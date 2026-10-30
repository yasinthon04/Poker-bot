import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export function createTableActionRows(defaultBuyin: number): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_poker_join')
      .setLabel(`🟢 เข้าร่วม (${defaultBuyin}฿)`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_poker_rebuy')
      .setLabel(`🔄 Rebuy (+${defaultBuyin}฿)`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_poker_custom_rebuy')
      .setLabel('➕ เติมชิป (ระบุเอง)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_poker_leave')
      .setLabel('🏃 ขอออกก่อน')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_poker_ai_scan')
      .setLabel('📸 คิดเงินด้วย AI (สแกนรูป)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_poker_preview')
      .setLabel('🧮 คิดเงิน (ไม่ปิดโต๊ะ)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_poker_end')
      .setLabel('🏁 ปิดโต๊ะ / จบเกม')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_poker_status')
      .setLabel('📊 เช็คสถานะ')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_poker_refresh')
      .setLabel('🔄 รีเฟรช')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

export function createLeaveModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('modal_poker_leave')
    .setTitle('🏃 ขอออกก่อน (Early Cash-out)');

  const chipsInput = new TextInputBuilder()
    .setCustomId('input_chips')
    .setLabel('ชิปคงเหลือของคุณ ณ ตอนนี้ (ใส่ 0 ถ้าหมดตัว)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('เช่น 0 หรือ 150')
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(chipsInput);
  modal.addComponents(row);

  return modal;
}

export function createCustomRebuyModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('modal_poker_custom_rebuy')
    .setTitle('➕ เติมชิป (ระบุจำนวนเงิน)');

  const amountInput = new TextInputBuilder()
    .setCustomId('input_amount')
    .setLabel('จำนวนเงินที่ต้องการซื้อเพิ่ม (บาท)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('เช่น 100, 200')
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput);
  modal.addComponents(row);

  return modal;
}

export function createEndSessionModal(
  activePlayers: { user_id: string; username: string; display_name: string | null }[]
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('modal_poker_end_chips')
    .setTitle('🏁 กรอกชิปตอนจบเกมของผู้เล่น');

  // Discord modal allows max 5 TextInput components
  const limitedPlayers = activePlayers.slice(0, 5);

  for (const player of limitedPlayers) {
    const name = player.display_name || player.username;
    const input = new TextInputBuilder()
      .setCustomId(`chips_${player.user_id}`)
      .setLabel(`ชิปของ ${name.substring(0, 25)}`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ใส่จำนวนชิปคงเหลือ (เช่น 200 หรือ 0)')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  return modal;
}

export function createPreviewSessionModal(
  activePlayers: { user_id: string; username: string; display_name: string | null }[]
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('modal_poker_preview_chips')
    .setTitle('🧮 คิดเงิน (ไม่ปิดโต๊ะ)');

  // Discord modal allows max 5 TextInput components
  const limitedPlayers = activePlayers.slice(0, 5);

  for (const player of limitedPlayers) {
    const name = player.display_name || player.username;
    const input = new TextInputBuilder()
      .setCustomId(`preview_chips_${player.user_id}`)
      .setLabel(`ชิปของ ${name.substring(0, 25)}`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ใส่จำนวนชิปปัจจุบัน (เช่น 200 หรือ 0)')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  return modal;
}

export function createNextRoundActionRow(
  sessionId: number,
  disabled: boolean = false,
  isBalanced: boolean = true
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_poker_edit_${sessionId}`)
      .setLabel(isBalanced ? '✏️ แก้ไขยอดเงิน (Edit)' : '⚠️ แก้ไขยอดเงิน (ไม่บาลานซ์)')
      .setStyle(isBalanced ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`btn_poker_next_round_${sessionId}`)
      .setLabel('🔄 เริ่มรอบใหม่ (ดึงผู้เล่นเดิมเข้าโต๊ะ)')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('btn_poker_leaderboard')
      .setLabel('🏆 ดูอันดับ (Leaderboard)')
      .setStyle(ButtonStyle.Primary)
  );
}

export function createManualRecordModal(defaultBuyIn: number = 200): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('modal_poker_manual_record')
    .setTitle('📝 คิดเงิน Poker (พิมพ์เอง)');

  const buyInInput = new TextInputBuilder()
    .setCustomId('input_buyin')
    .setLabel('ยอด Buy-in ต่อคน (บาท)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(defaultBuyIn))
    .setPlaceholder('เช่น 200 หรือ 500')
    .setRequired(true);

  const playersInput = new TextInputBuilder()
    .setCustomId('input_players')
    .setLabel('รายชื่อผู้เล่น และยอดชิป/Buy-in')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('พิมพ์คนละบรรทัด เช่น:\n@Ton 350\n@Nadear 50\n@JJ 200\n(หรือแยก buy-in: @Nadear 50 buyin:400)')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(buyInInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(playersInput)
  );

  return modal;
}

export function createManualEditModal(
  sessionId: number,
  defaultBuyIn: number,
  prefilledPlayersText: string
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`modal_poker_manual_edit_${sessionId}`)
    .setTitle(`✏️ แก้ไขยอดเงิน (Session #${sessionId})`);

  const buyInInput = new TextInputBuilder()
    .setCustomId('input_buyin')
    .setLabel('ยอด Buy-in พื้นฐาน (บาท)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(defaultBuyIn))
    .setPlaceholder('เช่น 200 หรือ 500')
    .setRequired(true);

  const playersInput = new TextInputBuilder()
    .setCustomId('input_players')
    .setLabel('รายชื่อผู้เล่น และยอดชิป/Buy-in')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(prefilledPlayersText)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(buyInInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(playersInput)
  );

  return modal;
}

export function createRecalculateModal(
  sessionId: number,
  players: { user_id: string; username: string; display_name: string | null; cash_out: number | null }[]
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`modal_poker_recalc_${sessionId}`)
    .setTitle('🧮 แก้ไขชิปและคำนวณเงินใหม่');

  // Discord modal allows max 5 TextInput components
  const uniquePlayers = Array.from(new Map(players.map(p => [p.user_id, p])).values());
  const limitedPlayers = uniquePlayers.slice(0, 5);

  for (const player of limitedPlayers) {
    const name = player.display_name || player.username;
    const currentVal = player.cash_out !== null && player.cash_out !== undefined ? String(player.cash_out) : '0';
    const input = new TextInputBuilder()
      .setCustomId(`recalc_${player.user_id}`)
      .setLabel(`ชิปของ ${name.substring(0, 25)}`)
      .setStyle(TextInputStyle.Short)
      .setValue(currentVal)
      .setPlaceholder('ใส่จำนวนชิปที่ถูกต้อง (เช่น 200 หรือ 0)')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  return modal;
}

export function createAiScanPromptRow(
  sessionId: number,
  isHostOrAdmin: boolean
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_poker_ai_prompt_preview_${sessionId}`)
      .setLabel('🧮 สแกนคิดเงิน (ไม่ปิดโต๊ะ)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`btn_poker_ai_prompt_end_${sessionId}`)
      .setLabel('🏁 สแกนคิดเงิน & ปิดโต๊ะ')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isHostOrAdmin)
  );
}

export function createPreviewActionRow(sessionId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_poker_status')
      .setLabel('📊 เช็คสถานะโต๊ะ')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_poker_ai_scan')
      .setLabel('📸 สแกนใหม่ด้วย AI')
      .setStyle(ButtonStyle.Success)
  );
}


