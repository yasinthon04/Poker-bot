import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from 'discord.js';

export const clearCommand = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('ลบข้อความในห้องแชท (Purge / Clean messages)')
    .addIntegerOption(opt =>
      opt
        .setName('amount')
        .setDescription('จำนวนข้อความที่ต้องการลบ (1 - 100 ข้อความ, ค่าเริ่มต้น 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction: ChatInputCommandInteraction) {
    // Check permission of user
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: '❌ คุณต้องมีสิทธิ์ **Manage Messages** ในการลบข้อความ',
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.channel;
    if (
      !channel ||
      !(
        channel instanceof TextChannel ||
        channel instanceof NewsChannel ||
        channel instanceof ThreadChannel
      )
    ) {
      await interaction.reply({
        content: '❌ ไม่สามารถลบข้อความในห้องประเภทนี้ได้',
        ephemeral: true,
      });
      return;
    }

    const amount = interaction.options.getInteger('amount') ?? 10;

    await interaction.deferReply({ ephemeral: true });

    try {
      // bulkDelete takes up to 100 messages, true ignores messages older than 14 days
      const deleted = await channel.bulkDelete(amount, true);

      await interaction.editReply({
        content: `🧹 ลบข้อความในห้องนี้ไปแล้ว **${deleted.size} ข้อความ** เรียบร้อยแล้วครับ!`,
      });
    } catch (error: any) {
      console.error('Error deleting messages:', error);
      await interaction.editReply({
        content: `⚠️ ไม่สามารถลบข้อความได้ (บอทอาจยังไม่มีสิทธิ์ **Manage Messages** ในเซิร์ฟเวอร์นี้ หรือข้อความเก่าเกิน 14 วัน)`,
      });
    }
  },
};
