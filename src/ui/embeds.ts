import { EmbedBuilder } from 'discord.js';
import { SessionPlayerRow, SessionRow, UserStats, RankedPlayerStats } from '../database/repo';
import { SettlementResult } from '../services/settlement';

export function createTableEmbed(session: SessionRow, players: SessionPlayerRow[]): EmbedBuilder {
  const totalBuyIn = players.reduce((sum, p) => sum + p.buy_in, 0);
  const activePlayers = players.filter(p => p.status === 'playing');
  const leftPlayers = players.filter(p => p.status === 'left');

  const uniqueUsers = new Set(players.map(p => p.user_id));

  const embed = new EmbedBuilder()
    .setTitle(`🃏 โต๊ะ Poker Session #${session.id}`)
    .setColor(0x2ecc71) // Nice poker table green
    .setDescription(
      `**Host:** <@${session.host_id}>\n` +
      `**ชิปเริ่มต้น:** ${session.default_buyin.toLocaleString()} บาท\n` +
      `**💰 กองกลางรวม (Total Pot):** ${totalBuyIn.toLocaleString()} บาท\n` +
      `**ผู้เล่นทั้งหมด:** ${uniqueUsers.size} คน (กำลังเล่น ${activePlayers.length} คน, ออกแล้ว ${leftPlayers.length} คน)\n\n` +
      `──────────────────────────────`
    );

  if (activePlayers.length > 0) {
    const activeText = activePlayers
      .map((p, idx) => {
        const rebuys = Math.max(0, Math.round((p.buy_in - session.default_buyin) / session.default_buyin));
        const rebuyTag = rebuys > 0 ? ` *(Rebuy x${rebuys})*` : '';
        return `${idx + 1}. <@${p.user_id}> : ลงเงิน **${p.buy_in.toLocaleString()}฿**${rebuyTag}`;
      })
      .join('\n');
    embed.addFields({ name: '🟢 ผู้เล่นที่ยังอยู่บนโต๊ะ', value: activeText });
  } else {
    embed.addFields({ name: '🟢 ผู้เล่นที่ยังอยู่บนโต๊ะ', value: '*ยังไม่มีผู้เล่น (กดปุ่ม Join ด้านล่าง)*' });
  }

  if (leftPlayers.length > 0) {
    const leftText = leftPlayers
      .map(p => {
        const cashOut = p.cash_out ?? 0;
        const net = Math.round((cashOut - p.buy_in) * 100) / 100;
        const netSign = net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString();
        const icon = net >= 0 ? '🟢' : '🔴';
        return `• <@${p.user_id}> : ชิป ${cashOut.toLocaleString()}฿ (${icon} **${netSign}฿**)`;
      })
      .join('\n');
    embed.addFields({ name: '🏃 ผู้เล่นที่ขอออกก่อน (Early Leavers)', value: leftText });
  }

  embed.setFooter({
    text: '💡 กดปุ่มด้านล่างเพื่อซื้อชิป / เติมชิป / ขอออกก่อน หรือกดปิดโต๊ะเมื่อเล่นเสร็จ',
  });
  embed.setTimestamp();

  return embed;
}

