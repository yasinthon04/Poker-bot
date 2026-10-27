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
          ? `🔄 <@${user.id}> กลับเข้าโต๊ะอีกครั้งด้วยเงิน **${session.default_buyin.toLocaleString()} บาท** (ยอดรวม ${result.totalBuyIn.toLocaleString()}฿)`
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
