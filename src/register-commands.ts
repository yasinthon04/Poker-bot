import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { pokerCommand } from './commands/poker';
import { statsCommand, leaderboardCommand } from './commands/stats';
import { profileCommand } from './commands/profile';

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Optional: specify guildId for instant testing

if (!token || !clientId) {
  console.error('❌ Error: DISCORD_TOKEN and CLIENT_ID must be specified in .env');
  process.exit(1);
}

const commands = [
  pokerCommand.data.toJSON(),
  statsCommand.data.toJSON(),
  leaderboardCommand.data.toJSON(),
  profileCommand.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`⏳ Registering ${commands.length} slash commands...`);

    if (guildId) {
      // Fast guild registration (immediate update)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✅ Successfully registered commands for Guild: ${guildId}`);
    } else {
      // Global registration (takes up to an hour to cache globally)
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log('✅ Successfully registered global commands');
    }
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
