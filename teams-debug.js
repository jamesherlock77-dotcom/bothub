// teams-debug.js
// Temporary debug handlers for team commands. Safe: reads DB but does not modify it.
const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TEAMS_DB_FILE = path.join(__dirname, 'teams_data.json');

function loadJson(p, fallback = {}) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Failed to load JSON', p, e);
    return fallback;
  }
}

function findTeamKeyCi(teams, name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(teams || {})) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

function findTeamByLeader(teams, userId) {
  for (const [name, info] of Object.entries(teams || {})) {
    if (info.leader_id == userId || info.leader_id === userId) return name;
  }
  return null;
}

function findTeamByMember(teams, userId) {
  for (const [name, info] of Object.entries(teams || {})) {
    if ((info.members || []).includes(userId)) return name;
  }
  return null;
}

function dumpBriefTeams(teams) {
  const out = [];
  for (const [k, v] of Object.entries(teams || {})) {
    out.push(`${k} (leader=${v.leader_id ?? 'unknown'} members=${(v.members||[]).length} role=${v.role_id ?? 'none'})`);
  }
  return out.join('\n') || '(no teams)';
}

function registerTeamDebugHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isChatInputCommand?.()) return;
      const cmd = interaction.commandName;
      const db = loadJson(TEAMS_DB_FILE, { teams: {} });
      const teams = db.teams || {};

      // Log raw receipt
      console.log(`[teams-debug] command=${cmd} user=${interaction.user?.id} channel=${interaction.channelId} guild=${interaction.guildId}`);

      if (cmd === 'teammembers') {
        const q = interaction.options.getString('team') ?? '';
        const key = findTeamKeyCi(teams, q);
        if (!key) {
          await interaction.reply({
            content: `No matching team found for "${q}". Teams known:\n${dumpBriefTeams(teams)}`,
            ephemeral: true,
          }).catch(() => {});
          return;
        }
        const info = teams[key];
        const members = (info.members || []).map(id => `<@${id}>`).join(', ') || 'No members';
        await interaction.reply({
          content: `Team **${key}**\nEmoji: ${info.emoji ?? 'N/A'}\nLeader: <@${info.leader_id ?? 'unknown'}>\nRole id: ${info.role_id ?? 'missing'}\nChannel id: ${info.channel_id ?? 'missing'}\nMembers: ${members}`,
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      if (cmd === 'startscrim') {
        const q = interaction.options.getString('team') ?? '';
        const key = findTeamKeyCi(teams, q);
        if (!key) {
          await interaction.reply({ content: `No team found named "${q}". Try one of: ${Object.keys(teams).slice(0,10).join(', ') || '(none)'}`, ephemeral: true }).catch(() => {});
          return;
        }
        const info = teams[key];
        const leader = info.leader_id ?? 'unknown';
        await interaction.reply({ content: `Would start a scrim vs **${key}** (leader <@${leader}>). Scrim handler should DM the leader; this is a debug confirmation.`, ephemeral: true }).catch(() => {});
        return;
      }

      if (cmd === 'invite') {
        const target = interaction.options.getUser('user');
        if (!target) {
          await interaction.reply({ content: 'No user supplied to invite.', ephemeral: true }).catch(() => {});
          return;
        }
        const leaderTeam = findTeamByLeader(teams, interaction.user.id);
        if (!leaderTeam) {
          await interaction.reply({ content: "You're not a leader of any team (can't invite).", ephemeral: true }).catch(() => {});
          return;
        }
        await interaction.reply({ content: `Debug: ${interaction.user.tag} (leader of ${leaderTeam}) would invite ${target.tag} (${target.id}).`, ephemeral: true }).catch(() => {});
        return;
      }

      if (cmd === 'leaveteam') {
        const myTeam = findTeamByMember(teams, interaction.user.id);
        if (!myTeam) {
          await interaction.reply({ content: "You're not a member of any team.", ephemeral: true }).catch(() => {});
          return;
        }
        await interaction.reply({ content: `You are a member of **${myTeam}** (this debug handler does not actually remove you).`, ephemeral: true }).catch(() => {});
        return;
      }

      // Fallback: acknowledge
      await interaction.reply({ content: `teams-debug: received /${cmd} — not implemented in debug module.`, ephemeral: true }).catch(() => {});
    } catch (err) {
      console.error('teams-debug handler error:', err);
      try { await interaction.reply({ content: `Error in debug handler: ${String(err)}`, ephemeral: true }); } catch {}
    }
  });

  client.once('ready', () => {
    console.log('teams-debug handlers registered.');
  });
}

module.exports = { registerTeamDebugHandlers };
