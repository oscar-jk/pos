// E1: la base de la comisión del vendedor se elige en Configuración (total con ITBIS, o subtotal).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 1180 });
  h.entrada(db, ctx, p, 20, 400);
  h.abrirTurno(db, ctx);
  db.prepare('UPDATE usuarios SET pct_comision = 10 WHERE id = ?').run(ctx.usuarioId);
  return { db, ctx, p };
}
const comision = (db, f) => db.prepare('SELECT monto_comision m FROM comisiones_vendedor WHERE documento_venta_id = ?').get(f).m;
const vender = (db, ctx, p) => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 1180 }], { vendedorId: ctx.usuarioId });

test('E1: por defecto la comisión es sobre el total (comportamiento de siempre)', () => {
  const { db, ctx, p } = base();
  assert.equal(comision(db, vender(db, ctx, p)), 118);
});

test('E1: con base subtotal se calcula sin ITBIS, y la nota de crédito la reduce en proporción', () => {
  const { db, ctx, p } = base();
  h.tx(db, () => h.m('configuracion').actualizarParametroNegocio(db, 'comision_base', 'subtotal', ctx.usuarioId));
  const f = vender(db, ctx, p);
  assert.equal(comision(db, f), 100);
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Devuelto', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  assert.equal(comision(db, f), 0);
});

test('E1: solo se admite total o subtotal', () => {
  const { db, ctx } = base();
  assert.throws(() => h.tx(db, () => h.m('configuracion').actualizarParametroNegocio(db, 'comision_base', 'neto', ctx.usuarioId)), /use total o subtotal/);
});
