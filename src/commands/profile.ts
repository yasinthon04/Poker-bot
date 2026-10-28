import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
} from 'discord.js';
import * as repo from '../database/repo';
import fs from 'fs';
import path from 'path';

export const profileCommand = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('จัดการข้อมูลส่วนตัวและการรับเงินของผู้เล่น')
    .addSubcommand(sub =>
      sub
        .setName('set-promptpay')
        .setDescription('บันทึกเบอร์พร้อมเพย์ หรือเลขบัตรประชาชนสำหรับรับเงิน')
        .addStringOption(opt =>
          opt
            .setName('number')
            .setDescription('เบอร์โทรศัพท์ (เช่น 0812345678) หรือเลขบัตร ปชช. (13 หลัก)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('clear-promptpay')
        .setDescription('ลบข้อมูลพร้อมเพย์ / ยกเลิกการสร้าง QR Code อัตโนมัติ')
    )
    .addSubcommand(sub =>
      sub
        .setName('set-qr')
        .setDescription('อัปโหลดรูปภาพ QR Code รับเงิน (ธนาคาร หรือ พร้อมเพย์) สำหรับใช้โอนเงิน')
        .addAttachmentOption(opt =>
          opt
            .setName('image')
            .setDescription('ไฟล์รูป QR Code สำหรับรับเงิน (PNG, JPG, WEBP)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('clear-qr')
        .setDescription('ลบรูปภาพ QR Code รับเงินของคุณออกจากระบบ')
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('ดูข้อมูลการรับเงินปัจจุบันของคุณ (เบอร์พร้อมเพย์ & รูป QR Code)')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.user;

    await repo.upsertUser(user.id, user.username, user.displayName);

    if (subcommand === 'set-promptpay') {
      const rawPromptPay = interaction.options.getString('number', true);
      const clean = rawPromptPay.replace(/[-\s]/g, '');

      // Validation for 10-digit phone or 13-digit ID
      if (!/^(\d{10}|\d{13})$/.test(clean)) {
        await interaction.reply({
          content: '❌ รูปแบบพร้อมเพย์ไม่ถูกต้อง! กรุณากรอกเบอร์โทรศัพท์ 10 หลัก (เช่น `0812345678`) หรือเลขบัตร ปชช. 13 หลัก',
          ephemeral: true,
        });
        return;
      }

      await repo.setUserPromptPay(user.id, clean);
      await interaction.reply({
        content: `✅ บันทึกเบอร์พร้อมเพย์ \`${clean}\` สำเร็จแล้ว! เมื่อคุณชนะในเกม บอทจะช่วยแนบ QR Code พร้อมเพย์ให้เพื่อนสแกนจ่ายได้ทันที`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'clear-promptpay') {
      await repo.clearUserPromptPay(user.id);
      await interaction.reply({
        content: '🗑️ ลบข้อมูลพร้อมเพย์ของคุณเรียบร้อยแล้ว! บอทจะไม่สร้าง QR Code ให้คุณเมื่อจบเกม',
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'set-qr') {
      const attachment = interaction.options.getAttachment('image', true);

      // Validate image format
      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
      const isImage = attachment.contentType
        ? validTypes.some(t => attachment.contentType?.toLowerCase().startsWith(t))
        : /\.(png|jpe?g|webp)$/i.test(attachment.name || '');

      if (!isImage) {
        await interaction.reply({
          content: '❌ ไฟล์ที่อัปโหลดไม่ใช่รูปภาพ! กรุณาอัปโหลดไฟล์รูปภาพ QR Code เช่น PNG, JPG หรือ WEBP',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const qrDir = path.join(process.cwd(), 'data', 'qr_images');
        if (!fs.existsSync(qrDir)) {
          fs.mkdirSync(qrDir, { recursive: true });
        }

        const ext = path.extname(attachment.name || '') || '.png';
        const fileName = `${user.id}${ext}`;
        const filePath = path.join(qrDir, fileName);
        const relativePath = `data/qr_images/${fileName}`;

        // Download attachment to local storage to prevent Discord CDN URL expiration
        const resp = await fetch(attachment.url);
        if (!resp.ok) {
          throw new Error(`Failed to download attachment: ${resp.statusText}`);
        }
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);

        // Update database
        await repo.setUserQrImage(user.id, relativePath);

        const previewAttachment = new AttachmentBuilder(buffer, { name: 'qr-preview.png' });
        const embed = new EmbedBuilder()
          .setTitle('✅ บันทึกรูป QR Code สำหรับรับเงินสำเร็จ!')
          .setDescription(
            `บันทึกรูป QR Code สำหรับคุณ **${user.displayName || user.username}** เรียบร้อยแล้ว!\n\n` +
            `💡 **การทำงาน:** เมื่อคุณเป็นผู้ชนะที่มีกำไรสูงสุด บอทจะนำรูป QR Code นี้ไปแสดงในหน้าสรุปเงินอัตโนมัติ เพื่อให้ผู้เล่นคนอื่นสแกนจ่ายได้ทันที`
          )
          .setColor(0x2ecc71)
          .setImage('attachment://qr-preview.png')
          .setTimestamp();

        await interaction.editReply({
          embeds: [embed],
          files: [previewAttachment],
        });
      } catch (err: any) {
        console.error('Error saving user QR image:', err);
        await interaction.editReply({
          content: `❌ เกิดข้อผิดพลาดในการบันทึกรูป QR Code: ${err?.message || 'Unknown error'}`,
        });
      }
      return;
    }

    if (subcommand === 'clear-qr') {
      await repo.clearUserQrImage(user.id);

      // Clean up files on disk if present
      const qrDir = path.join(process.cwd(), 'data', 'qr_images');
      if (fs.existsSync(qrDir)) {
        const files = fs.readdirSync(qrDir);
        for (const file of files) {
          if (file.startsWith(`${user.id}.`)) {
            try {
              fs.unlinkSync(path.join(qrDir, file));
            } catch (e) {
              console.warn('Failed to delete old QR file:', e);
            }
          }
        }
      }

      await interaction.reply({
        content: '🗑️ ลบรูป QR Code รับเงินของคุณเรียบร้อยแล้ว!',
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'view') {
      const userRecord = await repo.getUser(user.id);
      const ppText = userRecord?.promptpay ? `\`${userRecord.promptpay}\`` : '*ยังไม่ได้ตั้งค่า*';
      const hasQr = !!userRecord?.qr_image_url;

      const embed = new EmbedBuilder()
        .setTitle(`👤 ข้อมูลการรับเงินของ ${user.displayName || user.username}`)
        .setColor(0x3498db)
        .addFields(
          { name: '📱 เบอร์พร้อมเพย์', value: ppText, inline: true },
          { name: '🖼️ รูป QR Code', value: hasQr ? '✅ มีรูป QR ในระบบ' : '❌ ยังไม่ได้อัปโหลด', inline: true },
          {
            name: 'ℹ️ ลำดับการแสดง QR เมื่อคุณเป็นผู้ชนะ',
            value:
              '1. หากมี **รูป QR Code (set-qr)** บอทจะแสดงรูป QR นั้นเป็นอันดับแรก\n' +
              '2. หากไม่มีรูป แต่มี **เบอร์พร้อมเพย์ (set-promptpay)** บอทจะเจน QR พร้อมเพย์พร้อมระบุยอดให้อัตโนมัติ',
          }
        )
        .setTimestamp();

      const files: AttachmentBuilder[] = [];

      if (userRecord?.qr_image_url) {
        const resolvedPath = path.isAbsolute(userRecord.qr_image_url)
          ? userRecord.qr_image_url
          : path.join(process.cwd(), userRecord.qr_image_url);

        if (fs.existsSync(resolvedPath)) {
          const buffer = fs.readFileSync(resolvedPath);
          files.push(new AttachmentBuilder(buffer, { name: 'my-qr.png' }));
          embed.setImage('attachment://my-qr.png');
        }
      }

      await interaction.reply({
        embeds: [embed],
        files,
        ephemeral: true,
      });
      return;
    }
  },
};
