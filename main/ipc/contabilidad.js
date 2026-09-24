const crypto = require('node:crypto');
const session = require('../auth/session');

let configuracion; // require perezoso para evitar un ciclo si configuracion.js llegara a necesitar contabilidad.js
function auditoria() {
  if (!configuracion) configuracion = require('./configuracion');
  return configuracion;
}

function redondear(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function periodoAbiertoParaFecha(db, fechaIso) {
  const fecha = fechaIso.slice(0, 10);
  return db
    .prepare("SELECT * FROM periodos_contables WHERE estado = 'abierto' AND fecha_inicio <= ? AND fecha_fin >= ? LIMIT 1")
    .get(fecha, fecha);
}

function cuentaPorCodigo(db, codigo) {
  const cuenta = db.prepare('SELECT id FROM cuentas_contables WHERE codigo = ? AND deleted_at IS NULL').get(codigo);
  if (!cuenta) throw new Error(`No existe la cuenta contable ${codigo} en el catálogo`);
  return cuenta.id;
}

// lineas: [{ cuentaCodigo, debe, haber, descripcion }]. Debe llamarse dentro de una transacción.
// Lanza un error si el asiento no cuadra (regla de partida doble) o si no hay periodo abierto
// para la fecha — esto es lo que hace que el cierre de periodo bloquee nuevas operaciones en
// todos los módulos, sin que cada uno tenga que revisarlo por su cuenta.
function generarAsiento(db, { fecha, concepto, origenModulo, origenDocumentoTipo, origenDocumentoId, usuarioId, lineas, esManual = false }) {
  // Los asientos automáticos ya quedaron autorizados por el permiso de la operación que los
  // origina (p.ej. 'ventas.factura.crear'); solo los manuales exigen su propio permiso aquí.
  if (esManual) session.requerirPermiso('contabilidad.asiento_manual.crear');

  const totalDebe = redondear(lineas.reduce((acc, l) => acc + (l.debe || 0), 0));
  const totalHaber = redondear(lineas.reduce((acc, l) => acc + (l.haber || 0), 0));
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    throw new Error(`Asiento contable descuadrado: debe ${totalDebe} vs haber ${totalHaber}`);
  }
  if (totalDebe === 0) throw new Error('El asiento no puede estar vacío');

  const periodo = periodoAbiertoParaFecha(db, fecha);
  if (!periodo) throw new Error('No hay un periodo contable abierto para la fecha de esta operación. Verifique el cierre de periodos en Contabilidad.');

  const asientoId = crypto.randomUUID();
  const { maximo } = db.prepare("SELECT MAX(CAST(SUBSTR(numero, 3) AS INTEGER)) AS maximo FROM asientos_contables").get();
  const numero = `A-${String((maximo || 0) + 1).padStart(6, '0')}`;
  db.prepare(
    `INSERT INTO asientos_contables
       (id, numero, fecha, concepto, periodo_id, origen_modulo, origen_documento_tipo,
        origen_documento_id, es_manual, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(asientoId, numero, fecha, concepto, periodo.id, origenModulo, origenDocumentoTipo || null, origenDocumentoId || null, esManual ? 1 : 0, usuarioId);

  const insertDetalle = db.prepare(
    `INSERT INTO asientos_contables_detalle (id, asiento_id, cuenta_id, debe, haber, descripcion)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const linea of lineas) {
    if (!linea.debe && !linea.haber) continue;
    insertDetalle.run(
      crypto.randomUUID(), asientoId, cuentaPorCodigo(db, linea.cuentaCodigo),
      linea.debe || 0, linea.haber || 0, linea.descripcion || null
    );
  }

  return asientoId;
}

