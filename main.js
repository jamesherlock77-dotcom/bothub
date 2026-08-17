// main.js
// Entrypoint: create client, add interaction logger, autocomplete handler, ping responder, wire modules, and login.

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

// Create the client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// --- Detailed interaction logger (debug) ---
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    console.log('--- INTERACTION START ---');
    console.log('id:', interaction.id);
    console.log('type:', interaction.type);
    console.log('isChatInputCommand():', typeof interaction.isChatInputCommand === 'function' ? interaction.isChatInputCommand() : '(no method)');
    console.log('commandName:', interaction.commandName ?? null);
    console.log('commandId:', interaction.commandId ?? null);
    console.log('customId:', interaction.customId ?? null);
    console.log('user:', interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : null);
    console.log('channelId:', interaction.channelId);
    console.log('guildId:', interaction.guildId);
    console.log('memberRoles:', interaction.member ? Array.from(interaction.member.roles?.cache?.keys?.() || []) : null);
    try { console.log('raw (partial):', JSON.stringify({
      id: interaction.id,
      type: interaction.type,
      commandName: interaction.commandName,
      commandId: interaction.commandId,
      customId: interaction.customId,
      user: interaction.user?.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
    }, null, 2)); } catch {}
    console.log('--- INTERACTION END ---');
  } catch (e) {
    console.error('Failed to log interaction', e);
  }
});

// --- Autocomplete handler: returns team-name suggestions for certain commands ---
// Prevents "Loading failed" when users type into the team option.
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isAutocomplete?.()) return;

    const cmd = interaction.commandName;
    // Commands that should use team-name autocomplete:
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
      // generic fallback (keep Discord happy)
      const focused = interaction.options.getFocused?.() ?? '';
      await interaction.respond([{ name: String(focused || '(no suggestion)').slice(0, 100), value: String(focused || '') }]).catch(() => {});
      return;
    }

    const focused = String(interaction.options.getFocused?.() ?? '').toLowerCase();
    const db = loadJson(TEAMS_DB_FILE, { teams: {} });
    const names = Object.keys(db.teams || {}).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const matches = names.filter(n => n.toLowerCase().includes(focused)).slice(0, 25);
    if (matches.length === 0) {
      // Return a harmless placeholder so Discord doesn't show "Loading failed"
      await interaction.respond([{ name: '(no matching teams)', value: '__none__' }]).catch(() => {});
      return;
    }
    const choices = matches.map(n => ({ name: n, value: n }));
    await interaction.respond(choices).catch((err) => {
      console.error('Failed to respond to autocomplete:', err);
    });
    console.log(`Autocomplete suggestions for /${cmd} (${interaction.user?.tag}): ${matches.slice(0,5).join(', ')}`);
  } catch (err) {
    console.error('Autocomplete handler error:', err);
  }
});

// --- Simple /ping handler for end-to-end test ---
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand?.()) return;
    if (interaction.commandName === 'ping') {
      // Use reply; ephemeral flagged for user-only visibility
      await interaction.reply({ content: 'pong', ephemeral: true }).catch(async (err) => {
        // fallback to followup if needed
        try { await interaction.followUp({ content: 'pong', ephemeral: true }).catch(() => {}); } catch {}
      });
    }
  } catch (err) {
    console.error('Ping command handler error:', err);
  }
});

// Wire up your existing modules (they expect a client instance)
registerTicketHandlers(client);
registerTournamentHandlers(client);
registerTeamHandlers(client);
registerInviteHandlers(client);
registerGiveawayHandlers(client);
registerScrimHandlers(client);
registerMetaHandlers(client);

// Optional: refresh leaderboard on ready (safe no-op if canvas not installed)
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
  try {
    await refreshLeaderboardMessage(client).catch(() => {});
  } catch (err) {
    console.warn('Leaderboard refresh failed at startup:', err);
  }
});

// Helpful global error logging
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
