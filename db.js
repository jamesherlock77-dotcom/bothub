// db.js
// Very small JSON DB helper with "edit-in-place" backup to a log channel (like the Python code).
// In production prefer a DB (sqlite, postgres, or Railway persistent disk).
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

function _ensureFile(filePath, initial = {}) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), { encoding: 'utf8' });
  }
}

function loadJson(filePath, defaultValue = {}) {
  _ensureFile(filePath, defaultValue);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('Failed to read JSON', filePath, e);
    return defaultValue;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
}

// Example DB file constants (place in repo root or configure)
const TEAMS_DB_FILE = path.join(__dirname, 'teams_data.json');
const TICKETS_DB_FILE = path.join(__dirname, 'tickets_data.json');

async function backupFileToChannel(client, channelId, filePath, filename) {
  // Keep a single message in the channel with that filename, edit it in-place if found.
  // Requires the bot to have view/send/edit message permissions in that channel.
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    const messages = await channel.messages.fetch({ limit: 50 });
    const ours = messages.find(m => m.author && m.author.id === client.user.id && m.attachments.size > 0 && m.attachments.first().name === filename);
    const fileBuffer = fs.readFileSync(filePath);
    const attachment = new AttachmentBuilder(fileBuffer, { name: filename });
    if (ours) {
      try {
        await ours.edit({ content: '📦 Database (auto-updated):', files: [attachment] });
        return;
      } catch (err) {
        // Could have been deleted; fall through to send new
      }
    }
    await channel.send({ content: '📦 Database (auto-updated):', files: [attachment] });
  } catch (err) {
    console.error('backupFileToChannel failed', err);
  }
}

module.exports = {
  loadJson,
  saveJson,
  TEAMS_DB_FILE,
  TICKETS_DB_FILE,
  backupFileToChannel,
};