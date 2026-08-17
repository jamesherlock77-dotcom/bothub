// backup helper — posts a JSON backup into the log channel with a short message
// Usage: await backupFileToChannel(client, '/full/path/to/teams_data.json', 'teams_data.json');

const fs = require('fs');

const LOG_CHANNEL_ID = '1538791773772455949'; // backup/log channel as requested

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

module.exports = { backupFileToChannel, LOG_CHANNEL_ID };
