// Tiny JSON-file datastore (atomic writes). Swap for SQLite/Postgres in production.
const fs = require('fs');
const path = require('path');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

// Create the data directory as soon as the process boots. Render's disk is
// ephemeral and empty on each start, and the first request may read before
// anything is written.
function ensureDir() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
}
ensureDir();

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { payments: [], payouts: [] }; }
}
let db = load();

function save() {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = {
  get db() { return db; },
  save,
  reset() { db = { payments: [], payouts: [] }; save(); },
};
