import {
  Client,
  GatewayIntentBits,
  Interaction,
  Message,
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
  createAiScanPromptRow,
  createPreviewActionRow,
} from './ui/components';

import http from 'http';
import fs from 'fs';
import path from 'path';
import { PokerGameManager } from './game/server';

dotenv.config();

// Koyeb / Cloud health check and Activity server
const port = process.env.PORT || 8000;
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/' || url.startsWith('/activity')) {
    const activityHtmlPath = path.join(process.cwd(), 'public', 'activity', 'index.html');
    if (fs.existsSync(activityHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(activityHtmlPath).pipe(res);
      return;
    }
  }

  if (url.startsWith('/data/qr_images/')) {
    const cleanUrl = url.split('?')[0];
    const imagePath = path.join(process.cwd(), cleanUrl);
    if (fs.existsSync(imagePath)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(imagePath).pipe(res);
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🃏 Poker Bot is online and healthy!\n');
});

PokerGameManager.getInstance().attachToHttpServer(server);

server.listen(port, () => {
  console.log(`🌐 Health check & Poker Activity server listening on port ${port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const pendingScanCollectors = new Map<string, any>();

import { registerSlashCommands } from './register-commands';
import { isSupabaseConfigured } from './database/supabase';
import { autoMigrateLocalData } from './database/supabase-repo';

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user?.tag}!`);
  console.log('🃏 Poker Bot is online and ready.');

  if (isSupabaseConfigured()) {
    console.log('⚡ Database: Connected to Supabase (Permanent Cloud Storage)');
    await autoMigrateLocalData();
  } else {
    console.log('📁 Database: Using local JSON storage (data/poker-data.json)');
    console.log('💡 Tip: Set SUPABASE_URL and SUPABASE_KEY in .env for permanent cloud storage!');
  }

  // Automatically register and sync slash commands on startup
  await registerSlashCommands();

  // Attach discord client to PokerGameManager for auto-settlement channel announcements
  PokerGameManager.getInstance().setDiscordClient(client);
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

        const uniqueOldPlayers = Array.from(new Map(oldPlayers.map(p => [p.user_id, p])).values());
        for (const p of uniqueOldPlayers) {
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

      // Edit / Recalculate button (can be clicked on completed session summary)
      if (
        interaction.customId.startsWith('btn_poker_edit_') ||
        interaction.customId.startsWith('btn_poker_recalc_')
      ) {
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
            content: '❌ เฉพาะ Host ของโต๊ะนี้หรือแอดมินเท่านั้นที่สามารถแก้ไขข้อมูลได้ครับ',
            ephemeral: true,
          });
          return;
        }

        const players = await repo.getSessionPlayers(targetSessionId);
        const { formatPlayersForModal } = await import('./services/manual-parser');
        const { createManualEditModal } = await import('./ui/components');
        const prefilledText = formatPlayersForModal(targetSession.default_buyin, players);

        await interaction.showModal(createManualEditModal(targetSessionId, targetSession.default_buyin, prefilledText));
        return;
      }

      // Leaderboard button (from completed session summary)
      if (interaction.customId === 'btn_poker_leaderboard') {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น', ephemeral: true });
          return;
        }

        const statsList = await repo.getRankedStats(guildId);
        const { createRankedLeaderboardEmbed } = await import('./ui/embeds');
        const embed = createRankedLeaderboardEmbed('🌟 ทำเนียบเซียน Poker (All-time Leaderboard)', statsList);
        await interaction.reply({ embeds: [embed] });
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
          ? `🔄 <@${user.id}> กลับเข้าโต๊ะมา Buy-in เล่นรอบใหม่ด้วยเงิน **${session.default_buyin.toLocaleString()} บาท** (ยอดออกก่อนหน้ายังคงเดิม)`
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

      // Check Status button
      if (interaction.customId === 'btn_poker_status') {
        await refreshTableMessage(interaction, session);
        const players = await repo.getSessionPlayers(session.id);
        const { createTableEmbed } = await import('./ui/embeds');
        const embed = createTableEmbed(session, players);

        const currentPlayer = players.find(p => p.user_id === user.id && p.status === 'playing');
        const personalNote = currentPlayer
          ? `\n👤 สถานะของคุณ: **กำลังเล่นอยู่** (ยอด Buy-in รวม: **${currentPlayer.buy_in.toLocaleString()}฿**)`
          : '';

        await interaction.reply({
          content: `📊 **สถานะโต๊ะ Poker ล่าสุด (Session #${session.id}):**${personalNote}`,
          embeds: [embed],
          ephemeral: true,
        });
        return;
      }

      // AI Scan button -> Show prompt (Preview vs End Session)
      if (interaction.customId === 'btn_poker_ai_scan') {
        const isHostOrAdmin =
          interaction.user.id === session.host_id ||
          !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

        await interaction.reply({
          content:
            `📸 **คิดเงินอัตโนมัติด้วย AI (Gemini Vision)**\n` +
            `เลือกรูปแบบที่คุณต้องการคำนวณ:\n\n` +
            `• **🧮 สแกนคิดเงิน (ไม่ปิดโต๊ะ):** AI อ่านชิป สรุปยอดกำไร/ขาดทุน และสร้าง QR พร้อมเพย์ให้ดูทันที แต่ยังคงเปิดโต๊ะให้เล่นต่อตามปกติ *(ทุกคนกดได้)*\n` +
            `• **🏁 สแกนคิดเงิน & ปิดโต๊ะ:** คำนวณเงินพร้อมบันทึกสถิติและปิดโต๊ะ เพื่อเตรียมเริ่มรอบถัดไป *(เฉพาะ Host/Admin)*`,
          components: [createAiScanPromptRow(session.id, isHostOrAdmin)],
          ephemeral: true,
        });
        return;
      }

      // AI Scan Prompt choices (Preview or End)
      if (
        interaction.customId.startsWith('btn_poker_ai_prompt_preview_') ||
        interaction.customId.startsWith('btn_poker_ai_prompt_end_')
      ) {
        const isPreview = interaction.customId.startsWith('btn_poker_ai_prompt_preview_');
        const isHostOrAdmin =
          interaction.user.id === session.host_id ||
          !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

        if (!isPreview && !isHostOrAdmin) {
          await interaction.reply({
            content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถเลือกสแกนและปิดโต๊ะได้ครับ',
            ephemeral: true,
          });
          return;
        }

        const channel = interaction.channel;
        if (!channel || !('createMessageCollector' in channel)) {
          await interaction.reply({
            content: '❌ ไม่สามารถสร้างตัวรับรูปภาพในห้องนี้ได้',
            ephemeral: true,
          });
          return;
        }

        await interaction.update({
          content:
            `📸 **โหมดสแกน AI (${isPreview ? '🧮 ไม่ปิดโต๊ะ' : '🏁 ปิดโต๊ะและจบเกม'}):**\n` +
            `⏳ **กรุณาแนบและส่งรูปภาพหน้าจอโต๊ะ Poker เข้ามาในห้องแชทนี้ได้เลยครับ!**\n` +
            `*(มีเวลารับรูปภาพ 60 วินาที — แนบรูปในแชทปกติแล้วส่งได้ทันที บอทจะเริ่มสแกนและคำนวณเงินให้อัตโนมัติ)*\n` +
            `💡 *หากบอทไม่อ่านรูป สามารถพิมพ์ @บอท พร้อมแนบรูปภาพได้ครับ*`,
          components: [],
        });

        // Cancel previous collector if existing for this user
        if (pendingScanCollectors.has(user.id)) {
          try {
            pendingScanCollectors.get(user.id)?.stop('replaced');
          } catch {}
          pendingScanCollectors.delete(user.id);
        }

        const filter = (m: Message) => m.author.id === user.id && m.attachments.size > 0;
        const collector = channel.createMessageCollector({ filter, max: 1, time: 60000 });
        pendingScanCollectors.set(user.id, collector);

        collector.on('collect', async (msg: Message) => {
          pendingScanCollectors.delete(user.id);

          const attachment = msg.attachments.first();
          if (!attachment || !attachment.contentType?.startsWith('image/')) {
            await msg.reply('⚠️ ไฟล์ที่แนบต้องเป็นรูปภาพครับ กรุณาลองกดปุ่มสแกนใหม่อีกครั้ง');
            return;
          }

          const statusMsg = await msg.reply({
            content: `🔍 **AI กำลังสแกนรูปภาพและคำนวณเงิน (${isPreview ? 'แบบไม่ปิดโต๊ะ' : 'แบบปิดโต๊ะ'})...** ⏳ กรุณารอสักครู่`,
          });

          const replyAdapter = {
            channel: msg.channel,
            replied: true,
            deferred: true,
            editReply: async (data: any) => {
              return await statusMsg.edit(data);
            },
            followUp: async (data: any) => {
              return await (msg.channel as any).send(data);
            },
            reply: async (data: any) => {
              return await msg.reply(data);
            },
          };

          try {
            const { processTableScan } = await import('./commands/poker');
            await processTableScan(
              replyAdapter,
              session,
              attachment.url,
              attachment.name || 'scanned-table.png',
              isPreview
            );
          } catch (err: any) {
            console.error('Failed to parse poker screenshot via button collector:', err);
            if (err.message?.includes('GEMINI_API_KEY')) {
              await statusMsg.edit({
                content: '❌ ยังไม่ได้ตั้งค่า `GEMINI_API_KEY` ในไฟล์ `.env` ครับ!\n💡 คุณสามารถรับ API Key ได้ฟรีที่: https://aistudio.google.com/apikey',
              });
            } else {
              await statusMsg.edit({
                content: `⚠️ เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพ: ${err.message}`,
              });
            }
          }
        });

        collector.on('end', async (_collected, reason) => {
          pendingScanCollectors.delete(user.id);
          if (reason === 'time') {
            try {
              await interaction.followUp({
                content: '⏰ หมดเวลารอรับรูปภาพ (60 วินาที) หากต้องการสแกน กรุณากดปุ่ม [📸 คิดเงินด้วย AI] ใหม่อีกครั้งครับ',
                ephemeral: true,
              });
            } catch {}
          }
        });

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

          const ppMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
          for (const p of players) {
            ppMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
          }

          const { createSummaryEmbed } = await import('./ui/embeds');
          const embed = createSummaryEmbed(session, settlement, ppMap, true);
          const files: any[] = [];

          const topCreditor = settlement.players.find(
            p =>
              p.net > 0 &&
              !p.isBot &&
              !p.userId.startsWith('bot_') &&
              (ppMap[p.userId]?.qrImageUrl || ppMap[p.userId]?.promptpay)
          );
          if (topCreditor) {
            const pInfo = ppMap[topCreditor.userId];
            const { resolvePaymentAttachment } = await import('./services/qr');
            const qrResult = await resolvePaymentAttachment(
              {
                userId: topCreditor.userId,
                name: topCreditor.name,
                promptpay: pInfo?.promptpay,
                qrImageUrl: pInfo?.qrImageUrl,
              },
              topCreditor.net
            );
            if (qrResult) {
              embed.setImage(`attachment://${qrResult.imageFileName}`);
              embed.addFields({
                name: qrResult.sourceType === 'custom_qr'
                  ? `📱 QR Code รับเงินของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`
                  : `📱 QR Code พร้อมเพย์ของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`,
                value: qrResult.sourceType === 'custom_qr'
                  ? `สแกน QR Code ด้านล่างเพื่อโอนเงินเข้าบัญชีได้ทันที (QR ที่ผู้เล่นอัปโหลดไว้)`
                  : `สามารถสแกน QR Code ด้านล่างเพื่อโอนเงินได้ทันที (สร้างยอดอัตโนมัติ ${topCreditor.net.toLocaleString()} บาท)`,
              });
              files.push(qrResult.attachment);
            }
          }

          await interaction.reply({
            content: `🧮 **<@${user.id}> ได้คำนวณเงินปัจจุบัน (โต๊ะยังคงเปิดอยู่ตามปกติ ไม่ได้ปิดโต๊ะ):**`,
            embeds: [embed],
            files,
            components: [createPreviewActionRow(session.id)],
          });
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

      // Manual Record Modal Submit
      if (interaction.customId === 'modal_poker_manual_record') {
        const rawBuyin = interaction.fields.getTextInputValue('input_buyin');
        const rawPlayers = interaction.fields.getTextInputValue('input_players');
        const buyIn = parseFloat(rawBuyin) || 200;

        await interaction.deferReply();
        const { executeManualSettlement } = await import('./commands/poker');
        await executeManualSettlement(interaction, rawPlayers, buyIn);
        return;
      }

      // Manual Edit Modal Submit
      if (interaction.customId.startsWith('modal_poker_manual_edit_')) {
        const parts = interaction.customId.split('_');
        const targetSessionId = parseInt(parts[parts.length - 1], 10);
        const rawBuyin = interaction.fields.getTextInputValue('input_buyin');
        const rawPlayers = interaction.fields.getTextInputValue('input_players');
        const buyIn = parseFloat(rawBuyin) || 200;

        await interaction.deferReply();
        const { executeManualSettlement } = await import('./commands/poker');
        await executeManualSettlement(interaction, rawPlayers, buyIn, targetSessionId);
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
          cashOut: p.status === 'playing' ? (activeChipsMap[p.user_id] ?? 0) : (p.cash_out ?? 0),
        }));
        const { calculateSettlements } = await import('./services/settlement');
        const settlement = calculateSettlements(playerInputs);

        const ppMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
        for (const p of players) {
          ppMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
        }

        const { createSummaryEmbed } = await import('./ui/embeds');
        const embed = createSummaryEmbed(session, settlement, ppMap, true);
        const files: any[] = [];

        const topCreditor = settlement.players.find(
          p =>
            p.net > 0 &&
            !p.isBot &&
            !p.userId.startsWith('bot_') &&
            (ppMap[p.userId]?.qrImageUrl || ppMap[p.userId]?.promptpay)
        );
        if (topCreditor) {
          const pInfo = ppMap[topCreditor.userId];
          const { resolvePaymentAttachment } = await import('./services/qr');
          const qrResult = await resolvePaymentAttachment(
            {
              userId: topCreditor.userId,
              name: topCreditor.name,
              promptpay: pInfo?.promptpay,
              qrImageUrl: pInfo?.qrImageUrl,
            },
            topCreditor.net
          );
          if (qrResult) {
            embed.setImage(`attachment://${qrResult.imageFileName}`);
            embed.addFields({
              name: qrResult.sourceType === 'custom_qr'
                ? `📱 QR Code รับเงินของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`
                : `📱 QR Code พร้อมเพย์ของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`,
              value: qrResult.sourceType === 'custom_qr'
                ? `สแกน QR Code ด้านล่างเพื่อโอนเงินเข้าบัญชีได้ทันที (QR ที่ผู้เล่นอัปโหลดไว้)`
                : `สามารถสแกน QR Code ด้านล่างเพื่อโอนเงินได้ทันที (สร้างยอดอัตโนมัติ ${topCreditor.net.toLocaleString()} บาท)`,
            });
            files.push(qrResult.attachment);
          }
        }

        await interaction.reply({
          content: `🧮 **<@${user.id}> ได้คำนวณเงินปัจจุบัน (โต๊ะยังคงเปิดอยู่ตามปกติ ไม่ได้ปิดโต๊ะ):**`,
          embeds: [embed],
          files,
          components: [createPreviewActionRow(session.id)],
        });
        return;
      }
    }
  } catch (error: any) {
    console.error('Error handling interaction:', error);
    try {
      if (interaction.isRepliable()) {
        const errorContent = `⚠️ เกิดข้อผิดพลาด: ${error?.message || 'กรุณาลองใหม่อีกครั้ง'}`;
        if (interaction.deferred) {
          await interaction.editReply({ content: errorContent });
        } else if (!interaction.replied) {
          await interaction.reply({ content: errorContent, ephemeral: true });
        }
      }
    } catch (replyErr) {
      console.error('Failed to send error reply:', replyErr);
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (token && token !== 'your_bot_token_here') {
  client.login(token);
} else {
  console.log('⚠️ Warning: DISCORD_TOKEN is not set or still default in .env. Bot is not logged in yet.');
}
