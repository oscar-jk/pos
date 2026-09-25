const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

const { seed, sincronizarPermisosFaltantes } = require('./seed');
const { aplicarMigraciones } = require('./migrations');

let db = null;

function resolveDbPath() {
  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  return path.join(userDataDir, 'punto-x.sqlite');
}

function schemaIsApplied(database) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roles'")
    .get();
  return Boolean(row);
}

function seedIsApplied(database) {
  const row = database.prepare('SELECT COUNT(*) AS total FROM roles').get();
  return row.total > 0;
}

function getDb() {
  if (db) return db;

  const dbPath = resolveDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (!schemaIsApplied(db)) {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schemaSql);
  }
  aplicarMigraciones(db);

  if (!seedIsApplied(db)) {
    seed(db);
  } else {
    sincronizarPermisosFaltantes(db);
  }

  return db;
}

module.exports = { getDb };
