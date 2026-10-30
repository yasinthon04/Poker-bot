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
          name: '🎮 เปิดโต๊ะและเล่นไพ่ (`/poker`)',
          value: [
            '• `/poker play` : เปิดโต๊ะเล่น Texas Hold\'em แบบสด (Web / Discord Activity)',
            '• `/poker start-voice [buyin]` : เปิดโต๊ะดึงทุกคนในห้องเสียงเข้าเล่นอัตโนมัติ (เริ่มต้น 200฿)',
            '• `/poker start [buyin]` : เปิดโต๊ะใหม่แบบปกติในห้องนี้',
            '• `/poker join [amount]` / `/poker rebuy [amount]` : ซื้อชิป / เติมชิป',
            '• `/poker leave <chips>` : ขอออกก่อน (Early Cash-out) ล็อคยอดชิปไว้',
            '• `/poker status` : ดูสถานะโต๊ะปัจจุบันในห้องนี้',
            '• `/poker cancel` : [Host] ยกเลิกโต๊ะที่กำลังเล่นอยู่',
          ].join('\n'),
        },
        {
          name: '📝 คิดเงิน & เคลียร์หนี้ (`/poker`)',
          value: [
            '• `/poker record [players] [buyin]` : คิดเงินแบบพิมพ์เอง (คำนวณหนี้ + บันทึก Leaderboard)',
            '• `/poker edit [session_id]` : [Host] แก้ไขยอดเงินหรือผู้เล่นของรอบที่บันทึกไว้ได้ตลอดเวลา',
            '• `/poker scan-table <image>` : 📸 สแกนรูปโต๊ะคิดเงินทันทีโดยไม่ต้องเปิดโต๊ะล่วงหน้า',
            '• `/poker preview` : ดูพรีวิวยอดเงินและคำนวณหนี้ปัจจุบันโดยไม่ต้องปิดโต๊ะ',
            '• `/poker next-round [buyin]` : เริ่มรอบใหม่ทันทีโดยดึงผู้เล่นเดิมเข้าโต๊ะ',
            '• `/poker set-chips @player <chips>` : [Host] กำหนดชิปตอนจบให้เพื่อน',
            '• `/poker set-buyin @player <amount>` : [Host] แก้ไขยอด Buy-in ของผู้เล่น',
            '• `/poker end` : ปิดโต๊ะและคำนวณเงินเคลียร์หนี้ (แบบกรอกตัวเลข)',
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
          name: '📱 ข้อมูลส่วนตัว / รับเงิน (`/profile`)',
          value: [
            '• `/profile set-qr <image>` : 🖼️ อัปโหลดรูป QR Code รับเงิน (ธนาคาร หรือ พร้อมเพย์) ให้เพื่อนสแกนเมื่อชนะ',
            '• `/profile view` : 🔍 ดูข้อมูลการรับเงินของคุณ (เบอร์พร้อมเพย์ & พรีวิวรูป QR ที่บันทึกไว้)',
            '• `/profile clear-qr` : 🗑️ ลบรูปภาพ QR Code รับเงินออกจากระบบ',
            '• `/profile set-promptpay <number>` : บันทึกเบอร์พร้อมเพย์รับเงิน (มี QR Code อัตโนมัติ)',
            '• `/profile clear-promptpay` : ลบข้อมูลพร้อมเพย์ / ปิดการสร้าง QR Code',
          ].join('\n'),
        }
      )
      .setFooter({
        text: '💡 ทริค: เล่นสด /poker play หรือเข้า Voice ➔ /poker start-voice ➔ เล่นเสร็จแคปรูป /poker scan-table',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
