// Cambios incrementales al esquema para bases de datos ya instaladas. schema.sql siempre
// refleja el esquema completo (instalaciones nuevas); cada migración debe ser idempotente,
// porque en una base nueva sus cambios ya vienen aplicados desde schema.sql.
const MIGRACIONES = [
  require('./001_conciliacion_bancaria'),
  require('./002_notas_compra'),
];

function columnasDe(db, tabla) {
  return new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
}

function aplicarMigraciones(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const aplicadas = new Set(db.prepare('SELECT id FROM migraciones_aplicadas').all().map((m) => m.id));
  for (const migracion of MIGRACIONES) {
    if (aplicadas.has(migracion.id)) continue;
    db.transaction(() => {
      migracion.up(db, { columnasDe });
      db.prepare('INSERT INTO migraciones_aplicadas (id) VALUES (?)').run(migracion.id);
    })();
  }
}

module.exports = { aplicarMigraciones };
