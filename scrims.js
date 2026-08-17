// scrims.js
// /startscrim flow: DM the opponent leader, create a temporary scrim channel if accepted,
// and a background expiry loop that deletes expired scrim channels.
//
// Usage: registerScrimHandlers(client) from main.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const path = require('path');
const { loadJson, saveJson } = require('./db');
const config = require('./config');

const SCRIMS_FILE = path.join(__dirname, 'scrims_data.json');
const CHECK_INTERVAL_MS = Math.max(60_000, (config.SCRIM_CHECK_INTERVAL_MINUTES || 5) * 60_000);

function scrimButtons(challengerLeaderId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`scrim_accept::${challengerLeaderId}`).setLabel('Yes').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`scrim_decline::${challengerLeaderId}`).setLabel('No').setStyle(ButtonStyle.Danger),
  );
}

async function registerScrimHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    // startscrim slash command
    if (interaction.isChatInputCommand() && interaction.commandName === 'startscrim') {
      await interaction.deferReply({ ephemeral: true });
      const team = interaction.options.getString('team');
      const db = loadJson(path.join(__dirname, 'teams_data.json'), { teams: {} });
      const challengerTeam = Object.entries(db.teams || {}).find(([, t]) => t.leader_id === interaction.user.id)?.[0];
      if (!challengerTeam) {
        await interaction.followUp({ content: "You must be a team leader to start a scrim.", ephemeral: true });
        return;
      }
      const opponentKey = Object.keys(db.teams).find(k => k.toLowerCase() === (team || '').toLowerCase());
      if (!opponentKey) {
        await interaction.followUp({ content: "No team found with that name.", ephemeral: true });
        return;
      }
      if (opponentKey === challengerTeam) {
        await interaction.followUp({ content: "You can't scrim your own team.", ephemeral: true });
        return;
      }
      const opponentInfo = db.teams[opponentKey];
      const opponentLeaderId = opponentInfo?.leader_id;
      if (!opponentLeaderId) {
        await interaction.followUp({ content: `${opponentKey} doesn't have a leader on record.`, ephemeral: true });
        return;
      }
      if (interaction.user.id in (global.pending_scrim_requests || {})) {
        await interaction.followUp({ content: "You already have a pending scrim request. Cancel it first.", ephemeral: true });
        return;
      }

      // DM the opponent leader with accept/decline buttons
      try {
        const leader = await client.users.fetch(opponentLeaderId);
        const msg = await leader.send({ content: `**${challengerTeam}** (challenged by ${interaction.user}) wants to scrim your team **${opponentKey}**! Accept?`, components: [scrimButtons(interaction.user.id)] });
        // store pending request in memory and file
        global.pending_scrim_requests = global.pending_scrim_requests || {};
        global.pending_scrim_requests[interaction.user.id] = {
          opponent_team: opponentKey,
          opponent_leader_id: opponentLeaderId,
          dm_channel_id: msg.channel.id,
          dm_message_id: msg.id,
        };
        await interaction.followUp({ content: `Scrim request sent to ${opponentKey}'s leader.`, ephemeral: true });
      } catch (err) {
        console.error('Failed to DM opponent leader', err);
        await interaction.followUp({ content: `Couldn't DM ${opponentKey}'s leader (they may have DMs off).`, ephemeral: true });
      }
      return;
    }

    // Button accept/decline
    if (interaction.isButton()) {
      const [action, challengerId] = interaction.customId.split('::');
      if (action === 'scrim_accept' || action === 'scrim_decline') {
        await interaction.deferReply({ ephemeral: true });
        const pending = global.pending_scrim_requests && global.pending_scrim_requests[parseInt(challengerId, 10)];
        if (!pending) {
          await interaction.editReply({ content: "That scrim request is no longer pending.", ephemeral: true });
          return;
        }
        if (action === 'scrim_decline') {
          delete global.pending_scrim_requests[parseInt(challengerId, 10)];
          try {
            const requester = await client.users.fetch(parseInt(challengerId, 10));
            await requester.send(`**${pending.opponent_team}** declined your scrim request.`);
          } catch {}
          await interaction.editReply({ content: 'Scrim declined.', ephemeral: true });
          return;
        }

        // Accept -> create scrim channel
        try {
          const guild = interaction.guild || (await client.guilds.fetch(pending.guild_id).catch(() => null));
          const category = guild?.channels.cache.get(config.SCRIM_CATEGORY_ID);
          if (!category) {
            await interaction.editReply({ content: 'The scrim category no longer exists — ask staff to check the bot config.', ephemeral: true });
            return;
          }
          const challengerInfo = loadJson(path.join(__dirname, 'teams_data.json'), { teams: {} }).teams[pending.challenger_team] || {};
          // build overwrites
          const overwrites = [
            { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
            { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] },
          ];
          const challengerRole = guild.roles.cache.get(challengerInfo.role_id);
          const opponentRole = guild.roles.cache.get((loadJson(path.join(__dirname, 'teams_data.json'), { teams: {} }).teams[pending.opponent_team] || {}).role_id);
          if (challengerRole) overwrites.push({ id: challengerRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
          if (opponentRole) overwrites.push({ id: opponentRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });

          const scrimChannel = await guild.channels.create({
            name: config.SCRIM_CHANNEL_NAME,
            type: 0, // text
            parent: category.id,
            permissionOverwrites: overwrites,
            reason: `Scrim accepted between ${pending.challenger_team} and ${pending.opponent_team}`,
          });

          const createdAt = Math.floor(Date.now() / 1000);
          const deleteTs = createdAt + (config.SCRIM_DURATION_DAYS || 3) * 24 * 3600;

          // persist in scrims file
          const scrimDb = loadJson(SCRIMS_FILE, { scrims: {} });
          scrimDb.scrims = scrimDb.scrims || {};
          scrimDb.scrims[String(scrimChannel.id)] = {
            channel_id: scrimChannel.id,
            guild_id: guild.id,
            team_a: pending.challenger_team,
            team_a_leader_id: parseInt(challengerId, 10),
            team_b: pending.opponent_team,
            team_b_leader_id: pending.opponent_leader_id,
            created_ts: createdAt,
            delete_ts: deleteTs,
          };
          saveJson(SCRIMS_FILE, scrimDb);
          try { await require('./db').backupFileToChannel(client, config.SCRIM_LOG_CHANNEL_ID, SCRIMS_FILE, path.basename(SCRIMS_FILE)); } catch {}

          delete global.pending_scrim_requests[parseInt(challengerId, 10)];
          await scrimChannel.send(`${challengerRole ? challengerRole.mention : ''} ${opponentRole ? opponentRole.mention : ''}\n🎯 **${pending.challenger_team}** vs **${pending.opponent_team}** — the scrim is on! This channel will be deleted <t:${deleteTs}:R>.`);
          await interaction.editReply({ content: `Scrim accepted! Channel created: ${scrimChannel}`, ephemeral: true });
        } catch (err) {
          console.error('Failed to create scrim channel', err);
          await interaction.editReply({ content: `Failed to create the scrim channel: ${err.message}`, ephemeral: true });
        }
        return;
      }
    }
  });

  // background expiry loop
  client.once('ready', () => {
    setInterval(async () => {
      try {
        const db = loadJson(SCRIMS_FILE, { scrims: {} });
        const nowTs = Math.floor(Date.now() / 1000);
        let changed = false;
        for (const [channelId, info] of Object.entries(db.scrims || {})) {
          if (info.delete_ts > nowTs) continue;
          try {
            const guild = client.guilds.cache.get(info.guild_id) || await client.guilds.fetch(info.guild_id);
            const channel = guild?.channels.cache.get(info.channel_id) || await guild?.channels.fetch(info.channel_id).catch(() => null);
            if (channel) await channel.delete(`Scrim expired between ${info.team_a} and ${info.team_b}`);
          } catch (err) {
            console.warn('Failed to delete scrim channel', err);
          }
          delete db.scrims[channelId];
          changed = true;
        }
        if (changed) {
          saveJson(SCRIMS_FILE, db);
          try { await require('./db').backupFileToChannel(client, config.SCRIM_LOG_CHANNEL_ID, SCRIMS_FILE, path.basename(SCRIMS_FILE)); } catch {}
        }
      } catch (err) {
        console.error('Scrim expiry loop error', err);
      }
    }, CHECK_INTERVAL_MS);
    console.log('Scrim handlers registered and expiry loop started.');
  });
}

module.exports = { registerScrimHandlers };