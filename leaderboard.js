// leaderboard.js
// Renders an "All-Time Champions" leaderboard image if node-canvas is installed, otherwise posts a plaintext list.
// Requires optional 'canvas' package + its system dependencies to produce images.
//
// Usage: registerLeaderboardHandlers(client) from main.js, and call refreshLeaderboard(channel) as needed.
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const { loadJson, saveJson } = require('./db');

const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard_data.json');
const IMAGE_FILENAME = 'leaderboard.png';

function _rankTeams(teams) {
  return Object.entries(teams || {}).sort((a, b) => {
    const ai = Number(a[1]) || 0;
    const bi = Number(b[1]) || 0;
    if (ai !== bi) return bi - ai;
    return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
  });
}

async function renderLeaderboardImage(teams) {
  // Try to use node-canvas if installed
  try {
    // dynamic require so the rest of the bot works without canvas
    const { createCanvas, loadImage, registerFont } = require('canvas');
    const width = 952, height = 556;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // background
    ctx.fillStyle = '#1e1410';
    ctx.fillRect(0, 0, width, height);

    // title bar
    ctx.fillStyle = 'rgba(20,16,20,0.9)';
    ctx.fillRect(0, 0, width, 108);
    ctx.fillStyle = '#fff';
    ctx.font = '46px Sans';
    ctx.fillText('All-Time Champions', 36, 64);

    const ranked = _rankTeams(teams).slice(0, 10);
    ctx.font = '24px Sans';
    const colX = [36, width / 2 + 8];
    const rowH = 76;
    const topY = 132;
    for (let i = 0; i < ranked.length; i++) {
      const [teamName, wins] = ranked[i];
      const col = Math.floor(i / 5);
      const row = i % 5;
      const x = colX[col];
      const y = topY + row * rowH;
      // row
      ctx.fillStyle = 'rgba(25,22,30,0.7)';
      roundRect(ctx, x, y, width / 2 - 44, 56, 14, true, false);
      // rank badge
      const rank = i + 1;
      ctx.beginPath();
      ctx.fillStyle = rank <= 3 ? '#f7c548' : 'rgba(40,36,44,0.9)';
      ctx.arc(x + 32, y + 28, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rank <= 3 ? '#1e140a' : '#f7c548';
      ctx.font = '22px Sans';
      ctx.fillText(String(rank), x + 26, y + 34);
      // name & wins
      ctx.fillStyle = '#fff';
      ctx.font = '24px Sans';
      ctx.fillText(teamName, x + 64, y + 35);
      ctx.fillStyle = '#f7c548';
      ctx.fillText(`${Number(wins).toLocaleString()} wins`, x + (width / 2 - 44) - 180, y + 35);
    }

    const buffer = canvas.toBuffer('image/png');
    return buffer;
  } catch (err) {
    // canvas not available — return null so caller falls back to text
    console.warn('Canvas not available, leaderboard will be sent as text fallback.', err.message || err);
    return null;
  }
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

async function refreshLeaderboardMessage(client) {
  // posts or edits the leaderboard image in LEADERBOARD_CHANNEL_ID
  const db = loadJson(LEADERBOARD_FILE, { teams: {} });
  const buf = await renderLeaderboardImage(db.teams);
  const channel = await client.channels.fetch(require('./config').LEADERBOARD_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Leaderboard channel missing or not text-based.');
  }

  if (buf) {
    // find existing attachment by name and edit, else send new
    const attachments = channel.messages.fetch({ limit: 50 }).then(async (msgs) => {
      const ours = msgs.find(m => m.author && m.author.id === client.user.id && m.attachments.size && m.attachments.first().name === IMAGE_FILENAME);
      const file = new AttachmentBuilder(buf, { name: IMAGE_FILENAME });
      if (ours) {
        try {
          await ours.edit({ attachments: [file] });
          return;
        } catch (e) {
          // fall through to new send
        }
      }
      await channel.send({ files: [file] });
    }).catch(async () => {
      const file = new AttachmentBuilder(buf, { name: IMAGE_FILENAME });
      await channel.send({ files: [file] }).catch(() => {});
    });
    return;
  } else {
    // fallback: post plaintext leaderboard
    const ranked = _rankTeams(db.teams).slice(0, 20);
    const lines = ranked.map(([name, wins], idx) => `${idx + 1}. ${name} — ${wins} wins`);
    const content = `All-Time Champions\n\n${lines.join('\n')}`;
    await channel.send({ content }).catch(() => {});
  }
}

module.exports = { refreshLeaderboardMessage, renderLeaderboardImage };