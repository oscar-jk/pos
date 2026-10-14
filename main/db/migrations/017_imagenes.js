// Imágenes: foto de cada sucursal (local) y galería de fotos por producto. Las imágenes se
// guardan como data URL dentro de la base (la app funciona sin internet y la base es un solo
// archivo); el producto guarda además una miniatura para listas y la cuadrícula del mostrador.
// Idempotente.
module.exports = {
  id: '017_imagenes',
  up(db, { columnasDe }) {
    if (!columnasDe(db, 'sucursales').has('imagen')) db.exec('ALTER TABLE sucursales ADD COLUMN imagen TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS productos_imagenes (
      id           TEXT PRIMARY KEY,
      producto_id  TEXT NOT NULL REFERENCES productos(id),
      imagen       TEXT NOT NULL,
      miniatura    TEXT NOT NULL,
      orden        INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      deleted_at   TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_productos_imagenes ON productos_imagenes(producto_id, orden)');
  },
};
