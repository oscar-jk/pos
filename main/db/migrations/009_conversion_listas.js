// Módulo 2, segunda parte:
// - conversiones_producto: costo total trasladado del producto origen al destino, y una nota.
// - listas_precio: categoría de cliente a la que se asigna y, opcionalmente, un % sobre el precio
//   de detalle para los productos que la lista no fija uno por uno (negativo = descuento).
module.exports = {
  id: '009_conversion_listas',
  up(db, { columnasDe }) {
    const conv = columnasDe(db, 'conversiones_producto');
    if (!conv.has('costo_total')) db.exec('ALTER TABLE conversiones_producto ADD COLUMN costo_total REAL NOT NULL DEFAULT 0');
    if (!conv.has('concepto')) db.exec('ALTER TABLE conversiones_producto ADD COLUMN concepto TEXT');
    const listas = columnasDe(db, 'listas_precio');
    if (!listas.has('categoria_cliente_id')) db.exec('ALTER TABLE listas_precio ADD COLUMN categoria_cliente_id TEXT REFERENCES categorias_cliente(id)');
    if (!listas.has('porcentaje_sobre_detalle')) db.exec('ALTER TABLE listas_precio ADD COLUMN porcentaje_sobre_detalle REAL');
    if (!listas.has('usuario_id')) db.exec('ALTER TABLE listas_precio ADD COLUMN usuario_id TEXT REFERENCES usuarios(id)');
  },
};
