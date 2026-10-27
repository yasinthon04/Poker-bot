import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import * as repo from '../database/repo';
import { createTableEmbed, createSummaryEmbed } from '../ui/embeds';
import { createTableActionRows } from '../ui/components';
import { generatePromptPayAttachment } from '../services/qr';

export const pokerCommand = {
  data: new SlashCommandBuilder()
    .setName('poker')
    .setDescription('คำสั่งจัดการโต๊ะ Poker')
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('เปิดโต๊ะ Poker ใหม่ในห้องนี้')
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ค่า Buy-in เริ่มต้น (ค่าเริ่มต้น 100 บาท)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('join')
        .setDescription('ซื้อชิปเข้าร่วมโต๊ะ')
        .addNumberOption(opt =>
          opt.setName('amount').setDescription('จำนวนเงิน (เว้นว่างไว้จะใช้ค่าเริ่มต้น)').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('rebuy')
        .setDescription('เติมชิปเพิ่ม (Rebuy)')
        .addNumberOption(opt =>
          opt.setName('amount').setDescription('จำนวนเงินที่เติม (เว้นว่างไว้จะใช้ค่าเริ่มต้น)').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('leave')
        .setDescription('ขอออกก่อน (Early Cash-out) ล็อคยอดชิปไว้')
        .addNumberOption(opt =>
          opt.setName('chips').setDescription('ชิปคงเหลือ ณ ตอนนี้ (ใส่ 0 ถ้าหมดตัว)').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set-chips')
        .setDescription('[Host] ตั้งค่ายอดชิปคงเหลือให้เพื่อน')
        .addUserOption(opt => opt.setName('player').setDescription('ผู้เล่น').setRequired(true))
        .addNumberOption(opt => opt.setName('chips').setDescription('จำนวนชิป').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('ปิดโต๊ะและคำนวณเงินเคลียร์หนี้')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('ดูสถานะโต๊ะปัจจุบันในห้องนี้')
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('[Host] ยกเลิกโต๊ะที่กำลังเล่นอยู่')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channelId;
    const guildId = interaction.guildId;
    const user = interaction.user;

    if (!guildId) {
      await interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น', ephemeral: true });
      return;
    }

    // Ensure user exists in DB
    repo.upsertUser(user.id, user.username, interaction.member && 'displayName' in interaction.member ? (interaction.member as any).displayName : user.displayName);

    // 1. START
    if (subcommand === 'start') {
      const activeSession = repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.reply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
          ephemeral: true,
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? 100;
      const session = repo.createSession(guildId, channelId, user.id, defaultBuyin);

      // Auto-add the host as the first player
      repo.addOrRebuyPlayer(session.id, user.id, defaultBuyin);
      const players = repo.getSessionPlayers(session.id);

      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);

      const reply = await interaction.reply({
        embeds: [embed],
        components: rows,
        fetchReply: true,
      });

      repo.updateSessionMessageId(session.id, reply.id);
      return;
    }

    // For other subcommands, get active session
    const session = repo.getActiveSession(channelId);
    if (!session) {
      await interaction.reply({
        content: '❌ ยังไม่มีโต๊ะ Poker ที่กำลังเล่นอยู่ในห้องนี้! พิมพ์ `/poker start` เพื่อเปิดโต๊ะ',
        ephemeral: true,
      });
      return;
    }

    // 2. STATUS
    if (subcommand === 'status') {
      const players = repo.getSessionPlayers(session.id);
      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);
      await interaction.reply({ embeds: [embed], components: rows });
      return;
    }

    // 3. JOIN / REBUY
    if (subcommand === 'join' || subcommand === 'rebuy') {
      const amount = interaction.options.getNumber('amount') ?? session.default_buyin;
      const result = repo.addOrRebuyPlayer(session.id, user.id, amount);

      const actionText = result.isRebuy
        ? `🔄 <@${user.id}> เติมชิปเพิ่ม **+${amount.toLocaleString()} บาท** (ยอดรวม ${result.totalBuyIn.toLocaleString()}฿)`
        : `🟢 <@${user.id}> เข้าร่วมโต๊ะด้วยเงิน **${amount.toLocaleString()} บาท**`;

      await interaction.reply({ content: actionText });
      await refreshTableMessage(interaction, session);
      return;
    }

    // 4. LEAVE (Early Cashout)
    if (subcommand === 'leave') {
      const chips = interaction.options.getNumber('chips', true);
      const leaveResult = repo.playerLeaveSession(session.id, user.id, chips);

      if (!leaveResult.success) {
        await interaction.reply({ content: '❌ คุณไม่ได้อยู่ในโต๊ะนี้ หรือออกจากโต๊ะไปแล้ว', ephemeral: true });
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

    // 5. SET-CHIPS (Host override)
    if (subcommand === 'set-chips') {
      if (interaction.user.id !== session.host_id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถตั้งค่าชิปได้', ephemeral: true });
        return;
      }

      const targetPlayer = interaction.options.getUser('player', true);
      const chips = interaction.options.getNumber('chips', true);

      repo.upsertUser(targetPlayer.id, targetPlayer.username);
      const leaveResult = repo.playerLeaveSession(session.id, targetPlayer.id, chips);

      if (!leaveResult.success) {
        await interaction.reply({ content: `❌ ผู้เล่น <@${targetPlayer.id}> ไม่อยู่ในโต๊ะนี้`, ephemeral: true });
        return;
      }

      await interaction.reply({
        content: `🔧 Host ได้ตั้งค่าชิปคงเหลือของ <@${targetPlayer.id}> เป็น **${chips.toLocaleString()} บาท** เรียบร้อยแล้ว`,
      });

      await refreshTableMessage(interaction, session);
      return;
    }

    // 6. CANCEL
    if (subcommand === 'cancel') {
      if (interaction.user.id !== session.host_id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถยกเลิกโต๊ะได้', ephemeral: true });
        return;
      }

      repo.cancelSession(session.id);
      await interaction.reply({ content: `🛑 โต๊ะ Poker Session #${session.id} ถูกยกเลิกเรียบร้อยแล้ว` });
      return;
    }

    // 7. END SESSION
    if (subcommand === 'end') {
      const players = repo.getSessionPlayers(session.id);
      const activePlayers = players.filter(p => p.status === 'playing');

      if (activePlayers.length > 5) {
        await interaction.reply({
          content: `⚠️ โต๊ะนี้ยังมีผู้เล่นที่ยังไม่ Cash-out ถึง ${activePlayers.length} คน (เกิน 5 คน)\nกรุณาให้ผู้เล่นกดปุ่ม **[🏃 ขอออกก่อน (Cash-out)]** หรือให้ Host ใช้คำสั่ง \`/poker set-chips @ผู้เล่น [ชิป]\` ให้เหลือไม่เกิน 5 คนก่อนปิดโต๊ะ`,
          ephemeral: true,
        });
        return;
      }

      // If active players <= 5, prompt end modal or finish if 0 active players
      if (activePlayers.length === 0) {
        // All players already cashed out!
        await finalizeAndDisplaySummary(interaction, session, {});
      } else {
        // Show modal to host/user to fill in remaining chips
        const { createEndSessionModal } = await import('../ui/components');
        const modal = createEndSessionModal(activePlayers);
        await interaction.showModal(modal);
      }
      return;
    }
  },
};

export async function refreshTableMessage(interaction: any, session: repo.SessionRow) {
  try {
    if (!session.message_id || !interaction.channel) return;
    const msg = await interaction.channel.messages.fetch(session.message_id).catch(() => null);
    if (!msg) return;

    const players = repo.getSessionPlayers(session.id);
    const embed = createTableEmbed(session, players);
    const rows = createTableActionRows(session.default_buyin);

    await msg.edit({ embeds: [embed], components: rows });
  } catch (err) {
    console.error('Failed to refresh table message:', err);
  }
}

export async function finalizeAndDisplaySummary(
  interaction: any,
  session: repo.SessionRow,
  activeChipsMap: Record<string, number>
) {
  const { settlement } = repo.finalizeSession(session.id, activeChipsMap);
  const players = repo.getSessionPlayers(session.id);

  // Map PromptPay IDs
  const ppMap: Record<string, string | null> = {};
  for (const p of players) {
    ppMap[p.user_id] = p.promptpay;
  }

  const embed = createSummaryEmbed(session, settlement, ppMap);

  // Find biggest winner to generate QR code if PromptPay is configured
  const topCreditor = settlement.players.find(p => p.net > 0 && ppMap[p.userId]);
  const files = [];

  if (topCreditor && ppMap[topCreditor.userId]) {
    // Generate QR for top winner
    const topAmount = topCreditor.net;
    const qrAttachment = await generatePromptPayAttachment(ppMap[topCreditor.userId]!, topAmount);
    if (qrAttachment) {
      embed.setImage('attachment://promptpay-qr.png');
      embed.addFields({
        name: `📱 QR Code พร้อมเพย์ของ ${topCreditor.name} (${topAmount.toLocaleString()}฿)`,
        value: `สามารถสแกน QR Code ด้านล่างเพื่อโอนเงินได้ทันที`,
      });
      files.push(qrAttachment);
    }
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], files });
  } else {
    await interaction.reply({ embeds: [embed], files });
  }
}
