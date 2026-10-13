// Delivery: zona de entrega (para el reporte de tiempos por zona) y momento en que el pedido
// salió a ruta. La creación, el tiempo estimado y la entrega real ya existían. Idempotente.
module.exports = {
  id: '015_delivery',
  up(db, { columnasDe }) {
    const columnas = columnasDe(db, 'documentos_venta');
    if (!columnas.has('zona_entrega')) db.exec('ALTER TABLE documentos_venta ADD COLUMN zona_entrega TEXT');
    if (!columnas.has('fecha_en_ruta')) db.exec('ALTER TABLE documentos_venta ADD COLUMN fecha_en_ruta TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_docventa_delivery ON documentos_venta(es_delivery, estado_delivery)');
  },
};
