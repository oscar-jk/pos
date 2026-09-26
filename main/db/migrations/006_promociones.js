// Promociones programadas (Módulo 1):
// - promociones.nombre: nombre con que se reconoce (p. ej. "Semana del yogurt").
// - promociones.usuario_id: quién la creó.
// - documentos_venta_detalle.promocion_id: promoción que se aplicó a la línea, si alguna.
module.exports = {
  id: '006_promociones',
  up(db, { columnasDe }) {
    const promo = columnasDe(db, 'promociones');
    if (!promo.has('nombre')) db.exec('ALTER TABLE promociones ADD COLUMN nombre TEXT');
    if (!promo.has('usuario_id')) db.exec('ALTER TABLE promociones ADD COLUMN usuario_id TEXT REFERENCES usuarios(id)');
    const detalle = columnasDe(db, 'documentos_venta_detalle');
    if (!detalle.has('promocion_id')) db.exec('ALTER TABLE documentos_venta_detalle ADD COLUMN promocion_id TEXT REFERENCES promociones(id)');
  },
};
