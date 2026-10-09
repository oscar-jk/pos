// C: regresión de movimientos de inventario — transferencias con lote, conversión de producto,
// mermas y ajustes (con su asiento). Las invariantes globales se revisan al final de la suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const inv = () => h.m('inventario');
function base(extra = {}) {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const deposito = h.tx(db, () => inv().crearAlmacen(db, { sucursalId: ctx.sucursalId, nombre: 'Depósito' })).id;
  const p = h.producto(db, ctx, { controlaLote: true, ...extra });
  h.entrada(db, ctx, p, 10, 50, { numeroLote: 'L-OCT', fechaVencimiento: '2027-10-31' });
  h.entrada(db, ctx, p, 5, 60, { numeroLote: 'L-SEP', fechaVencimiento: '2027-09-30' });
  return { db, ctx, p, deposito };
}
const enAlmacen = (db, p, almacenId) => (db.prepare('SELECT cantidad_disponible c FROM existencias WHERE producto_id = ? AND almacen_id = ?').get(p, almacenId) || { c: 0 }).c;

test('C transferencia con lote: sale primero el que vence antes y llega con su vencimiento', () => {
  const { db, ctx, p, deposito } = base();
  h.tx(db, () => inv().crearTransferencia(db, { almacenOrigenId: ctx.almacenId, almacenDestinoId: deposito, lineas: [{ productoId: p, cantidad: 7 }], usuarioId: ctx.usuarioId }));
  assert.equal(enAlmacen(db, p, ctx.almacenId), 8);
  assert.equal(enAlmacen(db, p, deposito), 7);
  const lotes = inv().listarLotes(db, { productoId: p, almacenId: deposito }).map((l) => [l.numero_lote, l.fecha_vencimiento, l.cantidad]);
  assert.deepEqual(lotes, [['L-SEP', '2027-09-30', 5], ['L-OCT', '2027-10-31', 2]]);
  assert.equal(h.saldoCuenta(db, '1300'), 800, 'transferir no cambia el valor del inventario');
});

test('C transferencia eligiendo el lote y sin existencia suficiente', () => {
  const { db, ctx, p, deposito } = base();
  const loteOct = inv().listarLotes(db, { productoId: p, almacenId: ctx.almacenId }).find((l) => l.numero_lote === 'L-OCT');
  h.tx(db, () => inv().crearTransferencia(db, { almacenOrigenId: ctx.almacenId, almacenDestinoId: deposito, lineas: [{ productoId: p, cantidad: 4, loteId: loteOct.lote_id }], usuarioId: ctx.usuarioId }));
  assert.deepEqual(inv().listarLotes(db, { productoId: p, almacenId: deposito }).map((l) => l.numero_lote), ['L-OCT']);
  assert.throws(() => h.tx(db, () => inv().crearTransferencia(db, { almacenOrigenId: ctx.almacenId, almacenDestinoId: deposito, lineas: [{ productoId: p, cantidad: 50 }], usuarioId: ctx.usuarioId })), /insuficiente/);
  assert.throws(() => h.tx(db, () => inv().crearTransferencia(db, { almacenOrigenId: ctx.almacenId, almacenDestinoId: ctx.almacenId, lineas: [{ productoId: p, cantidad: 1 }], usuarioId: ctx.usuarioId })), /no pueden ser el mismo/);
});

test('C conversión: el valor y el lote pasan al destino; anular la devuelve', () => {
  const { db, ctx, p } = base();
  const libra = h.producto(db, ctx, { controlaLote: true });
  const antes = h.saldoCuenta(db, '1300');
  const conv = h.tx(db, () => inv().crearConversion(db, { almacenId: ctx.almacenId, productoOrigenId: p, cantidadOrigen: 2, productoDestinoId: libra, cantidadDestino: 100, usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 13);
  assert.equal(h.existencia(db, ctx, libra), 100);
  assert.equal(inv().listarLotes(db, { productoId: libra })[0].numero_lote, 'L-SEP', 'hereda el lote del que vence antes');
  assert.equal(h.saldoCuenta(db, '1300'), antes, 'la conversión no genera asiento: el valor se mantiene');
  h.tx(db, () => inv().anularConversion(db, { conversionId: conv, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 15);
  assert.equal(h.existencia(db, ctx, libra), 0);
});

test('C merma y ajustes: asientos a 6200 y 6300 y el inventario sigue cuadrado', () => {
  const { db, ctx, p } = base();
  const loteSep = inv().listarLotes(db, { productoId: p, almacenId: ctx.almacenId }).find((l) => l.numero_lote === 'L-SEP');
  h.tx(db, () => inv().crearMerma(db, { almacenId: ctx.almacenId, productoId: p, loteId: loteSep.lote_id, cantidad: 2, motivo: 'Vencido', usuarioId: ctx.usuarioId }));
  assert.ok(h.saldoCuenta(db, '6200') > 0);
  const diferenciasAntes = h.saldoCuenta(db, '6300'); // la existencia inicial entró como ajuste (haber)
  h.tx(db, () => inv().crearAjuste(db, { almacenId: ctx.almacenId, tipo: 'salida', motivo: 'conteo_fisico', lineas: [{ productoId: p, cantidad: 1 }], usuarioId: ctx.usuarioId }));
  assert.ok(h.saldoCuenta(db, '6300') > diferenciasAntes, 'el faltante va al debe de 6300');
  assert.equal(h.existencia(db, ctx, p), 12);
  assert.deepEqual(h.invariantes(db), []);
});

test('C PEPS: venta, devolución y anulación sobre capas con lote', () => {
  const { db, ctx, p } = base({ metodoValoracion: 'peps' });
  h.abrirTurno(db, ctx);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 6 }], [{ formaPago: 'efectivo', monto: 708 }]);
  assert.equal(h.saldoCuenta(db, '5100'), 5 * 60 + 1 * 50, 'sale primero el lote que vence antes (L-SEP a 60)');
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  const nc = h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Devuelto', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 3 }] }));
  assert.equal(h.existencia(db, ctx, p), 12);
  h.tx(db, () => h.m('ventas').anularNotaCredito(db, { documentoId: nc, motivo: 'Error', usuarioId: ctx.usuarioId }));
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 15);
  assert.equal(h.saldoCuenta(db, '1300'), 800);
});