function anularAsiento(db, { asientoId, motivo, usuarioId }) {
  session.requerirPermiso('contabilidad.asiento_manual.crear');
  const asiento = db.prepare('SELECT * FROM asientos_contables WHERE id = ?').get(asientoId);
  if (!asiento) throw new Error('Asiento no encontrado');
  if (!asiento.es_manual) throw new Error('Solo se pueden anular asientos manuales; los automáticos se anulan revirtiendo la operación que los originó');
  if (asiento.estado === 'anulado') throw new Error('El asiento ya está anulado');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE asientos_contables SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, asientoId);

  const detalle = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asientoId);
  const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
  const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
  generarAsiento(db, {
    fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'contabilidad',
    origenDocumentoTipo: 'asientos_contables_anulacion', origenDocumentoId: asientoId, usuarioId, esManual: true,
    lineas: detalle.map((d) => ({ cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
  });

  auditoria().registrarAuditoria(db, {
    usuarioId, modulo: 'contabilidad', entidad: 'asientos_contables', entidadId: asientoId, accion: 'anular', detalle: { numero: asiento.numero, motivo },
  });
}

// =========================================================================
// Catálogo de cuentas
// =========================================================================

function listarCuentas(db) {
  return db.prepare('SELECT * FROM cuentas_contables WHERE deleted_at IS NULL ORDER BY codigo').all();
}

function crearCuenta(db, { codigo, nombre, tipo, cuentaPadreId, esMovimiento }) {
  if (!codigo || !nombre || !tipo) throw new Error('Código, nombre y tipo son obligatorios');
  const existe = db.prepare('SELECT 1 FROM cuentas_contables WHERE codigo = ? AND deleted_at IS NULL').get(codigo);
  if (existe) throw new Error(`Ya existe una cuenta con el código ${codigo}`);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO cuentas_contables (id, codigo, nombre, tipo, cuenta_padre_id, es_movimiento) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, codigo, nombre, tipo, cuentaPadreId || null, esMovimiento === false ? 0 : 1);
  return id;
}

function actualizarCuenta(db, cuentaId, { nombre, cuentaPadreId, esMovimiento, activo }) {
  db.prepare(
    `UPDATE cuentas_contables SET nombre = ?, cuenta_padre_id = ?, es_movimiento = ?, activo = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(nombre, cuentaPadreId || null, esMovimiento === false ? 0 : 1, activo === false ? 0 : 1, cuentaId);
}

// =========================================================================
// Libro diario y libro mayor
// =========================================================================

function listarAsientos(db, { desde, hasta, origenModulo, limite = 100 } = {}) {
  const condiciones = [];
  const params = [];
  if (desde) { condiciones.push('a.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('a.fecha <= ?'); params.push(hasta); }
  if (origenModulo) { condiciones.push('a.origen_modulo = ?'); params.push(origenModulo); }
  params.push(limite);

  const asientos = db
    .prepare(
      `SELECT a.*, u.nombre_completo AS usuario_nombre FROM asientos_contables a LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY a.fecha DESC, a.numero DESC LIMIT ?`
    )
    .all(...params);

  const detalleStmt = db.prepare(
    `SELECT d.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre FROM asientos_contables_detalle d
     JOIN cuentas_contables c ON c.id = d.cuenta_id WHERE d.asiento_id = ?`
  );
  return asientos.map((a) => ({ ...a, lineas: detalleStmt.all(a.id) }));
}

function libroMayor(db, { cuentaId, desde, hasta }) {
  const condiciones = ['d.cuenta_id = ?', "a.estado = 'confirmado'"];
  const params = [cuentaId];
  if (desde) { condiciones.push('a.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('a.fecha <= ?'); params.push(hasta); }

  const movimientos = db
    .prepare(
      `SELECT a.fecha, a.numero, a.concepto, a.origen_modulo, d.debe, d.haber, d.descripcion
       FROM asientos_contables_detalle d JOIN asientos_contables a ON a.id = d.asiento_id
       WHERE ${condiciones.join(' AND ')} ORDER BY a.fecha ASC, a.numero ASC`
    )
    .all(...params);

  const cuenta = db.prepare('SELECT * FROM cuentas_contables WHERE id = ?').get(cuentaId);
  const naturalezaDeudora = ['activo', 'costo', 'gasto'].includes(cuenta.tipo);
  let saldo = 0;
  const conSaldo = movimientos.map((m) => {
    saldo += naturalezaDeudora ? (m.debe - m.haber) : (m.haber - m.debe);
    return { ...m, saldo_acumulado: redondear(saldo) };
  });
  return { cuenta, movimientos: conSaldo, saldoFinal: redondear(saldo) };
}

// =========================================================================
// Balance de comprobación y estados financieros
// =========================================================================

function balanceComprobacion(db, { desde, hasta } = {}) {
  const condiciones = ["a.estado = 'confirmado'"];
  const params = [];
  if (desde) { condiciones.push('a.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('a.fecha <= ?'); params.push(hasta); }

  const filas = db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre, c.tipo, COALESCE(SUM(d.debe),0) AS total_debe, COALESCE(SUM(d.haber),0) AS total_haber
       FROM cuentas_contables c
       LEFT JOIN asientos_contables_detalle d ON d.cuenta_id = c.id
       LEFT JOIN asientos_contables a ON a.id = d.asiento_id AND ${condiciones.join(' AND ')}
       WHERE c.deleted_at IS NULL AND c.es_movimiento = 1
       GROUP BY c.id HAVING total_debe > 0 OR total_haber > 0
       ORDER BY c.codigo`
    )
    .all(...params);

  return filas.map((f) => {
    const naturalezaDeudora = ['activo', 'costo', 'gasto'].includes(f.tipo);
    const saldo = naturalezaDeudora ? f.total_debe - f.total_haber : f.total_haber - f.total_debe;
    return { ...f, saldo: redondear(saldo) };
  });
}

function estadoResultados(db, { desde, hasta }) {
  const balance = balanceComprobacion(db, { desde, hasta });
  const ingresos = balance.filter((c) => c.tipo === 'ingreso');
  const costos = balance.filter((c) => c.tipo === 'costo');
  const gastos = balance.filter((c) => c.tipo === 'gasto');
  const totalIngresos = redondear(ingresos.reduce((acc, c) => acc + c.saldo, 0));
  const totalCostos = redondear(costos.reduce((acc, c) => acc + c.saldo, 0));
  const totalGastos = redondear(gastos.reduce((acc, c) => acc + c.saldo, 0));
  const utilidadBruta = redondear(totalIngresos - totalCostos);
  const utilidadNeta = redondear(utilidadBruta - totalGastos);
  return { ingresos, costos, gastos, totalIngresos, totalCostos, totalGastos, utilidadBruta, utilidadNeta };
}

function balanceGeneral(db, { hasta }) {
  const balance = balanceComprobacion(db, { hasta });
  const activos = balance.filter((c) => c.tipo === 'activo');
  const pasivos = balance.filter((c) => c.tipo === 'pasivo');
  const patrimonio = balance.filter((c) => c.tipo === 'patrimonio');
  const totalActivo = redondear(activos.reduce((acc, c) => acc + c.saldo, 0));
  const totalPasivo = redondear(pasivos.reduce((acc, c) => acc + c.saldo, 0));
  const totalPatrimonioRegistrado = redondear(patrimonio.reduce((acc, c) => acc + c.saldo, 0));

  // La utilidad acumulada (ingresos - costos - gastos hasta la fecha de corte) se suma al
  // patrimonio para que el balance cuadre, tal como exige la ecuación contable, sin que el
  // usuario tenga que cerrar el periodo formalmente para verla reflejada.
  const resultados = estadoResultados(db, { hasta });
  const totalPatrimonio = redondear(totalPatrimonioRegistrado + resultados.utilidadNeta);

  return {
    activos, pasivos, patrimonio, totalActivo, totalPasivo, totalPatrimonioRegistrado,
    utilidadDelPeriodo: resultados.utilidadNeta, totalPatrimonio,
    cuadra: Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) < 0.01,
  };
}

