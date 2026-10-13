// C: regresión de documentos de venta — cotización, conduce (cuenta puente 1350), pedidos con
// reserva, promociones y cuentas abiertas. Cada suite: flujo normal, anulación y cuadre (las
// invariantes globales de helpers.js se revisan al final sobre todas las bases).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const ventas = () => h.m('ventas');
function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 590 });
  h.entrada(db, ctx, p, 100, 400);
  h.abrirTurno(db, ctx);
  const cl = h.cliente(db, ctx, { limiteCredito: 1000000 });
  return { db, ctx, p, cl };
}
const doc = (db, id) => ventas().obtenerFactura(db, id);
const comun = (ctx, extra) => ({ sucursalId: ctx.sucursalId, almacenId: ctx.almacenId, usuarioId: ctx.usuarioId, nivelPrecio: 'detalle', descuentoGlobalPct: 0, ...extra });
const lineasDe = (d) => d.lineas.map((l) => ({ productoId: l.producto_id, cantidad: l.cantidad, precioUnitario: l.precio_unitario, descuentoMonto: l.descuento_monto, descuentoPct: 0 }));
const credito = (monto) => [{ formaPago: 'credito', monto }];

// --- Cotización ---
test('C cotización: no mueve inventario ni libros; se factura con sus precios', () => {
  const { db, ctx, p, cl } = base();
  const cot = h.tx(db, () => ventas().crearCotizacion(db, comun(ctx, { clienteId: cl, diasValidez: 10, lineas: [{ productoId: p, cantidad: 10 }] })));
  assert.equal(doc(db, cot).estado, 'abierto');
  assert.equal(h.existencia(db, ctx, p), 100);
  assert.equal(h.saldoCuenta(db, '4100'), 0);
  db.prepare('UPDATE productos SET precio_detalle = 650 WHERE id = ?').run(p);
  const f = h.facturar(db, ctx, lineasDe(doc(db, cot)), credito(5900), { clienteId: cl, cotizacionId: cot });
  assert.equal(doc(db, f).total, 5900);
  assert.equal(doc(db, cot).estado, 'facturado');
  h.tx(db, () => ventas().anularFactura(db, { documentoId: f, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(doc(db, cot).estado, 'abierto', 'anular la factura reabre la cotización');
  h.tx(db, () => ventas().anularCotizacion(db, { documentoId: cot, motivo: 'Cliente no quiso', usuarioId: ctx.usuarioId }));
  assert.equal(doc(db, cot).estado, 'anulado');
});

// --- Conduce y cuenta puente 1350 ---
test('C conduce: saca inventario a la cuenta 1350; al facturar pasa a costo de ventas', () => {
  const { db, ctx, p, cl } = base();
  const c1 = h.tx(db, () => ventas().crearConduce(db, comun(ctx, { clienteId: cl, lineas: [{ productoId: p, cantidad: 3 }] })));
  const c2 = h.tx(db, () => ventas().crearConduce(db, comun(ctx, { clienteId: cl, lineas: [{ productoId: p, cantidad: 2 }] })));
  assert.equal(h.existencia(db, ctx, p), 95);
  assert.equal(h.saldoCuenta(db, '1350'), 2000);
  assert.equal(h.saldoCuenta(db, '5100'), 0);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 5, precioUnitario: 590 }], credito(2950), { clienteId: cl, conduceIds: [c1, c2] });
  assert.equal(h.existencia(db, ctx, p), 95, 'facturar conduces no vuelve a sacar inventario');
  assert.equal(h.saldoCuenta(db, '1350'), 0);
  assert.equal(h.saldoCuenta(db, '5100'), 2000);
  assert.equal(doc(db, c1).estado, 'facturado');
  assert.throws(() => h.tx(db, () => ventas().anularConduce(db, { documentoId: c1, motivo: 'x', usuarioId: ctx.usuarioId })), /anula la factura/);
  h.tx(db, () => ventas().anularFactura(db, { documentoId: f, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(h.saldoCuenta(db, '1350'), 2000, 'anular la factura devuelve el costo a la cuenta puente');
  assert.equal(doc(db, c1).estado, 'entregado');
  h.tx(db, () => ventas().anularConduce(db, { documentoId: c1, motivo: 'Devuelto', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 98);
  assert.equal(h.saldoCuenta(db, '1350'), 800);
});

test('C conduce: exige cliente y no se factura para otro cliente', () => {
  const { db, ctx, p, cl } = base();
  assert.throws(() => h.tx(db, () => ventas().crearConduce(db, comun(ctx, { lineas: [{ productoId: p, cantidad: 1 }] }))), /cliente/);
  const c = h.tx(db, () => ventas().crearConduce(db, comun(ctx, { clienteId: cl, lineas: [{ productoId: p, cantidad: 1 }] })));
  const otro = h.cliente(db, ctx);
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1, precioUnitario: 590 }], credito(590), { clienteId: otro, conduceIds: [c] }));
});

// --- Pedidos con reserva ---
test('C pedido: reserva existencia, otras ventas no la tocan, facturar y anular la liberan', () => {
  const { db, ctx, p, cl } = base();
  const ped = h.tx(db, () => ventas().crearPedido(db, comun(ctx, { clienteId: cl, lineas: [{ productoId: p, cantidad: 95 }] })));
  const reservado = () => db.prepare('SELECT cantidad_comprometida c FROM existencias WHERE producto_id = ?').get(p).c;
  assert.equal(reservado(), 95);
  assert.equal(h.existencia(db, ctx, p), 100, 'el pedido no mueve inventario');
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 6 }], [{ formaPago: 'efectivo', monto: 3540 }]), /disponible: 5/);
  const f = h.facturar(db, ctx, lineasDe(doc(db, ped)), credito(56050), { clienteId: cl, pedidoId: ped });
  assert.equal(reservado(), 0);
  assert.equal(h.existencia(db, ctx, p), 5);
  h.tx(db, () => ventas().anularFactura(db, { documentoId: f, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(doc(db, ped).estado, 'abierto');
  assert.equal(reservado(), 95, 'anular la factura vuelve a reservar');
  h.tx(db, () => ventas().anularPedido(db, { documentoId: ped, motivo: 'Cancelado', usuarioId: ctx.usuarioId }));
  assert.equal(reservado(), 0);
});

// --- Promociones ---
test('C promociones: se aplica sola y gana la mayor entre promoción y descuento manual', () => {
  const { db, ctx, p } = base();
  const hoy = h.m('inventario').hoyLocal();
  const promo = h.tx(db, () => ventas().guardarPromocion(db, { nombre: 'Promo 10', productoId: p, tipoDescuento: 'porcentaje', valor: 10, fechaInicio: hoy, fechaFin: hoy, usuarioId: ctx.usuarioId }));
  const linea = (extra) => [{ productoId: p, cantidad: 1, ...extra }];
  const f1 = h.facturar(db, ctx, linea({ precioUnitario: 590 }), [{ formaPago: 'efectivo', monto: 531 }]);
  assert.equal(doc(db, f1).lineas[0].promocion_id, promo);
  const f2 = h.facturar(db, ctx, linea({ precioUnitario: 590, descuentoPct: 20 }), [{ formaPago: 'efectivo', monto: 472 }]);
  assert.equal(doc(db, f2).lineas[0].total_linea, 472, 'el manual mayor gana, no se suman');
  assert.equal(doc(db, f2).lineas[0].promocion_id, null);
  h.tx(db, () => ventas().anularFactura(db, { documentoId: f1, motivo: 'Error', usuarioId: ctx.usuarioId }));
  h.tx(db, () => ventas().desactivarPromocion(db, { promocionId: promo, usuarioId: ctx.usuarioId }));
  const f3 = h.facturar(db, ctx, linea({ precioUnitario: 590 }), [{ formaPago: 'efectivo', monto: 590 }]);
  assert.equal(doc(db, f3).lineas[0].total_linea, 590, 'desactivada ya no aplica');
});

// --- Cuentas abiertas ---
test('C cuentas abiertas: agregar, quitar con motivo, cobrar y anular', () => {
  const { db, ctx, p } = base();
  h.tx(db, () => h.m('configuracion').actualizarModulo(db, { clave: 'cuentas_abiertas', activo: true, usuarioId: ctx.usuarioId }));
  const cuenta = h.tx(db, () => ventas().abrirCuenta(db, { nombre: 'Mesa 4', sucursalId: ctx.sucursalId, almacenId: ctx.almacenId, usuarioId: ctx.usuarioId }));
  const cuentaId = typeof cuenta === 'string' ? cuenta : cuenta.id;
  h.tx(db, () => ventas().agregarProductoCuenta(db, { cuentaId, productoId: p, cantidad: 3, usuarioId: ctx.usuarioId }));
  h.tx(db, () => ventas().agregarProductoCuenta(db, { cuentaId, productoId: p, cantidad: 1, nota: 'sin hielo', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 100, 'la cuenta no saca inventario hasta cobrar');
  const c = ventas().obtenerCuentaAbierta(db, cuentaId);
  assert.equal(c.total, 2360);
  h.tx(db, () => ventas().quitarLineaCuenta(db, { lineaId: c.lineas.find((l) => l.nota === 'sin hielo').id, motivo: 'Lo cambió', usuarioId: ctx.usuarioId }));
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 3, precioUnitario: 590 }], [{ formaPago: 'efectivo', monto: 1770 }], { cuentaAbiertaId: cuentaId });
  assert.equal(h.existencia(db, ctx, p), 97);
  assert.equal(ventas().obtenerCuentaAbierta(db, cuentaId).estado, 'facturada');
  h.tx(db, () => ventas().anularFactura(db, { documentoId: f, motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(ventas().obtenerCuentaAbierta(db, cuentaId).estado, 'abierta', 'anular la factura reabre la cuenta');
  h.tx(db, () => ventas().anularCuentaAbierta(db, { cuentaId, motivo: 'Se fueron', usuarioId: ctx.usuarioId }));
  assert.equal(ventas().obtenerCuentaAbierta(db, cuentaId).estado, 'anulada');
  assert.equal(h.existencia(db, ctx, p), 100);
});

test('C cuentas abiertas: con el módulo apagado no se pueden abrir', () => {
  const { db, ctx } = base();
  assert.throws(() => h.tx(db, () => ventas().abrirCuenta(db, { nombre: 'Mesa 1', sucursalId: ctx.sucursalId, almacenId: ctx.almacenId, usuarioId: ctx.usuarioId })), /no está activado|módulo/i);
});
