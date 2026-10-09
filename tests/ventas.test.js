const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 10, 50);
  h.abrirTurno(db, ctx);
  return { db, ctx, p };
}

test('venta en efectivo: inventario, caja y asientos cuadran', () => {
  const { db, ctx, p } = base();
  h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 236 }]);
  assert.equal(h.existencia(db, ctx, p), 8);
  assert.equal(h.saldoCuenta(db, '1100'), 236);
  assert.equal(h.saldoCuenta(db, '4100'), -200);
  assert.equal(h.saldoCuenta(db, '2200'), -36);
  assert.equal(h.saldoCuenta(db, '5100'), 100);
  assert.equal(h.saldoCuenta(db, '1300'), 400);
  assert.ok(h.balanceCuadrado(db));
});

test('ITBIS incluido: precio 100 con 18% da base 84.75 e ITBIS 15.25', () => {
  const { calcularLinea } = h.m('ventas');
  const r = calcularLinea({ cantidad: 1, precioUnitario: 100, tasaItbisPct: 0.18 });
  assert.equal(r.baseImponible, 84.75);
  assert.equal(r.itbisMonto, 15.25);
});

test('redondeo acumulado: 7 líneas de 33.33 cuadran contra pagos', () => {
  const { db, ctx } = base();
  const lineas = [];
  for (let i = 0; i < 7; i++) {
    const q = h.producto(db, ctx, { precioDetalle: 33.33 });
    h.entrada(db, ctx, q, 5, 10);
    lineas.push({ productoId: q, cantidad: 1 });
  }
  h.facturar(db, ctx, lineas, [{ formaPago: 'efectivo', monto: 233.31 }]);
  assert.ok(h.balanceCuadrado(db));
});

test('anular venta en efectivo revierte todo', () => {
  const { db, ctx, p } = base();
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 236 }]);
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'error', usuarioId: ctx.usuarioId }));
  assert.equal(h.existencia(db, ctx, p), 10);
  for (const c of ['1100', '4100', '2200', '5100']) assert.equal(h.saldoCuenta(db, c), 0, c);
  assert.equal(h.saldoCuenta(db, '1300'), 500);
});

test('pago con monto negativo debe rechazarse', () => {
  const { db, ctx, p } = base();
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }],
    [{ formaPago: 'efectivo', monto: 218 }, { formaPago: 'tarjeta', monto: -100 }]));
});

test('precioUnitario enviado desde la pantalla no debe saltarse el precio de lista', () => {
  const { db, ctx, p } = base();
  // Un cajero con tope de descuento 10% manda precio 1.00 directo en la línea.
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1, precioUnitario: 1 }], [{ formaPago: 'efectivo', monto: 1 }]));
});

test('la factura registra al usuario de la sesión, no el que manda la pantalla', () => {
  const { db, ctx, p } = base();
  const otro = h.usuarioDeRol(db, 'Cajero');
  // Se llama como lo hace la ventana: por el canal IPC, con el usuarioId de otro.
  const { protegerIpc } = require('../main/ipc/seguro');
  const handlers = {};
  const ipc = protegerIpc({ handle: (c, fn) => { handlers[c] = fn; } });
  h.m('ventas').register(ipc, () => db);
  const fac = handlers['ventas:crearFactura'](null, { modoVenta: 'rapida', sucursalId: ctx.sucursalId, almacenId: ctx.almacenId,
    cajaId: ctx.cajaId, condicionPago: 'contado', nivelPrecio: 'detalle', usuarioId: otro,
    lineas: [{ productoId: p, cantidad: 1 }], pagos: [{ formaPago: 'efectivo', monto: 118 }] });
  const f = fac.id || fac;
  const doc = db.prepare('SELECT usuario_id FROM documentos_venta WHERE id=?').get(f);
  assert.equal(doc.usuario_id, ctx.usuarioId);
});

test('no se puede anular una factura a crédito con cobros aplicados', () => {
  const { db, ctx, p } = base();
  const cl = h.cliente(db, ctx);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'credito', monto: 118 }], { clienteId: cl, condicionPago: 'credito', modoVenta: 'completa' });
  h.tx(db, () => h.m('cxc').crearRecibo(db, { clienteId: cl, formaPago: 'efectivo', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId,
    aplicaciones: [{ documentoVentaId: f, montoAplicado: 50 }] }));
  assert.throws(() => h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'x', usuarioId: ctx.usuarioId })));
});

test('anular en un turno ya cerrado no debe tocar el arqueo cerrado', () => {
  const { db, ctx, p } = base();
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const caja = h.m('caja');
  const turno = caja.obtenerTurnoAbierto(db, ctx.cajaId);
  h.tx(db, () => caja.cerrarTurno(db, { turnoId: turno.id, efectivoContado: 1118 }));
  assert.throws(() => h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'x', usuarioId: ctx.usuarioId })), /Abra un turno/);
  h.abrirTurno(db, ctx, 500);
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'x', usuarioId: ctx.usuarioId }));
  const movsCerrado = db.prepare("SELECT COUNT(*) n FROM movimientos_caja WHERE turno_caja_id=? AND documento_origen_tipo='documentos_venta_anulacion'").get(turno.id).n;
  assert.equal(movsCerrado, 0);
});

