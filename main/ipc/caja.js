const crypto = require('node:crypto');
const contabilidad = require('./contabilidad');
const session = require('../auth/session');

function redondear(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function siguienteNumeroDocumento(db, tabla) {
  const row = db.prepare(`SELECT MAX(CAST(numero AS INTEGER)) AS maximo FROM ${tabla}`).get();
  return String((row.maximo || 0) + 1).padStart(6, '0');
}

// =========================================================================
// Cajas y turnos
// =========================================================================

function listarCajas(db) {
  return db.prepare('SELECT id, sucursal_id, nombre FROM cajas WHERE deleted_at IS NULL AND activo = 1 ORDER BY nombre').all();
}

function crearCaja(db, { sucursalId, nombre }) {
  session.requerirPermiso('configuracion.gestionar');
  if (!nombre || !nombre.trim()) throw new Error('El nombre de la caja es obligatorio');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO cajas (id, sucursal_id, nombre, activo) VALUES (?, ?, ?, 1)').run(id, sucursalId, nombre.trim());
  return { id, sucursal_id: sucursalId, nombre: nombre.trim() };
}

function obtenerTurnoAbierto(db, cajaId) {
  return db
    .prepare("SELECT * FROM turnos_caja WHERE caja_id = ? AND estado = 'abierto' ORDER BY fecha_apertura DESC LIMIT 1")
    .get(cajaId);
}

// El efectivo esperado del turno es fondo_inicial + la suma de todos sus movimientos
// (ventas en efectivo y entradas manuales suman, salidas manuales, gastos de caja chica
// y depósitos a banco restan — todos ya vienen firmados en movimientos_caja.monto).
function efectivoEsperado(db, turno) {
  const row = db
    .prepare('SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos_caja WHERE turno_caja_id = ? AND deleted_at IS NULL')
    .get(turno.id);
  return redondear(turno.fondo_inicial + row.total);
}

function movimientosDeTurno(db, turnoId) {
  return db
    .prepare(
      `SELECT m.*, u.nombre_completo AS usuario_nombre FROM movimientos_caja m
       LEFT JOIN usuarios u ON u.id = m.usuario_id
       WHERE m.turno_caja_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at DESC`
    )
    .all(turnoId);
}

function abrirTurno(db, { cajaId, fondoInicial, usuarioId }) {
  session.requerirPermiso('caja.apertura');
  const yaAbierto = obtenerTurnoAbierto(db, cajaId);
  if (yaAbierto) throw new Error('Ya hay un turno abierto para esta caja');

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO turnos_caja (id, caja_id, usuario_id, fondo_inicial, fecha_apertura, estado)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'abierto')`
  ).run(id, cajaId, usuarioId, fondoInicial || 0);
  return obtenerTurnoAbierto(db, cajaId);
}

function cerrarTurno(db, { turnoId, efectivoContado }) {
  session.requerirPermiso('caja.cierre');
  const turno = db.prepare('SELECT * FROM turnos_caja WHERE id = ?').get(turnoId);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado === 'cerrado') throw new Error('El turno ya está cerrado');

  const esperado = efectivoEsperado(db, turno);
  const diferencia = redondear(efectivoContado - esperado);

  db.prepare(
    `UPDATE turnos_caja SET fecha_cierre = strftime('%Y-%m-%dT%H:%M:%fZ','now'), efectivo_esperado = ?,
       efectivo_contado = ?, diferencia = ?, estado = 'cerrado', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(esperado, efectivoContado, diferencia, turnoId);

  return db.prepare('SELECT * FROM turnos_caja WHERE id = ?').get(turnoId);
}

