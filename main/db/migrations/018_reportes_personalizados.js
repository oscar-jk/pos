// Reportes personalizados (armados por el usuario sobre las fuentes de datos existentes) y
// preferencias por usuario (p. ej. qué columnas ve en cada reporte). Idempotente.
module.exports = {
  id: '018_reportes_personalizados',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS reportes_personalizados (
      id           TEXT PRIMARY KEY,
      nombre       TEXT NOT NULL,
      descripcion  TEXT,
      definicion   TEXT NOT NULL,
      usuario_id   TEXT NOT NULL REFERENCES usuarios(id),
      compartido   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      deleted_at   TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_reportes_personalizados_usuario ON reportes_personalizados(usuario_id)');
    db.exec(`CREATE TABLE IF NOT EXISTS preferencias_usuario (
      id           TEXT PRIMARY KEY,
      usuario_id   TEXT NOT NULL REFERENCES usuarios(id),
      clave        TEXT NOT NULL,
      valor        TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      deleted_at   TEXT,
      UNIQUE (usuario_id, clave)
    )`);
  },
};
