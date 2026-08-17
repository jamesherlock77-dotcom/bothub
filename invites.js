// invites.js
// Invite-tracker parsing and /syncinvites command.
// Scans messages from a dedicated INVITE_TRACKER_CHANNEL_ID and builds a small invite DB.
// Uses the same message-parse regexes as the Python original.

const { Events } = require('discord.js');
const config = require('./config');
const { loadJson, saveJson, INVITES_DB_FILE, backupFileToChannel } = require('./db');
const path = require('path');

// Regexes mirroring the Python version (literal Invite Tracker phrasing)
const INVITE_JOIN_INVITED_RE = /^(?<user>.+?) has been invited by (?<inviter>.+?) and has now (?<count>\d+) invites?\.?\s*$/;
const INVITE_LEFT_INVITED_RE = /^(?<user>.+?) left the server, they were invited by (?<inviter>.+?)\.?\s*$/;
const INVITE_LEFT_VANITY_RE = /^(?<user>.+?) left the server\.\s*They joined using the vanity invite\.?\s*$/;
const INVITE_JOIN_VANITY_RE = /^(?<user>.+?) joined using a vanity invite\.?\s*$/;
const MENTION_ID_RE = /<@!?(\d+)>/;

function _extractMentionId(text) {
  const m = MENTION_ID_RE.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function _cleanInviteName(text) {
  return text.replace(MENTION_ID_RE, '').trim() || text.trim();
}

function parseInviteTrackerLine(line) {
  const t = line.trim();
  if (!t) return null;
  let m = INVITE_JOIN_INVITED_RE.exec(t);
  if (m) {
    return { kind: 'join', method: 'invite', user_raw: m.groups.user, inviter_raw: m.groups.inviter, invite_count: parseInt(m.groups.count, 10) };
  }
  m = INVITE_LEFT_INVITED_RE.exec(t);
  if (m) return { kind: 'left', method: 'invite', user_raw: m.groups.user, inviter_raw: m.groups.inviter };
  m = INVITE_LEFT_VANITY_RE.exec(t);
  if (m) return { kind: 'left', method: 'vanity', user_raw: m.groups.user, inviter_raw: null };
  m = INVITE_JOIN_VANITY_RE.exec(t);
  if (m) return { kind: 'join', method: 'vanity', user_raw: m.groups.user, inviter_raw: null };
  return null;
}

// Best-effort name -> member id resolution using guild member cache
function _resolveMemberIdByName(guild, nameText) {
  if (!guild || !nameText) return null;
  const nameClean = nameText.trim().toLowerCase();
  const member = guild.members.cache.find(m => {
    const dn = (m.displayName || '').toLowerCase();
    const n = (m.user.username || '').toLowerCase();
    return dn === nameClean || n === nameClean || (`${m.user}`.toLowerCase() === nameClean);
  });
  return member ? member.id : null;
}

function _inviteRecordKey(userId, nameText) {
  if (userId != null) return String(userId);
  return `name:${(nameText || '').trim().toLowerCase()}`;
}

function applyInviteEvent(db, event, timestamp, messageId, guild) {
  const invitedUsers = db.invited_users || {};
  const userMentionId = _extractMentionId(event.user_raw);
  const userName = _cleanInviteName(event.user_raw);
  const userId = userMentionId || _resolveMemberIdByName(guild, userName);

  let inviterName = 'vanity';
  let inviterId = null;
  if (event.inviter_raw) {
    inviterName = _cleanInviteName(event.inviter_raw);
    inviterId = _extractMentionId(event.inviter_raw) || _resolveMemberIdByName(guild, inviterName);
  }

  const key = _inviteRecordKey(userId, userName);
  const record = invitedUsers[key] || {};
  record.user_name = userName;
  if (userId != null) record.user_id = userId;
  else record.user_id = record.user_id || null;

  if (event.kind === 'join') {
    record.inviter_name = inviterName;
    record.inviter_id = inviterId;
    record.method = event.method;
    record.joined_at = timestamp;
    record.joined_message_id = messageId;
    record.still_in_server = true;
    if (event.method === 'invite' && typeof event.invite_count === 'number') record.inviter_invite_count = event.invite_count;
  } else {
    record.inviter_name = record.inviter_name || inviterName;
    record.inviter_id = record.inviter_id || inviterId;
    record.method = record.method || event.method;
    record.left_at = timestamp;
    record.left_message_id = messageId;
    record.still_in_server = false;
  }
  invitedUsers[key] = record;
  db.invited_users = invitedUsers;
}

async function registerInviteHandlers(client) {
  // process new messages in the invite tracker channel
  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild) return;
    if (message.channelId !== String(config.INVITE_TRACKER_CHANNEL_ID)) return;
    if (!message.author.bot) return;
    const lines = message.content.split('\n');
    const events = [];
    for (const line of lines) {
      const parsed = parseInviteTrackerLine(line);
      if (parsed) events.push(parsed);
    }
    if (!events.length) return;
    const db = loadJson(config.INVITES_DB_FILE ? path.join(__dirname, config.INVITES_DB_FILE) : (INVITES_DB_FILE || 'invites_data.json'), { invited_users: {}, last_processed_message_id: null });
    const timestamp = message.createdAt.toISOString();
    for (const ev of events) {
      applyInviteEvent(db, ev, timestamp, message.id, message.guild);
    }
    db.last_processed_message_id = message.id;
    saveJson(config.INVITES_DB_FILE ? path.join(__dirname, config.INVITES_DB_FILE) : (INVITES_DB_FILE || 'invites_data.json'), db);
    // backup to log channel
    try {
      const filePath = (config.INVITES_DB_FILE ? path.join(__dirname, config.INVITES_DB_FILE) : INVITES_DB_FILE);
      await backupFileToChannel(client, config.INVITE_LOG_CHANNEL_ID, filePath, path.basename(filePath));
    } catch (err) {
      console.error('Failed to backup invite db', err);
    }
  });

  // Slash command: syncinvites
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'syncinvites') return;
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.member.roles.cache.some(r => r.id === config.STAFF_ROLE_ID)) {
      await interaction.followUp({ content: "You don't have permission to use this command.", ephemeral: true });
      return;
    }
    // fetch channel and iterate history
    let channel = interaction.guild.channels.cache.get(config.INVITE_TRACKER_CHANNEL_ID);
    if (!channel) {
      try { channel = await client.channels.fetch(config.INVITE_TRACKER_CHANNEL_ID); } catch {}
    }
    if (!channel || !channel.isTextBased()) {
      await interaction.followUp({ content: "Couldn't find the invite tracker channel — check INVITE_TRACKER_CHANNEL_ID.", ephemeral: true });
      return;
    }

    const db = { invited_users: {}, last_processed_message_id: null };
    let processed_messages = 0;
    let matched_events = 0;
    let last_message_id = null;

    try {
      // fetch entire history (beware very large channels)
      const messages = await channel.messages.fetch({ limit: 1000 }); // pragmatic limit; can be paged further
      const ordered = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      for (const message of ordered) {
        if (!message.author.bot) continue;
        let foundAny = false;
        for (const line of message.content.split('\n')) {
          const parsed = parseInviteTrackerLine(line);
          if (parsed) {
            applyInviteEvent(db, parsed, message.createdAt.toISOString(), message.id, interaction.guild);
            matched_events += 1;
            foundAny = true;
          }
        }
        if (foundAny) processed_messages += 1;
        last_message_id = message.id;
      }
    } catch (err) {
      console.error('syncinvites failed', err);
      await interaction.followUp({ content: `Couldn't read the invite tracker channel: ${err}`, ephemeral: true });
      return;
    }

    db.last_processed_message_id = last_message_id;
    // Write to INVITES_DB_FILE path defined in db.js (we use same filename constant)
    const filePath = path.join(__dirname, 'invites_data.json');
    try {
      // use the db saving functions from db.js if exported; here we write directly for clarity
      const fs = require('fs');
      fs.writeFileSync(filePath, JSON.stringify(db, null, 2), 'utf8');
      // backup
      await backupFileToChannel(client, config.INVITE_LOG_CHANNEL_ID, filePath, path.basename(filePath));
    } catch (err) {
      console.error('Failed to save/backup invite db', err);
    }

    await interaction.followUp({ content: `✅ Rebuilt the invite database from <#${config.INVITE_TRACKER_CHANNEL_ID}> — matched ${matched_events} join/leave event(s) across ${processed_messages} message(s), now tracking ${Object.keys(db.invited_users).length} invited member(s). Backed up to <#${config.INVITE_LOG_CHANNEL_ID}>.`, ephemeral: true });
  });

  client.once('ready', () => {
    console.log('Invite handlers registered.');
  });
}

module.exports = { registerInviteHandlers, parseInviteTrackerLine, applyInviteEvent };