// Cotizaciones y conduces (documentos_venta tipo 'cotizacion' y 'conduce'):
// - valida_hasta: fecha hasta la que se respeta el precio cotizado (AAAA-MM-DD).
// - facturado_en_id: factura que cobró esta cotización o este conduce.
module.exports = {
  id: '005_cotizacion_conduce',
  up(db, { columnasDe }) {
    const columnas = columnasDe(db, 'documentos_venta');
    if (!columnas.has('valida_hasta')) db.exec('ALTER TABLE documentos_venta ADD COLUMN valida_hasta TEXT');
    if (!columnas.has('facturado_en_id')) db.exec('ALTER TABLE documentos_venta ADD COLUMN facturado_en_id TEXT REFERENCES documentos_venta(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_docventa_facturado_en ON documentos_venta(facturado_en_id)');
  },
};
