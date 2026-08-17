// main.js
// Entrypoint: create client, add interaction logger, wire modules, and login.

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const config = require('./config');

const { registerTicketHandlers } = require('./ticket');
const { registerTournamentHandlers } = require('./tournamentsignups');
const { registerTeamHandlers } = require('./teams');
const { registerInviteHandlers } = require('./invites');
const { registerGiveawayHandlers } = require('./giveaways');
const { registerScrimHandlers } = require('./scrims');
const { registerMetaHandlers } = require('./metaupdate');
const { refreshLeaderboardMessage } = require('./leaderboard');

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

// --- Interaction logger (debug) ---
// Logs every interaction that reaches the bot so you can confirm Discord sends them here.
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    console.log('INTERACTION:', {
      id: interaction.id,
      type: interaction.type,
      isChatInput: typeof interaction.isChatInputCommand === 'function' ? interaction.isChatInputCommand() : false,
      commandName: interaction.isChatInputCommand ? (interaction.commandName || null) : null,
      customId: interaction.isButton ? (interaction.customId || null) : null,
      user: interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : null,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
    });
  } catch (e) {
    console.error('Failed to log interaction', e);
  }
});

// --- Simple /ping handler for end-to-end test ---
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'ping') {
      await interaction.reply({ content: 'pong', ephemeral: true });
    }
  } catch (err) {
    console.error('Ping command handler error:', err);
  }
});

// Wire up your modules (they expect a client instance)
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
