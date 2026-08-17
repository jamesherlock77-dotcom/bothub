// diag.js -- run this in the same environment/container as the bot (node diag.js)
// It prints runtime dirs, env info, lists files and tries to read the DB files.

const fs = require('fs');
const path = require('path');

console.log('=== ENV & PATHS ===');
console.log('node version:', process.version);
console.log('cwd:', process.cwd());
console.log('__dirname:', __dirname);
console.log('__filename:', __filename);

console.log('\n=== IMPORTANT ENV VARS ===');
['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','RAILWAY_ENV','NODE_ENV'].forEach(k => {
  console.log(k, ':', process.env[k] ? '[SET]' : '[UNSET]');
});

console.log('\n=== REPO ROOT FILES (top-level) ===');
try {
  const rootFiles = fs.readdirSync(__dirname);
  rootFiles.forEach(f => {
    try {
      const stat = fs.statSync(path.join(__dirname, f));
      console.log(`${stat.isDirectory() ? 'DIR ' : 'FILE'} ${f}  ${stat.size} bytes`);
    } catch(e) {
      console.log('ERR stat', f, e && e.message);
    }
  });
} catch (err) {
  console.error('Failed to read __dirname listing:', err && err.message ? err.message : err);
}

console.log('\n=== LOOK FOR teams_data.json / tickets_data.json ===');
const candidatePaths = [
  path.join(__dirname, 'teams_data.json'),
  path.join(process.cwd(), 'teams_data.json'),
  path.join(__dirname, 'data', 'teams_data.json'),
  path.join(process.cwd(), 'data', 'teams_data.json'),
  path.join('/', 'app', 'teams_data.json'),
];

candidatePaths.forEach(p => {
  try {
    const exists = fs.existsSync(p);
    const stat = exists ? fs.statSync(p) : null;
    console.log(`${p} -> exists=${exists}${exists ? ` size=${stat.size}` : ''}`);
  } catch (err) {
    console.log(`${p} -> error: ${err && err.message}`);
  }
});

console.log('\n=== WHAT db.js EXPORTS (if present) ===');
try {
  const db = require('./db');
  console.log('require("./db") ok. Exports keys:', Object.keys(db));
  if (db.TEAMS_DB_FILE) {
    console.log('TEAMS_DB_FILE:', db.TEAMS_DB_FILE);
    try {
      const p = db.TEAMS_DB_FILE;
      console.log('exists:', fs.existsSync(p));
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        console.log('size:', stat.size);
        const raw = fs.readFileSync(p, 'utf8');
        console.log('first 2KB of file:\n', raw.slice(0, 2048), raw.length > 2048 ? '\n...[truncated]' : '');
        try {
          console.log('parsed JSON keys:', Object.keys(JSON.parse(raw)));
        } catch (e) {
          console.log('JSON parse error:', e && e.message);
        }
      }
    } catch(e) {
      console.log('Error reading TEAMS_DB_FILE:', e && e.message);
    }
  }
} catch (err) {
  console.error('require("./db") failed:', err && err.message ? err.message : err);
}

console.log('\n=== CHECK FOR LITERALS IN CODE (teams_data.json occurrences) ===');
try {
  // naive grep-like search for the filename literal in the repo files
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js'));
  for (const f of files) {
    try {
      const txt = fs.readFileSync(path.join(__dirname, f), 'utf8');
      if (txt.includes('teams_data.json')) {
        console.log(`Found literal 'teams_data.json' inside ${f} (line snippet):`);
        const lines = txt.split('\n').slice(0, 400);
        lines.forEach((ln, idx) => {
          if (ln.includes('teams_data.json')) console.log(`${idx+1}: ${ln.trim()}`);
        });
      }
    } catch(e) { /* ignore */ }
  }
} catch (err) {
  console.error('literal search failed:', err && err.message);
}

console.log('\n=== PERMISSIONS CHECK (for TEAMS_DB_FILE if found) ===');
try {
  const db = require('./db');
  const p = db.TEAMS_DB_FILE;
  try {
    const mode = fs.existsSync(p) ? fs.statSync(p).mode : null;
    console.log('TEAMS_DB_FILE path:', p, 'exists=', fs.existsSync(p), 'mode=', mode ? (mode & 0o777).toString(8) : 'n/a');
    // try reading/writing a small temp file next to it
    const tmp = p + '.diag.tmp';
    try {
      fs.writeFileSync(tmp, 'ok', { flag: 'w' });
      const tmpContents = fs.readFileSync(tmp, 'utf8');
      fs.unlinkSync(tmp);
      console.log('Write test succeeded next to TEAMS_DB_FILE (tmp read):', tmpContents);
    } catch (e) {
      console.log('Write test failed next to TEAMS_DB_FILE:', e && e.message);
    }
  } catch (e) {
    console.log('stat test failed for TEAMS_DB_FILE path:', e && e.message);
  }
} catch (e) {
  console.log('Skipping permissions check: require("./db") failed.');
}

console.log('\n=== DIAG DONE ===');
