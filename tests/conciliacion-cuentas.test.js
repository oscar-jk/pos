// E3: conciliación por cuenta bancaria. Cada línea del libro de Bancos (1200) pertenece a una
// cuenta bancaria: con una sola cuenta todo es suyo; con varias, lo asignado va a su cuenta y lo
// que no se sabe de cuál es espera a que se asigne (al emparejarlo o a mano).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { aplicarMigraciones } = require('../main/db/migrations');

const caja = () => h.m('caja');
const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
const id = (r) => (typeof r === 'string' ? r : r.id);

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  h.entrada(db, ctx, p, 50, 40);
  const turno = h.abrirTurno(db, ctx, 5000);
  return { db, ctx, p, turno: id(turno) };
}
const cuenta = (db, nombre) => id(h.tx(db, () => caja().crearCuentaBancaria(db, { nombre, banco: 'Banco', numeroCuenta: nombre })));
const vender = (db, ctx, p, forma, monto) => h.facturar(db, ctx, [{ productoId: p, cantidad: monto / 118 }], [{ formaPago: forma, monto }]);
const conciliar = (db, ctx, cuentaBancariaId, saldo) => id(h.tx(db, () => caja().crearConciliacion(db, {
  cuentaBancariaId, periodoDesde: `${hoy().slice(0, 8)}01`, periodoHasta: hoy(), saldoEstadoCuenta: saldo, usuarioId: ctx.usuarioId,
})));

test('E3: al abrir la segunda cuenta el historial pasa a la primera; los depósitos van a su cuenta', () => {
  const { db, ctx, p, turno } = base();
  const A = cuenta(db, 'Corriente');
  vender(db, ctx, p, 'tarjeta', 236);
  const B = cuenta(db, 'Ahorros');
  assert.equal(caja().saldoLibroBancos(db, hoy(), A), 236, 'lo anterior era de la única cuenta');
  assert.equal(caja().saldoLibroBancos(db, hoy(), B), 0);
  h.tx(db, () => caja().crearTransferenciaCajaBanco(db, { cajaId: ctx.cajaId, turnoCajaId: turno, cuentaBancariaId: B, tipo: 'deposito', monto: 500, usuarioId: ctx.usuarioId }));
  assert.equal(caja().saldoLibroBancos(db, hoy(), B), 500);
  assert.equal(caja().saldoLibroBancos(db, hoy(), A), 236);
  assert.equal(caja().saldoLibroBancos(db, hoy()), h.saldoCuenta(db, '1200'), 'sin indicar cuenta es todo el 1200');
  assert.equal(caja().saldoLibroBancos(db, hoy(), A) + caja().saldoLibroBancos(db, hoy(), B), 736);
});

test('E3: con varias cuentas, lo nuevo sin cuenta no entra en los saldos y se muestra para asignarlo', () => {
  const { db, ctx, p } = base();
  const A = cuenta(db, 'Corriente');
  cuenta(db, 'Ahorros');
  vender(db, ctx, p, 'tarjeta', 354);
  const c = caja().obtenerConciliacion(db, conciliar(db, ctx, A, 0));
  assert.equal(c.resumen.saldoLibros, 0);
  assert.equal(c.resumen.sinCuentaAsignada, 354);
  assert.equal(c.resumen.movimientosSinCuenta, 1);
  assert.equal(c.resumen.depositosEnTransito, 0, 'lo sin cuenta no es tránsito de ninguna');
  assert.equal(c.movimientos.filter((m) => m.sin_cuenta).length, 1);
});

test('E3: cada cuenta se concilia por separado y emparejar una línea sin cuenta se la asigna', () => {
  const { db, ctx, p, turno } = base();
  const A = cuenta(db, 'Corriente');
  const B = cuenta(db, 'Ahorros');
  h.tx(db, () => caja().crearTransferenciaCajaBanco(db, { cajaId: ctx.cajaId, turnoCajaId: turno, cuentaBancariaId: B, tipo: 'deposito', monto: 500, usuarioId: ctx.usuarioId }));
  vender(db, ctx, p, 'tarjeta', 236); // sin cuenta

  // Ahorros: extracto con su depósito; cuadra sin que la venta con tarjeta moleste.
  const concB = conciliar(db, ctx, B, 500);
  h.tx(db, () => caja().agregarPartidas(db, { conciliacionId: concB, usuarioId: ctx.usuarioId, partidas: [{ fecha: hoy(), descripcion: 'Depósito', monto: 500 }] }));
  h.tx(db, () => caja().conciliarAutomaticamente(db, { conciliacionId: concB, usuarioId: ctx.usuarioId }));
  assert.equal(caja().obtenerConciliacion(db, concB).resumen.cuadra, true);
  h.tx(db, () => caja().cerrarConciliacion(db, { conciliacionId: concB, usuarioId: ctx.usuarioId }));

  // Corriente: el extracto trae el cobro con tarjeta; se empareja a mano (el automático no toca lo sin cuenta).
  const concA = conciliar(db, ctx, A, 236);
  h.tx(db, () => caja().agregarPartidas(db, { conciliacionId: concA, usuarioId: ctx.usuarioId, partidas: [{ fecha: hoy(), descripcion: 'Liquidación tarjetas', monto: 236 }] }));
  assert.equal(h.tx(db, () => caja().conciliarAutomaticamente(db, { conciliacionId: concA, usuarioId: ctx.usuarioId })), 0);
  const antes = caja().obtenerConciliacion(db, concA);
  const linea = antes.movimientos.find((m) => m.sin_cuenta);
  h.tx(db, () => caja().conciliarPareja(db, { partidaId: antes.partidas[0].id, asientoDetalleId: linea.asiento_detalle_id, usuarioId: ctx.usuarioId }));
  const despues = caja().obtenerConciliacion(db, concA);
  assert.equal(despues.movimientos.filter((m) => m.sin_cuenta).length, 0);
  assert.equal(despues.resumen.saldoLibros, 236);
  assert.equal(despues.resumen.cuadra, true);
  h.tx(db, () => caja().cerrarConciliacion(db, { conciliacionId: concA, usuarioId: ctx.usuarioId }));
  // La línea ya es de Corriente: no aparece en la conciliación de Ahorros.
  assert.equal(caja().obtenerConciliacion(db, concB).movimientos.some((m) => m.asiento_detalle_id === linea.asiento_detalle_id), false);
});