function listarTurnos(db, { cajaId, limite = 50 } = {}) {
  const condiciones = [];
  const params = [];
  if (cajaId) { condiciones.push('t.caja_id = ?'); params.push(cajaId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT t.*, c.nombre AS caja_nombre, u.nombre_completo AS usuario_nombre
       FROM turnos_caja t JOIN cajas c ON c.id = t.caja_id LEFT JOIN usuarios u ON u.id = t.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY t.fecha_apertura DESC LIMIT ?`
    )
    .all(...params);
}

// Reporte "Historial de Sobrantes/Faltantes": diferencia acumulada por usuario y por caja,
// solo de turnos ya cerrados (diferencia es NULL mientras el turno sigue abierto).
function historialSobrantesFaltantes(db, { desde, hasta } = {}) {
  const condiciones = ["t.estado = 'cerrado'"];
  const params = [];
  if (desde) { condiciones.push('t.fecha_cierre >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('t.fecha_cierre <= ?'); params.push(hasta); }
  return db
    .prepare(
      `SELECT u.id AS usuario_id, u.nombre_completo AS usuario_nombre, c.nombre AS caja_nombre,
              COUNT(t.id) AS num_turnos,
              SUM(CASE WHEN t.diferencia > 0 THEN t.diferencia ELSE 0 END) AS total_sobrante,
              SUM(CASE WHEN t.diferencia < 0 THEN -t.diferencia ELSE 0 END) AS total_faltante,
              SUM(t.diferencia) AS diferencia_neta
       FROM turnos_caja t JOIN cajas c ON c.id = t.caja_id LEFT JOIN usuarios u ON u.id = t.usuario_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY u.id, c.id ORDER BY diferencia_neta ASC`
    )
    .all(...params);
}

function registrarMovimiento(db, { turnoCajaId, tipo, concepto, monto, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO movimientos_caja
       (id, turno_caja_id, tipo, concepto, monto, documento_origen_tipo, documento_origen_id, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, turnoCajaId, tipo, concepto, monto, documentoOrigenTipo || null, documentoOrigenId || null, usuarioId);
  return id;
}

function registrarMovimientoManual(db, { turnoCajaId, tipo, concepto, monto, usuarioId }) {
  session.requerirPermiso('caja.movimiento.crear');
  if (!concepto || !concepto.trim()) throw new Error('El concepto del movimiento es obligatorio');
  if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
  const turno = db.prepare('SELECT * FROM turnos_caja WHERE id = ?').get(turnoCajaId);
  if (!turno || turno.estado !== 'abierto') throw new Error('El turno no está abierto');

  const montoFirmado = tipo === 'salida_manual' ? -Math.abs(monto) : Math.abs(monto);
  return registrarMovimiento(db, { turnoCajaId, tipo, concepto: concepto.trim(), monto: montoFirmado, usuarioId });
}

// =========================================================================
// Caja chica
// =========================================================================

function obtenerOCrearCajaChica(db, { cajaId, fondoAsignado }) {
  let cc = db.prepare('SELECT * FROM caja_chica WHERE caja_id = ? AND deleted_at IS NULL LIMIT 1').get(cajaId);
  if (!cc) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO caja_chica (id, caja_id, nombre, fondo_asignado, activo) VALUES (?, ?, 'Caja chica', ?, 1)")
      .run(id, cajaId, fondoAsignado || 0);
    cc = db.prepare('SELECT * FROM caja_chica WHERE id = ?').get(id);
  }
  return cc;
}

function gastoCajaChicaTotalDelPeriodo(db, cajaChicaId) {
  const row = db
    .prepare("SELECT COALESCE(SUM(monto), 0) AS total FROM gastos_caja_chica WHERE caja_chica_id = ? AND estado != 'anulado'")
    .get(cajaChicaId);
  return row.total;
}

function crearGastoCajaChica(db, { cajaChicaId, turnoCajaId, concepto, categoria, monto, comprobanteRuta, usuarioId }) {
  session.requerirPermiso('caja.movimiento.crear');
  if (!concepto || !concepto.trim()) throw new Error('El concepto del gasto es obligatorio');
  if (!comprobanteRuta || !comprobanteRuta.trim()) throw new Error('El comprobante del gasto es obligatorio');
  if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');

  const gastoId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO gastos_caja_chica (id, caja_chica_id, concepto, categoria, monto, comprobante_ruta, fecha, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(gastoId, cajaChicaId, concepto.trim(), categoria || null, monto, comprobanteRuta.trim(), usuarioId);

  if (turnoCajaId) {
    registrarMovimiento(db, {
      turnoCajaId, tipo: 'gasto_caja_chica', concepto: `Caja chica: ${concepto.trim()}`, monto: -Math.abs(monto),
      documentoOrigenTipo: 'gastos_caja_chica', documentoOrigenId: gastoId, usuarioId,
    });
  }

  contabilidad.generarAsiento(db, {
    fecha: new Date().toISOString(), concepto: `Gasto de caja chica: ${concepto.trim()}`, origenModulo: 'caja',
    origenDocumentoTipo: 'gastos_caja_chica', origenDocumentoId: gastoId, usuarioId,
    lineas: [
      { cuentaCodigo: '6100', debe: monto, descripcion: concepto.trim() },
      { cuentaCodigo: '1100', haber: monto, descripcion: 'Salida de caja' },
    ],
  });

  return gastoId;
}

function listarGastosCajaChica(db, { cajaChicaId, limite = 50 } = {}) {
  const condiciones = [];
  const params = [];
  if (cajaChicaId) { condiciones.push('g.caja_chica_id = ?'); params.push(cajaChicaId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT g.*, u.nombre_completo AS usuario_nombre FROM gastos_caja_chica g LEFT JOIN usuarios u ON u.id = g.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY g.fecha DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// Cuentas bancarias y transferencias caja-banco
// =========================================================================

function listarCuentasBancarias(db) {
  return db.prepare('SELECT * FROM cuentas_bancarias WHERE deleted_at IS NULL AND activo = 1 ORDER BY nombre').all();
}

function crearCuentaBancaria(db, { nombre, banco, numeroCuenta, monedaId }) {
  if (!nombre || !banco) throw new Error('Nombre y banco son obligatorios');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO cuentas_bancarias (id, nombre, banco, numero_cuenta, moneda_id, activo) VALUES (?, ?, ?, ?, ?, 1)')
    .run(id, nombre, banco, numeroCuenta || null, monedaId);
  return db.prepare('SELECT * FROM cuentas_bancarias WHERE id = ?').get(id);
}

function crearTransferenciaCajaBanco(db, { cajaId, turnoCajaId, cuentaBancariaId, tipo, monto, usuarioId }) {
  session.requerirPermiso('caja.movimiento.crear');
  if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
  if (tipo === 'deposito' && turnoCajaId) {
    // Un depósito saca efectivo físico de la caja, así que se refleja en el turno abierto.
    const turno = db.prepare('SELECT * FROM turnos_caja WHERE id = ?').get(turnoCajaId);
    const esperadoActual = efectivoEsperado(db, turno);
    if (esperadoActual < monto) {
      throw new Error(`El efectivo esperado en caja (RD$ ${esperadoActual.toFixed(2)}) es menor al monto a depositar`);
    }
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO transferencias_caja_banco (id, caja_id, turno_caja_id, cuenta_bancaria_id, tipo, monto, fecha, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(id, cajaId, turnoCajaId || null, cuentaBancariaId, tipo, monto, usuarioId);

  if (turnoCajaId) {
    registrarMovimiento(db, {
      turnoCajaId, tipo: 'transferencia_banco', concepto: `${tipo === 'deposito' ? 'Depósito' : 'Retiro'} a banco`,
      monto: tipo === 'deposito' ? -Math.abs(monto) : Math.abs(monto),
      documentoOrigenTipo: 'transferencias_caja_banco', documentoOrigenId: id, usuarioId,
    });
  }

  contabilidad.generarAsiento(db, {
    fecha: new Date().toISOString(), concepto: `${tipo === 'deposito' ? 'Depósito' : 'Retiro'} caja-banco`, origenModulo: 'caja',
    origenDocumentoTipo: 'transferencias_caja_banco', origenDocumentoId: id, usuarioId,
    lineas: tipo === 'deposito'
      ? [{ cuentaCodigo: '1200', debe: monto, descripcion: 'Depósito a banco' }, { cuentaCodigo: '1100', haber: monto, descripcion: 'Salida de caja' }]
      : [{ cuentaCodigo: '1100', debe: monto, descripcion: 'Retiro de banco' }, { cuentaCodigo: '1200', haber: monto, descripcion: 'Salida de banco' }],
  });

  return id;
}

function listarTransferenciasCajaBanco(db, { limite = 50 } = {}) {
  return db
    .prepare(
      `SELECT tcb.*, cb.nombre AS cuenta_nombre, cb.banco, u.nombre_completo AS usuario_nombre
       FROM transferencias_caja_banco tcb JOIN cuentas_bancarias cb ON cb.id = tcb.cuenta_bancaria_id
       LEFT JOIN usuarios u ON u.id = tcb.usuario_id ORDER BY tcb.fecha DESC LIMIT ?`
    )
    .all(limite);
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('caja:principal', () => {
    const db = getDb();
    return db.prepare('SELECT id, sucursal_id, nombre FROM cajas WHERE deleted_at IS NULL AND activo = 1 LIMIT 1').get();
  });
  ipcMain.handle('caja:listar', () => listarCajas(getDb()));
  ipcMain.handle('caja:crear', (event, payload) => crearCaja(getDb(), payload));

  ipcMain.handle('caja:turnoAbierto', (event, { cajaId }) => obtenerTurnoAbierto(getDb(), cajaId));
  ipcMain.handle('caja:abrirTurno', (event, payload) => {
    const db = getDb();
    return db.transaction(() => abrirTurno(db, payload))();
  });
  ipcMain.handle('caja:cerrarTurno', (event, payload) => {
    const db = getDb();
    return db.transaction(() => cerrarTurno(db, payload))();
  });
  ipcMain.handle('caja:listarTurnos', (event, filtros) => listarTurnos(getDb(), filtros || {}));
  ipcMain.handle('caja:historialSobrantesFaltantes', (event, filtros) => historialSobrantesFaltantes(getDb(), filtros || {}));
  ipcMain.handle('caja:efectivoEsperado', (event, { turnoId }) => {
    const db = getDb();
    const turno = db.prepare('SELECT * FROM turnos_caja WHERE id = ?').get(turnoId);
    return turno ? efectivoEsperado(db, turno) : 0;
  });
  ipcMain.handle('caja:movimientosDeTurno', (event, { turnoId }) => movimientosDeTurno(getDb(), turnoId));
  ipcMain.handle('caja:registrarMovimientoManual', (event, payload) => {
    const db = getDb();
    return db.transaction(() => registrarMovimientoManual(db, payload))();
  });

  ipcMain.handle('caja:cajaChica', (event, payload) => {
    const db = getDb();
    return db.transaction(() => obtenerOCrearCajaChica(db, payload))();
  });
  ipcMain.handle('caja:crearGastoCajaChica', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearGastoCajaChica(db, payload))();
  });
  ipcMain.handle('caja:listarGastosCajaChica', (event, filtros) => listarGastosCajaChica(getDb(), filtros || {}));

  ipcMain.handle('caja:listarCuentasBancarias', () => listarCuentasBancarias(getDb()));
  ipcMain.handle('caja:crearCuentaBancaria', (event, payload) => crearCuentaBancaria(getDb(), payload));
  ipcMain.handle('caja:crearTransferenciaBanco', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearTransferenciaCajaBanco(db, payload))();
  });
  ipcMain.handle('caja:listarTransferenciasBanco', (event, filtros) => listarTransferenciasCajaBanco(getDb(), filtros || {}));
}

module.exports = {
  register, obtenerTurnoAbierto, registrarMovimiento, efectivoEsperado, abrirTurno, cerrarTurno,
  listarTurnos, historialSobrantesFaltantes, movimientosDeTurno, registrarMovimientoManual, obtenerOCrearCajaChica,
  crearGastoCajaChica, listarGastosCajaChica, listarCuentasBancarias, crearCuentaBancaria,
  crearTransferenciaCajaBanco, listarTransferenciasCajaBanco, listarCajas, crearCaja,
};
