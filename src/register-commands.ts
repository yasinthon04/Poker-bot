import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { pokerCommand } from './commands/poker';
import { statsCommand, leaderboardCommand } from './commands/stats';
import { profileCommand } from './commands/profile';
import { clearCommand } from './commands/clear';
import { helpCommand } from './commands/help';

dotenv.config();

export async function registerSlashCommands(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !clientId || token === 'your_bot_token_here' || clientId === 'your_client_id_here') {
    console.error('\n❌ กรุณาตั้งค่า DISCORD_TOKEN และ CLIENT_ID ในไฟล์ .env ก่อนครับ!');
    return;
  }

  const commands = [
    pokerCommand.data.toJSON(),
    statsCommand.data.toJSON(),
    leaderboardCommand.data.toJSON(),
    profileCommand.data.toJSON(),
    clearCommand.data.toJSON(),
    helpCommand.data.toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log(`⏳ กำลังลงทะเบียน ${commands.length} Slash Commands เข้า Discord...`);

    if (guildId && guildId !== 'your_guild_id_here') {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✅ ลงทะเบียนคำสั่งสำหรับ Server ID: ${guildId} เรียบร้อยแล้ว (อัปเดตทันที)`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log('✅ ลงทะเบียนคำสั่งแบบ Global เรียบร้อยแล้ว');
    }
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// If executed directly (e.g. npm run register)
if (require.main === module) {
  registerSlashCommands();
}
