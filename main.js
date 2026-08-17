// main.js (production-ready)
// Creates the Discord client, handles team-name autocompletes, registers modules, and logs in.

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const path = require('path');
const config = require('./config');

const { registerTicketHandlers } = require('./ticket');
const { registerTournamentHandlers } = require('./tournamentsignups');
const { registerTeamHandlers } = require('./teams');
const { registerInviteHandlers } = require('./invites');
const { registerGiveawayHandlers } = require('./giveaways');
const { registerScrimHandlers } = require('./scrims');
const { registerMetaHandlers } = require('./metaupdate');
const { refreshLeaderboardMessage } = require('./leaderboard');
const { loadJson } = require('./db');

const TEAMS_DB_FILE = path.join(__dirname, 'teams_data.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// Autocomplete handler for team-name options (prevents "Loading failed")
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isAutocomplete?.()) return;

    const cmd = interaction.commandName;
    // Commands that should use team-name autocomplete
    const handledCommands = new Set([
      'teammembers',
      'startscrim',
      'forceadd',
      'staffleaderpromote',
      'staffchangesetting',
      'bypassteamlimit',
      'sendtournament',
    ]);

    // If it's not one of our handled commands, return a basic echo suggestion to keep Discord happy.
    if (!handledCommands.has(cmd)) {
      const focused = interaction.options.getFocused?.() ?? '';
      await interaction.respond([{ name: String(focused || '(no suggestion)').slice(0, 100), value: String(focused || '') }]).catch(() => {});
      return;
    }

    const focused = String(interaction.options.getFocused?.() ?? '').toLowerCase();
    const db = loadJson(TEAMS_DB_FILE, { teams: {} });
    const names = Object.keys(db.teams || {}).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const matches = names.filter(n => n.toLowerCase().includes(focused)).slice(0, 25);

    if (matches.length === 0) {
      await interaction.respond([{ name: '(no matching teams)', value: '__none__' }]).catch(() => {});
      return;
    }

    const choices = matches.map(n => ({ name: n, value: n }));
    await interaction.respond(choices).catch((err) => console.error('Failed to respond to autocomplete:', err));
  } catch (err) {
    console.error('Autocomplete handler error:', err);
  }
});

// Optional debug handlers (if you added teams-debug.js for troubleshooting)
try {
  // This file is optional — only require/register it if present.
  // It provides temporary debug handlers and will not be present in production.
  // If you use it, ensure it's removed once debugging is complete.
  // eslint-disable-next-line global-require
  const { registerTeamDebugHandlers } = require('./teams-debug');
  if (typeof registerTeamDebugHandlers === 'function') {
    registerTeamDebugHandlers(client);
    console.log('Registered optional teams-debug handlers.');
  }
} catch {
  // ignore — debug module not present
}

// Register main bot modules
registerTicketHandlers(client);
registerTournamentHandlers(client);
registerTeamHandlers(client);
registerInviteHandlers(client);
registerGiveawayHandlers(client);
registerScrimHandlers(client);
registerMetaHandlers(client);

// Ready hook
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
  try {
    await refreshLeaderboardMessage(client).catch(() => {});
  } catch (err) {
    console.warn('Leaderboard refresh failed at startup:', err);
  }
});

// Global error logging
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// Login
const token = process.env[config.DISCORD_TOKEN_ENV] || process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is not set in env; aborting.');
  process.exit(1);
}
client.login(token).catch((err) => {
  console.error('Failed to login:', err);
  process.exit(1);
});
