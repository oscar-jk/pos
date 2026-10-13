// C: regresión del 606 (con caja chica y notas B04), conciliación bancaria y cierre/reapertura
// de periodos contables. Las invariantes globales se revisan al final de la suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const compras = () => h.m('compras');
const caja = () => h.m('caja');
const conta = () => h.m('contabilidad');
const hoy = () => h.m('inventario').hoyLocal();
const r2 = (n) => Math.round(n * 100) / 100;

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  h.abrirTurno(db, ctx, 5000);
  const prov = h.tx(db, () => compras().guardarProveedor(db, { nombre: 'Distribuidora', rnc: '101000001', diasCredito: 30 }));
  return { db, ctx, p, prov: typeof prov === 'string' ? prov : prov.id };
}
function comprar(db, ctx, prov, p, cantidad, costo) {
  return h.tx(db, () => compras().crearFacturaCompra(db, {
    proveedorId: prov, almacenId: ctx.almacenId, sucursalId: ctx.sucursalId, usuarioId: ctx.usuarioId, cajaId: ctx.cajaId,
    ncfProveedor: 'B0100000005', lineas: [{ productoId: p, cantidad, costoUnitario: costo }], pagos: [{ formaPago: 'credito', monto: r2(cantidad * costo * 1.18) }],
  }));
}

// --- 606 ---
test('C 606: compras, nota de crédito B04 en línea propia y gasto de caja chica', () => {
  const { db, ctx, p, prov } = base();
  const f = comprar(db, ctx, prov, p, 10, 100);
  const linea = compras().lineasParaNota(db, f)[0];
  h.tx(db, () => compras().crearNotaCompra(db, { tipo: 'nota_credito', tipoAjuste: 'devolucion', facturaId: f, ncfProveedor: 'B0400000003', concepto: 'Dañados', lineas: [{ detalleReferenciaId: linea.id, cantidad: 2 }], usuarioId: ctx.usuarioId }));
  const chica = h.tx(db, () => caja().obtenerOCrearCajaChica(db, { cajaId: ctx.cajaId, fondoAsignado: 5000 }));
  const turno = caja().obtenerTurnoAbierto(db, ctx.cajaId);
  h.tx(db, () => caja().crearGastoCajaChica(db, {
    cajaChicaId: chica.id || chica, turnoCajaId: turno.id, concepto: 'Gasolina', categoria: 'transporte', monto: 590, comprobanteRuta: 'recibo.jpg',
    rncSuplidor: '130000001', ncf: 'B0100000099', tipoBienesServicios: '02', itbisFacturado: 90, claseMonto: 'bienes', usuarioId: ctx.usuarioId,
  }));
  const r = compras().reporte606(db, { periodo: hoy().slice(0, 7) });
  assert.equal(r.registros.length, 3);
  const nc = r.registros.find((x) => String(x.ncf).startsWith('B04'));
  assert.ok(nc, 'la nota de crédito B04 va en su propia línea');
  assert.ok(r.registros.some((x) => x.ncf === 'B0100000099'), 'el gasto de caja chica con NCF entra al 606');
  assert.throws(() => compras().txt606(r), /RNC del negocio/);
  db.prepare("UPDATE parametros_negocio SET valor = '101999999' WHERE clave = 'negocio_rnc'").run();
  const txt = compras().txt606(compras().reporte606(db, { periodo: hoy().slice(0, 7) }));
  assert.match(txt, /^606\|101999999\|\d{6}\|3/);
  assert.throws(() => compras().reporte606(db, { periodo: '2026/10' }), /AAAA-MM/);
});

// --- Conciliación bancaria ---
test('C conciliación: empareja depósitos, registra un cargo bancario, cierra, reabre y deshace', () => {
  const { db, ctx, p } = base();
  h.entrada(db, ctx, p, 10, 50);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'tarjeta', monto: 236 }]);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'transferencia', monto: 118 }]);
  const cuenta = h.tx(db, () => caja().crearCuentaBancaria(db, { nombre: 'Corriente', banco: 'Banco Popular', numeroCuenta: '7890' }));
  const cuentaId = cuenta.id || cuenta;
  const dia = hoy();
  const conc = h.tx(db, () => caja().crearConciliacion(db, { cuentaBancariaId: cuentaId, periodoDesde: dia.slice(0, 8) + '01', periodoHasta: dia, saldoEstadoCuenta: 304, usuarioId: ctx.usuarioId }));
  const concId = conc.id || conc;
  h.tx(db, () => caja().agregarPartidas(db, { conciliacionId: concId, usuarioId: ctx.usuarioId, partidas: [
    { fecha: dia, descripcion: 'Depósito tarjetas', monto: 236 },
    { fecha: dia, descripcion: 'Transferencia recibida', monto: 118 },
    { fecha: dia, descripcion: 'Comisión bancaria', monto: -50 },
  ] }));
  h.tx(db, () => caja().conciliarAutomaticamente(db, { conciliacionId: concId, usuarioId: ctx.usuarioId }));
  assert.throws(() => h.tx(db, () => caja().cerrarConciliacion(db, { conciliacionId: concId, usuarioId: ctx.usuarioId })), /sin conciliar/);
  const cargo = caja().obtenerConciliacion(db, concId).partidas.find((x) => x.monto === -50);
  h.tx(db, () => caja().registrarPartidaEnContabilidad(db, { partidaId: cargo.id, usuarioId: ctx.usuarioId }));
  assert.equal(h.saldoCuenta(db, '1200'), 304);
  h.tx(db, () => caja().cerrarConciliacion(db, { conciliacionId: concId, usuarioId: ctx.usuarioId }));
  assert.equal(caja().obtenerConciliacion(db, concId).conciliacion.estado, 'conciliada');
  h.tx(db, () => caja().reabrirConciliacion(db, { conciliacionId: concId, usuarioId: ctx.usuarioId }));
  h.tx(db, () => caja().deshacerConciliacionPartida(db, { partidaId: cargo.id, usuarioId: ctx.usuarioId }));
  assert.equal(h.saldoCuenta(db, '1200'), 354, 'deshacer revierte el cargo con asiento espejo');
});

// --- Periodos contables ---
test('C periodo: cerrado no acepta movimientos; reabierto vuelve a aceptar; queda en la bitácora', () => {
  const { db, ctx, p } = base();
  h.entrada(db, ctx, p, 10, 50);
  const actual = conta().listarPeriodos(db).find((x) => x.fecha_inicio <= hoy() && x.fecha_fin >= hoy());
  assert.ok(actual && actual.estado === 'abierto');
  h.tx(db, () => conta().cerrarPeriodo(db, { periodoId: actual.id, usuarioId: ctx.usuarioId }));
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]), /periodo contable abierto/);
  assert.equal(h.existencia(db, ctx, p), 10, 'la venta rechazada no movió inventario');
  h.tx(db, () => conta().reabrirPeriodo(db, { periodoId: actual.id, usuarioId: ctx.usuarioId }));
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const acciones = db.prepare("SELECT accion FROM bitacora_auditoria WHERE entidad = 'periodos_contables' ORDER BY rowid").all().map((x) => x.accion);
  assert.deepEqual(acciones.slice(-2), ['cerrar', 'reabrir']);
});

test('C periodo: el cajero no puede cerrar ni reabrir', () => {
  const { db } = base();
  const actual = conta().listarPeriodos(db)[0];
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => h.tx(db, () => conta().cerrarPeriodo(db, { periodoId: actual.id })), /permiso/);
});
