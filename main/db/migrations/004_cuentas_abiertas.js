// Cuentas abiertas (módulo opcional): cuenta tipo bar/mesa a la que se le van agregando
// productos y que al cobrarse se convierte en una factura. Cada línea queda con quién la
// agregó; quitar una línea es borrado lógico con motivo, nunca físico.
module.exports = {
  id: '004_cuentas_abiertas',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cuentas_abiertas (
        id                  TEXT PRIMARY KEY,
        numero              TEXT NOT NULL UNIQUE,
        nombre              TEXT NOT NULL,
        sucursal_id         TEXT REFERENCES sucursales(id),
        almacen_id          TEXT REFERENCES almacenes(id),
        estado              TEXT NOT NULL DEFAULT 'abierta', -- abierta | facturada | anulada
        documento_venta_id  TEXT REFERENCES documentos_venta(id),
        fecha_cierre        TEXT,
        motivo_anulacion    TEXT,
        usuario_anulo_id    TEXT REFERENCES usuarios(id),
        usuario_id          TEXT NOT NULL REFERENCES usuarios(id),
        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        deleted_at          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cuentas_abiertas_estado ON cuentas_abiertas(estado);

      CREATE TABLE IF NOT EXISTS cuentas_abiertas_detalle (
        id                  TEXT PRIMARY KEY,
        cuenta_id           TEXT NOT NULL REFERENCES cuentas_abiertas(id),
        producto_id         TEXT NOT NULL REFERENCES productos(id),
        cantidad            REAL NOT NULL,
        nota                TEXT,
        usuario_id          TEXT NOT NULL REFERENCES usuarios(id),
        motivo_eliminacion  TEXT,
        usuario_elimino_id  TEXT REFERENCES usuarios(id),
        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        deleted_at          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cuentas_abiertas_detalle_cuenta ON cuentas_abiertas_detalle(cuenta_id);
    `);
  },
};
