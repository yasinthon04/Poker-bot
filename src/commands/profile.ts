import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import * as repo from '../database/repo';

export const profileCommand = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('จัดการข้อมูลส่วนตัวของผู้เล่น')
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
  },
};
