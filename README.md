# 🃏 Poker Settlement & Stats Discord Bot

บอทจัดการโต๊ะโป๊กเกอร์ สรุปยอดเงิน เคลียร์หนี้อัตโนมัติ (ใครต้องโอนให้ใครด้วยจำนวนครั้งที่น้อยที่สุด) รองรับคนออกกลางคัน และสรุปสถิติรายเดือน/รายปี พร้อมสร้าง QR Code พร้อมเพย์ให้สแกนจ่ายได้ทันที

---

## ✨ ฟีเจอร์หลัก (Features)

1. **ระบบโต๊ะแบบ Interactive (Embed + Buttons + Modals)**:
   - มีปุ่ม **🟢 เข้าร่วมโต๊ะ**, **🔄 เติมชิป (Rebuy)**, **➕ เติมชิป (ระบุเอง)**, **🏃 ขอออกก่อน**, **🏁 ปิดโต๊ะ/คิดเงิน**
   - อัปเดตยอดชิปกองกลาง (Total Pot) และรายชื่อคนบนโต๊ะแบบ Real-time
2. **แก้ปัญหาคนออกกลางคัน (Early Cash-out)**:
   - คนที่ขอตัวไปนอนหรือเลิกก่อน สามารถกดปุ่ม **[🏃 ขอออกก่อน]** หรือพิมพ์ `/poker leave [ชิป]`
   - บอทจะแช่แข็งยอดไว้ แล้วนำมาคำนวณเคลียร์หนี้พร้อมกันตอนจบโต๊ะ
3. **อัลกอริทึมเคลียร์หนี้ (Minimum Cash Flow Algorithm)**:
   - ตรวจสอบยอดเงิน Zero-sum ($\sum \text{Buy-in} = \sum \text{Cash-out}$) ป้องกันชิปหาย
   - จับคู่โอนเงินให้เหลือน้อยรอบที่สุด (เช่น B และ C ขาดทุนคนละ 50 ➜ โอนตรงให้ A 100 บาทคนเดียว)
4. **สร้าง PromptPay QR Code อัตโนมัติ**:
   - ถ้าผู้ชนะลงทะเบียนเบอร์พร้อมเพย์ไว้ บอทจะแนบรูป QR Code ยอดเงินที่ต้องรับให้อัตโนมัติ
5. **ระบบสถิติและทำเนียบเซียน (Stats & Leaderboard)**:
   - สรุปสถิติส่วนบุคคล (Win Rate, กำไรสะสม, Best Win/Loss)
   - สรุปผลประจำเดือน และประจำปี
   - แจกฉายา **🦈 The Shark** (คนกวาดกำไรสูงสุด) และ **🐟 The Sponsor** (ผู้สนับสนุนหลัก เสียเยอะสุด)

---

## 🚀 วิธีติดตั้งและเปิดใช้งาน (Setup Guide)

### 1. สร้าง Bot ใน Discord Developer Portal
1. เข้าไปที่ [Discord Developer Portal](https://discord.com/developers/applications)
2. กด **New Application** ตั้งชื่อบอท
3. ไปที่แท็บ **Bot**:
   - กด **Reset Token** แล้วคัดลอก Token ไว้
   - เลื่อนลงมาเปิด **Privileged Gateway Intents**:
     - ✅ **Server Members Intent** (ถ้าต้องการ)
     - ✅ **Message Content Intent**
4. ไปที่แท็บ **OAuth2 ➔ URL Generator**:
   - ติ๊ก `bot` และ `application.commands`
   - ใน Bot Permissions ติ๊ก:
     - `Send Messages`
     - `Embed Links`
     - `Attach Files`
     - `Use External Emojis`
   - คัดลอก URL ด้านล่างไปเปิดในเบราว์เซอร์ เพื่อเชิญบอทเข้าเซิร์ฟเวอร์ของคุณ

### 2. ตั้งค่าโปรเจกต์
คัดลอกไฟล์ `.env.example` เป็น `.env`:
```bash
cp .env.example .env
```
เปิดไฟล์ `.env` แล้วใส่ค่า:
```env
DISCORD_TOKEN=โทเคนบอทของคุณ
CLIENT_ID=Application_ID_ของคุณ
GUILD_ID=Server_ID_ของคุณ  # ใส่เพื่อให้อัปเดตคำสั่ง Slash Command ทันทีไม่ต้องรอ
```

### 3. ติดตั้ง Dependencies และลงทะเบียนคำสั่ง
```bash
npm install
npm run register   # ลงทะเบียน Slash Commands เข้า Discord
```

### 4. รันบอท
```bash
# โหมดพัฒนา (Development)
npm run dev

# หรือ Build แล้วรัน Production
npm run build
npm start
```

---

## 📖 คู่มือการใช้งานคำสั่ง (Commands)

### 🃏 จัดการโต๊ะ Poker (`/poker`)
| คำสั่ง | คำอธิบาย |
|---|---|
| `/poker start [buyin]` | เปิดโต๊ะใหม่ในห้องนี้ (ค่าเริ่มต้น 100 บาท) |
| `/poker join [amount]` | ซื้อชิปเข้าร่วมโต๊ะ |
| `/poker rebuy [amount]` | เติมชิปเพิ่มเมื่อหมดตัว |
| `/poker leave <chips>` | ขอออกก่อน (Early Cash-out) ใส่ชิปที่เหลือ หรือใส่ 0 ถ้าหมดตัว |
| `/poker set-chips @player <chips>` | [Host] ตั้งค่าชิปให้เพื่อน เผื่อมีคนปิดคอมหนีไปก่อน |
| `/poker end` | ปิดโต๊ะและคำนวณเงินเคลียร์หนี้ |
| `/poker status` | แสดงสถานะโต๊ะปัจจุบัน |
| `/poker cancel` | [Host] ยกเลิกโต๊ะที่กำลังเล่นอยู่ |

### 📊 สถิติและอันดับ (`/stats`, `/leaderboard`)
| คำสั่ง | คำอธิบาย |
|---|---|
| `/stats user [@player]` | ดูสถิติส่วนบุคคล (กำไรสะสม, Win Rate, Best Win/Loss) |
| `/stats monthly [month] [year]` | สรุปผลประจำเดือน (ดู Shark 🦈 และ Sponsor 🐟) |
| `/stats yearly [year]` | สรุปผลประจำปี |
| `/leaderboard` | ตารางอันดับเซียนไพ่ของเซิร์ฟเวอร์ (All-time) |

### 📱 ข้อมูลส่วนตัว (`/profile`)
| คำสั่ง | คำอธิบาย |
|---|---|
| `/profile set-promptpay <number>` | บันทึกเบอร์พร้อมเพย์ (10 หลัก) หรือบัตร ปชช. (13 หลัก) สำหรับสร้าง QR Code อัตโนมัติ |

---

## 🗄️ โครงสร้างฐานข้อมูล (SQLite)
ข้อมูลทั้งหมดถูกบันทึกไว้ใน `data/poker.db` โดยอัตโนมัติ:
- `users`: ข้อมูลผู้เล่น และเบอร์พร้อมเพย์
- `sessions`: ข้อมูลโต๊ะ ประวัติเวลาเริ่ม-จบ โฮสต์
- `session_players`: รายการซื้อชิป (Buy-in / Rebuy) และชิปตอนจบ (Cash-out)
- `settlements`: ประวัติการจับคู่โอนเงิน
