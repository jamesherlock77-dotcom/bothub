// teams.js - team management handlers (uses robust DB + interaction helpers)

const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require('discord.js');

const config = require('./config');
const { loadJson, saveJson, backupFileToChannel, TEAMS_DB_FILE } = require('./db');
const { safeDeferReply, safeReply } = require('./utils/interaction');
const path = require('path');

const pendingTeamRequests = new Set();
const pendingInvites = new Map();

function _findTeamKeyCI(teams, name) {
  if (!name) return null;
  const nameLower = name.toLowerCase();
  for (const key of Object.keys(teams)) {
    if (key.toLowerCase() === nameLower) return key;
  }
  return null;
}

function _findTeamByLeader(teams, userId) {
  for (const [name, info] of Object.entries(teams)) {
    if (String(info.leader_id) === String(userId)) return name;
  }
  return null;
}

function _findTeamByMember(teams, userId) {
  for (const [name, info] of Object.entries(teams)) {
    if ((info.members || []).map(String).includes(String(userId))) return name;
  }
  return null;
}

async function _backupTeams(client) {
  try {
    await backupFileToChannel(client, TEAMS_DB_FILE, path.basename(TEAMS_DB_FILE), client.user?.tag);
  } catch (err) {
    console.warn('backup teams failed:', err && err.message ? err.message : err);
  }
}

