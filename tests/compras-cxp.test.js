// C: regresión de compras, notas de compra (promedio y PEPS) y cuentas por pagar con cheques
// posdatados. Además de las invariantes globales, se exige 2100 = saldo de los proveedores.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const compras = () => h.m('compras');
const cxp = () => h.m('cxp');
function base(extraProducto = {}) {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 500, ...extraProducto });
  h.abrirTurno(db, ctx);
  const prov = h.tx(db, () => compras().guardarProveedor(db, { nombre: 'Distribuidora', rnc: '101000001', diasCredito: 30 }));
  return { db, ctx, p, prov: typeof prov === 'string' ? prov : prov.id };
}
const r2 = (n) => Math.round(n * 100) / 100;
function comprar(db, ctx, prov, lineas, formaPago = 'credito') {
  const total = r2(lineas.reduce((a, l) => a + r2(l.cantidad * l.costoUnitario * 1.18), 0));
  return h.tx(db, () => compras().crearFacturaCompra(db, {
    proveedorId: prov, almacenId: ctx.almacenId, sucursalId: ctx.sucursalId, usuarioId: ctx.usuarioId, cajaId: ctx.cajaId, ncfProveedor: 'B0100000001',
    lineas, pagos: [{ formaPago, monto: total }],
  }));
}
function cuadraProveedores(db) {
  const deuda = r2(db.prepare('SELECT id FROM proveedores').all().reduce((a, p) => a + compras().saldoPendienteProveedor(db, p.id) - compras().saldoAFavorProveedor(db, p.id), 0));
  assert.equal(r2(-h.saldoCuenta(db, '2100')) + 0, deuda + 0, `2100 = ${-h.saldoCuenta(db, '2100')} vs proveedores ${deuda}`);
}
const lineaNota = (db, factura) => compras().lineasParaNota(db, factura)[0];

