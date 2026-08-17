// teams.js
// Team management: create team, change settings, invite flow, leader promotion, forceadd/forcekick, leave, cleanup.
// Updated to use safe interaction replies and flags to avoid "Unknown interaction" errors.
// Assumes discord.js v14, and db.js + config.js from earlier files.

const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  InteractionResponseFlags,
} = require('discord.js');

const config = require('./config');
const { loadJson, saveJson, TEAMS_DB_FILE, backupFileToChannel } = require('./db');
const path = require('path');

const pendingTeamRequests = new Set(); // userId set while awaiting admin confirm
const pendingInvites = new Map(); // leaderId -> { team, invitedUserId, dmChannelId, dmMessageId }

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

function _isValidHexColour(text) {
  return /^#?[0-9A-Fa-f]{6}$/.test((text || '').trim());
}

function _isCustomEmoji(text) {
  // Discord custom emoji looks like <:_name_:id> or <:name:id>
  return /^<a?:\w+:\d+>$/.test(text);
}

async function _backupTeams(client) {
  const filePath = TEAMS_DB_FILE;
  try { await backupFileToChannel(client, config.TEAM_LOG_CHANNEL_ID, filePath, path.basename(filePath)); } catch (err) { /* ignore */ }
}

// Safe helpers for interactions to avoid Unknown interaction / double-reply crashes
async function safeDeferReply(interaction) {
  if (!interaction || typeof interaction.deferReply !== 'function') return false;
  try {
    if (interaction.replied || interaction.deferred) return false;
    await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });
    return true;
  } catch (err) {
    console.warn('safeDeferReply failed:', err?.message || err);
    return false;
  }
}

async function safeReply(interaction, options) {
  if (!interaction) return;
  try {
    const payload = Object.assign({}, options);
    // Ensure ephemeral style via flags
    if (payload.ephemeral) {
      delete payload.ephemeral;
      payload.flags = InteractionResponseFlags.Ephemeral;
    }
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(payload);
    } else {
      await interaction.followUp(payload);
    }
  } catch (err) {
    console.warn('safeReply failed:', err?.message || err);
  }
}

