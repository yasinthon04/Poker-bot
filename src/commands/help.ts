import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('phelp')
    .setDescription('ดูคู่มือและคำสั่งทั้งหมดของบอท Poker Bot'),

  async execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setTitle('📖 คู่มือและคำสั่งทั้งหมดของ Poker Bot')
      .setColor(0x3498db)
      .setDescription(
        'บอทจัดการโต๊ะโป๊กเกอร์ เคลียร์หนี้อัตโนมัติ และสแกนหน้าจอเกมด้วย AI\n──────────────────────────────'
      )
      .addFields(
        {
          name: '🃏 จัดการโต๊ะโป๊กเกอร์ (`/poker`)',
          value: [
            '🌟 `/poker start-voice [buyin] [channel]` : เปิดโต๊ะและดึงทุกคนในห้องเสียงเข้าโต๊ะอัตโนมัติ (ค่าเริ่มต้น 200 บาท) *(แนะนำ)*',
            '📸 `/poker scan-table <image> [buyin] [preview] [leaver] [leaver_chips]` : แคปหน้าจอส่ง AI อ่านชิปคิดเงิน (ค่าเริ่มต้น 200 บาท สแกนได้ทันทีโดยไม่ต้องเปิดโต๊ะไว้ก่อน)',
            '🔍 `/poker preview` : ดูพรีวิวยอดเงินและคำนวณหนี้ปัจจุบันโดยไม่ต้องปิดโต๊ะ',
            '🔄 `/poker next-round [buyin]` : เริ่มรอบใหม่ทันทีโดยดึงผู้เล่นจากรอบล่าสุดเข้าโต๊ะอัตโนมัติ',
            '• `/poker start [buyin]` : เปิดโต๊ะใหม่แบบปกติ (ค่าเริ่มต้น 200 บาท)',
            '• `/poker join [amount]` : ซื้อชิปเข้าร่วมโต๊ะ',
            '• `/poker rebuy [amount]` : เติมชิปเพิ่มเมื่อหมดตัว',
            '• `/poker leave <chips>` : ขอออกก่อน (Early Cash-out) ล็อคยอดชิปไว้',
            '• `/poker set-buyin @player <amount>` : [Host] แก้ไขยอด Buy-in เผื่อใครกด Rebuy พลาด',
            '• `/poker set-chips @player <chips>` : [Host] กำหนดชิปตอนจบให้เพื่อน',
            '• `/poker end` : ปิดโต๊ะและคำนวณเงินเคลียร์หนี้ (แบบกรอกตัวเลข)',
            '• `/poker status` : ดูสถานะโต๊ะปัจจุบันในห้องนี้',
            '• `/poker cancel` : [Host] ยกเลิกโต๊ะที่กำลังเล่นอยู่',
          ].join('\n'),
        },
        {
          name: '🧹 จัดการข้อความ (`/clear`)',
          value: '• `/clear [amount]` : ลบข้อความในห้องแชท (1 - 100 ข้อความ, ค่าเริ่มต้น 10)',
        },
        {
          name: '📊 สถิติและทำเนียบเซียน (`/stats`, `/leaderboard`)',
          value: [
            '• `/stats user [@player]` : ดูสถิติส่วนบุคคล (กำไรสะสม, Win Rate %, สถิติชนะ/แพ้)',
            '• `/stats monthly [month] [year]` : สรุปประจำเดือน (ดู Shark 🦈 และ Sponsor 🐟)',
            '• `/stats yearly [year]` : สรุปผลประจำปี',
            '• `/leaderboard` : ตารางอันดับเซียนไพ่ของเซิร์ฟเวอร์ (All-time)',
          ].join('\n'),
        },
        {
          name: '📱 ข้อมูลส่วนตัว / พร้อมเพย์ (`/profile`)',
          value: [
            '• `/profile set-promptpay <number>` : บันทึกเบอร์พร้อมเพย์รับเงิน (มี QR Code อัตโนมัติ)',
            '• `/profile clear-promptpay` : ลบข้อมูลพร้อมเพย์ / ปิดการสร้าง QR Code',
          ].join('\n'),
        }
      )
      .setFooter({
        text: '💡 ทริค: เข้าห้อง Voice ➔ /poker start-voice ➔ เล่นเสร็จแคปรูปส่ง /poker scan-table',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
