// deploy-commands.js
// Registers slash commands for your bot. Run this locally or in CI with NODE_ENV vars set.
// Usage: DISCORD_TOKEN=... NODE_ENV=production node deploy-commands.js
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

const token = process.env[config.DISCORD_TOKEN_ENV];
if (!token) {
  console.error('DISCORD_TOKEN not set');
  process.exit(1);
}

// Replace with your application ID / guild ID if you want guild-scoped commands during development.
// For global commands use application ID only (takes up to an hour to propagate).
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // set this env var to your bot/app client ID
const GUILD_ID = process.env.DISCORD_GUILD_ID; // optional: for faster testing, set a dev guild ID

if (!CLIENT_ID) {
  console.error('Set DISCORD_CLIENT_ID env var (bot application ID).');
  process.exit(1);
}

// Build commands
const commands = [
  new SlashCommandBuilder().setName('createteam').setDescription('Create a new team')
    .addStringOption(opt => opt.setName('name').setDescription('Team name').setRequired(true))
    .addStringOption(opt => opt.setName('emoji').setDescription('Single standard emoji').setRequired(true))
    .addStringOption(opt => opt.setName('colour').setDescription('Hex colour, e.g. #5865F2').setRequired(true)),
  new SlashCommandBuilder().setName('invite').setDescription('Invite a user to your team')
    .addUserOption(opt => opt.setName('user').setDescription('The user to invite').setRequired(true)),
  new SlashCommandBuilder().setName('startscrim').setDescription('Challenge another team')
    .addStringOption(opt => opt.setName('team').setDescription('The team you want to scrim').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your current team'),
  new SlashCommandBuilder().setName('startgiveaway').setDescription('Start a giveaway (staff)')
    .addIntegerOption(opt => opt.setName('winners').setDescription('How many winners').setRequired(true))
    .addStringOption(opt => opt.setName('prize').setDescription("What's being given away").setRequired(true))
    .addStringOption(opt => opt.setName('ends').setDescription('How long, e.g. 10m').setRequired(true))
    .addUserOption(opt => opt.setName('hosted').setDescription("Who's hosting the giveaway")),
  new SlashCommandBuilder().setName('syncinvites').setDescription('Rebuild the invite DB by rescanning the invite tracker channel'),
  new SlashCommandBuilder().setName('checkupdate').setDescription('Check for an Animal Company update manually'),
  // More commands can be added here as needed.
].map(c => c.toJSON());

(async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (GUILD_ID) {
      console.log('Refreshing guild commands...');
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log('Successfully reloaded guild application (/) commands.');
    } else {
      console.log('Refreshing global commands (may take up to an hour)...');
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log('Successfully reloaded global application (/) commands.');
    }
  } catch (err) {
    console.error('Failed to deploy commands', err);
  }
})();