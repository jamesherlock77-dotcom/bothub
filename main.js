// main.js (production-ready)
// Creates the Discord client, handles autocomplete, registers modules, and logs DB files at startup.

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const path = require('path');
const fs = require('fs');

const config = require('./config');

// Module handlers (expect these files to exist)
const { registerTicketHandlers } = require('./ticket');
const { registerTournamentHandlers } = require('./tournamentsignups');
const { registerTeamHandlers } = require('./teams');
const { registerInviteHandlers } = require('./invites');
const { registerGiveawayHandlers } = require('./giveaways');
const { registerScrimHandlers } = require('./scrims');
const { registerMetaHandlers } = require('./metaupdate');
const { refreshLeaderboardMessage } = require('./leaderboard');

const { loadJson, TEAMS_DB_FILE, TICKETS_DB_FILE } = require('./db');
const { safeDeferReply, safeReply } = require('./utils/interaction');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// --- Startup DB preview for debugging ---
function _logFilePreview(filePath, label) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`DB CHECK: ${label} missing at ${filePath}`);
      return;
    }
    const stat = fs.statSync(filePath);
    console.log(`DB CHECK: ${label} exists at ${filePath} size=${stat.size} bytes`);
    const raw = fs.readFileSync(filePath, 'utf8');
    const preview = raw.slice(0, 1024);
    console.log(`DB PREVIEW (${label}):\n${preview}${raw.length > 1024 ? '\n...[truncated]' : ''}`);
  } catch (err) {
    console.error(`DB CHECK ERROR (${label}):`, err && err.message ? err.message : err);
  }
}

_logFilePreview(TEAMS_DB_FILE, 'teams_data.json (candidate)');
_logFilePreview(TICKETS_DB_FILE, 'tickets_data.json (candidate)');

// --- Autocomplete handler for team-name options ---
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isAutocomplete?.()) return;

    const cmd = interaction.commandName;
    const handledCommands = new Set([
      'teammembers',
      'startscrim',
      'forceadd',
      'staffleaderpromote',
      'staffchangesetting',
      'bypassteamlimit',
      'sendtournament',
    ]);

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

// --- Register optional debug handlers if present (teams-debug) ---
try {
  const { registerTeamDebugHandlers } = require('./teams-debug');
  if (typeof registerTeamDebugHandlers === 'function') {
    registerTeamDebugHandlers(client);
    console.log('Registered optional teams-debug handlers.');
  }
} catch {
  // ignore if missing
}

// --- Register main modules ---
registerTicketHandlers(client);
registerTournamentHandlers(client);
registerTeamHandlers(client);
registerInviteHandlers(client);
registerGiveawayHandlers(client);
registerScrimHandlers(client);
registerMetaHandlers(client);

// --- Ready hook ---
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
  try {
    await refreshLeaderboardMessage(client).catch(() => {});
  } catch (err) {
    console.warn('Leaderboard refresh failed at startup:', err);
  }
});

// Global and client-level error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err && err.stack ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.stack ? err.stack : err);
});
client.on('error', (err) => {
  console.error('Discord client error:', err && err.stack ? err.stack : err);
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
