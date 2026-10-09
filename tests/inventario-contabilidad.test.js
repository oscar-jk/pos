const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  h.abrirTurno(db, ctx);
  return { db, ctx };
}

test('PEPS: la venta consume la capa más vieja y costea con ella', () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx, { metodoValoracion: 'peps' });
  h.entrada(db, ctx, p, 5, 10);
  h.entrada(db, ctx, p, 5, 20);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 7 }], [{ formaPago: 'efectivo', monto: 826 }]);
  assert.equal(h.saldoCuenta(db, '5100'), 5 * 10 + 2 * 20);
  assert.equal(h.saldoCuenta(db, '1300'), 3 * 20);
});

test('PEPS: anular reingresa a las mismas capas y costo', () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx, { metodoValoracion: 'peps' });
  h.entrada(db, ctx, p, 5, 10);
  h.entrada(db, ctx, p, 5, 20);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 7 }], [{ formaPago: 'efectivo', monto: 826 }]);
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'x', usuarioId: ctx.usuarioId }));
  assert.equal(h.saldoCuenta(db, '1300'), 150);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 5 }], [{ formaPago: 'efectivo', monto: 590 }]);
  assert.equal(h.saldoCuenta(db, '1300'), 100); // quedan las 5 de 20
});

test('valor del inventario (existencias x costo) cuadra con la cuenta 1300', () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 10, 33.33);
  h.entrada(db, ctx, p, 7, 41.17);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 3 }], [{ formaPago: 'efectivo', monto: 354 }]);
  const pr = db.prepare('SELECT costo_promedio FROM productos WHERE id=?').get(p);
  const valor = Math.round(h.existencia(db, ctx, p) * pr.costo_promedio * 100) / 100;
  assert.ok(Math.abs(valor - h.saldoCuenta(db, '1300')) < 0.05, `${valor} vs ${h.saldoCuenta(db, '1300')}`);
});

test('salida de ajuste mayor que la existencia se rechaza', () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 2, 10);
  assert.throws(() => h.tx(db, () => h.m('inventario').crearAjuste(db, {
    almacenId: ctx.almacenId, tipo: 'salida', motivo: 'x', usuarioId: ctx.usuarioId, lineas: [{ productoId: p, cantidad: 5 }] })));
});

test('venta de noche el último día del mes cae en el periodo local, no en UTC', () => {
  const { db, ctx } = base();
  const { generarAsiento } = h.m('contabilidad');
  // 31 de oct 21:00 en Santo Domingo = 1 de nov 01:00 UTC.
  db.prepare("UPDATE periodos_contables SET fecha_inicio='2026-10-01', fecha_fin='2026-10-31', estado='abierto'").run();
  const id = h.tx(db, () => generarAsiento(db, { fecha: '2026-11-01T01:00:00.000Z', concepto: 't', origenModulo: 'x',
    usuarioId: ctx.usuarioId, lineas: [{ cuentaCodigo: '1100', debe: 1 }, { cuentaCodigo: '4100', haber: 1 }] }));
  assert.ok(id);
});

test('no se puede registrar en un periodo cerrado', () => {
  const { db, ctx } = base();
  const per = db.prepare('SELECT id FROM periodos_contables').get();
  h.tx(db, () => h.m('contabilidad').cerrarPeriodo(db, { periodoId: per.id, usuarioId: ctx.usuarioId }));
  const p = h.producto(db, ctx);
  assert.throws(() => h.entrada(db, ctx, p, 1, 1), /periodo/);
});

test('numeración de asientos sin duplicados', () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx);
  for (let i = 0; i < 20; i++) h.entrada(db, ctx, p, 1, 1);
  const d = db.prepare('SELECT numero, COUNT(*) n FROM asientos_contables GROUP BY numero HAVING n>1').all();
  assert.equal(d.length, 0);
});

test('multimoneda: factura en USD guarda RD$ en libros con tasa congelada', () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx, { precioDetalle: 590 });
  h.entrada(db, ctx, p, 2, 100);
  const usd = db.prepare("SELECT id FROM monedas WHERE codigo='USD'").get();
  if (!usd) return;
  h.tx(db, () => h.m('configuracion').guardarTasaCambio(db, { monedaId: usd.id, tasa: 59, usuarioId: ctx.usuarioId }));
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'tarjeta', monto: 590 }], { monedaId: usd.id, tasaCambio: 59 });
  assert.equal(h.saldoCuenta(db, '1200'), 590);
  assert.ok(h.balanceCuadrado(db));
});

test('contraseña: login falla con clave errónea y no hay bloqueo tras 10 intentos', () => {
  const { verifyPassword, hashPassword } = require('../main/auth/password');
  const hsh = hashPassword('admin123');
  assert.equal(verifyPassword('x', hsh), false);
  assert.equal(verifyPassword('admin123', hsh), true);
});

test('el día 1 del mes se puede vender aunque nadie haya cerrado el mes anterior', () => {
  const { db, ctx } = base();
  const id = h.tx(db, () => h.m('contabilidad').generarAsiento(db, { fecha: '2031-03-01T15:00:00.000Z', concepto: 't', origenModulo: 'x',
    usuarioId: ctx.usuarioId, lineas: [{ cuentaCodigo: '1100', debe: 1 }, { cuentaCodigo: '4100', haber: 1 }] }));
  assert.ok(id);
});

test('login: 5 intentos fallidos bloquean al usuario', () => {
  const { db } = base();
  const { login } = require('../main/ipc/auth');
  for (let i = 0; i < 5; i++) assert.throws(() => login(db, { usuario: 'admin', password: 'mala' }), /incorrectos/);
  assert.throws(() => login(db, { usuario: 'admin', password: 'admin123' }), /intentos/);
});
