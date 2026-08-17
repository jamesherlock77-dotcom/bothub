// metaupdate.js
// Check a remote store page for a version string and post a component/summary.
// Lightweight fetch+regex first; optional Playwright fallback if you set USE_PLAYWRIGHT=1 and have playwright installed.
//
// Usage: registerMetaHandlers(client) from main.js (it will start a poll loop)
const axios = require('axios').default;
const { Events } = require('discord.js');
const config = require('./config');
const { loadJson, saveJson } = require('./db');
const path = require('path');

const META_DB_FILE = path.join(__dirname, 'meta_version_data.json');
const VERSION_RE = /\bVersion\b[:\s\-–—]*([0-9]+(?:\.[0-9]+){1,4})/i;
const CHECK_INTERVAL_MS = Math.max(60_000, (config.META_CHECK_INTERVAL_MINUTES || 5) * 60_000);

function _sanitize(text, maxLen = 1000) {
  if (!text) return null;
  let s = String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + '…';
  return s;
}

async function fetchMetaVersion() {
  try {
    const resp = await axios.get(config.META_URL, { timeout: 15_000, headers: { 'User-Agent': 'AC-UpdateBot/1.0' } });
    if (resp.status === 200) {
      const m = VERSION_RE.exec(resp.data);
      if (m) return _sanitize(m[1], 100);
      // else fallthrough to optional Playwright
    }
  } catch (err) {
    console.warn('aiohttp-like fetch failed', err.message || err);
  }

  if (process.env.USE_PLAYWRIGHT === '1') {
    try {
      const { chromium } = require('playwright'); // ensure playwright is installed if you enable this
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      try {
        await page.goto(config.META_URL, { waitUntil: 'networkidle', timeout: 20000 });
      } catch {
        try { await page.goto(config.META_URL, { timeout: 20000 }); } catch (err) { await browser.close(); throw err; }
      }
      const version = await page.evaluate(() => {
        const versionShape = /^[:\s\-\u2013\u2014]*([0-9]+(?:\.[0-9]+){1,4})/;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node;
        while (node = walker.nextNode()) {
          const t = node.textContent.trim();
          if (!t) continue;
          const idx = t.toLowerCase().indexOf('version');
          if (idx !== -1) {
            const after = t.slice(idx + 'version'.length);
            const match = after.match(versionShape);
            if (match) return match[1];
          }
        }
        const divs = [...document.querySelectorAll('div, span, p')];
        for (const el of divs) {
          const t = (el.innerText || '').trim();
          if (t.toLowerCase().startsWith('version')) {
            const match = t.slice('version'.length).match(versionShape);
            if (match) return match[1];
          }
        }
        return null;
      });
      await browser.close();
      return _sanitize(version, 100);
    } catch (err) {
      console.error('Playwright fallback failed', err);
      return null;
    }
  }

  return null;
}

async function checkForMetaUpdate(client) {
  const prevData = loadJson(META_DB_FILE, { last_version: null });
  const previous = prevData.last_version || null;
  const current = await fetchMetaVersion();
  if (current && current !== previous) {
    // save and post
    saveJson(META_DB_FILE, { last_version: current, last_updated: new Date().toISOString() });
    try { await require('./db').backupFileToChannel(client, config.META_LOG_CHANNEL_ID, META_DB_FILE, path.basename(META_DB_FILE)); } catch {}
    const channel = await client.channels.fetch(config.META_UPDATE_CHANNEL_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
      const msg = `Meta Update Detected!\nUpdated Version: \`${current}\`\nLast Logged: \`${previous || 'None'}\``;
      try { await channel.send({ content: `<@&${config.META_UPDATE_PING_ROLE_ID}> ${msg}` }); } catch (err) { console.error('Failed to send meta update', err); }
    }
    return { changed: true, current, previous };
  }
  return { changed: false, current, previous };
}

async function registerMetaHandlers(client) {
  client.once('ready', () => {
    setInterval(async () => {
      try {
        await checkForMetaUpdate(client);
      } catch (err) {
        console.error('meta poll error', err);
      }
    }, CHECK_INTERVAL_MS);
    console.log('Meta update poll started.');
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'checkupdate') {
      await interaction.deferReply({ ephemeral: true });
      const res = await checkForMetaUpdate(client);
      if (!res.current) {
        await interaction.followUp({ content: "⚠️ Couldn't fetch the version from the Meta store page.", ephemeral: true });
        return;
      }
      if (res.changed) {
        await interaction.followUp({ content: `✅ Update detected!\nCurrent: \`${res.current}\`\nPrevious: \`${res.previous || 'None'}\``, ephemeral: true });
      } else {
        await interaction.followUp({ content: `No update detected.\nCurrent: \`${res.current}\``, ephemeral: true });
      }
    }
  });
}

module.exports = { registerMetaHandlers, fetchMetaVersion };