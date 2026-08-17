const fs = require('fs');
const path = require('path');

console.log('cwd:', process.cwd());
console.log('__dirname:', __dirname);

const entries = fs.readdirSync(__dirname);
console.log('Top-level files (count):', entries.length);
entries.filter(f => /teams/i.test(f)).forEach(f => {
  try {
    const p = path.join(__dirname, f);
    const s = fs.statSync(p);
    console.log(`FOUND: ${f} -> ${p}  size=${s.size} mode=${(s.mode & 0o777).toString(8)}`);
    try { console.log('HEAD:\n', fs.readFileSync(p,'utf8').slice(0,800)); } catch(e) {}
  } catch(e){ console.log('stat error for', f, e && e.message); }
});
