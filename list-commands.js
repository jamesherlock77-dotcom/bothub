// list-commands.js
// Lists your registered slash commands (global or guild).
// Usage:
// DISCORD_TOKEN=... DISCORD_CLIENT_ID=... DISCORD_GUILD_ID=... node list-commands.js

const { REST, Routes } = require('discord.js');
const token = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!token || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID env vars.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    if (GUILD_ID) {
      const cmds = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
      console.log('Guild commands:', cmds.map(c => c.name));
    } else {
      const cmds = await rest.get(Routes.applicationCommands(CLIENT_ID));
      console.log('Global commands:', cmds.map(c => c.name));
    }
  } catch (err) {
    console.error('Failed to list commands', err);
  }
})();
