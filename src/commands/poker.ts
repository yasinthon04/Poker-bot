import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  GuildMember,
  ChannelType,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import * as repo from '../database/repo';
import { createTableEmbed, createSummaryEmbed } from '../ui/embeds';
import { createTableActionRows } from '../ui/components';
import { resolvePaymentAttachment } from '../services/qr';

export const pokerCommand = {
  data: new SlashCommandBuilder()
    .setName('poker')
    .setDescription('คำสั่งจัดการโต๊ะ Poker')
    .addSubcommand(sub =>
      sub
        .setName('play')
        .setDescription('เปิดโต๊ะเล่น Poker ทันที (Discord Activity / Web Table พร้อมระบบ Bot)')
    )
    .addSubcommand(sub =>
      sub
        .setName('start')
        .setDescription('เปิดโต๊ะ Poker ใหม่ในห้องนี้')
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ค่า Buy-in เริ่มต้น (ค่าเริ่มต้น 200 บาท)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('start-voice')
        .setDescription('เปิดโต๊ะและดึงทุกคนในห้อง Voice Call เข้าโต๊ะอัตโนมัติ')
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ค่า Buy-in เริ่มต้น (ค่าเริ่มต้น 200 บาท)')
            .setRequired(false)
            .setMinValue(1)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('เลือกห้องเสียง (ไม่ระบุ = ตรวจจับห้องเสียงที่คุณกำลังอยู่โดยอัตโนมัติ)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('scan-table')
        .setDescription('สแกนรูปภาพหน้าจอโต๊ะโป๊กเกอร์ (AI อ่านชื่อและชิปทุกคนเพื่อคิดเงินอัตโนมัติ)')
        .addAttachmentOption(opt =>
          opt
            .setName('image')
            .setDescription('รูปภาพแคปหน้าจอโต๊ะโป๊กเกอร์ตอนจบเกม')
            .setRequired(true)
        )
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ยอด Buy-in ต่อคน (ค่าเริ่มต้น 200 บาท สำหรับกรณีที่ไม่ได้เปิดโต๊ะไว้)')
            .setRequired(false)
            .setMinValue(1)
        )
        .addBooleanOption(opt =>
          opt
            .setName('preview')
            .setDescription('ดูผลคำนวณอย่างเดียวโดยไม่ต้องปิดโต๊ะ (ค่าเริ่มต้น: false)')
            .setRequired(false)
        )
        .addUserOption(opt =>
          opt
            .setName('leaver')
            .setDescription('ผู้เล่นที่ออกจากโต๊ะไปก่อน (ถ้ามี)')
            .setRequired(false)
        )
        .addNumberOption(opt =>
          opt
            .setName('leaver_chips')
            .setDescription('จำนวนชิปของคนที่ออกไปก่อน (ถ้าไม่ใส่ บอทจะคำนวณจากกองกลางให้อัตโนมัติ)')
            .setRequired(false)
            .setMinValue(0)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('preview')
        .setDescription('ดูสรุปยอดเงินและกำไร/ขาดทุนปัจจุบันโดยไม่ต้องปิดโต๊ะ')
    )
    .addSubcommand(sub =>
      sub
        .setName('next-round')
        .setDescription('เริ่มรอบใหม่ทันทีโดยดึงผู้เล่นจากรอบล่าสุดเข้าโต๊ะอัตโนมัติ')
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ค่า Buy-in สำหรับรอบใหม่ (ไม่ใส่จะใช้เท่าเดิม)')
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
        .setName('set-buyin')
        .setDescription('[Host] แก้ไขยอดเงิน Buy-in ของผู้เล่น (เผื่อกด Rebuy พลาด)')
        .addUserOption(opt => opt.setName('player').setDescription('ผู้เล่น').setRequired(true))
        .addNumberOption(opt =>
          opt.setName('amount').setDescription('ยอดเงิน Buy-in ใหม่').setRequired(true).setMinValue(0)
        )
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
    )
    .addSubcommand(sub =>
      sub
        .setName('record')
        .setDescription('บันทึกและคิดเงินแบบพิมพ์เอง (คำนวณหนี้, บันทึกลง Leaderboard และแก้ไขได้ตลอด)')
        .addStringOption(opt =>
          opt
            .setName('players')
            .setDescription('รายชื่อและยอดเงิน (เช่น @A 350, @B 50 หรือ @A 350 buyin:400) หากไม่ใส่จะเปิดฟอร์มกรอก')
            .setRequired(false)
        )
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ยอด Buy-in พื้นฐานสำหรับทุกคน (ค่าเริ่มต้น 200 บาท)')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('[Host] แก้ไขยอดเงินหรือผู้เล่นของรอบที่บันทึกไว้ (อัปเดต Leaderboard อัตโนมัติ)')
        .addIntegerOption(opt =>
          opt
            .setName('session_id')
            .setDescription('เลข Session ID ที่ต้องการแก้ไข (เว้นว่างไว้จะใช้รอบล่าสุดในห้องนี้)')
            .setRequired(false)
            .setMinValue(1)
        )
        .addStringOption(opt =>
          opt
            .setName('players')
            .setDescription('ข้อมูลผู้เล่นและยอดเงินใหม่ (เว้นว่างไว้จะเปิดฟอร์มแก้ไข)')
            .setRequired(false)
        )
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ยอด Buy-in พื้นฐานใหม่')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('reset-all')
        .setDescription('[Admin] ล้างประวัติโต๊ะ การเล่น และหนี้ทั้งหมดออกจากระบบเพื่อเริ่มใหม่')
        .addBooleanOption(opt =>
          opt
            .setName('confirm')
            .setDescription('ยืนยันว่าต้องการล้างข้อมูลทั้งหมดจริงหรือไม่ (เลือก True)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('help')
        .setDescription('ดูคู่มือและคำสั่งทั้งหมดของบอท Poker Bot')
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

    // Ensure user exists in DB (non-blocking to ensure instant response within 3s)
    repo.upsertUser(
      user.id,
      user.username,
      interaction.member && 'displayName' in interaction.member
        ? (interaction.member as any).displayName
        : user.displayName
    ).catch(err => console.error('Background upsertUser error:', err));

    // HELP (No active session needed)
    if (subcommand === 'help') {
      const { helpCommand } = await import('./help');
      await helpCommand.execute(interaction);
      return;
    }

    // RESET-ALL (Admin only)
    if (subcommand === 'reset-all') {
      if (
        !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({
          content: '❌ เฉพาะผู้ดูแลเซิร์ฟเวอร์ (Admin / Manage Server) เท่านั้นที่สามารถใช้คำสั่งนี้ได้ครับ',
          ephemeral: true,
        });
        return;
      }

      const confirm = interaction.options.getBoolean('confirm', true);
      if (!confirm) {
        await interaction.reply({
          content: '❌ กรุณาเลือก `confirm: True` เพื่อยืนยันการล้างข้อมูลทั้งหมด',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();
      await repo.resetAllData();
      await interaction.editReply({
        content:
          '🗑️ **ล้างข้อมูลโต๊ะโป๊กเกอร์ การเล่น และการคำนวณหนี้ทั้งหมดออกจากระบบเรียบร้อยแล้วครับ!**\n💡 โต๊ะและฐานข้อมูลสะอาดพร้อมเริ่มเล่นรอบใหม่ได้ทันทีด้วย `/poker start`',
      });
      return;
    }

    // 0. PLAY (Discord Activity / Interactive Live Table)
    if (subcommand === 'play') {
      const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 8000}`;
      const playUrl = `${baseUrl}/activity?channel_id=${channelId}&user_id=${user.id}&display_name=${encodeURIComponent(
        user.displayName || user.username
      )}`;

      const embed = new EmbedBuilder()
        .setTitle('🎮 โต๊ะเกม Texas Hold\'em Poker (Live Activity)')
        .setDescription(
          `คลิกปุ่มด้านล่างเพื่อเปิดหน้าต่างโต๊ะโป๊กเกอร์แบบสด เล่นได้ทันทีใน Discord หรือเบราว์เซอร์!\n\n` +
          `• 👥 **เล่นกับเพื่อน:** สามารถกดลิงก์นี้เพื่อเข้าโต๊ะเดียวกันได้สูงสุด 9 คน\n` +
          `• 🤖 **ระบบ Bot:** สามารถกดปุ่ม **[🤖 เพิ่ม Bot]** บนโต๊ะเพื่อเติมที่นั่งว่างหรือซ้อมมือได้\n` +
          `• 🛡️ **กฎการคิดเงิน:** หากมี Bot ร่วมเล่น จะเป็น **โหมดเล่นสนุก (ไม่คิดเงินจริง)** ป้องกันหนี้มั่วอัตโนมัติ\n` +
          `• 🏁 **จบเกม:** เมื่อเล่นเสร็จ กดปุ่ม "คิดเงิน" บนโต๊ะ บอทจะสรุปผลและส่งบิลลงห้องนี้ให้ทันที`
        )
        .setColor(0x2ecc71)
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/2618/2618496.png')
        .setFooter({ text: '🃏 พัฒนาโดย Poker Bot • รองรับทั้ง PC และมือถือ' })
        .setTimestamp();

      const button = new ButtonBuilder()
        .setLabel('🎮 เข้าโต๊ะเล่น Poker ทันที')
        .setStyle(ButtonStyle.Link)
        .setURL(playUrl);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

      await interaction.reply({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    // RECORD (Manual settlement typing or modal)
    if (subcommand === 'record') {
      const playersOption = interaction.options.getString('players');
      const buyinOption = interaction.options.getNumber('buyin') ?? 200;

      if (playersOption) {
        await interaction.deferReply();
        await executeManualSettlement(interaction, playersOption, buyinOption);
      } else {
        const { createManualRecordModal } = await import('../ui/components');
        await interaction.showModal(createManualRecordModal(buyinOption));
      }
      return;
    }

    // EDIT (Edit completed or manual session)
    if (subcommand === 'edit') {
      const sessionIdOption = interaction.options.getInteger('session_id');
      const playersOption = interaction.options.getString('players');
      const buyinOption = interaction.options.getNumber('buyin');

      let targetSession: repo.SessionRow | null = null;
      if (sessionIdOption) {
        targetSession = (await repo.getSessionById(sessionIdOption)) || null;
      } else {
        targetSession = (await repo.getLastSession(channelId)) || (await repo.getActiveSession(channelId)) || null;
      }

      if (!targetSession) {
        await interaction.reply({
          content: '❌ ไม่พบข้อมูลโต๊ะหรือรอบ Poker ที่ต้องการแก้ไขครับ',
          ephemeral: true,
        });
        return;
      }

      // Check Host or Admin permission
      if (
        interaction.user.id !== targetSession.host_id &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({
          content: '❌ เฉพาะ Host ของโต๊ะนี้หรือแอดมินเท่านั้นที่สามารถแก้ไขข้อมูลรอบนี้ได้ครับ',
          ephemeral: true,
        });
        return;
      }

      const finalBuyIn = buyinOption ?? targetSession.default_buyin ?? 200;

      if (playersOption) {
        await interaction.deferReply();
        await executeManualSettlement(interaction, playersOption, finalBuyIn, targetSession.id);
      } else {
        const players = await repo.getSessionPlayers(targetSession.id);
        const { formatPlayersForModal } = await import('../services/manual-parser');
        const prefilledText = formatPlayersForModal(finalBuyIn, players);
        const { createManualEditModal } = await import('../ui/components');
        await interaction.showModal(createManualEditModal(targetSession.id, finalBuyIn, prefilledText));
      }
      return;
    }

    // 1. START (Standard)
    if (subcommand === 'start') {
      await interaction.deferReply();
      const activeSession = await repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.editReply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? 200;
      const session = await repo.createSession(guildId, channelId, user.id, defaultBuyin);

      // Auto-add the host as the first player
      await repo.joinPlayer(session.id, user.id, defaultBuyin);
      const players = await repo.getSessionPlayers(session.id);

      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);

      const reply = await interaction.editReply({
        embeds: [embed],
        components: rows,
      });

      await repo.updateSessionMessageId(session.id, reply.id);
      return;
    }

    // 2. START-VOICE (Auto-join everyone in voice channel)
    if (subcommand === 'start-voice') {
      await interaction.deferReply();
      const activeSession = await repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.editReply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
        });
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({
          content: '❌ คำสั่งนี้ใช้ได้เฉพาะใน Discord Server เท่านั้นครับ',
        });
        return;
      }

      // 1. Check explicit channel option
      const explicitChannel = interaction.options.getChannel('channel');
      let targetChannelId: string | null | undefined = explicitChannel?.id;

      // 2. If no explicit channel, check caller member's voice state
      if (!targetChannelId) {
        const callerMember =
          (interaction.member as GuildMember) ||
          (await guild.members.fetch(user.id).catch(() => null));
        targetChannelId =
          callerMember?.voice?.channelId ||
          guild.voiceStates.cache.get(user.id)?.channelId;
      }

      if (!targetChannelId) {
        await interaction.editReply({
          content:
            '❌ คุณต้องอยู่ในห้อง Voice Call (ห้องพูดคุย) ก่อนใช้คำสั่งนี้ หรือเลือกห้องเสียงในตัวเลือก `channel` เพื่อให้บอทดึงเพื่อนในห้องเข้ามาได้ครับ',
        });
        return;
      }

      const voiceChannel = (await guild.channels.fetch(targetChannelId).catch(() => null)) as any;
      if (
        !voiceChannel ||
        (voiceChannel.type !== ChannelType.GuildVoice &&
          voiceChannel.type !== ChannelType.GuildStageVoice)
      ) {
        await interaction.editReply({
          content: '❌ ไม่พบห้องเสียง หรือห้องที่เลือกไม่ใช่ห้อง Voice Call ครับ',
        });
        return;
      }

      // Collect all non-bot members in this voice channel
      const memberMap = new Map<string, GuildMember>();

      // From guild.voiceStates cache
      const voiceStates = guild.voiceStates.cache.filter(vs => vs.channelId === voiceChannel.id);
      for (const [memberId, vs] of voiceStates) {
        const m = vs.member || (await guild.members.fetch(memberId).catch(() => null));
        if (m && !m.user.bot) {
          memberMap.set(m.id, m);
        }
      }

      // From channel.members if available
      if (voiceChannel.members) {
        for (const [, m] of voiceChannel.members) {
          if (!m.user.bot && !memberMap.has(m.id)) {
            memberMap.set(m.id, m);
          }
        }
      }

      const voiceMembers = Array.from(memberMap.values());

      if (voiceMembers.length === 0) {
        await interaction.editReply({
          content: `❌ ไม่พบผู้เล่น (ที่ไม่ใช่บอท) ในห้องเสียง **${voiceChannel.name}** ครับ`,
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? 200;
      const session = await repo.createSession(guildId, channelId, user.id, defaultBuyin);

      // Add all voice members
      for (const vm of voiceMembers) {
        await repo.upsertUser(vm.user.id, vm.user.username, vm.displayName);
        await repo.joinPlayer(session.id, vm.user.id, defaultBuyin);
      }

      const players = await repo.getSessionPlayers(session.id);
      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);

      const reply = await interaction.editReply({
        content: `🎙️ ตรวจพบห้องเสียง **${voiceChannel.name}** ดึงผู้เล่นเข้าโต๊ะอัตโนมัติ **${players.length} คน** เรียบร้อยแล้ว!`,
        embeds: [embed],
        components: rows,
      });

      await repo.updateSessionMessageId(session.id, reply.id);
      return;
    }

    // NEXT-ROUND (Start next round with players from previous session)
    if (subcommand === 'next-round') {
      await interaction.deferReply();
      const activeSession = await repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.editReply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้อยู่แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
        });
        return;
      }

      const lastSession = await repo.getLastSession(channelId);
      if (!lastSession) {
        await interaction.editReply({
          content: '❌ ยังไม่มีประวัติการเล่นโต๊ะ Poker ในห้องนี้มาก่อนครับ ให้ใช้ `/poker start` หรือ `/poker start-voice` เพื่อเริ่มโต๊ะแรก',
        });
        return;
      }

      const lastPlayers = await repo.getSessionPlayers(lastSession.id);
      if (lastPlayers.length === 0) {
        await interaction.editReply({
          content: '❌ ไม่พบรายชื่อผู้เล่นจากโต๊ะรอบที่แล้วครับ',
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? lastSession.default_buyin ?? 200;
      const newSession = await repo.createSession(guildId, channelId, user.id, defaultBuyin);

      const uniqueLastPlayers = Array.from(new Map(lastPlayers.map(p => [p.user_id, p])).values());
      for (const p of uniqueLastPlayers) {
        await repo.upsertUser(p.user_id, p.username, p.display_name);
        await repo.joinPlayer(newSession.id, p.user_id, defaultBuyin);
      }

      const players = await repo.getSessionPlayers(newSession.id);
      const embed = createTableEmbed(newSession, players);
      const rows = createTableActionRows(newSession.default_buyin);

      const reply = await interaction.editReply({
        content: `🎉 **เริ่มรอบใหม่ (Session #${newSession.id}) เรียบร้อยแล้ว!** ดึงผู้เล่นเดิม **${players.length} คน** เข้าโต๊ะอัตโนมัติ (Buy-in: **${newSession.default_buyin}฿**)`,
        embeds: [embed],
        components: rows,
      });

      await repo.updateSessionMessageId(newSession.id, reply.id);
      return;
    }

    // For other subcommands, get active session (or last session for set-chips)
    let session = await repo.getActiveSession(channelId);
    if (!session && subcommand === 'set-chips') {
      session = await repo.getLastSession(channelId);
    }

    // 3. SCAN-TABLE (AI Vision auto-cashout from screenshot, supports scanning without open table)
    if (subcommand === 'scan-table') {
      const isPreview = interaction.options.getBoolean('preview') ?? false;

      if (
        session &&
        !isPreview &&
        interaction.user.id !== session.host_id &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถใช้คำสั่งสแกนปิดโต๊ะได้ (หรือใช้ `preview:True` เพื่อดูยอดโดยไม่ปิดโต๊ะ)', ephemeral: true });
        return;
      }

      const attachment = interaction.options.getAttachment('image', true);
      const buyinOption = interaction.options.getNumber('buyin') ?? 200;
      const explicitLeaver = interaction.options.getUser('leaver');
      const explicitLeaverChips = interaction.options.getNumber('leaver_chips');

      if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: '❌ ไฟล์ที่แนบต้องเป็นไฟล์รูปภาพเท่านั้นครับ', ephemeral: true });
        return;
      }

      await interaction.deferReply();

      try {
        await processTableScan(
          interaction,
          session ?? null,
          attachment.url,
          attachment.name || 'scanned-table.png',
          isPreview,
          explicitLeaver,
          explicitLeaverChips,
          buyinOption
        );
      } catch (err: any) {
        console.error('Failed to parse poker screenshot:', err);
        if (err.message?.includes('GEMINI_API_KEY')) {
          await interaction.editReply({
            content: '❌ ยังไม่ได้ตั้งค่า `GEMINI_API_KEY` ในไฟล์ `.env` บน Render ครับ!\n💡 คุณสามารถรับ API Key ได้ฟรีที่: https://aistudio.google.com/apikey',
          });
        } else {
          await interaction.editReply({
            content: `⚠️ เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพ: ${err.message}`,
          });
        }
      }
      return;
    }

    if (!session) {
      await interaction.reply({
        content: '❌ ยังไม่มีโต๊ะ Poker ที่กำลังเล่นอยู่ในห้องนี้! พิมพ์ `/poker start` หรือ `/poker start-voice` เพื่อเปิดโต๊ะ',
        ephemeral: true,
      });
      return;
    }



    // 3.1 PREVIEW (Check current debts without ending session)
    if (subcommand === 'preview') {
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
        const { calculateSettlements } = await import('../services/settlement');
        const settlement = calculateSettlements(playerInputs);

        const ppMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
        for (const p of players) {
          ppMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
        }

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

        const { createPreviewActionRow } = await import('../ui/components');
        await interaction.reply({
          embeds: [embed],
          files,
          components: [createPreviewActionRow(session.id)],
        });
        return;
      }

      const { createPreviewSessionModal } = await import('../ui/components');
      const modal = createPreviewSessionModal(activePlayers);
      await interaction.showModal(modal);
      return;
    }

    // 4. STATUS
    if (subcommand === 'status') {
      await interaction.deferReply();
      const players = await repo.getSessionPlayers(session.id);
      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);
      const reply = await interaction.editReply({ embeds: [embed], components: rows });
      await repo.updateSessionMessageId(session.id, reply.id);
      return;
    }

    // 5. JOIN
    if (subcommand === 'join') {
      const amount = interaction.options.getNumber('amount') ?? session.default_buyin;
      const result = await repo.joinPlayer(session.id, user.id, amount);

      if (result.alreadyPlaying) {
        await interaction.reply({
          content: `⚠️ คุณ <@${user.id}> อยู่ในโต๊ะนี้แล้วครับ (ยอดเงินปัจจุบัน: **${result.totalBuyIn.toLocaleString()}฿**)\nหากต้องการซื้อชิปเพิ่ม กรุณาใช้คำสั่ง \`/poker rebuy\` หรือกดปุ่ม [🔄 Rebuy] แทนครับ`,
          ephemeral: true,
        });
        return;
      }

      const actionText = result.isRejoin
        ? `🔄 <@${user.id}> กลับเข้าโต๊ะมา Buy-in เล่นรอบใหม่ด้วยเงิน **${amount.toLocaleString()} บาท** (ยอดออกก่อนหน้ายังคงเดิม)`
        : `🟢 <@${user.id}> เข้าร่วมโต๊ะด้วยเงิน **${amount.toLocaleString()} บาท**`;

      await interaction.reply({ content: actionText });
      await refreshTableMessage(interaction, session);
      return;
    }

    // 6. REBUY
    if (subcommand === 'rebuy') {
      const amount = interaction.options.getNumber('amount') ?? session.default_buyin;
      const result = await repo.rebuyPlayer(session.id, user.id, amount);

      if (result.notPlaying) {
        await interaction.reply({
          content: `❌ คุณยังไม่ได้เข้าร่วมโต๊ะนี้ กรุณาใช้คำสั่ง \`/poker join\` หรือกดปุ่ม [🟢 เข้าร่วม] ก่อนครับ`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `🔄 <@${user.id}> เติมชิปเพิ่ม **+${amount.toLocaleString()} บาท** (ยอดรวม ${result.totalBuyIn.toLocaleString()}฿)`,
      });
      await refreshTableMessage(interaction, session);
      return;
    }

    // 7. SET-BUYIN (Host correction)
    if (subcommand === 'set-buyin') {
      if (
        interaction.user.id !== session.host_id &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถแก้ไขยอดเงินได้', ephemeral: true });
        return;
      }

      const targetPlayer = interaction.options.getUser('player', true);
      const amount = interaction.options.getNumber('amount', true);

      const result = await repo.setPlayerBuyIn(session.id, targetPlayer.id, amount);
      if (!result.success) {
        await interaction.reply({ content: `❌ ผู้เล่น <@${targetPlayer.id}> ไม่อยู่ในโต๊ะนี้`, ephemeral: true });
        return;
      }

      await interaction.reply({
        content: `🔧 Host ได้แก้ไขยอด Buy-in ของ <@${targetPlayer.id}> เป็น **${amount.toLocaleString()} บาท** เรียบร้อยแล้ว`,
      });

      await refreshTableMessage(interaction, session);
      return;
    }

    // 8. LEAVE (Early Cashout)
    if (subcommand === 'leave') {
      const chips = interaction.options.getNumber('chips', true);
      const leaveResult = await repo.playerLeaveSession(session.id, user.id, chips);

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

    // 9. SET-CHIPS (Host override for cashout)
    if (subcommand === 'set-chips') {
      if (
        interaction.user.id !== session.host_id &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถตั้งค่าชิปได้', ephemeral: true });
        return;
      }

      const targetPlayer = interaction.options.getUser('player', true);
      const chips = interaction.options.getNumber('chips', true);

      await repo.upsertUser(targetPlayer.id, targetPlayer.username);
      const leaveResult = await repo.playerLeaveSession(session.id, targetPlayer.id, chips);

      if (!leaveResult.success) {
        await interaction.reply({ content: `❌ ผู้เล่น <@${targetPlayer.id}> ไม่อยู่ในโต๊ะนี้`, ephemeral: true });
        return;
      }

      if (session.status === 'completed') {
        const players = await repo.getSessionPlayers(session.id);
        const activeChipsMap: Record<string, number> = {};
        for (const p of players) {
          activeChipsMap[p.user_id] = p.user_id === targetPlayer.id ? chips : (p.cash_out ?? 0);
        }
        await interaction.reply({
          content: `🔧 Host ได้แก้ไขชิปของ <@${targetPlayer.id}> เป็น **${chips.toLocaleString()} บาท** และคำนวณยอดเงินใหม่:`,
        });
        await finalizeAndDisplaySummary(interaction, session, activeChipsMap);
        return;
      }

      await interaction.reply({
        content: `🔧 Host ได้ตั้งค่าชิปคงเหลือของ <@${targetPlayer.id}> เป็น **${chips.toLocaleString()} บาท** เรียบร้อยแล้ว`,
      });

      await refreshTableMessage(interaction, session);
      return;
    }

    // 10. CANCEL
    if (subcommand === 'cancel') {
      if (
        interaction.user.id !== session.host_id &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถยกเลิกโต๊ะได้', ephemeral: true });
        return;
      }

      await interaction.deferReply();
      await repo.cancelSession(session.id);
      await interaction.editReply({ content: `🛑 โต๊ะ Poker Session #${session.id} ถูกยกเลิกเรียบร้อยแล้ว` });
      return;
    }

    // 11. END SESSION
    if (subcommand === 'end') {
      const players = await repo.getSessionPlayers(session.id);
      const activePlayers = players.filter(p => p.status === 'playing');

      if (activePlayers.length > 5) {
        await interaction.reply({
          content: `⚠️ โต๊ะนี้ยังมีผู้เล่นที่ยังไม่ Cash-out ถึง ${activePlayers.length} คน (เกิน 5 คน)\n💡 **แนะนำ:** ใช้คำสั่ง \`/poker scan-table\` แล้วแนบรูปภาพหน้าจอโต๊ะโป๊กเกอร์ เพื่อให้ AI อ่านชิปทุกคนและคิดเงินอัตโนมัติได้ทันทีครับ!`,
          ephemeral: true,
        });
        return;
      }

      if (activePlayers.length === 0) {
        await finalizeAndDisplaySummary(interaction, session, {});
      } else {
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

    const players = await repo.getSessionPlayers(session.id);
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
  activeChipsMap: Record<string, number>,
  sourceImageUrl?: string
) {
  const { settlement } = await repo.finalizeSession(session.id, activeChipsMap);
  const players = await repo.getSessionPlayers(session.id);

  // Map Payment info
  const ppMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
  for (const p of players) {
    ppMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
  }

  const embed = createSummaryEmbed(session, settlement, ppMap);

  if (sourceImageUrl) {
    embed.setThumbnail(sourceImageUrl);
  }

  // Find biggest winner to generate QR code if PromptPay or custom QR is configured
  const topCreditor = settlement.players.find(
    p =>
      p.net > 0 &&
      !p.isBot &&
      !p.userId.startsWith('bot_') &&
      (ppMap[p.userId]?.qrImageUrl || ppMap[p.userId]?.promptpay)
  );
  const files: any[] = [];

  if (topCreditor) {
    const pInfo = ppMap[topCreditor.userId];
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

  const { createNextRoundActionRow } = await import('../ui/components');
  const actionRow = createNextRoundActionRow(session.id, false, settlement.isBalanced);

  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ embeds: [embed], files, components: [actionRow] });
  } else if (interaction.replied) {
    await interaction.followUp({ embeds: [embed], files, components: [actionRow] });
  } else {
    await interaction.reply({ embeds: [embed], files, components: [actionRow] });
  }
}

export async function executeManualSettlement(
  context: any,
  rawPlayersText: string,
  defaultBuyIn: number = 200,
  existingSessionId?: number
) {
  try {
    const { parseManualInputLines, resolvePlayerDiscordMembers } = await import('../services/manual-parser');
    const parsed = parseManualInputLines(rawPlayersText, defaultBuyIn);

    if (parsed.errors.length > 0 && parsed.players.length === 0) {
      const errorMsg = `❌ **ไม่สามารถบันทึกข้อมูลได้:**\n${parsed.errors.join('\n')}\n\n💡 **ตัวอย่างรูปแบบที่ถูกต้อง:**\n\`@Ton 350\`\n\`@Nadear 50 buyin:400\`\n\`@JJ 200\``;
      if (context.replied || context.deferred) {
        await context.editReply({ content: errorMsg });
      } else {
        await context.reply({ content: errorMsg, ephemeral: true });
      }
      return;
    }

    const guildId = context.guildId || context.guild?.id || '';
    const channelId = context.channelId || context.channel?.id || '';
    const hostId = context.user?.id || context.member?.id || 'host';

    let voiceChannelId: string | undefined;
    try {
      const callerMember = context.member;
      voiceChannelId =
        callerMember?.voice?.channelId ||
        (context.user && context.guild?.voiceStates?.cache?.get(context.user.id)?.channelId);
    } catch {}

    const resolvedPlayers = await resolvePlayerDiscordMembers(parsed.players, context.guild, voiceChannelId);

    for (const p of resolvedPlayers) {
      if (!p.userId.startsWith('guest_')) {
        await repo.upsertUser(p.userId, p.name);
      }
    }

    const { settlement, session } = await repo.saveOrUpdateManualSession(
      guildId,
      channelId,
      hostId,
      defaultBuyIn,
      resolvedPlayers,
      existingSessionId
    );

    const sessionPlayers = await repo.getSessionPlayers(session.id);
    const ppMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
    for (const p of sessionPlayers) {
      ppMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
    }
    const { createSummaryEmbed } = await import('../ui/embeds');
    const embed = createSummaryEmbed(session, settlement, ppMap);

    let prefixNote = existingSessionId
      ? `✏️ **แก้ไขและคำนวณเงินใหม่สำหรับ Session #${session.id} สำเร็จ!** (อัปเดตตาราง Leaderboard เรียบร้อย)\n`
      : `📝 **บันทึกและคิดเงิน Poker Session #${session.id} สำเร็จ!** (บันทึกลงตาราง Leaderboard เรียบร้อย)\n`;

    if (parsed.errors.length > 0) {
      prefixNote += `⚠️ *ข้อสังเกตบางรายการ:*\n${parsed.errors.join('\n')}\n\n`;
    }

    const topCreditor = settlement.players.find(
      p =>
        p.net > 0 &&
        !p.isBot &&
        !p.userId.startsWith('bot_') &&
        !p.userId.startsWith('guest_') &&
        (ppMap[p.userId]?.qrImageUrl || ppMap[p.userId]?.promptpay)
    );

    const files: any[] = [];
    if (topCreditor) {
      const pInfo = ppMap[topCreditor.userId];
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
          name:
            qrResult.sourceType === 'custom_qr'
              ? `📱 QR Code รับเงินของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`
              : `📱 QR Code พร้อมเพย์ของ ${topCreditor.name} (${topCreditor.net.toLocaleString()}฿)`,
          value:
            qrResult.sourceType === 'custom_qr'
              ? `สแกน QR Code ด้านล่างเพื่อโอนเงินเข้าบัญชีได้ทันที (QR ที่ผู้เล่นอัปโหลดไว้)`
              : `สามารถสแกน QR Code ด้านล่างเพื่อโอนเงินได้ทันที (สร้างยอดอัตโนมัติ ${topCreditor.net.toLocaleString()} บาท)`,
        });
        files.push(qrResult.attachment);
      }
    }

    const { createNextRoundActionRow } = await import('../ui/components');
    const actionRow = createNextRoundActionRow(session.id, false, settlement.isBalanced);

    if (context.replied || context.deferred) {
      await context.editReply({ content: prefixNote, embeds: [embed], files, components: [actionRow] });
    } else {
      await context.reply({ content: prefixNote, embeds: [embed], files, components: [actionRow] });
    }
  } catch (err: any) {
    console.error('Failed to execute manual settlement:', err);
    const errorMsg = `❌ **เกิดข้อผิดพลาดในการคิดเงิน:** ${err?.message || 'กรุณาลองใหม่อีกครั้ง'}`;
    if (context.replied || context.deferred) {
      await context.editReply({ content: errorMsg });
    } else {
      await context.reply({ content: errorMsg, ephemeral: true });
    }
  }
}


