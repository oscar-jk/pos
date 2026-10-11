// Proyección de cobros (CxC), proyección de pagos (CxP) y flujo de caja diario/semanal.
// Solo leen: las proyecciones agrupan lo pendiente por su fecha de vencimiento y el flujo suma
// los movimientos de efectivo de todas las cajas. Días locales (RD, UTC-4).
const session = require('../auth/session');
const cxc = require('./cxc');
const cxp = require('./cxp');

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const DESFASE_MS = -4 * 3600 * 1000;

// Instante UTC o fecha → "AAAA-MM-DD" local.
function diaLocal(valor) {
  const s = String(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date(new Date(valor).getTime() + DESFASE_MS).toISOString().slice(0, 10);
}

const sumarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const hoyLocal = () => diaLocal(new Date());

const LARGO_PERIODO = { semana: 7, mes: 30 };

function periodosDesde(hoy, granularidad, cantidad) {
  const largo = LARGO_PERIODO[granularidad];
  if (!largo) throw new Error('La agrupación debe ser semana o mes');
  const n = Math.min(Math.max(parseInt(cantidad, 10) || 8, 1), 52);
  const lista = [{ clave: 'vencido', etiqueta: 'Ya vencido', desde: null, hasta: sumarDias(hoy, -1), monto: 0, documentos: 0 }];
  for (let i = 0; i < n; i += 1) {
    const desde = sumarDias(hoy, i * largo);
    lista.push({ clave: `p${i}`, etiqueta: i === 0 ? `Próximos ${largo} días` : `Días ${i * largo + 1} a ${(i + 1) * largo}`, desde, hasta: sumarDias(desde, largo - 1), monto: 0, documentos: 0 });
  }
  lista.push({ clave: 'despues', etiqueta: 'Más adelante', desde: sumarDias(hoy, n * largo), hasta: null, monto: 0, documentos: 0 });
  return lista;
}

function ubicar(periodos, dia) {
  return periodos.find((p) => (p.desde === null || dia >= p.desde) && (p.hasta === null || dia <= p.hasta));
}

function agregar(periodos, dia, monto) {
  const p = ubicar(periodos, dia);
  p.monto = redondear(p.monto + monto);
  p.documentos += 1;
}

function resumir(periodos) {
  const total = redondear(periodos.reduce((a, p) => a + p.monto, 0));
  return { periodos, total, vencido: periodos[0].monto };
}

// Cobros esperados: saldo pendiente de cada factura a crédito (y notas de débito) en su fecha
// de vencimiento = fecha de la factura + días de crédito del cliente.
function proyeccionCobros(db, { agrupar = 'semana', periodos = 8 } = {}) {
  session.requerirPermiso('cxc.reportes.ver');
  const hoy = hoyLocal();
  const lista = periodosDesde(hoy, agrupar, periodos);
  for (const c of db.prepare('SELECT id, dias_credito FROM clientes WHERE deleted_at IS NULL').all()) {
    for (const f of cxc.facturasAbiertasCliente(db, c.id)) {
      agregar(lista, sumarDias(diaLocal(f.fecha), c.dias_credito || 0), f.saldo_pendiente);
    }
  }
  return resumir(lista);
}

// Pagos esperados: saldo pendiente de cada factura de compra en su vencimiento, más los
// cheques posdatados pendientes el día de su fecha (el dinero sale del banco ese día).
function proyeccionPagos(db, { agrupar = 'semana', periodos = 8 } = {}) {
  session.requerirPermiso('cxp.reportes.ver');
  const hoy = hoyLocal();
  const lista = periodosDesde(hoy, agrupar, periodos);
  for (const p of db.prepare('SELECT id FROM proveedores WHERE deleted_at IS NULL').all()) {
    for (const f of cxp.facturasAbiertasProveedor(db, p.id)) {
      agregar(lista, f.fecha_vencimiento ? diaLocal(f.fecha_vencimiento) : diaLocal(f.fecha), f.saldo_pendiente);
    }
  }
  for (const c of cxp.chequesPosdatadosPendientes(db)) {
    if (c.fecha_cheque) agregar(lista, diaLocal(c.fecha_cheque), c.monto_total);
  }
  return resumir(lista);
}

// Entradas y salidas de efectivo de todas las cajas (o de una), por día o por semana
// (lunes a domingo), con el neto y el acumulado del rango.
function flujoDeCaja(db, { desde, hasta, agrupar = 'dia', cajaId } = {}) {
  session.requerirAlgunPermiso('caja.cierre', 'contabilidad.ver', 'cxc.reportes.ver');
  const fin = hasta ? diaLocal(hasta) : hoyLocal();
  const inicio = desde ? diaLocal(desde) : sumarDias(fin, -29);
  if (inicio > fin) throw new Error('La fecha inicial no puede ser posterior a la final');
  if (!['dia', 'semana'].includes(agrupar)) throw new Error('La agrupación debe ser día o semana');
  const params = [new Date(Date.parse(`${inicio}T00:00:00-04:00`)).toISOString(), new Date(Date.parse(`${fin}T23:59:59.999-04:00`)).toISOString()];
  if (cajaId) params.push(cajaId);
  const movimientos = db
    .prepare(
      `SELECT m.created_at, m.monto, m.tipo FROM movimientos_caja m JOIN turnos_caja t ON t.id = m.turno_caja_id
       WHERE m.deleted_at IS NULL AND m.created_at >= ? AND m.created_at <= ? ${cajaId ? 'AND t.caja_id = ?' : ''}`
    )
    .all(...params);
  const lunes = (dia) => {
    const d = new Date(`${dia}T12:00:00Z`);
    return sumarDias(dia, -((d.getUTCDay() + 6) % 7));
  };
  const grupos = new Map();
  for (const m of movimientos) {
    const dia = diaLocal(m.created_at);
    const clave = agrupar === 'semana' ? lunes(dia) : dia;
    const g = grupos.get(clave) || { periodo: clave, entradas: 0, salidas: 0, ventas_efectivo: 0 };
    if (m.monto >= 0) g.entradas += m.monto; else g.salidas += -m.monto;
    if (m.tipo === 'venta_efectivo') g.ventas_efectivo += m.monto;
    grupos.set(clave, g);
  }
  let acumulado = 0;
  const filas = [...grupos.values()].sort((a, b) => (a.periodo < b.periodo ? -1 : 1)).map((g) => {
    const neto = g.entradas - g.salidas;
    acumulado += neto;
    return { periodo: g.periodo, entradas: redondear(g.entradas), salidas: redondear(g.salidas), neto: redondear(neto), acumulado: redondear(acumulado), ventas_efectivo: redondear(g.ventas_efectivo) };
  });
  const entradas = redondear(filas.reduce((a, f) => a + f.entradas, 0));
  const salidas = redondear(filas.reduce((a, f) => a + f.salidas, 0));
  return { desde: inicio, hasta: fin, agrupar, filas, entradas, salidas, neto: redondear(entradas - salidas), dias: diasEntre(inicio, fin) + 1 };
}

function register(ipcMain, getDb) {
  ipcMain.handle('proyecciones:cobros', (event, filtros) => proyeccionCobros(getDb(), filtros || {}));
  ipcMain.handle('proyecciones:pagos', (event, filtros) => proyeccionPagos(getDb(), filtros || {}));
  ipcMain.handle('proyecciones:flujoCaja', (event, filtros) => flujoDeCaja(getDb(), filtros || {}));
}

module.exports = { register, proyeccionCobros, proyeccionPagos, flujoDeCaja };
