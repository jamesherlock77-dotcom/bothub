// db.js - robust JSON file helpers and backup helper that logs to the backup channel
// Exports: loadJson, saveJson, backupFileToChannel, TEAMS_DB_FILE, TICKETS_DB_FILE

const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname; // keep DB files next to code for predictable paths
const CANDIDATE_TEAMS_FILENAMES = [
  'teams_data.json',
  'teams_data (1).json',
  'teams_data(1).json',
  'teams.json',
];

function _findTeamsFile() {
  for (const name of CANDIDATE_TEAMS_FILENAMES) {
    const p = path.join(DATA_DIR, name);
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  // fallback canonical path (used for saves)
  return path.join(DATA_DIR, 'teams_data.json');
}

const TEAMS_DB_FILE = _findTeamsFile();
const TICKETS_DB_FILE = path.join(DATA_DIR, 'tickets_data.json');

function _ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { /* ignore */ }
  }
}

function loadJson(filePathOrKey, fallback = {}) {
  const filePath = (filePathOrKey === undefined || filePathOrKey === null) ? filePathOrKey
    : (filePathOrKey === 'teams' ? TEAMS_DB_FILE : filePathOrKey);

  const p = filePath || filePathOrKey || TEAMS_DB_FILE;
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw || raw.trim() === '') return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`loadJson: failed to parse JSON ${p}:`, err.message);
      return fallback;
    }
  } catch (err) {
    console.error(`loadJson error reading ${p}:`, err && err.message ? err.message : err);
    return fallback;
  }
}

function saveJson(filePathOrKey, obj) {
  const filePath = (filePathOrKey === 'teams') ? TEAMS_DB_FILE : (filePathOrKey || TEAMS_DB_FILE);
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

// Backup helper: posts a short message and attaches the file to the log channel
const LOG_CHANNEL_ID = '1538791773772455949';

async function backupFileToChannel(client, filePath, filename, actorName) {
  try {
    if (!client) {
      console.warn('backupFileToChannel: client missing');
      return false;
    }
    if (!filePath || !filename) {
      console.warn('backupFileToChannel: filePath or filename missing');
      return false;
    }
    if (!fs.existsSync(filePath)) {
      console.warn('backupFileToChannel: file does not exist:', filePath);
      return false;
    }

    const chan = await client.channels.fetch(String(LOG_CHANNEL_ID)).catch(() => null);
    if (!chan || !chan.isTextBased()) {
      console.warn('backupFileToChannel: log channel not found or not text-based:', LOG_CHANNEL_ID);
      return false;
    }

    const actor = actorName || (client.user ? client.user.tag : 'bot');
    const content = `Backed Up With ${actor} Json`;

    await chan.send({
      content,
      files: [{ attachment: filePath, name: filename }],
    }).catch((err) => {
      console.warn('backupFileToChannel: failed to send backup:', err && err.message ? err.message : err);
    });

    console.log(`backupFileToChannel: backed up ${filename} to channel ${LOG_CHANNEL_ID}`);
    return true;
  } catch (err) {
    console.warn('backupFileToChannel error:', err && err.message ? err.message : err);
    return false;
  }
}

module.exports = {
  loadJson,
  saveJson,
  backupFileToChannel,
  TEAMS_DB_FILE,
  TICKETS_DB_FILE,
  LOG_CHANNEL_ID,
};