async function _sendConfirmCreateMessage(client, requesterMention, teamName, emoji, colour) {
  const ch = await client.channels.fetch(config.CONFIRM_CHANNEL_ID).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_team_yes::${requesterMention}::${teamName}::${emoji}::${colour}`).setLabel('Yes').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`confirm_team_no::${requesterMention}::${teamName}`).setLabel('No').setStyle(ButtonStyle.Danger),
  );
  const sent = await ch.send({ content: `${requesterMention} requested team **${teamName}** ${emoji} — confirm?`, components: [row] }).catch(() => null);
  return sent;
}

function registerTeamHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        if (name === 'teammembers') {
          await safeDeferReply(interaction);
          const teamParam = interaction.options.getString('team');
          const db = loadJson(TEAMS_DB_FILE, { teams: {} });
          const key = _findTeamKeyCI(db.teams, teamParam);
          if (!key) {
            await safeReply(interaction, { content: `No team found named "${teamParam}".`, ephemeral: true });
            return;
          }
          const info = db.teams[key];
          const members = (info.members || []).map(id => `<@${id}>${String(id) === String(info.leader_id) ? ' (Leader)' : ''}`).join('\n') || 'No members';
          await safeReply(interaction, { content: `**${key}** members:\n${members}`, ephemeral: true });
          return;
        }

        if (name === 'invite') {
          await safeDeferReply(interaction);
          const target = interaction.options.getMember('user');
          if (!target) {
            await safeReply(interaction, { content: "Couldn't find that user.", ephemeral: true });
            return;
          }
          const db = loadJson(TEAMS_DB_FILE, { teams: {} });
          const teamKey = _findTeamByLeader(db.teams, interaction.user.id);
          if (!teamKey) {
            await safeReply(interaction, { content: "You must be a team leader to invite people.", ephemeral: true });
            return;
          }
          const teamInfo = db.teams[teamKey];
          if (_findTeamByMember(db.teams, target.id)) {
            await safeReply(interaction, { content: "That user is already on a team.", ephemeral: true });
            return;
          }

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`invite_accept::${interaction.user.id}::${teamKey}`).setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`invite_decline::${interaction.user.id}::${teamKey}`).setLabel('No').setStyle(ButtonStyle.Danger),
          );

          try {
            const dm = await target.createDM();
            const sent = await dm.send({ content: `${interaction.user} invited you to join **${teamKey}** ${teamInfo.emoji || ''}!`, components: [row] });
            pendingInvites.set(String(interaction.user.id), {
              team: teamKey,
              invited_user_id: target.id,
              dm_channel_id: sent.channel.id,
              dm_message_id: sent.id,
            });
            await safeReply(interaction, { content: `Invite sent to ${target.user.tag}.`, ephemeral: true });
          } catch (err) {
            console.warn('Invite DM failed', err && err.message ? err.message : err);
            await safeReply(interaction, { content: "Couldn't DM that user (they may have DMs off).", ephemeral: true });
          }
          return;
        }

        if (name === 'leaveteam') {
          await safeDeferReply(interaction);
          const db = loadJson(TEAMS_DB_FILE, { teams: {} });
          const teamKey = _findTeamByMember(db.teams, interaction.user.id);
          if (!teamKey) {
            await safeReply(interaction, { content: "You're not in a team.", ephemeral: true });
            return;
          }
          const info = db.teams[teamKey];
          if (String(info.leader_id) === String(interaction.user.id)) {
            await safeReply(interaction, { content: "You are the leader — delete the team instead of leaving or transfer leadership first.", ephemeral: true });
            return;
          }
          info.members = (info.members || []).filter(id => String(id) !== String(interaction.user.id));
          saveJson(TEAMS_DB_FILE, db);
          await _backupTeams(client);
          await safeReply(interaction, { content: `You left **${teamKey}**.`, ephemeral: true });
          try {
            const ch = interaction.guild.channels.cache.get(info.channel_id);
            if (ch && ch.isTextBased()) await ch.send(`<@${interaction.user.id}> left the team.`).catch(() => {});
          } catch {}
          return;
        }

        // Add other team commands (createteam, forceadd, forcekick, etc.) following same pattern
      }

      // Component handlers (buttons) for invite accept/decline/cancel
      if (interaction.isButton && interaction.isButton()) {
        const custom = interaction.customId;
        if (custom.startsWith('invite_accept::') || custom.startsWith('invite_decline::')) {
          await safeDeferReply(interaction);
          const parts = custom.split('::');
          const leaderId = parts[1];
          const teamName = parts.slice(2).join('::');
          const pending = pendingInvites.get(String(leaderId));
          if (!pending || pending.team !== teamName) {
            await safeReply(interaction, { content: "That invite is no longer pending.", ephemeral: true });
            return;
          }
          if (custom.startsWith('invite_decline::')) {
            pendingInvites.delete(String(leaderId));
            try {
              const dmCh = await client.channels.fetch(pending.dm_channel_id).catch(() => null);
              if (dmCh) {
                const msg = await dmCh.messages.fetch(pending.dm_message_id).catch(() => null);
                if (msg) await msg.edit({ content: "Invite declined.", components: [] }).catch(() => {});
              }
            } catch {}
            await safeReply(interaction, { content: "Invite declined.", ephemeral: true });
            return;
          }
          // accept
          try {
            const db = loadJson(TEAMS_DB_FILE, { teams: {} });
            const info = db.teams[teamName];
            if (!info) {
              pendingInvites.delete(String(leaderId));
              await safeReply(interaction, { content: "This team no longer exists.", ephemeral: true });
              return;
            }
            if (!info.members) info.members = [];
            if (!info.members.map(String).includes(String(interaction.user.id))) info.members.push(String(interaction.user.id));
            saveJson(TEAMS_DB_FILE, db);
            await _backupTeams(client);
            pendingInvites.delete(String(leaderId));
            const ch = interaction.guild.channels.cache.get(info.channel_id);
            if (ch && ch.isTextBased()) await ch.send(`🎉 <@${interaction.user.id}> joined **${teamName}**`).catch(() => {});
            await safeReply(interaction, { content: `You joined **${teamName}**!`, ephemeral: true });
          } catch (err) {
            console.error('Invite accept failed:', err && err.stack ? err.stack : err);
            await safeReply(interaction, { content: "Failed to accept invite.", ephemeral: true });
          }
          return;
        }
      }
    } catch (err) {
      console.error('teams handler error:', err && err.stack ? err.stack : err);
    }
  });

  client.once('ready', () => {
    console.log('Team handlers registered.');
  });
}

module.exports = { registerTeamHandlers };
