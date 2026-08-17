// tournamentsignups.js
// Implements the tournament sticky sign-up message and the Join Tournament toggle button.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const { TOURNAMENT_SIGNUP_CAP, TOURNAMENT_SUBMISSION_ROLE_ID, TOURNAMENT_PANEL_CHANNEL_ID } = require('./config');
const { loadJson, saveJson, TEAMS_DB_FILE, backupFileToChannel } = require('./db');

const _teamChannelIds = new Set();
let _lastRepost = {}; // channelId -> monotonic timestamp

function buildTournamentContent(signups) {
  const coin = '🎯';
  return `${coin} **Tournament Sign-Ups** ${coin}\nClick the green button below, if you would like to play for the tournament!\n**Signed up: \`${signups.length}/${TOURNAMENT_SIGNUP_CAP}\`**`;
}

function tournamentSignupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tournament_signup_toggle').setLabel('Join Tournament').setStyle(ButtonStyle.Success)
  );
}

async function postTournamentSticky(client, guild, teamKey, info, db) {
  const channel = guild.channels.cache.get(info.channel_id) || await guild.channels.fetch(info.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  // delete previous sticky message if exists
  if (info.tournament_message_id) {
    try {
      const old = await channel.messages.fetch(info.tournament_message_id);
      if (old) await old.delete();
    } catch (err) { /* ignore */ }
  }

  const signups = info.tournament_signups || [];
  try {
    const msg = await channel.send({ content: buildTournamentContent(signups), components: [tournamentSignupRow()] });
    info.tournament_message_id = msg.id;
    saveJson(TEAMS_DB_FILE, db);
    await backupFileToChannel(client, require('./config').TEAM_LOG_CHANNEL_ID, TEAMS_DB_FILE, 'teams_data.json');
  } catch (err) {
    console.error('Failed to post tournament sticky', err);
  }
}

async function maybeRestickTournamentMessage(client, message) {
  if (!_teamChannelIds.has(message.channelId)) return;
  const now = Date.now() / 1000;
  const last = _lastRepost[message.channelId] || 0;
  if (now - last < require('./config').TOURNAMENT_STICKY_DEBOUNCE_SECONDS) return;

  const db = loadJson(TEAMS_DB_FILE, { teams: {} });
  const teamKey = Object.entries(db.teams).find(([, info]) => info.channel_id === message.channelId)?.[0];
  if (!teamKey) return;
  const info = db.teams[teamKey];
  if (!info || !info.tournament_message_id) return;
  if ((info.tournament_signups || []).length >= TOURNAMENT_SIGNUP_CAP) return;

  _lastRepost[message.channelId] = now;
  try {
    await postTournamentSticky(client, message.guild, teamKey, info, db);
  } catch (err) {
    console.error('Failed to re-stick tournament sign-up message', err);
  }
}

async function registerTournamentHandlers(client) {
  // Button click handler
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'tournament_signup_toggle') {
      await interaction.deferReply({ ephemeral: true });
      const db = loadJson(TEAMS_DB_FILE, { teams: {} });
      const teamKey = Object.entries(db.teams).find(([, info]) => info.channel_id === interaction.channelId)?.[0];
      if (!teamKey) {
        await interaction.editReply({ content: "Couldn't figure out which team this sign-up sheet belongs to.", ephemeral: true });
        return;
      }
      const info = db.teams[teamKey];
      info.tournament_signups = info.tournament_signups || [];
      const userId = interaction.user.id;
      const role = interaction.guild.roles.cache.get(TOURNAMENT_SUBMISSION_ROLE_ID);
      if (info.tournament_signups.includes(userId)) {
        info.tournament_signups = info.tournament_signups.filter(id => id !== userId);
        try { if (role) await interaction.member.roles.remove(role, 'Left tournament sign-up'); } catch {}
        await interaction.message.edit({ content: buildTournamentContent(info.tournament_signups) });
        await interaction.followUp({ content: "You've been removed from the sign-up list.", ephemeral: true });
      } else {
        if (info.tournament_signups.length >= TOURNAMENT_SIGNUP_CAP) {
          await interaction.followUp({ content: `Sign-ups are full (\`${TOURNAMENT_SIGNUP_CAP}/${TOURNAMENT_SIGNUP_CAP}\`).`, ephemeral: true });
          return;
        }
        info.tournament_signups.push(userId);
        try { if (role) await interaction.member.roles.add(role, 'Signed up for tournament'); } catch {}
        await interaction.message.edit({ content: buildTournamentContent(info.tournament_signups) });
        await interaction.followUp({ content: "You're signed up for the tournament! 🏆", ephemeral: true });
      }
      saveJson(TEAMS_DB_FILE, db);
      await backupFileToChannel(client, require('./config').TEAM_LOG_CHANNEL_ID, TEAMS_DB_FILE, 'teams_data.json');
    }
  });

  // Hook into messages to maybe restick
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    await maybeRestickTournamentMessage(client, message).catch(e => console.error(e));
  });

  // startup: load known team channel ids into memory and post panel if missing
  client.once('ready', async () => {
    const db = loadJson(TEAMS_DB_FILE, { teams: {} });
    for (const info of Object.values(db.teams || {})) {
      if (info.channel_id) _teamChannelIds.add(info.channel_id);
    }

    // Post tournament admin panel if missing
    try {
      const panelChannel = await client.channels.fetch(TOURNAMENT_PANEL_CHANNEL_ID);
      if (panelChannel && panelChannel.isTextBased()) {
        const messages = await panelChannel.messages.fetch({ limit: 50 });
        const already = messages.find(m => m.author && m.author.id === client.user.id && m.embeds.length && m.embeds[0].title === 'Tournament Admin');
        if (!already) {
          await panelChannel.send({ embeds: [{ title: 'Tournament Admin', description: 'Pick a team from the dropdown to post (or refresh) the Join Tournament sign-up message in that team\\'s channel.' }], components: [] });
        }
      }
    } catch (err) {
      // ignore
    }

    console.log('Tournament handlers registered.');
  });
}

module.exports = { registerTournamentHandlers, postTournamentSticky, buildTournamentContent };