test('NCF agotado bloquea con mensaje claro', () => {
  const { db, ctx, p } = base();
  db.prepare("UPDATE tipos_ncf SET secuencia_actual = secuencia_hasta + 1 WHERE codigo='B02'").run();
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]), /NCF/);
});

test('NCF no se consume si la factura falla (transacción)', () => {
  const { db, ctx, p } = base();
  const antes = db.prepare("SELECT secuencia_actual s FROM tipos_ncf WHERE codigo='B02'").get().s;
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 999 }], [{ formaPago: 'efectivo', monto: 999 * 118 }]));
  assert.equal(db.prepare("SELECT secuencia_actual s FROM tipos_ncf WHERE codigo='B02'").get().s, antes);
});

test('cajero no puede exceder 10% de descuento', () => {
  const { db, ctx, p } = base();
  const cajero = h.usuarioDeRol(db, 'Cajero');
  h.loginUsuario(db, cajero);
  // Se loguea el cajero pero la pantalla manda el usuarioId del dueño.
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1, descuentoPct: 20 }], [{ formaPago: 'efectivo', monto: 94.4 }]), /límite/);
});

test('límite de crédito se respeta', () => {
  const { db, ctx, p } = base();
  const cl = h.cliente(db, ctx, { limiteCredito: 100 });
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'credito', monto: 118 }], { clienteId: cl }), /límite/);
});

test('cobro con retenciones: caja recibe solo el neto, 1510/1520 registran lo retenido', () => {
  const { db, ctx, p } = base();
  const cl = h.cliente(db, ctx, { esAgenteRetencion: true, pctRetencionIsr: 2, pctRetencionItbis: 30 });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'credito', monto: 118 }], { clienteId: cl });
  h.tx(db, () => h.m('cxc').crearRecibo(db, { clienteId: cl, formaPago: 'efectivo', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId,
    retencionIsr: 2, retencionItbis: 5.4, aplicaciones: [{ documentoVentaId: f, montoAplicado: 118 }] }));
  assert.equal(h.saldoCuenta(db, '1400'), 0);
  assert.equal(h.saldoCuenta(db, '1510'), 2);
  assert.equal(h.saldoCuenta(db, '1520'), 5.4);
  assert.ok(h.balanceCuadrado(db));
});

test('nota de crédito parcial reingresa y revierte proporcional', () => {
  const { db, ctx, p } = base();
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 4 }], [{ formaPago: 'efectivo', monto: 472 }]);
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id=?').get(f);
  h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'dev', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId,
    lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  assert.equal(h.existencia(db, ctx, p), 7);
  assert.equal(h.saldoCuenta(db, '1300'), 350);
  assert.ok(h.balanceCuadrado(db));
});

// --- B2: pagos válidos desde el inicio ---
test('B2: un pago en cero, negativo o no numérico se rechaza con su propio mensaje', () => {
  const { db, ctx, p } = base();
  const linea = [{ productoId: p, cantidad: 1 }];
  assert.throws(() => h.facturar(db, ctx, linea, [{ formaPago: 'efectivo', monto: 218 }, { formaPago: 'tarjeta', monto: -100 }]), /tarjeta debe ser mayor que cero/);
  assert.throws(() => h.facturar(db, ctx, linea, [{ formaPago: 'efectivo', monto: 118 }, { formaPago: 'tarjeta', monto: 0 }]), /mayor que cero/);
  assert.throws(() => h.facturar(db, ctx, linea, [{ formaPago: 'efectivo', monto: 'abc' }]), /mayor que cero/);
  assert.throws(() => h.facturar(db, ctx, linea, [{ formaPago: 'bitcoin', monto: 118 }]), /Forma de pago no válida/);
  assert.equal(h.existencia(db, ctx, p), 10); // nada se movió
});

// --- B3: la condición de pago la decide el servidor ---
test('B3: una factura a crédito marcada "contado" desde la pantalla entra al saldo del cliente', () => {
  const { db, ctx, p } = base();
  const cl = h.cliente(db, ctx);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'credito', monto: 118 }], { clienteId: cl, condicionPago: 'contado' });
  assert.equal(db.prepare('SELECT condicion_pago c FROM documentos_venta WHERE id = ?').get(f).c, 'credito');
  assert.equal(h.m('cxc').saldoPendienteCliente(db, cl), 118);
  const f2 = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 100 }, { formaPago: 'credito', monto: 136 }], { clienteId: cl, condicionPago: 'contado' });
  assert.equal(db.prepare('SELECT condicion_pago c FROM documentos_venta WHERE id = ?').get(f2).c, 'mixto');
  assert.deepEqual(h.invariantes(db), []);
});