test('C compras (promedio): compra a crédito, devolución, ajuste de precio y anulaciones', () => {
  const { db, ctx, p, prov } = base({ metodoValoracion: 'promedio_ponderado' });
  const f1 = comprar(db, ctx, prov, [{ productoId: p, cantidad: 10, costoUnitario: 100 }]);
  const f2 = comprar(db, ctx, prov, [{ productoId: p, cantidad: 10, costoUnitario: 120 }]);
  assert.equal(h.existencia(db, ctx, p), 20);
  assert.equal(h.saldoCuenta(db, '1300'), 2200);
  assert.equal(h.saldoCuenta(db, '1500'), 396);
  cuadraProveedores(db);
  const nc = h.tx(db, () => compras().crearNotaCompra(db, { tipo: 'nota_credito', tipoAjuste: 'devolucion', facturaId: f2, ncfProveedor: 'B0400000001', concepto: 'Dañados', lineas: [{ detalleReferenciaId: lineaNota(db, f2).id, cantidad: 3 }], usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 17);
  cuadraProveedores(db);
  const nd = h.tx(db, () => compras().crearNotaCompra(db, { tipo: 'nota_debito', facturaId: f1, ncfProveedor: 'B0300000001', concepto: 'Flete', lineas: [{ detalleReferenciaId: lineaNota(db, f1).id, monto: 50 }], usuarioId: ctx.usuarioId }));
  cuadraProveedores(db);
  assert.throws(() => h.tx(db, () => compras().anularFacturaCompra(db, { documentoId: f2, motivo: 'x', usuarioId: ctx.usuarioId })), /notas de compra activas/);
  h.tx(db, () => compras().anularNotaCompra(db, { documentoId: nd, motivo: 'Error', usuarioId: ctx.usuarioId }));
  h.tx(db, () => compras().anularNotaCompra(db, { documentoId: nc, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 20);
  h.tx(db, () => compras().anularFacturaCompra(db, { documentoId: f2, motivo: 'Duplicada', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 10);
  assert.equal(h.saldoCuenta(db, '1300'), 1000, 'anular la compra saca su valor y el inventario vuelve a cuadrar');
  cuadraProveedores(db);
});

test('C compras (PEPS): la devolución sale de la capa de esa compra', () => {
  const { db, ctx, p, prov } = base({ metodoValoracion: 'peps' });
  comprar(db, ctx, prov, [{ productoId: p, cantidad: 10, costoUnitario: 100 }]);
  const f2 = comprar(db, ctx, prov, [{ productoId: p, cantidad: 10, costoUnitario: 120 }]);
  h.tx(db, () => compras().crearNotaCompra(db, { tipo: 'nota_credito', tipoAjuste: 'devolucion', facturaId: f2, concepto: 'Dañados', lineas: [{ detalleReferenciaId: lineaNota(db, f2).id, cantidad: 4 }], usuarioId: ctx.usuarioId }));
  const capas = db.prepare('SELECT cantidad, costo_unitario c FROM lotes WHERE producto_id = ? AND cantidad > 0 ORDER BY created_at, rowid').all(p);
  assert.deepEqual(capas.map((x) => [x.cantidad, x.c]), [[10, 100], [6, 120]]);
  assert.equal(h.saldoCuenta(db, '1300'), 1720);
  cuadraProveedores(db);
});

test('C CxP: pago con cheque posdatado, cobro del cheque y anulación del pago', () => {
  const { db, ctx, p, prov } = base();
  const f = comprar(db, ctx, prov, [{ productoId: p, cantidad: 10, costoUnitario: 100 }]);
  const pago = h.tx(db, () => cxp().crearPago(db, {
    proveedorId: prov, formaPago: 'cheque', numeroCheque: '000123', bancoCheque: 'Banreservas', fechaCheque: '2099-01-15',
    aplicaciones: [{ documentoCompraId: f, montoAplicado: 1180 }], cajaId: ctx.cajaId, usuarioId: ctx.usuarioId,
  }));
  const pagoId = typeof pago === 'string' ? pago : pago.id;
  assert.equal(compras().saldoPendienteProveedor(db, prov), 0);
  assert.equal(cxp().chequesPosdatadosPendientes(db).length, 1);
  cuadraProveedores(db);
  const cajero = h.usuarioDeRol(db, 'Cajero');
  h.loginUsuario(db, cajero);
  assert.throws(() => h.tx(db, () => cxp().marcarChequeCobrado(db, { pagoId, usuarioId: cajero })), /permiso/);
  h.loginComo(db);
  h.tx(db, () => cxp().marcarChequeCobrado(db, { pagoId, usuarioId: ctx.usuarioId }));
  assert.equal(cxp().chequesPosdatadosPendientes(db).length, 0);
  assert.throws(() => h.tx(db, () => cxp().marcarChequeCobrado(db, { pagoId, usuarioId: ctx.usuarioId })), /ya está marcado/);
  assert.ok(db.prepare("SELECT 1 FROM bitacora_auditoria WHERE accion = 'cheque_cobrado'").get());
  h.tx(db, () => cxp().anularPago(db, { pagoId, motivo: 'Cheque devuelto', usuarioId: ctx.usuarioId }));
  assert.equal(compras().saldoPendienteProveedor(db, prov), 1180);
  cuadraProveedores(db);
});

test('C CxP: no se paga más del saldo y el efectivo exige turno', () => {
  const { db, ctx, p, prov } = base();
  const f = comprar(db, ctx, prov, [{ productoId: p, cantidad: 1, costoUnitario: 100 }]);
  assert.throws(() => h.tx(db, () => cxp().crearPago(db, { proveedorId: prov, formaPago: 'transferencia', aplicaciones: [{ documentoCompraId: f, montoAplicado: 500 }], usuarioId: ctx.usuarioId })), /excede/);
  h.tx(db, () => cxp().crearPago(db, { proveedorId: prov, formaPago: 'efectivo', aplicaciones: [{ documentoCompraId: f, montoAplicado: 118 }], cajaId: ctx.cajaId, usuarioId: ctx.usuarioId }));
  assert.equal(compras().saldoPendienteProveedor(db, prov), 0);
  cuadraProveedores(db);
});
