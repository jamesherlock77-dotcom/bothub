// db.js - robust JSON file helpers for the bot
// Exports: loadJson, saveJson, backupFileToChannel, plus DB filename constants.

const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname; // keep DB files next to code; ensures consistent path in container

const TEAMS_DB_FILE = path.join(DATA_DIR, 'teams_data.json');
const TICKETS_DB_FILE = path.join(DATA_DIR, 'tickets_data.json');
const OTHER_DB_FILE = path.join(DATA_DIR, 'other_data.json'); // example, replace/use as needed

function _ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { /* ignore */ }
  }
}

function loadJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || raw.trim() === '') return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`loadJson: failed to parse JSON ${filePath}:`, err.message);
      return fallback;
    }
  } catch (err) {
    console.error(`loadJson error reading ${filePath}:`, err && err.message ? err.message : err);
    return fallback;
  }
}

function saveJson(filePath, obj) {
  try {
    _ensureDirForFile(filePath);
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(temp, filePath);
    return true;
  } catch (err) {
    console.error(`saveJson error writing ${filePath}:`, err && err.message ? err.message : err);
    return false;
  }
}

// Simple wrapper to backup to a channel (keeps existing signature)
async function backupFileToChannel(client, channelId, filePath, filename) {
  try {
    if (!client || !channelId || !fs.existsSync(filePath)) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    // Use attachment if small, otherwise skip silently
    await ch.send({ content: `Backup: ${filename}`, files: [filePath] }).catch(() => {});
  } catch (err) {
    console.warn('backupFileToChannel failed:', err && err.message ? err.message : err);
  }
}

module.exports = {
  loadJson,
  saveJson,
  backupFileToChannel,
  TEAMS_DB_FILE,
  TICKETS_DB_FILE,
  OTHER_DB_FILE,
};
