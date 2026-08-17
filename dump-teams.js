// dump-teams.js
const path = require('path');
const fs = require('fs');

const TEAMS_DB_FILE = path.join(__dirname, 'teams_data.json');

function loadJson(p, fallback = {}) {
  if (!fs.existsSync(p)) return fallback;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse JSON', p, e);
    return fallback;
  }
}

const db = loadJson(TEAMS_DB_FILE, { teams: {} });
const teams = db.teams || {};
console.log('Teams DB path:', TEAMS_DB_FILE);
console.log('Total teams:', Object.keys(teams).length);
for (const [name, info] of Object.entries(teams)) {
  console.log('---');
  console.log('Team name:', name);
  console.log('Info:', JSON.stringify(info, null, 2));
}
