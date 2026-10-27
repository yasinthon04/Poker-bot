import {
  Client,
  GatewayIntentBits,
  Interaction,
  PermissionFlagsBits,
} from 'discord.js';
import dotenv from 'dotenv';
import { pokerCommand, refreshTableMessage, finalizeAndDisplaySummary } from './commands/poker';
import { statsCommand, leaderboardCommand } from './commands/stats';
import { profileCommand } from './commands/profile';
import { clearCommand } from './commands/clear';
import { helpCommand } from './commands/help';
import * as repo from './database/repo';
import {
  createCustomRebuyModal,
  createLeaveModal,
  createEndSessionModal,
} from './ui/components';

import http from 'http';

dotenv.config();

// Koyeb / Cloud health check server
const port = process.env.PORT || 8000;
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🃏 Poker Bot is online and healthy!\n');
}).listen(port, () => {
  console.log(`🌐 Health check server listening on port ${port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

import { registerSlashCommands } from './register-commands';

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user?.tag}!`);
  console.log('🃏 Poker Bot is online and ready.');
  // Automatically register and sync slash commands on startup
  await registerSlashCommands();
});

client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      if (commandName === 'poker') {
        await pokerCommand.execute(interaction);
      } else if (commandName === 'stats') {
        await statsCommand.execute(interaction);
      } else if (commandName === 'leaderboard') {
        await leaderboardCommand.execute(interaction);
      } else if (commandName === 'profile') {
        await profileCommand.execute(interaction);
      } else if (commandName === 'clear') {
        await clearCommand.execute(interaction);
      } else if (commandName === 'help' || commandName === 'phelp') {
        await helpCommand.execute(interaction);
      }
      return;
    }

    // 2. Buttons
    if (interaction.isButton()) {
      const channelId = interaction.channelId;
      const user = interaction.user;

      // Next Round button (can be clicked on completed session summary)
      if (interaction.customId.startsWith('btn_poker_next_round_')) {
        const parts = interaction.customId.split('_');
        const oldSessionId = parseInt(parts[parts.length - 1], 10);

        const activeSession = await repo.getActiveSession(channelId);
        if (activeSession) {
          await interaction.reply({
            content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้อยู่แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
            ephemeral: true,
          });
          return;
        }

        const oldSession = await repo.getSessionById(oldSessionId);
        if (!oldSession) {
          await interaction.reply({
            content: '❌ ไม่พบข้อมูลโต๊ะรอบที่แล้วครับ',
            ephemeral: true,
          });
          return;
        }

        const oldPlayers = await repo.getSessionPlayers(oldSessionId);
        if (oldPlayers.length === 0) {
          await interaction.reply({
            content: '❌ ไม่พบรายชื่อผู้เล่นจากโต๊ะรอบที่แล้วครับ',
            ephemeral: true,
          });
          return;
        }

        const guildId = interaction.guildId;
        if (!guildId) return;

        const newSession = await repo.createSession(
          guildId,
          channelId,
          user.id,
          oldSession.default_buyin
        );

        for (const p of oldPlayers) {
          await repo.upsertUser(p.user_id, p.username, p.display_name);
          await repo.joinPlayer(newSession.id, p.user_id, oldSession.default_buyin);
        }

        const newPlayers = await repo.getSessionPlayers(newSession.id);
        const { createTableEmbed } = await import('./ui/embeds');
        const { createTableActionRows, createNextRoundActionRow } = await import('./ui/components');

        // Disable button on old summary message
        try {
          await interaction.update({ components: [createNextRoundActionRow(oldSessionId, true)] });
        } catch {}

        const embed = createTableEmbed(newSession, newPlayers);
        const rows = createTableActionRows(newSession.default_buyin);

        const reply = await interaction.followUp({
          content: `🎉 **เริ่มรอบใหม่ (Session #${newSession.id}) เรียบร้อยแล้ว!** ดึงผู้เล่นเดิม **${newPlayers.length} คน** เข้าโต๊ะอัตโนมัติ (Buy-in: **${newSession.default_buyin}฿**)`,
          embeds: [embed],
          components: rows,
          fetchReply: true,
        });

        await repo.updateSessionMessageId(newSession.id, reply.id);
        return;
      }

      // Recalculate button (can be clicked on completed session summary)
      if (interaction.customId.startsWith('btn_poker_recalc_')) {
        const parts = interaction.customId.split('_');
        const targetSessionId = parseInt(parts[parts.length - 1], 10);

        const targetSession = await repo.getSessionById(targetSessionId);
        if (!targetSession) {
          await interaction.reply({
            content: '❌ ไม่พบข้อมูลโต๊ะ Poker นี้ครับ',
            ephemeral: true,
          });
          return;
        }

        // Host or Admin permission
        if (
          interaction.user.id !== targetSession.host_id &&
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
        ) {
          await interaction.reply({
            content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถกดคำนวณใหม่ได้ครับ',
            ephemeral: true,
          });
          return;
        }

        const players = await repo.getSessionPlayers(targetSessionId);
        if (players.length > 5) {
          await interaction.reply({
            content: `⚠️ โต๊ะนี้มีผู้เล่นถึง ${players.length} คน (เกินขีดจำกัด 5 ช่องของ Discord Modal)\n💡 กรุณาใช้คำสั่ง \`/poker set-chips @ผู้เล่น [ชิป]\` เพื่อแก้ไขชิปทีละคน หรือใช้ \`/poker scan-table <รูปภาพ>\` เพื่อสแกนใหม่ครับ`,
            ephemeral: true,
          });
          return;
        }

        const { createRecalculateModal } = await import('./ui/components');
        await interaction.showModal(createRecalculateModal(targetSessionId, players));
        return;
      }

      const session = await repo.getActiveSession(channelId);

      if (!session) {
        await interaction.reply({
          content: '❌ ไม่พบโต๊ะ Poker ที่กำลังเล่นอยู่ในห้องนี้ หรือโต๊ะถูกปิดไปแล้ว',
          ephemeral: true,
        });
        return;
      }

      // Upsert user
      await repo.upsertUser(
        user.id,
        user.username,
        interaction.member && 'displayName' in interaction.member
          ? (interaction.member as any).displayName
          : user.displayName
      );

      // Join button
      if (interaction.customId === 'btn_poker_join') {
        const result = await repo.joinPlayer(session.id, user.id, session.default_buyin);
        if (result.alreadyPlaying) {
          await interaction.reply({
            content: `⚠️ คุณ <@${user.id}> อยู่ในโต๊ะนี้แล้วครับ (ยอดเงินปัจจุบัน: **${result.totalBuyIn.toLocaleString()}฿**)\nหากต้องการซื้อชิปเพิ่ม กรุณากดปุ่ม **[🔄 Rebuy]** แทนครับ`,
            ephemeral: true,
          });
          return;
        }

        const actionText = result.isRejoin
          ? `🔄 <@${user.id}> กลับเข้าโต๊ะมาเล่นต่อแล้ว (ยอดเงิน Buy-in เดิม: **${result.totalBuyIn.toLocaleString()} บาท**)`
          : `🟢 <@${user.id}> เข้าร่วมโต๊ะด้วยเงิน **${session.default_buyin.toLocaleString()} บาท**`;

        await interaction.reply({ content: actionText });
        await refreshTableMessage(interaction, session);
        return;
      }

      // Rebuy default button
      if (interaction.customId === 'btn_poker_rebuy') {
        const result = await repo.rebuyPlayer(session.id, user.id, session.default_buyin);
        if (result.notPlaying) {
          await interaction.reply({
            content: `❌ คุณยังไม่ได้เข้าร่วมโต๊ะนี้ กรุณากดปุ่ม **[🟢 เข้าร่วม]** ก่อนครับ`,
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: `🔄 <@${user.id}> เติมชิปเพิ่ม **+${session.default_buyin.toLocaleString()} บาท** (ยอดรวม ${result.totalBuyIn.toLocaleString()}฿)`,
        });
        await refreshTableMessage(interaction, session);
        return;
      }

      // Custom Rebuy button -> Show modal
      if (interaction.customId === 'btn_poker_custom_rebuy') {
        await interaction.showModal(createCustomRebuyModal());
        return;
      }

      // Leave button -> Show modal
      if (interaction.customId === 'btn_poker_leave') {
        await interaction.showModal(createLeaveModal());
        return;
      }

      // Refresh button
      if (interaction.customId === 'btn_poker_refresh') {
        await refreshTableMessage(interaction, session);
        await interaction.reply({ content: '🔄 รีเฟรชสถานะโต๊ะล่าสุดแล้ว', ephemeral: true });
        return;
      }

      // Preview button -> Show modal or calculate immediately
      if (interaction.customId === 'btn_poker_preview') {
        const players = await repo.getSessionPlayers(session.id);
        const activePlayers = players.filter(p => p.status === 'playing');

        if (activePlayers.length > 5) {
          await interaction.reply({
            content: `⚠️ โต๊ะนี้ยังมีผู้เล่นที่ยังไม่ Cash-out ถึง ${activePlayers.length} คน (เกิน 5 คน)\n💡 **แนะนำ:** ใช้คำสั่ง \`/poker scan-table <รูปภาพ> preview:True\` เพื่อให้ AI อ่านชิปทุกคนจากรูปภาพและพรีวิวยอดโอนเงินทันทีโดยไม่ต้องปิดโต๊ะครับ!`,
            ephemeral: true,
          });
          return;
        }

        if (activePlayers.length === 0) {
          const playerInputs = players.map(p => ({
            userId: p.user_id,
            name: p.display_name || p.username,
            buyIn: p.buy_in,
            cashOut: p.cash_out ?? 0,
          }));
          const { calculateSettlements } = await import('./services/settlement');
          const settlement = calculateSettlements(playerInputs);

          const ppMap: Record<string, string | null> = {};
          for (const p of players) {
            ppMap[p.user_id] = p.promptpay;
          }

          const { createSummaryEmbed } = await import('./ui/embeds');
          const embed = createSummaryEmbed(session, settlement, ppMap, true);
          await interaction.reply({ embeds: [embed] });
          return;
        }

        const { createPreviewSessionModal } = await import('./ui/components');
        await interaction.showModal(createPreviewSessionModal(activePlayers));
        return;
      }

      // End Session button
      if (interaction.customId === 'btn_poker_end') {
        if (
          interaction.user.id !== session.host_id &&
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
        ) {
          await interaction.reply({
            content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถกดปิดโต๊ะได้',
            ephemeral: true,
          });
          return;
        }

        const players = await repo.getSessionPlayers(session.id);
        const activePlayers = players.filter(p => p.status === 'playing');

        if (activePlayers.length > 5) {
          await interaction.reply({
            content: `⚠️ โต๊ะนี้ยังมีผู้เล่นที่ยังไม่ Cash-out ถึง ${activePlayers.length} คน (เกิน 5 คน)\nกรุณาให้ผู้เล่นกดปุ่ม **[🏃 ขอออกก่อน (Cash-out)]** หรือให้ Host ใช้คำสั่ง \`/poker set-chips @ผู้เล่น [ชิป]\` ให้เหลือไม่เกิน 5 คนก่อนปิดโต๊ะ`,
            ephemeral: true,
          });
          return;
        }

        if (activePlayers.length === 0) {
          await finalizeAndDisplaySummary(interaction, session, {});
          return;
        }

        await interaction.showModal(createEndSessionModal(activePlayers));
        return;
      }
    }

    // 3. Modals
    if (interaction.isModalSubmit()) {
      const channelId = interaction.channelId;
      if (!channelId) return;
      const user = interaction.user;
      // Recalculate Modal Submit (handles completed or active session)
      if (interaction.customId.startsWith('modal_poker_recalc_')) {
        const parts = interaction.customId.split('_');
        const targetSessionId = parseInt(parts[parts.length - 1], 10);

        const targetSession = await repo.getSessionById(targetSessionId);
        if (!targetSession) {
          await interaction.reply({
            content: '❌ ไม่พบข้อมูลโต๊ะ Poker นี้ครับ',
            ephemeral: true,
          });
          return;
        }

        const players = await repo.getSessionPlayers(targetSessionId);
        const activeChipsMap: Record<string, number> = {};

        for (const player of players) {
          try {
            const raw = interaction.fields.getTextInputValue(`recalc_${player.user_id}`);
            const chips = parseFloat(raw);
            activeChipsMap[player.user_id] = isNaN(chips) ? 0 : chips;
          } catch {
            activeChipsMap[player.user_id] = player.cash_out ?? 0;
          }
        }

        await finalizeAndDisplaySummary(interaction, targetSession, activeChipsMap);
        return;
      }

      const session = await repo.getActiveSession(channelId);

      if (!session) {
        await interaction.reply({
          content: '❌ ไม่พบโต๊ะ Poker ที่กำลังเล่นอยู่ในห้องนี้ หรือโต๊ะถูกปิดไปแล้ว',
          ephemeral: true,
        });
        return;
      }

      // Custom Rebuy Submit
      if (interaction.customId === 'modal_poker_custom_rebuy') {
        const rawAmount = interaction.fields.getTextInputValue('input_amount');
        const amount = parseFloat(rawAmount);

        if (isNaN(amount) || amount <= 0) {
          await interaction.reply({ content: '❌ กรุณากรอกจำนวนเงินเป็นตัวเลขที่มากกว่า 0', ephemeral: true });
          return;
        }

        const result = await repo.rebuyPlayer(session.id, user.id, amount);
        if (result.notPlaying) {
          await interaction.reply({
            content: `❌ คุณยังไม่ได้เข้าร่วมโต๊ะนี้ กรุณากดปุ่ม **[🟢 เข้าร่วม]** ก่อนครับ`,
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: `➕ <@${user.id}> เติมชิปเพิ่ม **+${amount.toLocaleString()} บาท** (ยอดรวม ${result.totalBuyIn.toLocaleString()}฿)`,
        });
        await refreshTableMessage(interaction, session);
        return;
      }

      // Leave Submit
      if (interaction.customId === 'modal_poker_leave') {
        const rawChips = interaction.fields.getTextInputValue('input_chips');
        const chips = parseFloat(rawChips);

        if (isNaN(chips) || chips < 0) {
          await interaction.reply({
            content: '❌ กรุณากรอกจำนวนชิปเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0 (ใส่ 0 ถ้าหมดตัว)',
            ephemeral: true,
          });
          return;
        }

        const leaveResult = await repo.playerLeaveSession(session.id, user.id, chips);
        if (!leaveResult.success) {
          await interaction.reply({
            content: '❌ คุณไม่ได้อยู่ในโต๊ะนี้ หรือออกจากโต๊ะไปแล้ว',
            ephemeral: true,
          });
          return;
        }

        const sign = leaveResult.net > 0 ? '+' : '';
        const icon = leaveResult.net >= 0 ? '🟢' : '🔴';
        await interaction.reply({
          content: `🏃 <@${user.id}> ขอออกก่อนโดยมีชิป **${chips.toLocaleString()} บาท** (${icon} กำไร/ขาดทุน: **${sign}${leaveResult.net.toLocaleString()} บาท**) บอทล็อคยอดไว้เรียบร้อยแล้ว`,
        });

        await refreshTableMessage(interaction, session);
        return;
      }

      // End Session Chips Submit
      if (interaction.customId === 'modal_poker_end_chips') {
        const players = await repo.getSessionPlayers(session.id);
        const activePlayers = players.filter(p => p.status === 'playing');

        const activeChipsMap: Record<string, number> = {};
        for (const player of activePlayers) {
          try {
            const raw = interaction.fields.getTextInputValue(`chips_${player.user_id}`);
            const chips = parseFloat(raw);
            activeChipsMap[player.user_id] = isNaN(chips) ? 0 : chips;
          } catch {
            activeChipsMap[player.user_id] = 0;
          }
        }

        await finalizeAndDisplaySummary(interaction, session, activeChipsMap);
        return;
      }

      // Preview Session Chips Submit
      if (interaction.customId === 'modal_poker_preview_chips') {
        const players = await repo.getSessionPlayers(session.id);
        const activePlayers = players.filter(p => p.status === 'playing');

        const activeChipsMap: Record<string, number> = {};
        for (const player of activePlayers) {
          try {
            const raw = interaction.fields.getTextInputValue(`preview_chips_${player.user_id}`);
            const chips = parseFloat(raw);
            activeChipsMap[player.user_id] = isNaN(chips) ? 0 : chips;
          } catch {
            activeChipsMap[player.user_id] = 0;
          }
        }

        const playerInputs = players.map(p => ({
          userId: p.user_id,
          name: p.display_name || p.username,
          buyIn: p.buy_in,
          cashOut: activeChipsMap[p.user_id] ?? (p.cash_out ?? 0),
        }));
        const { calculateSettlements } = await import('./services/settlement');
        const settlement = calculateSettlements(playerInputs);

        const ppMap: Record<string, string | null> = {};
        for (const p of players) {
          ppMap[p.user_id] = p.promptpay;
        }

        const { createSummaryEmbed } = await import('./ui/embeds');
        const embed = createSummaryEmbed(session, settlement, ppMap, true);
        await interaction.reply({
          content: `🔍 **<@${user.id}> ได้เปิดดูพรีวิวสรุปยอดเงินปัจจุบัน (โต๊ะยังเปิดอยู่ ไม่ได้ปิดโต๊ะ):**`,
          embeds: [embed],
        });
        return;
      }
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '⚠️ เกิดข้อผิดพลาดในการประมวลผลคำสั่ง กรุณาลองใหม่อีกครั้ง',
        ephemeral: true,
      });
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (token && token !== 'your_bot_token_here') {
  client.login(token);
} else {
  console.log('⚠️ Warning: DISCORD_TOKEN is not set or still default in .env. Bot is not logged in yet.');
}
