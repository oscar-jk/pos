// Esquema sync-ready: created_at, updated_at y deleted_at en todas las tablas (14 tablas de
// detalle y bitácora no las tenían, más la propia tabla de migraciones).
//
// SQLite no acepta un valor por defecto no constante (strftime) en ALTER TABLE ADD COLUMN, así
// que en una base existente las columnas se agregan sin él, se rellenan con la mejor fecha
// disponible, y un trigger llena created_at/updated_at en cada fila nueva que llegue sin ellas.
// En una instalación nueva schema.sql ya trae las columnas con su valor por defecto; los
// triggers se crean igual (no estorban) para que ambas bases se comporten idéntico.
const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const TABLAS = [
  'bitacora_auditoria', 'parametros_negocio', 'unidades_medida', 'existencias', 'kardex_movimientos',
  'transferencias_almacen_detalle', 'ajustes_inventario_detalle', 'cxc_empleados_pagos', 'pagos_venta',
  'recibos_ingreso_aplicaciones', 'liquidaciones_importacion_detalle', 'pagos_proveedor_aplicaciones',
  'movimientos_caja', 'asientos_contables_detalle', 'migraciones_aplicadas',
];

function asegurarColumnasSync(db, tabla, columnasDe) {
  const cols = columnasDe(db, tabla);
  if (!cols.has('created_at')) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN created_at TEXT`);
    const desde = cols.has('updated_at') ? 'updated_at' : AHORA;
    db.exec(`UPDATE ${tabla} SET created_at = COALESCE(${desde}, ${AHORA})`);
  }
  if (!cols.has('updated_at')) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN updated_at TEXT`);
    db.exec(`UPDATE ${tabla} SET updated_at = COALESCE(created_at, ${AHORA})`);
  }
  if (!cols.has('deleted_at')) db.exec(`ALTER TABLE ${tabla} ADD COLUMN deleted_at TEXT`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${tabla}_fechas AFTER INSERT ON ${tabla}
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE ${tabla} SET created_at = COALESCE(NEW.created_at, ${AHORA}), updated_at = COALESCE(NEW.updated_at, NEW.created_at, ${AHORA})
      WHERE rowid = NEW.rowid;
    END`);
}

module.exports = {
  id: '011_columnas_sync',
  TABLAS,
  up(db, { columnasDe }) {
    for (const tabla of TABLAS) asegurarColumnasSync(db, tabla, columnasDe);
  },
};