export async function processTableScan(
  context: any,
  session: repo.SessionRow | null,
  imageUrl: string,
  imageFileName: string,
  isPreview: boolean,
  explicitLeaver?: any,
  explicitLeaverChips?: number | null,
  buyinOption: number = 200
) {
  const { parsePokerScreenshot, matchPlayersWithDiscord } = await import('../services/vision');
  const detected = await parsePokerScreenshot(imageUrl);

  if (detected.length === 0) {
    await context.editReply({
      content: '⚠️ AI ไม่พบชื่อหรือชิปผู้เล่นในรูปภาพ กรุณาลองแคปรูปใหม่ที่เห็นชื่อและยอดเงินชัดเจนครับ',
    });
    return;
  }

  const isAdHoc = !session;
  if (!session) {
    const guildId = context.guildId || context.guild?.id || '';
    const channelId = context.channelId || context.channel?.id || '';
    const hostId = context.user?.id || context.member?.id || 'host';
    session = await repo.createSession(guildId, channelId, hostId, buyinOption);
  }

  let players = await repo.getSessionPlayers(session.id);
  let activePlayers = players.filter(p => p.status === 'playing');

  let matched: { userId: string; discordName: string; detectedName: string; chips: number }[] = [];

  if (isAdHoc || activePlayers.length === 0) {
    // Collect Discord candidates to match against detected player names
    const candidatesMap = new Map<string, { user_id: string; username: string; display_name: string | null }>();

    // 1. Caller
    const callerUser = context.user;
    if (callerUser) {
      candidatesMap.set(callerUser.id, {
        user_id: callerUser.id,
        username: callerUser.username,
        display_name:
          context.member && 'displayName' in context.member
            ? (context.member as any).displayName
            : callerUser.displayName || callerUser.username,
      });
    }

    const guild = context.guild;
    if (guild) {
      // 2. Caller's voice channel
      try {
        const callerMember =
          (context.member as GuildMember) ||
          (typeof guild.members?.fetch === 'function' && callerUser
            ? await guild.members.fetch(callerUser.id).catch(() => null)
            : null);
        const voiceChannelId =
          callerMember?.voice?.channelId || (callerUser ? guild.voiceStates?.cache?.get(callerUser.id)?.channelId : null);
        if (voiceChannelId && typeof guild.channels?.fetch === 'function') {
          const voiceChannel = (await guild.channels.fetch(voiceChannelId).catch(() => null)) as any;
          if (voiceChannel) {
            const vsList = guild.voiceStates?.cache?.filter((vs: any) => vs.channelId === voiceChannel.id);
            if (vsList) {
              for (const [mId, vs] of vsList) {
                const m =
                  vs.member ||
                  (typeof guild.members?.fetch === 'function' ? await guild.members.fetch(mId).catch(() => null) : null);
                if (m && !m.user?.bot) {
                  candidatesMap.set(m.id, {
                    user_id: m.id,
                    username: m.user.username,
                    display_name: m.displayName || m.user.username,
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('Error fetching voice channel candidates:', e);
      }

      // 3. Cached guild members
      if (guild.members?.cache) {
        for (const [, m] of guild.members.cache) {
          if (!m.user?.bot && !candidatesMap.has(m.id)) {
            candidatesMap.set(m.id, {
              user_id: m.id,
              username: m.user.username,
              display_name: m.displayName || m.user.username,
            });
          }
        }
      }
    }

    // 4. Past players in this channel
    try {
      const lastSession = await repo.getLastSession(session.channel_id);
      if (lastSession) {
        const lastPlayers = await repo.getSessionPlayers(lastSession.id);
        for (const lp of lastPlayers) {
          if (!candidatesMap.has(lp.user_id)) {
            candidatesMap.set(lp.user_id, {
              user_id: lp.user_id,
              username: lp.username,
              display_name: lp.display_name,
            });
          }
        }
      }
    } catch {}

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
    const candidateList = Array.from(candidatesMap.values());
    const matchResult = matchPlayersWithDiscord(detected, candidateList);
    matched = matchResult.matched;
    const matchedUserIds = new Set(matched.map(m => m.userId));

    for (const m of matched) {
      await repo.upsertUser(m.userId, m.discordName, m.discordName);
      await repo.joinPlayer(session.id, m.userId, buyinOption);
    }

    // Process unmatched detected players
    for (const ud of matchResult.unmatchedDetected) {
      let resolved = false;
      if (guild && typeof guild.members?.search === 'function') {
        try {
          const searched = await guild.members.search({ query: ud.name, limit: 1 });
          const found = searched.first();
          if (found && !found.user?.bot && !matchedUserIds.has(found.id)) {
            matched.push({
              userId: found.id,
              discordName: found.displayName,
              detectedName: ud.name,
              chips: ud.chips,
            });
            matchedUserIds.add(found.id);
            await repo.upsertUser(found.id, found.user.username, found.displayName);
            await repo.joinPlayer(session.id, found.id, buyinOption);
            resolved = true;
          }
        } catch {}
      }

      if (!resolved) {
        const cleanName = ud.name;
        const normName = norm(cleanName);
        const guestId = `guest_${normName || Math.random().toString(36).substring(2, 7)}`;
        matched.push({
          userId: guestId,
          discordName: cleanName,
          detectedName: cleanName,
          chips: ud.chips,
        });
        matchedUserIds.add(guestId);
        await repo.upsertUser(guestId, cleanName, cleanName);
        await repo.joinPlayer(session.id, guestId, buyinOption);
      }
    }

    // Explicit leaver
    if (explicitLeaver) {
      await repo.upsertUser(
        explicitLeaver.id,
        explicitLeaver.username,
        (explicitLeaver as any).displayName || explicitLeaver.username
      );
      await repo.joinPlayer(session.id, explicitLeaver.id, buyinOption);
    }

    players = await repo.getSessionPlayers(session.id);
    activePlayers = players.filter(p => p.status === 'playing');
  } else {
    // Normal flow when session already had players
    const matchResult = matchPlayersWithDiscord(detected, activePlayers);
    matched = matchResult.matched;

    if (matched.length === 0) {
      const detectedList = detected.map(d => `• ${d.name}: ${d.chips}฿`).join('\n');
      await context.editReply({
        content: `⚠️ AI อ่านรายชื่อบนโต๊ะได้:\n${detectedList}\n\nแต่ชื่อไม่ตรงกับผู้เล่นใน Discord สักคน กรุณาตรวจสอบชื่อผู้เล่นบนโต๊ะ หรือกรอกชิปด้วยมือครับ`,
      });
      return;
    }
  }

  // Apply chips to matched players
  const activeChipsMap: Record<string, number> = {};
  for (const m of matched) {
    activeChipsMap[m.userId] = m.chips;
  }

  // Apply explicit leaver if specified
  if (explicitLeaver && explicitLeaverChips !== null && explicitLeaverChips !== undefined) {
    activeChipsMap[explicitLeaver.id] = explicitLeaverChips;
  }

  // Remaining active players in Discord not in screenshot and not explicitly set
  const remainingUnmatched = activePlayers.filter(
    p => !matched.some(m => m.userId === p.user_id) && activeChipsMap[p.user_id] === undefined
  );

  // Calculate total buyin and accounted chips to deduce remaining pot
  const totalSessionBuyIn = players.reduce((sum, p) => sum + p.buy_in, 0);
  let accountedChips = 0;

  // Already cashed out early ('left')
  for (const p of players) {
    if (p.status === 'left') {
      accountedChips += p.cash_out ?? 0;
    }
  }
  // Matched by AI or explicitly set
  for (const chips of Object.values(activeChipsMap)) {
    accountedChips += chips;
  }

  const remainingPot = Math.max(0, Math.round((totalSessionBuyIn - accountedChips) * 100) / 100);
  let leaverNote = '';

  if (explicitLeaver && (explicitLeaverChips === null || explicitLeaverChips === undefined)) {
    activeChipsMap[explicitLeaver.id] = remainingPot;
    leaverNote += `\n💡 **<@${explicitLeaver.id}>** ออกจากโต๊ะไปก่อน ➔ บอทคำนวณชิปคงเหลือจากกองกลางให้อัตโนมัติ: **${remainingPot.toLocaleString()}฿**`;
  } else if (remainingUnmatched.length === 1) {
    const singleLeaver = remainingUnmatched[0];
    activeChipsMap[singleLeaver.user_id] = remainingPot;
    leaverNote += `\n💡 **<@${singleLeaver.user_id}>** ออกจากโต๊ะไปก่อน (ไม่ได้กดขอออกก่อน) ➔ บอทคำนวณชิปคงเหลือจากกองกลางให้อัตโนมัติ: **${remainingPot.toLocaleString()}฿** *(ยอดเงินลงตัวพอดี)*`;
  } else if (remainingUnmatched.length > 1) {
    const splitChips = Math.round((remainingPot / remainingUnmatched.length) * 100) / 100;
    for (const u of remainingUnmatched) {
      activeChipsMap[u.user_id] = splitChips;
    }
    leaverNote += `\n⚠️ ตรวจพบผู้เล่นที่ไม่อยู่ในรูปภาพ ${remainingUnmatched.length} คน: ${remainingUnmatched.map(u => `<@${u.user_id}>`).join(', ')} ➔ บอทเฉลี่ยชิปที่เหลือจากกองกลางคนละ **${splitChips.toLocaleString()}฿** *(สามารถใช้ /poker set-chips เพื่อแก้ไขได้)*`;
  }

  // Show early cash-out players if any
  const earlyLeavers = players.filter(p => p.status === 'left');
  let earlyLeaverNote = '';
  if (earlyLeavers.length > 0) {
    earlyLeaverNote = '\n' + earlyLeavers.map(el => `🏃 **<@${el.user_id}>** ขอออกก่อนไว้แล้ว ➔ ชิปคงเหลือ **${(el.cash_out ?? 0).toLocaleString()}฿**`).join('\n');
  }

  let matchSummary = isPreview
    ? `🔍 **AI สแกนพรีวิวรูปภาพสำเร็จ (${matched.length} คน - Buy-in ${session.default_buyin}฿ - โต๊ะยังไม่ปิด):**\n`
    : `🤖 **AI สแกนรูปภาพสำเร็จ (${matched.length} คน - Buy-in ${session.default_buyin}฿):**\n`;

  matchSummary += matched
    .map(m => `✅ **${m.discordName}** (ในรูป: \`${m.detectedName}\`) ➔ ชิป **${m.chips.toLocaleString()}฿**`)
    .join('\n');

  if (leaverNote) matchSummary += leaverNote;
  if (earlyLeaverNote) matchSummary += earlyLeaverNote;

  const tableFile = new AttachmentBuilder(imageUrl, {
    name: imageFileName || 'scanned-table.png',
  });

  if (isPreview) {
    const { calculateSettlements } = await import('../services/settlement');
    const playerInputs = players.map(p => ({
      userId: p.user_id,
      name: p.display_name || p.username,
      buyIn: p.buy_in,
      cashOut: p.status === 'playing' ? (activeChipsMap[p.user_id] ?? 0) : (p.cash_out ?? 0),
    }));
    const settlement = calculateSettlements(playerInputs);

    const ppMap: Record<string, { promptpay: string | null; qrImageUrl: string | null }> = {};
    for (const p of players) {
      ppMap[p.user_id] = { promptpay: p.promptpay, qrImageUrl: p.qr_image_url };
    }

    const embed = createSummaryEmbed(session, settlement, ppMap, true);
    const files: any[] = [tableFile];

    const topCreditor = settlement.players.find(
      p =>
        p.net > 0 &&
        !p.isBot &&
        !p.userId.startsWith('bot_') &&
        (ppMap[p.userId]?.qrImageUrl || ppMap[p.userId]?.promptpay)
    );
    if (topCreditor) {
      const pInfo = ppMap[topCreditor.userId];
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

    const { createPreviewActionRow } = await import('../ui/components');
    await context.editReply({
      content: matchSummary,
      embeds: [embed],
      files,
      components: [createPreviewActionRow(session.id)],
    });
    return;
  }

  await context.editReply({
    content: matchSummary,
    files: [tableFile],
  });
  await finalizeAndDisplaySummary(context, session, activeChipsMap, imageUrl);
}