export function createSummaryEmbed(
  session: SessionRow,
  settlement: SettlementResult,
  userPromptPayMap?: Record<string, string | { promptpay?: string | null; qrImageUrl?: string | null } | null>,
  isPreview: boolean = false
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(
      isPreview
        ? `🧮 คิดเงิน Poker Session #${session.id} (ยังไม่ปิดโต๊ะ)`
        : `🏁 สรุปผล Poker Session #${session.id}`
    )
    .setColor(isPreview ? 0xf1c40f : settlement.isBalanced ? 0x3498db : 0xe74c3c);

  if (isPreview) {
    embed.setDescription(
      '💡 **คิดเงินแบบไม่ปิดโต๊ะ:** คำนวณยอดเงินและรายการโอนเงินให้เรียบร้อย **โต๊ะยังคงเปิดอยู่ตามปกติ** สามารถเล่นต่อ หรือปิดโต๊ะจริงได้ตลอดเวลา'
    );
  }

  // 1. Profit / Loss section
  const playerLines = settlement.players.map((p, idx) => {
    const icon = p.net > 0 ? '🟢' : p.net < 0 ? '🔴' : '⚪';
    const sign = p.net > 0 ? '+' : '';
    const medal = idx === 0 && p.net > 0 ? '👑 ' : '';
    const userLabel = p.isBot || p.userId.startsWith('bot_') ? `🤖 **${p.name} (Bot)**` : `<@${p.userId}>`;
    return `${medal}${icon} ${userLabel} : **${sign}${p.net.toLocaleString()} บาท** *(Buy-in ${p.buyIn} ➜ เหลือ ${p.cashOut})*`;
  });

  embed.addFields({
    name: '📊 กำไร / ขาดทุน รายคน',
    value: playerLines.join('\n') || '*ไม่มีข้อมูล*',
  });

  // 2. Settlement transactions (Who pays whom)
  if (settlement.transactions.length > 0) {
    const txLines = settlement.transactions.map((tx, idx) => {
      const entry = userPromptPayMap?.[tx.toUserId];
      let ppText = '';
      if (typeof entry === 'string') {
        ppText = ` 📱 *พร้อมเพย์: \`${entry}\`*`;
      } else if (entry && typeof entry === 'object') {
        if (entry.promptpay && entry.qrImageUrl) {
          ppText = ` 📱 *พร้อมเพย์: \`${entry.promptpay}\`* (🖼️ มีรูป QR)`;
        } else if (entry.promptpay) {
          ppText = ` 📱 *พร้อมเพย์: \`${entry.promptpay}\`*`;
        } else if (entry.qrImageUrl) {
          ppText = ` 🖼️ *(มีรูป QR รับเงิน)*`;
        }
      }
      const fromLabel = tx.fromUserId.startsWith('bot_') ? `🤖 **${tx.fromName} (Bot)**` : `<@${tx.fromUserId}>`;
      const toLabel = tx.toUserId.startsWith('bot_') ? `🤖 **${tx.toName} (Bot)**` : `<@${tx.toUserId}>`;
      return `**${idx + 1}.** ${fromLabel} โอนให้ ${toLabel} 👉 **${tx.amount.toLocaleString()} บาท**${ppText}`;
    });

    embed.addFields({
      name: isPreview ? '💸 รายการโอนเงิน (โต๊ะยังไม่ปิด)' : '💸 รายการโอนเงิน (เคลียร์หนี้ให้น้อยรอบที่สุด)',
      value: txLines.join('\n\n'),
    });
  } else {
    embed.addFields({
      name: '💸 รายการโอนเงิน',
      value: '✅ เจ๊ากันทุกคน ไม่มียอดที่ต้องโอน',
    });
  }

  // 3. Balance verification
  if (!settlement.isBalanced) {
    const sign = settlement.discrepancy > 0 ? '+' : '';
    embed.addFields({
      name: '⚠️ แจ้งเตือน: ยอดเงินไม่บาลานซ์!',
      value: `ยอดชิปบนโต๊ะไม่ตรงกับเงิน Buy-in อยู่ **${sign}${settlement.discrepancy.toLocaleString()} บาท**\n(Total Buy-in: ${settlement.totalBuyIn}฿ vs Total Cash-out: ${settlement.totalCashOut}฿)\nกรุณาตรวจสอบว่ามีใครจำเลขผิดหรือลืมบันทึก Rebuy หรือไม่`,
    });
  } else {
    embed.setFooter({
      text: isPreview
        ? `🔍 พรีวิวยอดเงินลงตัวสมบูรณ์ (Total Pot: ${settlement.totalBuyIn.toLocaleString()}฿) • โต๊ะยังไม่ปิด`
        : `✅ ยอดเงินลงตัวสมบูรณ์ (Total Pot: ${settlement.totalBuyIn.toLocaleString()}฿)`,
    });
  }

  embed.setTimestamp();
  return embed;
}

