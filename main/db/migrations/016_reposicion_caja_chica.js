// Caja chica de fondo fijo: cada reposición cierra el periodo (lo gastado vuelve a estar
// disponible) y queda registrada con su monto. Idempotente.
module.exports = {
  id: '016_reposicion_caja_chica',
  up(db, { columnasDe }) {
    db.exec(`CREATE TABLE IF NOT EXISTS reposiciones_caja_chica (
      id              TEXT PRIMARY KEY,
      caja_chica_id   TEXT NOT NULL REFERENCES caja_chica(id),
      monto           REAL NOT NULL,
      gastos          INTEGER NOT NULL DEFAULT 0,
      fecha           TEXT NOT NULL,
      usuario_id      TEXT NOT NULL REFERENCES usuarios(id),
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      deleted_at      TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_reposiciones_caja_chica ON reposiciones_caja_chica(caja_chica_id, fecha)');
    // Cada gasto queda en la reposición que lo cubrió; sin reposición, es del periodo abierto.
    if (!columnasDe(db, 'gastos_caja_chica').has('reposicion_id')) {
      db.exec('ALTER TABLE gastos_caja_chica ADD COLUMN reposicion_id TEXT REFERENCES reposiciones_caja_chica(id)');
      // Antes no había reposiciones: lo gastado hasta hoy se da por repuesto en una reposición
      // inicial, para que el fondo arranque completo y no bloquee los gastos nuevos.
      const cajas = db.prepare(
        `SELECT caja_chica_id, SUM(monto) AS monto, COUNT(*) AS gastos, MAX(fecha) AS fecha,
                (SELECT usuario_id FROM gastos_caja_chica g2 WHERE g2.caja_chica_id = g.caja_chica_id ORDER BY fecha DESC LIMIT 1) AS usuario_id
         FROM gastos_caja_chica g WHERE estado != 'anulado' AND deleted_at IS NULL GROUP BY caja_chica_id`
      ).all();
      for (const c of cajas) {
        const id = require('node:crypto').randomUUID();
        db.prepare('INSERT INTO reposiciones_caja_chica (id, caja_chica_id, monto, gastos, fecha, usuario_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, c.caja_chica_id, Math.round(c.monto * 100) / 100, c.gastos, c.fecha, c.usuario_id);
        db.prepare("UPDATE gastos_caja_chica SET reposicion_id = ? WHERE caja_chica_id = ? AND estado != 'anulado' AND deleted_at IS NULL").run(id, c.caja_chica_id);
      }
    }
  },
};