test('E3: asignar a mano un movimiento en tránsito, con su reversión si el documento se anuló', () => {
  const { db, ctx, p } = base();
  const A = cuenta(db, 'Corriente');
  const B = cuenta(db, 'Ahorros');
  vender(db, ctx, p, 'transferencia', 118);
  const linea = caja().obtenerConciliacion(db, conciliar(db, ctx, B, 0)).movimientos.find((m) => m.sin_cuenta);
  h.tx(db, () => caja().asignarCuentaMovimiento(db, { asientoDetalleId: linea.asiento_detalle_id, cuentaBancariaId: A, usuarioId: ctx.usuarioId }));
  assert.equal(caja().saldoLibroBancos(db, hoy(), A), 118);
  assert.equal(caja().saldoLibroBancos(db, hoy(), B), 0);
  assert.throws(() => h.tx(db, () => caja().asignarCuentaMovimiento(db, { asientoDetalleId: linea.asiento_detalle_id, cuentaBancariaId: B, usuarioId: ctx.usuarioId })), /ya tiene una cuenta/);
  // Una anulación posterior deja una reversión sin cuenta: asignar el original la lleva consigo.
  const g = vender(db, ctx, p, 'transferencia', 236);
  const sin = caja().obtenerConciliacion(db, db.prepare("SELECT id FROM conciliaciones_bancarias WHERE cuenta_bancaria_id = ?").get(B).id).movimientos.find((m) => m.sin_cuenta);
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: g, motivo: 'Error', usuarioId: ctx.usuarioId }));
  h.tx(db, () => caja().asignarCuentaMovimiento(db, { asientoDetalleId: sin.asiento_detalle_id, cuentaBancariaId: A, usuarioId: ctx.usuarioId }));
  assert.equal(caja().saldoLibroBancos(db, hoy(), A), 118, 'original y reversión se netean en Corriente');
  assert.equal(caja().saldoSinCuentaAsignada(db, hoy()), 0);
});

test('E3: el cargo bancario registrado lleva la cuenta de su conciliación', () => {
  const { db, ctx } = base();
  cuenta(db, 'Corriente');
  const B = cuenta(db, 'Ahorros');
  const conc = conciliar(db, ctx, B, -50);
  h.tx(db, () => caja().agregarPartidas(db, { conciliacionId: conc, usuarioId: ctx.usuarioId, partidas: [{ fecha: hoy(), descripcion: 'Comisión', monto: -50 }] }));
  const partida = caja().obtenerConciliacion(db, conc).partidas[0];
  h.tx(db, () => caja().registrarPartidaEnContabilidad(db, { partidaId: partida.id, usuarioId: ctx.usuarioId }));
  assert.equal(caja().saldoLibroBancos(db, hoy(), B), -50);
  assert.equal(caja().saldoLibroBancos(db, hoy(), db.prepare("SELECT id FROM cuentas_bancarias WHERE nombre = 'Corriente'").get().id), 0);
  assert.equal(caja().obtenerConciliacion(db, conc).resumen.cuadra, true);
});

test('migración 014 sobre una base existente: con una cuenta asigna el historial; con varias lo deja sin asignar', () => {
  const { db, ctx, p } = base();
  const A = cuenta(db, 'Corriente');
  vender(db, ctx, p, 'tarjeta', 118);
  const reinstalar = () => {
    db.exec('DROP INDEX IF EXISTS idx_asiento_detalle_cuenta_bancaria; ALTER TABLE asientos_contables_detalle DROP COLUMN cuenta_bancaria_id');
    db.prepare("DELETE FROM migraciones_aplicadas WHERE id = '014_cuenta_bancaria_en_asientos'").run();
    aplicarMigraciones(db);
  };
  reinstalar();
  assert.equal(caja().saldoLibroBancos(db, hoy(), A), 118);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM asientos_contables_detalle WHERE cuenta_bancaria_id IS NULL AND cuenta_id = (SELECT id FROM cuentas_contables WHERE codigo = '1200')").get().n, 0);
  reinstalar();
  aplicarMigraciones(db); // idempotente
  cuenta(db, 'Ahorros');
  db.prepare('UPDATE asientos_contables_detalle SET cuenta_bancaria_id = NULL').run();
  reinstalar();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM asientos_contables_detalle WHERE cuenta_bancaria_id IS NULL AND cuenta_id = (SELECT id FROM cuentas_contables WHERE codigo = '1200')").get().n, 1, 'con dos cuentas no se adivina');
});