export function createUserStatsEmbed(
  userTag: string,
  userId: string,
  stats: UserStats
): EmbedBuilder {
  const profitSign = stats.totalProfit > 0 ? '+' : '';
  const profitColor = stats.totalProfit > 0 ? 0x2ecc71 : stats.totalProfit < 0 ? 0xe74c3c : 0x95a5a6;

  return new EmbedBuilder()
    .setTitle(`📈 สถิติ Poker ของ ${userTag}`)
    .setColor(profitColor)
    .setDescription(`<@${userId}>`)
    .addFields(
      {
        name: '💰 กำไร / ขาดทุน รวม',
        value: `**${profitSign}${stats.totalProfit.toLocaleString()} บาท**`,
        inline: true,
      },
      {
        name: '🎯 Win Rate',
        value: `**${stats.winRate}%** (${stats.wins} ชนะ / ${stats.losses} แพ้)`,
        inline: true,
      },
      {
        name: '🎮 จำนวนเกมที่เล่น',
        value: `**${stats.gamesPlayed} เกม**`,
        inline: true,
      },
      {
        name: '📥 Buy-in รวม',
        value: `${stats.totalBuyIn.toLocaleString()} บาท`,
        inline: true,
      },
      {
        name: '📤 Cash-out รวม',
        value: `${stats.totalCashOut.toLocaleString()} บาท`,
        inline: true,
      },
      {
        name: '⭐ ชนะสูงสุด / เสียสูงสุด',
        value: `🏆 +${stats.biggestWin.toLocaleString()}฿\n💀 -${stats.biggestLoss.toLocaleString()}฿`,
        inline: true,
      }
    )
    .setTimestamp();
}

export function createRankedLeaderboardEmbed(
  title: string,
  statsList: RankedPlayerStats[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0xf1c40f) // Gold
    .setTimestamp();

  if (statsList.length === 0) {
    embed.setDescription('*ยังไม่มีข้อมูลสถิติในเซิร์ฟเวอร์นี้*');
    return embed;
  }

  // Top winner (Shark 🦈) & Top loser (Sponsor 🐟)
  const shark = statsList[0];
  const sponsor = statsList[statsList.length - 1];

  let headerNote = '';
  if (shark && shark.totalProfit > 0) {
    headerNote += `🦈 **Shark ประจำตาราง:** <@${shark.userId}> (+${shark.totalProfit.toLocaleString()}฿)\n`;
  }
  if (sponsor && sponsor.totalProfit < 0 && sponsor.userId !== shark?.userId) {
    headerNote += `🐟 **ผู้สนับสนุนหลัก (Sponsor):** <@${sponsor.userId}> (${sponsor.totalProfit.toLocaleString()}฿)\n`;
  }
  if (headerNote) {
    embed.setDescription(headerNote + '\n──────────────────────────────');
  }

  const rows = statsList.map((p, idx) => {
    let rankBadge = `**#${idx + 1}**`;
    if (idx === 0) rankBadge = '🥇';
    else if (idx === 1) rankBadge = '🥈';
    else if (idx === 2) rankBadge = '🥉';

    const profitSign = p.totalProfit > 0 ? '+' : '';
    const icon = p.totalProfit > 0 ? '🟢' : p.totalProfit < 0 ? '🔴' : '⚪';

    return `${rankBadge} <@${p.userId}> : ${icon} **${profitSign}${p.totalProfit.toLocaleString()}฿** *(เล่น ${p.gamesPlayed} เกม | Win Rate ${p.winRate}%)*`;
  });

  embed.addFields({
    name: '🏆 ตารางอันดับผู้เล่น',
    value: rows.join('\n'),
  });

  return embed;
}