// =========================================================================
// Periodos contables
// =========================================================================

function listarPeriodos(db) {
  return db.prepare('SELECT * FROM periodos_contables ORDER BY fecha_inicio DESC').all();
}

function crearPeriodoSiguiente(db, periodoAnterior) {
  // Las fechas se guardan como 'YYYY-MM-DD'. Se parsean y recomponen en UTC explícitamente
  // (Date.UTC / getUTC*) para no arrastrar el desfase de huso horario que introduce
  // `new Date('YYYY-MM-DD')` (se interpreta en UTC) combinado con getters/setters locales.
  const [anioFin, mesFin, diaFin] = periodoAnterior.fecha_fin.split('-').map(Number);
  const finAnteriorUtc = Date.UTC(anioFin, mesFin - 1, diaFin);
  const inicioNuevoUtc = finAnteriorUtc + 24 * 60 * 60 * 1000;
  const inicioNuevo = new Date(inicioNuevoUtc);
  const anioNuevo = inicioNuevo.getUTCFullYear();
  const mesNuevo = inicioNuevo.getUTCMonth(); // 0-indexado, mes del nuevo periodo
  const finNuevo = new Date(Date.UTC(anioNuevo, mesNuevo + 1, 0));
  const nombre = `${anioNuevo}-${String(mesNuevo + 1).padStart(2, '0')}`;

  const yaExiste = db.prepare('SELECT 1 FROM periodos_contables WHERE nombre = ?').get(nombre);
  if (yaExiste) return;

  db.prepare(
    "INSERT INTO periodos_contables (id, nombre, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?, 'abierto')"
  ).run(crypto.randomUUID(), nombre, inicioNuevo.toISOString().slice(0, 10), finNuevo.toISOString().slice(0, 10));
}

