// giveaways.js
// Start a giveaway, persistent Join button, and a background checker that ends giveaways.
//
// Usage: registerGiveawayHandlers(client) from main.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { loadJson, saveJson } = require('./db');
const config = require('./config');

const GIVEAWAYS_FILE = path.join(__dirname, 'giveaways_data.json');
const CHECK_INTERVAL_MS = 30_000;

function buildGiveawayEmbedData(info) {
  const ended = !!info.ended;
  return {
    title: `🎉 ${info.prize}`,
    color: 0xffa500,
    fields: [
      ended
        ? { name: 'Ended', value: `<t:${info.end_ts}:F>`, inline: false }
        : { name: 'Ends', value: `<t:${info.end_ts}:R> (<t:${info.end_ts}:F>)`, inline: false },
      { name: 'Hosted by', value: `<@${info.host_id}>`, inline: false },
      { name: 'Entries', value: `**${(info.entries || []).length}**`, inline: false },
    ],
  };
}

function joinButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_join_button').setLabel('Join').setEmoji('🎉').setStyle(ButtonStyle.Success)
  );
}

async function registerGiveawayHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    // Join button
    if (interaction.isButton() && interaction.customId === 'giveaway_join_button') {
      await interaction.deferReply({ ephemeral: true });
      const db = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
      const key = String(interaction.message.id);
      const info = db.giveaways && db.giveaways[key];
      if (!info) {
        await interaction.followUp({ content: "This giveaway no longer exists.", ephemeral: true });
        return;
      }
      if (info.ended) {
        await interaction.followUp({ content: "This giveaway has already ended.", ephemeral: true });
        return;
      }

      info.entries = info.entries || [];
      const uid = interaction.user.id;
      let joined;
      if (info.entries.includes(uid)) {
        info.entries = info.entries.filter(i => i !== uid);
        joined = false;
      } else {
        info.entries.push(uid);
        joined = true;
      }
      saveJson(GIVEAWAYS_FILE, db);
      // persist backup pattern: either call backupFileToChannel (db.js helper) or ensure persistent disk
      try { await require('./db').backupFileToChannel(client, config.GIVEAWAY_LOG_CHANNEL_ID, GIVEAWAYS_FILE, path.basename(GIVEAWAYS_FILE)); } catch {}
      // edit embed (we'll rebuild embed-like plain object, actual conversion to EmbedBuilder can be done where you send)
      try {
        const embedData = buildGiveawayEmbedData(info);
        await interaction.message.edit({ embeds: [embedData], components: [joinButtonRow()] });
      } catch {}
      await interaction.followUp({ content: joined ? "🎉 You're in — good luck!" : "You left the giveaway.", ephemeral: true });
      return;
    }

    // Slash command startgiveaway handled as ChatInputCommand in deploy script / main's handlers
    if (interaction.isChatInputCommand() && interaction.commandName === 'startgiveaway') {
      await interaction.deferReply({ ephemeral: true });
      // permission check
      if (!interaction.member.roles.cache.some(r => r.id === config.STAFF_ROLE_ID)) {
        await interaction.followUp({ content: "You don't have permission to use this command.", ephemeral: true });
        return;
      }
      const winners = interaction.options.getInteger('winners');
      const prize = interaction.options.getString('prize');
      const ends = interaction.options.getString('ends');
      const hosted = interaction.options.getMember('hosted') || interaction.member;
      // simple parse like Python's parse_duration: accept minutes/hours/days like '10m', '2h', '1d'
      const durMatch = [...(ends || '').matchAll(/(\d+)\s*(w|d|h|m|s)/gi)];
      if (!durMatch.length) {
        await interaction.followUp({ content: "Couldn't parse `ends` — use something like `10m`, `2h`, `1d`, or `1d12h`.", ephemeral: true });
        return;
      }
      const unitSec = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
      let total = 0;
      for (const m of durMatch) total += Number(m[1]) * (unitSec[(m[2] || 'm').toLowerCase()] || 60);
      const endTs = Math.floor(Date.now() / 1000) + total;

      const info = {
        guild_id: interaction.guildId,
        channel_id: interaction.channelId,
        prize,
        winners,
        host_id: hosted.id,
        end_ts: endTs,
        entries: [],
        ended: false,
      };

      const msgData = buildGiveawayEmbedData(info);
      // send into channel
      try {
        const sent = await interaction.channel.send({ embeds: [msgData], components: [joinButtonRow()] });
        const db = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
        db.giveaways = db.giveaways || {};
        db.giveaways[String(sent.id)] = info;
        saveJson(GIVEAWAYS_FILE, db);
        try { await require('./db').backupFileToChannel(client, config.GIVEAWAY_LOG_CHANNEL_ID, GIVEAWAYS_FILE, path.basename(GIVEAWAYS_FILE)); } catch {}
        await interaction.followUp({ content: `🎉 Giveaway started in ${sent.channel}`, ephemeral: true });
      } catch (err) {
        console.error('startgiveaway failed', err);
        await interaction.followUp({ content: 'Failed to start giveaway — check permissions.', ephemeral: true });
      }
      return;
    }
  });

  // background checker
  client.once('ready', () => {
    setInterval(async () => {
      try {
        const db = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
        const nowTs = Math.floor(Date.now() / 1000);
        let changed = false;
        for (const [messageId, info] of Object.entries(db.giveaways || {})) {
          if (info.ended || info.end_ts > nowTs) continue;
          // pick winners
          const entries = info.entries || [];
          let winners = [];
          if (entries.length && info.winners > 0) {
            // random selection
            const shuffled = entries.slice().sort(() => 0.5 - Math.random());
            winners = shuffled.slice(0, Math.min(info.winners, shuffled.length));
          }
          info.ended = true;
          info.winner_ids = winners;
          // edit message to ended state & announce
          try {
            const channel = await client.channels.fetch(info.channel_id).catch(() => null);
            if (!channel || !channel.isTextBased()) continue;
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            const embedData = buildGiveawayEmbedData(info);
            // disable join button visually
            await msg?.edit({ embeds: [embedData], components: [] }).catch(() => {});
            if (winners.length) {
              await channel.send(`🎉 Congratulations ${winners.map(id => `<@${id}>`).join(', ')} — you won **${info.prize}**!`).catch(() => {});
            } else {
              await channel.send(`🎉 The giveaway for **${info.prize}** ended with no entries.`).catch(() => {});
            }
          } catch (err) {
            console.error('Failed to finalize giveaway', err);
          }
          changed = true;
        }
        if (changed) {
          saveJson(GIVEAWAYS_FILE, db);
          try { await require('./db').backupFileToChannel(client, config.GIVEAWAY_LOG_CHANNEL_ID, GIVEAWAYS_FILE, path.basename(GIVEAWAYS_FILE)); } catch {}
        }
      } catch (err) {
        console.error('giveaway checker error', err);
      }
    }, CHECK_INTERVAL_MS);
    console.log('Giveaway handlers registered and checker started.');
  });
}

module.exports = { registerGiveawayHandlers };