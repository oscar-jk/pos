// Multimoneda (Módulo 1): monedas y tasas de cambio con las columnas sync-ready que les faltaban
// (created_at/updated_at/deleted_at) y quién registró cada tasa del día.
module.exports = {
  id: '008_multimoneda',
  up(db, { columnasDe }) {
    const ahora = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    const monedas = columnasDe(db, 'monedas');
    for (const col of ['created_at', 'updated_at']) {
      if (!monedas.has(col)) { db.exec(`ALTER TABLE monedas ADD COLUMN ${col} TEXT`); db.exec(`UPDATE monedas SET ${col} = ${ahora}`); }
    }
    if (!monedas.has('deleted_at')) db.exec('ALTER TABLE monedas ADD COLUMN deleted_at TEXT');
    const tasas = columnasDe(db, 'tasas_cambio');
    if (!tasas.has('updated_at')) { db.exec('ALTER TABLE tasas_cambio ADD COLUMN updated_at TEXT'); db.exec(`UPDATE tasas_cambio SET updated_at = created_at`); }
    if (!tasas.has('deleted_at')) db.exec('ALTER TABLE tasas_cambio ADD COLUMN deleted_at TEXT');
    if (!tasas.has('usuario_id')) db.exec('ALTER TABLE tasas_cambio ADD COLUMN usuario_id TEXT REFERENCES usuarios(id)');
  },
};
