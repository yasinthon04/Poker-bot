import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  GuildMember,
  ChannelType,
  AttachmentBuilder,
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
        .setName('start-voice')
        .setDescription('เปิดโต๊ะและดึงทุกคนในห้อง Voice Call เข้าโต๊ะอัตโนมัติ')
        .addNumberOption(opt =>
          opt
            .setName('buyin')
            .setDescription('ค่า Buy-in เริ่มต้น (ค่าเริ่มต้น 100 บาท)')
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

    // Ensure user exists in DB
    await repo.upsertUser(
      user.id,
      user.username,
      interaction.member && 'displayName' in interaction.member
        ? (interaction.member as any).displayName
        : user.displayName
    );

    // HELP (No active session needed)
    if (subcommand === 'help') {
      const { helpCommand } = await import('./help');
      await helpCommand.execute(interaction);
      return;
    }

    // 1. START (Standard)
    if (subcommand === 'start') {
      const activeSession = await repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.reply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
          ephemeral: true,
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? 100;
      const session = await repo.createSession(guildId, channelId, user.id, defaultBuyin);

      // Auto-add the host as the first player
      await repo.joinPlayer(session.id, user.id, defaultBuyin);
      const players = await repo.getSessionPlayers(session.id);

      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);

      const reply = await interaction.reply({
        embeds: [embed],
        components: rows,
        fetchReply: true,
      });

      await repo.updateSessionMessageId(session.id, reply.id);
      return;
    }

    // 2. START-VOICE (Auto-join everyone in voice channel)
    if (subcommand === 'start-voice') {
      const activeSession = await repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.reply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
          ephemeral: true,
        });
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({
          content: '❌ คำสั่งนี้ใช้ได้เฉพาะใน Discord Server เท่านั้นครับ',
          ephemeral: true,
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
        await interaction.reply({
          content:
            '❌ คุณต้องอยู่ในห้อง Voice Call (ห้องพูดคุย) ก่อนใช้คำสั่งนี้ หรือเลือกห้องเสียงในตัวเลือก `channel` เพื่อให้บอทดึงเพื่อนในห้องเข้ามาได้ครับ',
          ephemeral: true,
        });
        return;
      }

      const voiceChannel = (await guild.channels.fetch(targetChannelId).catch(() => null)) as any;
      if (
        !voiceChannel ||
        (voiceChannel.type !== ChannelType.GuildVoice &&
          voiceChannel.type !== ChannelType.GuildStageVoice)
      ) {
        await interaction.reply({
          content: '❌ ไม่พบห้องเสียง หรือห้องที่เลือกไม่ใช่ห้อง Voice Call ครับ',
          ephemeral: true,
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
        await interaction.reply({
          content: `❌ ไม่พบผู้เล่น (ที่ไม่ใช่บอท) ในห้องเสียง **${voiceChannel.name}** ครับ`,
          ephemeral: true,
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? 100;
      const session = await repo.createSession(guildId, channelId, user.id, defaultBuyin);

      // Add all voice members
      for (const vm of voiceMembers) {
        await repo.upsertUser(vm.user.id, vm.user.username, vm.displayName);
        await repo.joinPlayer(session.id, vm.user.id, defaultBuyin);
      }

      const players = await repo.getSessionPlayers(session.id);
      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);

      const reply = await interaction.reply({
        content: `🎙️ ตรวจพบห้องเสียง **${voiceChannel.name}** ดึงผู้เล่นเข้าโต๊ะอัตโนมัติ **${players.length} คน** เรียบร้อยแล้ว!`,
        embeds: [embed],
        components: rows,
        fetchReply: true,
      });

      await repo.updateSessionMessageId(session.id, reply.id);
      return;
    }

    // NEXT-ROUND (Start next round with players from previous session)
    if (subcommand === 'next-round') {
      const activeSession = await repo.getActiveSession(channelId);
      if (activeSession) {
        await interaction.reply({
          content: `⚠️ มีโต๊ะ Poker Session #${activeSession.id} กำลังเล่นอยู่ในห้องนี้อยู่แล้ว! กรุณาเล่นให้จบหรือกดยกเลิกก่อน`,
          ephemeral: true,
        });
        return;
      }

      const lastSession = await repo.getLastSession(channelId);
      if (!lastSession) {
        await interaction.reply({
          content: '❌ ยังไม่มีประวัติการเล่นโต๊ะ Poker ในห้องนี้มาก่อนครับ ให้ใช้ `/poker start` หรือ `/poker start-voice` เพื่อเริ่มโต๊ะแรก',
          ephemeral: true,
        });
        return;
      }

      const lastPlayers = await repo.getSessionPlayers(lastSession.id);
      if (lastPlayers.length === 0) {
        await interaction.reply({
          content: '❌ ไม่พบรายชื่อผู้เล่นจากโต๊ะรอบที่แล้วครับ',
          ephemeral: true,
        });
        return;
      }

      const defaultBuyin = interaction.options.getNumber('buyin') ?? lastSession.default_buyin;
      const newSession = await repo.createSession(guildId, channelId, user.id, defaultBuyin);

      for (const p of lastPlayers) {
        await repo.upsertUser(p.user_id, p.username, p.display_name);
        await repo.joinPlayer(newSession.id, p.user_id, defaultBuyin);
      }

      const players = await repo.getSessionPlayers(newSession.id);
      const embed = createTableEmbed(newSession, players);
      const rows = createTableActionRows(newSession.default_buyin);

      const reply = await interaction.reply({
        content: `🎉 **เริ่มรอบใหม่ (Session #${newSession.id}) เรียบร้อยแล้ว!** ดึงผู้เล่นเดิม **${players.length} คน** เข้าโต๊ะอัตโนมัติ (Buy-in: **${newSession.default_buyin}฿**)`,
        embeds: [embed],
        components: rows,
        fetchReply: true,
      });

      await repo.updateSessionMessageId(newSession.id, reply.id);
      return;
    }

    // For other subcommands, get active session
    const session = await repo.getActiveSession(channelId);
    if (!session) {
      await interaction.reply({
        content: '❌ ยังไม่มีโต๊ะ Poker ที่กำลังเล่นอยู่ในห้องนี้! พิมพ์ `/poker start` หรือ `/poker start-voice` เพื่อเปิดโต๊ะ',
        ephemeral: true,
      });
      return;
    }

    // 3. SCAN-TABLE (AI Vision auto-cashout from screenshot)
    if (subcommand === 'scan-table') {
      const isPreview = interaction.options.getBoolean('preview') ?? false;

      if (
        !isPreview &&
        interaction.user.id !== session.host_id &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({ content: '❌ เฉพาะ Host ของโต๊ะนี้เท่านั้นที่สามารถใช้คำสั่งสแกนปิดโต๊ะได้ (หรือใช้ `preview:True` เพื่อดูยอดโดยไม่ปิดโต๊ะ)', ephemeral: true });
        return;
      }

      const attachment = interaction.options.getAttachment('image', true);
      if (!attachment.contentType?.startsWith('image/')) {
        await interaction.reply({ content: '❌ ไฟล์ที่แนบต้องเป็นไฟล์รูปภาพเท่านั้นครับ', ephemeral: true });
        return;
      }

      await interaction.deferReply();

      try {
        const { parsePokerScreenshot, matchPlayersWithDiscord } = await import('../services/vision');
        const detected = await parsePokerScreenshot(attachment.url);

        if (detected.length === 0) {
          await interaction.editReply({
            content: '⚠️ AI ไม่พบชื่อหรือชิปผู้เล่นในรูปภาพ กรุณาลองแคปรูปใหม่ที่เห็นชื่อและยอดเงินชัดเจนครับ',
          });
          return;
        }

        const players = await repo.getSessionPlayers(session.id);
        const activePlayers = players.filter(p => p.status === 'playing');

        const { matched, unmatchedDiscord } = matchPlayersWithDiscord(detected, activePlayers);

        if (matched.length === 0) {
          const detectedList = detected.map(d => `• ${d.name}: ${d.chips}฿`).join('\n');
          await interaction.editReply({
            content: `⚠️ AI อ่านรายชื่อบนโต๊ะได้:\n${detectedList}\n\nแต่ชื่อไม่ตรงกับผู้เล่นใน Discord สักคน กรุณาตรวจสอบชื่อผู้เล่นบนโต๊ะ หรือกรอกชิปด้วยมือครับ`,
          });
          return;
        }

        const explicitLeaver = interaction.options.getUser('leaver');
        const explicitLeaverChips = interaction.options.getNumber('leaver_chips');

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
          // Explicit leaver without chips -> assign remaining pot
          activeChipsMap[explicitLeaver.id] = remainingPot;
          leaverNote += `\n💡 **<@${explicitLeaver.id}>** ออกจากโต๊ะไปก่อน ➔ บอทคำนวณชิปคงเหลือจากกองกลางให้อัตโนมัติ: **${remainingPot.toLocaleString()}฿**`;
        } else if (remainingUnmatched.length === 1) {
          // Exactly 1 missing player -> automatically assign remaining pot!
          const singleLeaver = remainingUnmatched[0];
          activeChipsMap[singleLeaver.user_id] = remainingPot;
          leaverNote += `\n💡 **<@${singleLeaver.user_id}>** ออกจากโต๊ะไปก่อน (ไม่ได้กดขอออกก่อน) ➔ บอทคำนวณชิปคงเหลือจากกองกลางให้อัตโนมัติ: **${remainingPot.toLocaleString()}฿** *(ยอดเงินลงตัวพอดี)*`;
        } else if (remainingUnmatched.length > 1) {
          // Multiple missing players -> split remaining pot equally
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
          ? `🔍 **AI สแกนพรีวิวรูปภาพสำเร็จ (${matched.length} คน - โต๊ะยังไม่ปิด):**\n`
          : `🤖 **AI สแกนรูปภาพสำเร็จ (${matched.length} คน):**\n`;

        matchSummary += matched
          .map(m => `✅ **${m.discordName}** (ในรูป: \`${m.detectedName}\`) ➔ ชิป **${m.chips.toLocaleString()}฿**`)
          .join('\n');

        if (leaverNote) {
          matchSummary += leaverNote;
        }
        if (earlyLeaverNote) {
          matchSummary += earlyLeaverNote;
        }

        const tableFile = new AttachmentBuilder(attachment.url, {
          name: attachment.name || 'scanned-table.png',
        });

        if (isPreview) {
          const { calculateSettlements } = await import('../services/settlement');
          const playerInputs = players.map(p => ({
            userId: p.user_id,
            name: p.display_name || p.username,
            buyIn: p.buy_in,
            cashOut: activeChipsMap[p.user_id] ?? (p.cash_out ?? 0),
          }));
          const settlement = calculateSettlements(playerInputs);

          const ppMap: Record<string, string | null> = {};
          for (const p of players) {
            ppMap[p.user_id] = p.promptpay;
          }

          const embed = createSummaryEmbed(session, settlement, ppMap, true);
          await interaction.editReply({
            content: matchSummary,
            embeds: [embed],
            files: [tableFile],
          });
          return;
        }

        await interaction.editReply({
          content: matchSummary,
          files: [tableFile],
        });
        await finalizeAndDisplaySummary(interaction, session, activeChipsMap, attachment.url);
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

        const ppMap: Record<string, string | null> = {};
        for (const p of players) {
          ppMap[p.user_id] = p.promptpay;
        }

        const embed = createSummaryEmbed(session, settlement, ppMap, true);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      const { createPreviewSessionModal } = await import('../ui/components');
      const modal = createPreviewSessionModal(activePlayers);
      await interaction.showModal(modal);
      return;
    }

    // 4. STATUS
    if (subcommand === 'status') {
      const players = await repo.getSessionPlayers(session.id);
      const embed = createTableEmbed(session, players);
      const rows = createTableActionRows(session.default_buyin);
      await interaction.reply({ embeds: [embed], components: rows });
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
        ? `🔄 <@${user.id}> กลับเข้าโต๊ะมาเล่นต่อแล้ว (ยอดเงิน Buy-in เดิม: **${result.totalBuyIn.toLocaleString()} บาท**)`
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

      await repo.cancelSession(session.id);
      await interaction.reply({ content: `🛑 โต๊ะ Poker Session #${session.id} ถูกยกเลิกเรียบร้อยแล้ว` });
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

  // Map PromptPay IDs
  const ppMap: Record<string, string | null> = {};
  for (const p of players) {
    ppMap[p.user_id] = p.promptpay;
  }

  const embed = createSummaryEmbed(session, settlement, ppMap);

  if (sourceImageUrl) {
    embed.setThumbnail(sourceImageUrl);
  }

  // Find biggest winner to generate QR code if PromptPay is configured
  const topCreditor = settlement.players.find(p => p.net > 0 && ppMap[p.userId]);
  const files = [];

  if (topCreditor && ppMap[topCreditor.userId]) {
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

  const { createNextRoundActionRow } = await import('../ui/components');
  const actionRow = createNextRoundActionRow(session.id);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ embeds: [embed], files, components: [actionRow] });
  } else {
    await interaction.reply({ embeds: [embed], files, components: [actionRow] });
  }
}
