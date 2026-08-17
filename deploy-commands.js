// deploy-commands.js - register slash commands with autocomplete for team options
// Usage: DISCORD_TOKEN=... DISCORD_CLIENT_ID=... DISCORD_GUILD_ID=... node deploy-commands.js

const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

const token = process.env[config.DISCORD_TOKEN_ENV] || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!token) { console.error('DISCORD_TOKEN not set'); process.exit(1); }
if (!CLIENT_ID) { console.error('DISCORD_CLIENT_ID not set'); process.exit(1); }

const commands = [
  new SlashCommandBuilder().setName('createteam').setDescription('Create a new team')
    .addStringOption(opt => opt.setName('name').setDescription('Team name').setRequired(true))
    .addStringOption(opt => opt.setName('emoji').setDescription('Single standard emoji').setRequired(true))
    .addStringOption(opt => opt.setName('colour').setDescription('Hex colour, e.g. #5865F2').setRequired(true)),

  new SlashCommandBuilder().setName('teammembers').setDescription("List a team's members")
    .addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder().setName('invite').setDescription('Invite a user to your team')
    .addUserOption(opt => opt.setName('user').setDescription('The user to invite').setRequired(true)),

  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your current team'),

  new SlashCommandBuilder().setName('startscrim').setDescription('Challenge another team')
    .addStringOption(opt => opt.setName('team').setDescription('The team you want to scrim').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder().setName('forceadd').setDescription('Staff: force add a user to a team')
    .addStringOption(opt => opt.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
    .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true)),

  new SlashCommandBuilder().setName('ping').setDescription('Ping test'),
].map(c => c.toJSON());

(async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (GUILD_ID) {
      console.log('Refreshing guild commands...');
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Successfully reloaded guild (/) commands.');
    } else {
      console.log('Refreshing global commands (may take up to an hour)...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Successfully reloaded global (/) commands.');
    }
  } catch (err) {
    console.error('Failed to deploy commands', err);
    process.exit(1);
  }
})();