function cerrarPeriodo(db, { periodoId, usuarioId }) {
  session.requerirPermiso('contabilidad.periodo.cerrar');
  const periodo = db.prepare('SELECT * FROM periodos_contables WHERE id = ?').get(periodoId);
  if (!periodo) throw new Error('Periodo no encontrado');
  if (periodo.estado === 'cerrado') throw new Error('El periodo ya está cerrado');

  db.prepare(
    `UPDATE periodos_contables SET estado = 'cerrado', fecha_cierre = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       usuario_cierre_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(usuarioId, periodoId);

  // Asegura que exista un periodo abierto después de este, para que la operación del negocio
  // no se detenga (generarAsiento exige un periodo abierto para la fecha de cada operación).
  crearPeriodoSiguiente(db, periodo);

  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'contabilidad', entidad: 'periodos_contables', entidadId: periodoId, accion: 'cerrar', detalle: { nombre: periodo.nombre } });
}

// Reabrir requiere "permiso elevado" según la especificación; por ahora no hay sistema de
// login/roles activo para aplicarlo en tiempo de ejecución, así que queda disponible aquí
// sin más restricción que la del permiso `contabilidad.periodo.reabrir` ya definido en el
// catálogo de roles, a la espera de que exista una sesión de usuario real que lo exija.
function reabrirPeriodo(db, { periodoId, usuarioId }) {
  session.requerirPermiso('contabilidad.periodo.reabrir');
  const periodo = db.prepare('SELECT * FROM periodos_contables WHERE id = ?').get(periodoId);
  if (!periodo) throw new Error('Periodo no encontrado');
  if (periodo.estado === 'abierto') throw new Error('El periodo ya está abierto');

  db.prepare(
    `UPDATE periodos_contables SET estado = 'abierto', fecha_cierre = NULL, usuario_cierre_id = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(periodoId);

  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'contabilidad', entidad: 'periodos_contables', entidadId: periodoId, accion: 'reabrir', detalle: { nombre: periodo.nombre } });
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('contabilidad:cuentas', () => listarCuentas(getDb()));
  ipcMain.handle('contabilidad:crearCuenta', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearCuenta(db, payload))();
  });
  ipcMain.handle('contabilidad:actualizarCuenta', (event, { cuentaId, payload }) => {
    const db = getDb();
    return db.transaction(() => actualizarCuenta(db, cuentaId, payload))();
  });

  ipcMain.handle('contabilidad:listarAsientos', (event, filtros) => listarAsientos(getDb(), filtros || {}));
  ipcMain.handle('contabilidad:libroMayor', (event, filtros) => libroMayor(getDb(), filtros));
  ipcMain.handle('contabilidad:balanceComprobacion', (event, filtros) => balanceComprobacion(getDb(), filtros || {}));
  ipcMain.handle('contabilidad:estadoResultados', (event, filtros) => estadoResultados(getDb(), filtros || {}));
  ipcMain.handle('contabilidad:balanceGeneral', (event, filtros) => balanceGeneral(getDb(), filtros || {}));

  ipcMain.handle('contabilidad:crearAsientoManual', (event, payload) => {
    const db = getDb();
    return db.transaction(() => generarAsiento(db, { ...payload, esManual: true }))();
  });
  ipcMain.handle('contabilidad:anularAsiento', (event, payload) => {
    const db = getDb();
    return db.transaction(() => anularAsiento(db, payload))();
  });

  ipcMain.handle('contabilidad:listarPeriodos', () => listarPeriodos(getDb()));
  ipcMain.handle('contabilidad:cerrarPeriodo', (event, payload) => {
    const db = getDb();
    return db.transaction(() => cerrarPeriodo(db, payload))();
  });
  ipcMain.handle('contabilidad:reabrirPeriodo', (event, payload) => {
    const db = getDb();
    return db.transaction(() => reabrirPeriodo(db, payload))();
  });
}

module.exports = {
  register, generarAsiento, anularAsiento, cuentaPorCodigo, listarCuentas, crearCuenta, actualizarCuenta,
  listarAsientos, libroMayor, balanceComprobacion, estadoResultados, balanceGeneral,
  listarPeriodos, cerrarPeriodo, reabrirPeriodo, crearPeriodoSiguiente,
};
