// main.js (debug mode) — temporary. Reverts to regular when done.
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

// Detailed interaction logger for debugging
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
    // If possible, log the raw data (be careful with large objects)
    try { console.log('raw:', JSON.stringify(interaction, ['id','type','commandName','commandId','customId','user','channelId','guildId','token'], 2)); } catch {}
    console.log('--- INTERACTION END ---');
  } catch (e) {
    console.error('Failed to log interaction', e);
  }
});

// Temporary global chat-input responder — replies to every chat input command with a short ephemeral debug message.
// This confirms the bot can *send* replies in response to commands. Remove this block after debugging.
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    // If you want this handler to be last, ensure modules are registered first; it's fine for debugging.
    const cmd = interaction.commandName;
    // Reply only if not already replied — use reply if possible, otherwise followUp
    try {
      await interaction.reply({ content: `DEBUG: Received command /${cmd}`, ephemeral: true });
    } catch (err) {
      // If reply fails because interaction already replied, send followup
      try { await interaction.followUp({ content: `DEBUG: Received command /${cmd} (followup)`, ephemeral: true }); } catch {}
    }
  } catch (err) {
    console.error('Debug responder error:', err);
  }
});

// Wire up your modules (they still run; they may also reply — this is fine)
registerTicketHandlers(client);
registerTournamentHandlers(client);
registerTeamHandlers(client);
registerInviteHandlers(client);
registerGiveawayHandlers(client);
registerScrimHandlers(client);
registerMetaHandlers(client);

// Ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
  try {
    await refreshLeaderboardMessage(client).catch(() => {});
  } catch (err) {
    console.warn('Leaderboard refresh failed at startup:', err);
  }
});

// Errors
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
