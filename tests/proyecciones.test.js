// Proyección de cobros y pagos, y flujo de caja diario/semanal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const proy = require('../main/ipc/proyecciones');

const dia = (n) => new Date(Date.now() - 4 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const instante = (n) => new Date(Date.parse(`${dia(n)}T15:00:00Z`)).toISOString();

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 1180 });
  h.entrada(db, ctx, p, 50, 300);
  h.abrirTurno(db, ctx, 0);
  return { db, ctx, p };
}
const porClave = (r) => Object.fromEntries(r.periodos.map((x) => [x.clave, x]));

test('proyección de cobros: vencido, por semana y más adelante según los días de crédito', () => {
  const { db, ctx, p } = base();
  const cliente = h.cliente(db, ctx, { diasCredito: 30 });
  const credito = (n) => h.facturar(db, ctx, [{ productoId: p, cantidad: n }], [{ formaPago: 'credito', monto: 1180 * n }], { clienteId: cliente });
  const vieja = credito(1);                // vence hace 10 días
  db.prepare('UPDATE documentos_venta SET fecha = ? WHERE id = ?').run(instante(-40), vieja);
  credito(2);                              // vence en 30 días → semana 5 (días 29 a 35)
  const r = proy.proyeccionCobros(db, { agrupar: 'semana', periodos: 8 });
  const k = porClave(r);
  assert.equal(k.vencido.monto, 1180);
  assert.equal(k.p4.monto, 2360);
  assert.equal(k.p4.etiqueta, 'Días 29 a 35');
  assert.equal(r.total, 3540);
  assert.equal(proy.proyeccionCobros(db, { agrupar: 'semana', periodos: 2 }).periodos.find((x) => x.clave === 'despues').monto, 2360);
  assert.equal(proy.proyeccionCobros(db, { agrupar: 'mes', periodos: 3 }).periodos.find((x) => x.clave === 'p1').monto, 2360, 'el día 30 abre el segundo bloque de 30 días');
});

test('proyección de cobros: lo cobrado ya no cuenta', () => {
  const { db, ctx, p } = base();
  const cliente = h.cliente(db, ctx, { diasCredito: 15 });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'credito', monto: 2360 }], { clienteId: cliente });
  h.tx(db, () => h.m('cxc').crearRecibo(db, { clienteId: cliente, formaPago: 'efectivo', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, aplicaciones: [{ documentoVentaId: f, montoAplicado: 1000 }] }));
  assert.equal(proy.proyeccionCobros(db, { agrupar: 'semana' }).total, 1360);
});

test('proyección de pagos: facturas de compra por su vencimiento y cheques posdatados el día del cheque', () => {
  const { db, ctx, p } = base();
  const prov = h.tx(db, () => h.m('compras').guardarProveedor(db, { nombre: 'Distribuidora', rnc: '101000001', diasCredito: 20 }));
  const provId = typeof prov === 'string' ? prov : prov.id;
  const comprar = (cant) => h.tx(db, () => h.m('compras').crearFacturaCompra(db, {
    proveedorId: provId, almacenId: ctx.almacenId, sucursalId: ctx.sucursalId, usuarioId: ctx.usuarioId, cajaId: ctx.cajaId, ncfProveedor: 'B0100000001',
    lineas: [{ productoId: p, cantidad: cant, costoUnitario: 100 }], pagos: [{ formaPago: 'credito', monto: cant * 118 }],
  }));
  const f1 = comprar(10);
  comprar(5);
  h.tx(db, () => h.m('cxp').crearPago(db, {
    proveedorId: provId, formaPago: 'cheque', numeroCheque: '1', bancoCheque: 'B', fechaCheque: dia(10),
    aplicaciones: [{ documentoCompraId: f1, montoAplicado: 1180 }], cajaId: ctx.cajaId, usuarioId: ctx.usuarioId,
  }));
  const r = proy.proyeccionPagos(db, { agrupar: 'semana', periodos: 8 });
  const k = porClave(r);
  assert.equal(k.p1.monto, 1180, 'el cheque sale el día 10 (semana 2: días 8 a 14)');
  assert.equal(k.p2.monto, 590, 'la factura de 5 vence a los 20 días (semana 3: días 15 a 21)');
  assert.equal(r.total, 1770);
});

test('flujo de caja: entradas, salidas y acumulado por día y por semana, de todas las cajas', () => {
  const { db, ctx, p } = base();
  h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 2360 }]);
  const turno = db.prepare("SELECT id FROM turnos_caja WHERE estado = 'abierto'").get().id;
  h.tx(db, () => h.m('caja').registrarMovimientoManual(db, { turnoCajaId: turno, tipo: 'salida_manual', concepto: 'Compra de hielo', monto: 160, usuarioId: ctx.usuarioId }));
  const f = proy.flujoDeCaja(db, { desde: dia(-2), hasta: dia(0) });
  assert.equal(f.filas.length, 1);
  assert.equal(f.filas[0].periodo, dia(0));
  assert.equal(f.entradas, 2360);
  assert.equal(f.salidas, 160);
  assert.equal(f.filas[0].ventas_efectivo, 2360);
  assert.equal(f.filas[0].acumulado, f.neto);
  // Un movimiento de hace 3 días suma otra fila y el acumulado corre.
  db.prepare("INSERT INTO movimientos_caja (id, turno_caja_id, tipo, concepto, monto, usuario_id, created_at) VALUES ('mov-x', ?, 'salida_manual', 'Pasaje', -100, ?, ?)").run(turno, ctx.usuarioId, instante(-3));
  const dias = proy.flujoDeCaja(db, { desde: dia(-5), hasta: dia(0), agrupar: 'dia' });
  assert.equal(dias.filas[0].periodo, dia(-3));
  assert.equal(dias.filas[0].acumulado, -100);
  assert.equal(dias.filas[dias.filas.length - 1].acumulado, dias.neto);
  const semanas = proy.flujoDeCaja(db, { desde: dia(-14), hasta: dia(0), agrupar: 'semana' });
  assert.ok(semanas.filas.every((x) => new Date(`${x.periodo}T12:00:00Z`).getUTCDay() === 1), 'las semanas empiezan en lunes');
  assert.equal(semanas.neto, dias.neto);
  assert.throws(() => proy.flujoDeCaja(db, { desde: dia(0), hasta: dia(-5) }), /posterior/);
});

test('las proyecciones exigen el permiso de reportes del módulo', () => {
  const { db } = base();
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => proy.proyeccionPagos(db, {}), /permiso/i);
  assert.throws(() => proy.proyeccionCobros(db, {}), /permiso/i);
});
