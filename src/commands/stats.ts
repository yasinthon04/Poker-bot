import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import * as repo from '../database/repo';
import { createUserStatsEmbed, createRankedLeaderboardEmbed } from '../ui/embeds';

export const statsCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('ดูสถิติการเล่น Poker')
    .addSubcommand(sub =>
      sub
        .setName('user')
        .setDescription('ดูสถิติส่วนบุคคล')
        .addUserOption(opt => opt.setName('player').setDescription('เลือกผู้เล่น (เว้นว่างเพื่อดูของตนเอง)'))
    )
    .addSubcommand(sub =>
      sub
        .setName('monthly')
        .setDescription('สรุปผลประจำเดือน (ใครได้/เสียมากสุด)')
        .addIntegerOption(opt =>
          opt
            .setName('month')
            .setDescription('เดือน (1-12, เว้นว่างไว้คือเดือนปัจจุบัน)')
            .setMinValue(1)
            .setMaxValue(12)
        )
        .addIntegerOption(opt =>
          opt.setName('year').setDescription('ปี ค.ศ. (เว้นว่างไว้คือปีปัจจุบัน)').setMinValue(2020)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('yearly')
        .setDescription('สรุปผลประจำปี')
        .addIntegerOption(opt =>
          opt.setName('year').setDescription('ปี ค.ศ. (เว้นว่างไว้คือปีปัจจุบัน)').setMinValue(2020)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น', ephemeral: true });
      return;
    }

    const now = new Date();

    if (subcommand === 'user') {
      const targetUser = interaction.options.getUser('player') || interaction.user;
      repo.upsertUser(targetUser.id, targetUser.username, targetUser.displayName);

      const stats = repo.getUserStats(targetUser.id);
      if (stats.gamesPlayed === 0) {
        await interaction.reply({
          content: `📊 <@${targetUser.id}> ยังไม่มีประวัติการเล่น Poker ในบอทนี้`,
        });
        return;
      }

      const embed = createUserStatsEmbed(targetUser.username, targetUser.id, stats);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'monthly') {
      const month = interaction.options.getInteger('month') || now.getMonth() + 1;
      const year = interaction.options.getInteger('year') || now.getFullYear();

      const statsList = repo.getRankedStats(guildId, { year, month });
      const monthNamesThai = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
      ];
      const title = `📅 สรุปผล Poker ประจำเดือน ${monthNamesThai[month - 1]} ${year}`;
      const embed = createRankedLeaderboardEmbed(title, statsList);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'yearly') {
      const year = interaction.options.getInteger('year') || now.getFullYear();
      const statsList = repo.getRankedStats(guildId, { year });
      const title = `🏆 สรุปผล Poker ประจำปี ${year}`;
      const embed = createRankedLeaderboardEmbed(title, statsList);
      await interaction.reply({ embeds: [embed] });
      return;
    }
  },
};

export const leaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('ดูตารางอันดับเซียนไพ่ประจำเซิร์ฟเวอร์ (All-time)'),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น', ephemeral: true });
      return;
    }

    const statsList = repo.getRankedStats(guildId);
    const embed = createRankedLeaderboardEmbed('🌟 ทำเนียบเซียน Poker (All-time Leaderboard)', statsList);
    await interaction.reply({ embeds: [embed] });
  },
};