async function _sendConfirmCreateMessage(client, requester, teamName, emoji, colour) {
  const channel = await client.channels.fetch(config.CONFIRM_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const content = `${requester} wants to create team **${teamName}** ${emoji}. Admins, confirm?`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_team_yes::${requester.id}::${teamName}::${emoji}::${colour}`).setLabel('Yes').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`confirm_team_no::${requester.id}::${teamName}`).setLabel('No').setStyle(ButtonStyle.Danger),
  );
  const sent = await channel.send({ content, components: [row] }).catch(() => null);
  return sent;
}

async function registerTeamHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    // Slash commands
    if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // CREATE TEAM
      if (name === 'createteam') {
        await safeDeferReply(interaction);
        const teamName = interaction.options.getString('name');
        const emoji = interaction.options.getString('emoji');
        const colourRaw = interaction.options.getString('colour');

        if (!emoji || _isCustomEmoji(emoji)) {
          await safeReply(interaction, { content: "That's not a standard Discord emoji. Please use a single regular emoji (custom server emojis can't be used in channel names or role icons).", ephemeral: true });
          return;
        }
        if (!colourRaw || !_isValidHexColour(colourRaw)) {
          await safeReply(interaction, { content: "That's not a valid hex colour. Use a format like `#5865F2`.", ephemeral: true });
          return;
        }
        const normalizedColour = `#${colourRaw.trim().replace(/^#/, '')}`;

        const db = loadJson(TEAMS_DB_FILE, { teams: {} });
        if (_findTeamKeyCI(db.teams, teamName)) {
          await safeReply(interaction, { content: `A team called **${teamName}** already exists. Pick a different name.`, ephemeral: true });
          return;
        }

        if (_findTeamByLeader(db.teams, interaction.user.id)) {
          await safeReply(interaction, { content: "You already lead a team — you can only lead one team at a time.", ephemeral: true });
          return;
        }

        if (_findTeamByMember(db.teams, interaction.user.id)) {
          await safeReply(interaction, { content: "You're already a member of another team. Leave it first with `/leaveteam`.", ephemeral: true });
          return;
        }

        if (pendingTeamRequests.has(interaction.user.id)) {
          await safeReply(interaction, { content: "You already have a team creation request awaiting admin confirmation. Please wait.", ephemeral: true });
          return;
        }

        pendingTeamRequests.add(interaction.user.id);
        const sent = await _sendConfirmCreateMessage(client, interaction.user.toString(), teamName, emoji, normalizedColour);
        if (!sent) {
          pendingTeamRequests.delete(interaction.user.id);
          await safeReply(interaction, { content: "Couldn't send the confirmation message to the admin channel. Check CONFIRM_CHANNEL_ID and bot permissions.", ephemeral: true });
          return;
        }
        await safeReply(interaction, { content: `Sent to <#${config.CONFIRM_CHANNEL_ID}> for admin confirmation ✅`, ephemeral: true });
        return;
      }

      // INVITE
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
        if (target.user.bot) {
          await safeReply(interaction, { content: "You can't invite bots.", ephemeral: true });
          return;
        }
        if (_findTeamByMember(db.teams, target.id)) {
          await safeReply(interaction, { content: "That user is already on a team.", ephemeral: true });
          return;
        }

        const teamInfo = db.teams[teamKey];
        if (!teamInfo.bypass_member_limit && (teamInfo.members || []).length >= config.MAX_TEAM_MEMBERS) {
          await safeReply(interaction, { content: `**${teamKey}** is already at the ${config.MAX_TEAM_MEMBERS}-member cap — remove someone first.`, ephemeral: true });
          return;
        }

        if (pendingInvites.has(interaction.user.id)) {
          const cancelButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`cancel_invite::${interaction.user.id}`).setLabel('Cancel Invite').setStyle(ButtonStyle.Danger)
          );
          await safeReply(interaction, { content: "You already have a pending invite. Click the red button below to cancel.", components: [cancelButton], ephemeral: true });
          return;
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`invite_accept::${interaction.user.id}::${teamKey}`).setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`invite_decline::${interaction.user.id}::${teamKey}`).setLabel('No').setStyle(ButtonStyle.Danger),
        );

        try {
          const dm = await target.createDM();
          const sent = await dm.send({ content: `${interaction.user} invited you to join **${teamKey}** ${teamInfo.emoji || ''}! Would you like to join?`, components: [row] });

          pendingInvites.set(interaction.user.id, {
            team: teamKey,
            invited_user_id: target.id,
            dm_channel_id: sent.channel.id,
            dm_message_id: sent.id,
          });

          console.log(`Invite sent: ${interaction.user.tag} -> ${target.user.tag} for team ${teamKey}`);
          await safeReply(interaction, { content: `Invite sent to ${target.user.tag}.`, ephemeral: true });
        } catch (err) {
          console.warn('Invite DM failed', err);
          await safeReply(interaction, { content: "Couldn't DM that user (they may have DMs off).", ephemeral: true });
        }
        return;
      }

      // LEAVE TEAM
      if (name === 'leaveteam') {
        await safeDeferReply(interaction);
        const db = loadJson(TEAMS_DB_FILE, { teams: {} });
        const teamKey = _findTeamByMember(db.teams, interaction.user.id);
        if (!teamKey) {
          await safeReply(interaction, { content: "You're not in a team.", ephemeral: true });
          return;
        }
        const info = db.teams[teamKey];
        if (info.leader_id === interaction.user.id) {
          await safeReply(interaction, { content: "You're the leader of this team, so you can't leave it. Use `/changeteamsettings delete:True` if you want to delete it instead.", ephemeral: true });
          return;
        }
        const role = interaction.guild.roles.cache.get(info.role_id);
        if (role) {
          try { await interaction.member.roles.remove(role, 'Left the team'); } catch (e) { /* ignore */ }
        }
        info.members = (info.members || []).filter(id => String(id) !== String(interaction.user.id));
        saveJson(TEAMS_DB_FILE, db);
        await _backupTeams(client);

        const channel = interaction.guild.channels.cache.get(info.channel_id);
        if (channel && channel.isTextBased()) {
          try { await channel.send(`${config.TEAM_LEAVE_EMOJI || '👋'} <@${interaction.user.id}>, just left the team`); } catch {}
        }
        await safeReply(interaction, { content: `You left **${teamKey}**.`, ephemeral: true });
        return;
      }

      // FORCEKICK (staff)
      if (name === 'forcekick') {
        await safeDeferReply(interaction);
        const member = interaction.options.getMember('member');
        if (!member) {
          await safeReply(interaction, { content: "Couldn't find that member.", ephemeral: true });
          return;
        }
        if (!interaction.member.roles.cache.some(r => r.id === config.STAFF_ROLE_ID)) {
          await safeReply(interaction, { content: "You don't have permission to use this command.", ephemeral: true });
          return;
        }
        const db = loadJson(TEAMS_DB_FILE, { teams: {} });
        const teamKey = _findTeamByMember(db.teams, member.id);
        if (!teamKey) {
          await safeReply(interaction, { content: `${member.user.tag} isn't on a team.`, ephemeral: true });
          return;
        }
        const info = db.teams[teamKey];
        if (member.id === info.leader_id) {
          await safeReply(interaction, { content: `${member.user.tag} leads **${teamKey}** — use staff delete instead.`, ephemeral: true });
          return;
        }
        try { if (interaction.guild.members.cache.get(member.id)) await member.roles.remove(info.role_id, `Force-kicked by ${interaction.user.tag}`); } catch (e) { /* ignore */ }
        info.members = (info.members || []).filter(id => id !== member.id);
        saveJson(TEAMS_DB_FILE, db);
        await _backupTeams(client);
        await safeReply(interaction, { content: `Force-removed ${member.user.tag} from **${teamKey}**.`, ephemeral: true });
        return;
      }

      // FORCEADD (staff or special user)
      if (name === 'forceadd') {
        await safeDeferReply(interaction);
        const team = interaction.options.getString('team');
        const user = interaction.options.getMember('user');
        if (!team || !user) {
          await safeReply(interaction, { content: "Provide both team and user.", ephemeral: true });
          return;
        }
        if (!(interaction.member.roles.cache.some(r => r.id === config.STAFF_ROLE_ID) || String(interaction.user.id) === String(config.FORCEADD_EXTRA_USER_ID))) {
          await safeReply(interaction, { content: "You don't have permission to use this command.", ephemeral: true });
          return;
        }
        const db = loadJson(TEAMS_DB_FILE, { teams: {} });
        const teamKey = _findTeamKeyCI(db.teams, team);
        if (!teamKey) {
          await safeReply(interaction, { content: "No team found with that name.", ephemeral: true });
          return;
        }
        const info = db.teams[teamKey];
        if (user.user.bot) {
          await safeReply(interaction, { content: "You can't add bots to a team.", ephemeral: true });
          return;
        }
        const existing = _findTeamByMember(db.teams, user.id);
        if (existing) {
          if (existing === teamKey) {
            await safeReply(interaction, { content: `${user.user.tag} is already on **${teamKey}**.`, ephemeral: true });
          } else {
            await safeReply(interaction, { content: `${user.user.tag} is already on **${existing}** — use /forcekick first.`, ephemeral: true });
          }
          return;
        }
        try { await user.roles.add(info.role_id, `Force-added by ${interaction.user.tag}`); } catch {}
        if (!info.members) info.members = [];
        if (!info.members.includes(user.id)) info.members.push(user.id);
        saveJson(TEAMS_DB_FILE, db);
        await _backupTeams(client);
        await safeReply(interaction, { content: `Added ${user.user.tag} to **${teamKey}**.`, ephemeral: true });
        return;
      }

      // TEAMMEMBERS (list)
      if (name === 'teammembers') {
        await safeDeferReply(interaction);
        const teamParam = interaction.options.getString('team');
        const db = loadJson(TEAMS_DB_FILE, { teams: {} });
        const key = _findTeamKeyCI(db.teams, teamParam);
        if (!key) {
          await safeReply(interaction, { content: "No team found with that name.", ephemeral: true });
          return;
        }
        const info = db.teams[key];
        const members = (info.members || []).map(id => `<@${id}>${String(id) === String(info.leader_id) ? ' (Leader)' : ''}`).join('\n') || 'No members with this role yet.';
        await safeReply(interaction, { content: `**${key}** members:\n${members}`, ephemeral: true });
        return;
      }

      // other commands can be added here
    }

    // Button interactions and select menus
    if (interaction.isButton && interaction.isButton()) {
      const custom = interaction.customId;

      // Admin confirm yes/no for create team
      if (custom.startsWith('confirm_team_yes::') || custom.startsWith('confirm_team_no::')) {
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
          await safeReply(interaction, { content: "Only admins can confirm team creation.", ephemeral: true });
          return;
        }

        const parts = custom.split('::');
        const action = parts[0];
        const requesterId = parts[1];
        const teamName = parts[2];
        if (action === 'confirm_team_no') {
          pendingTeamRequests.delete(String(requesterId));
          try { await interaction.update({ content: `Team creation denied: **${teamName}**`, components: [] }); } catch (err) { console.warn('update failed:', err); }
          return;
        }

        const emoji = parts[3] || '';
        const colour = parts[4] || '#23272A';
        pendingTeamRequests.delete(String(requesterId));

        // create role & channel & set database
        try {
          const guild = interaction.guild;
          const requesterMember = await guild.members.fetch(requesterId).catch(() => null);
          const role = await guild.roles.create({
            name: `${teamName} Team`,
            color: colour,
            reason: `Team created, confirmed by ${interaction.user.tag}`,
          });

          try {
            const refRole = guild.roles.cache.get(config.REFERENCE_ROLE_ID);
            if (refRole) {
              await role.setPosition(refRole.position + 1).catch(() => {});
            }
          } catch {}

          const primaryCat = guild.channels.cache.get(config.TEAM_CATEGORY_ID);
          const overflowCat = guild.channels.cache.get(config.TEAM_CATEGORY_OVERFLOW_ID);
          let category = primaryCat && primaryCat.type === ChannelType.GuildCategory ? primaryCat : null;
          if (!category || (category && category.children?.size >= 50)) category = overflowCat && overflowCat.type === ChannelType.GuildCategory ? overflowCat : category;
          if (!category) {
            try { await interaction.update({ content: `Couldn't create ${teamName} — no suitable category available.`, components: [] }); } catch {}
            await role.delete().catch(() => {});
            return;
          }

          const overwrites = [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
          ];
          if (requesterMember) {
            overwrites.push({ id: requesterMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] });
          }

          const channel = await guild.channels.create({
            name: `${emoji}┃${teamName}-Team`.slice(0, 100),
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: overwrites,
            reason: `Team created, confirmed by ${interaction.user.tag}`,
          });

          if (requesterMember) {
            await requesterMember.roles.add(role, 'New team leader').catch(() => {});
          }

          try {
            const leaderMarker = guild.roles.cache.get(config.TEAM_LEADER_ROLE_ID);
            if (leaderMarker && requesterMember) {
              await requesterMember.roles.add(leaderMarker, 'New team leader marker').catch(() => {});
            }
          } catch {}

          const db = loadJson(TEAMS_DB_FILE, { teams: {} });
          db.teams[teamName] = {
            emoji,
            leader_id: String(requesterId),
            role_id: role.id,
            channel_id: channel.id,
            members: [String(requesterId)],
            joined_at: { [String(requesterId)]: new Date().toISOString() },
          };
          saveJson(TEAMS_DB_FILE, db);
          await _backupTeams(client);

          try { await interaction.update({ content: `✅ Team **${teamName}** ${emoji} created — ${channel}`, components: [] }); } catch (err) { console.warn('update failed after create:', err); }
          try {
            if (requesterMember) await requesterMember.send(`You're now the leader of **${teamName}** ${emoji}!`).catch(() => {});
          } catch {}
          console.log(`Team created: ${teamName} by ${requesterId}`);
        } catch (err) {
          console.error('Failed creating team:', err);
          try { await safeReply(interaction, { content: `Failed to create team ${teamName}: ${err.message}`, ephemeral: true }); } catch {}
        }
        return;
      }

      // Invite accept / decline / cancel
      if (custom.startsWith('invite_accept::') || custom.startsWith('invite_decline::') || custom.startsWith('cancel_invite::')) {
        await safeDeferReply(interaction);
        if (custom.startsWith('cancel_invite::')) {
          const leaderId = custom.split('::')[1];
          const pending = pendingInvites.get(String(leaderId));
          if (!pending) {
            await safeReply(interaction, { content: "That invite is no longer pending — you're free to send a new one.", ephemeral: true });
            return;
          }
          pendingInvites.delete(String(leaderId));
          try {
            const dmChannel = await client.channels.fetch(pending.dm_channel_id);
            const msg = await dmChannel.messages.fetch(pending.dm_message_id);
            await msg.edit({ content: "This invite was cancelled by the team leader.", components: [] }).catch(() => {});
          } catch {}
          await safeReply(interaction, { content: `Cancelled the pending invite to <@${pending.invited_user_id}>. You can now invite someone else.`, ephemeral: true });
          return;
        }

        const parts = custom.split('::'); // e.g. invite_accept::<leaderId>::<teamName>
        const action = parts[0];
        const leaderId = String(parts[1]);
        const teamName = parts.slice(2).join('::');
        const pending = pendingInvites.get(leaderId);
        if (!pending || pending.team !== teamName) {
          await safeReply(interaction, { content: "This invite no longer matches any pending invite.", ephemeral: true });
          return;
        }

        const db = loadJson(TEAMS_DB_FILE, { teams: {} });
        const info = db.teams[teamName];
        if (!info) {
          pendingInvites.delete(leaderId);
          await safeReply(interaction, { content: "This team no longer exists.", ephemeral: true });
          return;
        }

        if (action === 'invite_decline') {
          pendingInvites.delete(leaderId);
          try {
            const dmChannel = await client.channels.fetch(pending.dm_channel_id);
            const msg = await dmChannel.messages.fetch(pending.dm_message_id);
            await msg.edit({ content: "Invite declined.", components: [] }).catch(() => {});
          } catch {}
          await safeReply(interaction, { content: "Invite declined.", ephemeral: true });
          return;
        }

        // invite_accept
        if (!info.bypass_member_limit && (info.members || []).length >= config.MAX_TEAM_MEMBERS) {
          pendingInvites.delete(leaderId);
          await safeReply(interaction, { content: `**${teamName}** filled up before you accepted — ask the leader to check again.`, ephemeral: true });
          return;
        }

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const role = interaction.guild.roles.cache.get(info.role_id);
          if (role) await member.roles.add(role, 'Accepted team invite').catch(() => {});
          if (!info.members) info.members = [];
          if (!info.members.map(String).includes(String(interaction.user.id))) info.members.push(String(interaction.user.id));
          info.joined_at = info.joined_at || {};
          info.joined_at[String(interaction.user.id)] = new Date().toISOString();
          saveJson(TEAMS_DB_FILE, db);
          await _backupTeams(client);
          pendingInvites.delete(leaderId);
          try {
            const channel = interaction.guild.channels.cache.get(info.channel_id);
            if (channel && channel.isTextBased()) await channel.send(`🎉 <@${interaction.user.id}> just joined the team!`).catch(() => {});
          } catch {}
          await safeReply(interaction, { content: `You joined **${teamName}**! 🎉`, ephemeral: true });
        } catch (err) {
          console.error('Failed to process invite accept', err);
          await safeReply(interaction, { content: "Failed to accept invite.", ephemeral: true });
        }
        return;
      }
    }
  });

  client.once('ready', () => {
    console.log('Team handlers registered.');
  });
}

module.exports = { registerTeamHandlers };
