const crypto = require('node:crypto');
const contabilidad = require('./contabilidad');
const configuracion = require('./configuracion');
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

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'caja', entidad: 'turnos_caja', entidadId: id, accion: 'crear', detalle: { cajaId, fondoInicial: fondoInicial || 0 },
  });

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

  configuracion.registrarAuditoria(db, {
    usuarioId: session.usuarioActualId(), modulo: 'caja', entidad: 'turnos_caja', entidadId: turnoId, accion: 'cerrar', detalle: { esperado, efectivoContado, diferencia },
  });

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

const TIPOS_BIENES_SERVICIOS_606 = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];

function limpiarRnc(rnc) {
  return (rnc || '').replace(/[^0-9]/g, '');
}

// monto: total pagado (ITBIS incluido). itbisFacturado: el ITBIS de la factura del suplidor con
// derecho a crédito fiscal; va a ITBIS pagado (1500) igual que en las compras, y el resto a gasto.
function crearGastoCajaChica(db, {
  cajaChicaId, turnoCajaId, concepto, categoria, monto, comprobanteRuta, usuarioId,
  rncSuplidor, ncf, tipoBienesServicios, itbisFacturado, claseMonto,
}) {
  session.requerirPermiso('caja.movimiento.crear');
  if (!concepto || !concepto.trim()) throw new Error('El concepto del gasto es obligatorio');
  if (!comprobanteRuta || !comprobanteRuta.trim()) throw new Error('El comprobante del gasto es obligatorio');
  if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
  const itbis = redondear(Number(itbisFacturado) || 0);
  if (itbis < 0 || itbis >= monto) throw new Error('El ITBIS debe ser menor que el monto total del gasto');
  const rnc = limpiarRnc(rncSuplidor);
  const ncfLimpio = (ncf || '').trim().toUpperCase();
  if (rnc && rnc.length !== 9 && rnc.length !== 11) throw new Error('El RNC debe tener 9 dígitos (o 11 si es cédula)');
  if (ncfLimpio && !rnc) throw new Error('Si el gasto tiene NCF, indique también el RNC o cédula del suplidor');
  const tipo = tipoBienesServicios || '02';
  if (!TIPOS_BIENES_SERVICIOS_606.includes(tipo)) throw new Error('Tipo de bienes y servicios inválido');

  const gastoId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO gastos_caja_chica
       (id, caja_chica_id, concepto, categoria, monto, comprobante_ruta, rnc_suplidor, ncf, tipo_bienes_servicios,
        itbis_facturado, clase_monto, fecha, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(
    gastoId, cajaChicaId, concepto.trim(), categoria || null, monto, comprobanteRuta.trim(), rnc || null, ncfLimpio || null,
    tipo, itbis, claseMonto === 'servicios' ? 'servicios' : 'bienes', usuarioId
  );

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
      { cuentaCodigo: '6100', debe: redondear(monto - itbis), descripcion: concepto.trim() },
      { cuentaCodigo: '1500', debe: itbis, descripcion: 'ITBIS pagado (crédito fiscal)' },
      { cuentaCodigo: '1100', haber: monto, descripcion: 'Salida de caja' },
    ],
  });

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'caja', entidad: 'gastos_caja_chica', entidadId: gastoId, accion: 'crear', detalle: { concepto: concepto.trim(), monto },
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
  session.requerirAlgunPermiso('caja.movimiento.crear', 'caja.conciliacion.gestionar');
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

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'caja', entidad: 'transferencias_caja_banco', entidadId: id, accion: 'crear', detalle: { tipo, monto },
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
// Conciliación bancaria
// =========================================================================
//
// El extracto del banco se captura como partidas (monto > 0 = crédito/depósito, < 0 = débito).
// Los movimientos del sistema no se copian: se leen en vivo del libro de la cuenta contable
// Bancos (1200), porque todo lo que toca el banco (ventas con tarjeta/transferencia, cobros,
// pagos a proveedor, depósitos de caja) ya genera ahí su línea. Una línea del libro conciliada
// en una conciliación no vuelve a aparecer en otra; las no conciliadas se arrastran (cheques y
// depósitos en tránsito) hasta que aparezcan en un extracto.

const CUENTA_BANCOS = '1200';
const CUENTA_GASTOS_BANCARIOS = '6100';
const DIAS_TOLERANCIA_AUTOMATICA = 7;

// Las fechas de corte son días locales; los asientos se guardan en UTC. Sin la conversión, lo
// registrado después de las 8 p. m. (UTC-4) quedaría fuera del día.
function finDelDia(fecha) {
  return new Date(`${fecha.slice(0, 10)}T23:59:59.999`).toISOString();
}

function exigirLecturaConciliacion() {
  session.requerirAlgunPermiso('caja.conciliacion.gestionar', 'contabilidad.ver');
}

function obtenerConciliacionFila(db, conciliacionId) {
  const c = db
    .prepare(
      `SELECT cb.*, cu.nombre AS cuenta_nombre, cu.banco, cu.numero_cuenta, u.nombre_completo AS usuario_nombre
       FROM conciliaciones_bancarias cb JOIN cuentas_bancarias cu ON cu.id = cb.cuenta_bancaria_id
       LEFT JOIN usuarios u ON u.id = cb.usuario_id
       WHERE cb.id = ? AND cb.deleted_at IS NULL`
    )
    .get(conciliacionId);
  if (!c) throw new Error('Conciliación no encontrada');
  return c;
}

function exigirEnProceso(conciliacion) {
  if (conciliacion.estado !== 'en_proceso') throw new Error('La conciliación ya está cerrada. Reábrala para modificarla.');
}

function saldoLibroBancos(db, hasta) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(d.debe - d.haber), 0) AS saldo
       FROM asientos_contables_detalle d JOIN asientos_contables a ON a.id = d.asiento_id
       JOIN cuentas_contables c ON c.id = d.cuenta_id
       WHERE c.codigo = ? AND a.fecha <= ?`
    )
    .get(CUENTA_BANCOS, finDelDia(hasta));
  return redondear(row.saldo);
}

// Líneas del libro de Bancos hasta la fecha de corte que le corresponden a esta conciliación:
// las conciliadas en ella, las que no están conciliadas en ninguna, y las que se conciliaron en
// una conciliación posterior (para esta seguían en tránsito — así una conciliación cerrada no
// cambia su resumen cuando el cheque se cobra el mes siguiente). `disponible` indica si la
// línea todavía puede emparejarse (no está conciliada en ninguna parte).
function movimientosSistema(db, conciliacion) {
  const lineas = db
    .prepare(
      `SELECT d.id AS asiento_detalle_id, a.id AS asiento_id, a.numero, a.fecha, a.concepto, a.origen_modulo,
              a.origen_documento_tipo, a.origen_documento_id, d.descripcion, d.debe - d.haber AS monto,
              cbd.id AS partida_id, cbd.conciliacion_id AS conciliado_en, cb.periodo_hasta AS conciliado_hasta
       FROM asientos_contables_detalle d
       JOIN asientos_contables a ON a.id = d.asiento_id
       JOIN cuentas_contables c ON c.id = d.cuenta_id
       LEFT JOIN conciliaciones_bancarias_detalle cbd ON cbd.asiento_detalle_id = d.id AND cbd.deleted_at IS NULL
       LEFT JOIN conciliaciones_bancarias cb ON cb.id = cbd.conciliacion_id
       WHERE c.codigo = ? AND a.fecha <= ?
       ORDER BY a.fecha ASC, a.numero ASC`
    )
    .all(CUENTA_BANCOS, finDelDia(conciliacion.periodo_hasta));

  // Un documento anulado deja en Bancos su línea original y la de reversión. Si ninguna de las
  // dos está conciliada, nunca llegaron al banco: se ocultan en pareja. Se empareja cada
  // reversión con UNA línea original del mismo documento y monto opuesto (un mismo documento
  // puede tener varias, p. ej. un cargo bancario registrado, revertido y vuelto a registrar).
  const clave = (l) => (l.origen_documento_tipo === 'asientos_contables_anulacion' ? l.origen_documento_id : (l.origen_documento_id || l.asiento_id));
  const esReversion = (l) => (l.origen_documento_tipo || '').endsWith('_anulacion');
  const ocultas = new Set();
  for (const reversion of lineas.filter((l) => esReversion(l) && !l.conciliado_en)) {
    const original = lineas.find((l) => !esReversion(l) && !l.conciliado_en && !ocultas.has(l.asiento_detalle_id)
      && clave(l) === clave(reversion) && Math.abs(l.monto + reversion.monto) < 0.005);
    if (!original) continue;
    ocultas.add(original.asiento_detalle_id);
    ocultas.add(reversion.asiento_detalle_id);
  }

  return lineas
    .filter((l) => !ocultas.has(l.asiento_detalle_id))
    .filter((l) => !l.conciliado_en || l.conciliado_en === conciliacion.id || l.conciliado_hasta > conciliacion.periodo_hasta)
    .map((l) => {
      const aqui = l.conciliado_en === conciliacion.id;
      return {
        asiento_detalle_id: l.asiento_detalle_id, asiento_id: l.asiento_id, numero: l.numero, fecha: l.fecha,
        concepto: l.concepto, descripcion: l.descripcion, origen_modulo: l.origen_modulo, monto: redondear(l.monto),
        partida_id: aqui ? l.partida_id : null, conciliado: aqui, disponible: !l.conciliado_en,
      };
    });
}

function partidasEstadoCuenta(db, conciliacionId) {
  return db
    .prepare(
      `SELECT * FROM conciliaciones_bancarias_detalle
       WHERE conciliacion_id = ? AND origen = 'estado_cuenta' AND deleted_at IS NULL
       ORDER BY fecha ASC, created_at ASC`
    )
    .all(conciliacionId);
}

// saldo del banco + depósitos en tránsito − cheques en tránsito
//   debe igualar a
// saldo en libros + partidas del banco aún no conciliadas ni registradas
function resumenConciliacion(conciliacion, partidas, movimientos, saldoLibros) {
  const pendientesSistema = movimientos.filter((m) => !m.conciliado);
  const depositosEnTransito = redondear(pendientesSistema.filter((m) => m.monto > 0).reduce((a, m) => a + m.monto, 0));
  const chequesEnTransito = redondear(pendientesSistema.filter((m) => m.monto < 0).reduce((a, m) => a - m.monto, 0));
  const pendientesBanco = partidas.filter((p) => !p.conciliado);
  const partidasBancoPendientes = redondear(pendientesBanco.reduce((a, p) => a + p.monto, 0));
  const saldoEstadoCuenta = redondear(conciliacion.saldo_estado_cuenta || 0);
  const saldoBancoAjustado = redondear(saldoEstadoCuenta + depositosEnTransito - chequesEnTransito);
  const saldoLibrosAjustado = redondear(saldoLibros + partidasBancoPendientes);
  const diferencia = redondear(saldoBancoAjustado - saldoLibrosAjustado);
  return {
    saldoLibros, saldoEstadoCuenta, depositosEnTransito, chequesEnTransito, partidasBancoPendientes,
    saldoBancoAjustado, saldoLibrosAjustado, diferencia,
    partidasConciliadas: partidas.length - pendientesBanco.length, partidasPendientes: pendientesBanco.length,
    movimientosPendientes: pendientesSistema.length,
    cuadra: Math.abs(diferencia) < 0.01 && pendientesBanco.length === 0,
  };
}

function obtenerConciliacion(db, conciliacionId) {
  exigirLecturaConciliacion();
  const conciliacion = obtenerConciliacionFila(db, conciliacionId);
  const partidas = partidasEstadoCuenta(db, conciliacionId);
  const movimientos = movimientosSistema(db, conciliacion);
  // Una conciliación cerrada muestra el saldo en libros que tenía al cerrarse, aunque después
  // se registren operaciones con fecha anterior al corte.
  const saldoLibros = conciliacion.estado === 'conciliada' && conciliacion.saldo_sistema !== null
    ? conciliacion.saldo_sistema : saldoLibroBancos(db, conciliacion.periodo_hasta);
  return { conciliacion, partidas, movimientos, resumen: resumenConciliacion(conciliacion, partidas, movimientos, saldoLibros) };
}

function listarConciliaciones(db, { cuentaBancariaId, desde, hasta } = {}) {
  exigirLecturaConciliacion();
  const condiciones = ['cb.deleted_at IS NULL'];
  const params = [];
  if (cuentaBancariaId) { condiciones.push('cb.cuenta_bancaria_id = ?'); params.push(cuentaBancariaId); }
  if (desde) { condiciones.push('cb.periodo_hasta >= ?'); params.push(desde.slice(0, 10)); }
  if (hasta) { condiciones.push('cb.periodo_desde <= ?'); params.push(hasta.slice(0, 10)); }
  const filas = db
    .prepare(
      `SELECT cb.id FROM conciliaciones_bancarias cb WHERE ${condiciones.join(' AND ')}
       ORDER BY cb.periodo_hasta DESC, cb.created_at DESC`
    )
    .all(...params);
  return filas.map(({ id }) => {
    const { conciliacion, resumen } = obtenerConciliacion(db, id);
    return { ...conciliacion, ...resumen };
  });
}

function crearConciliacion(db, { cuentaBancariaId, periodoDesde, periodoHasta, saldoEstadoCuenta, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  if (!cuentaBancariaId) throw new Error('Seleccione la cuenta bancaria');
  if (!periodoDesde || !periodoHasta) throw new Error('Indique el periodo del estado de cuenta');
  if (periodoDesde > periodoHasta) throw new Error('La fecha inicial del periodo no puede ser posterior a la final');
  if (saldoEstadoCuenta === undefined || saldoEstadoCuenta === null || Number.isNaN(Number(saldoEstadoCuenta))) {
    throw new Error('Indique el saldo final que muestra el estado de cuenta');
  }
  const abierta = db
    .prepare("SELECT id FROM conciliaciones_bancarias WHERE cuenta_bancaria_id = ? AND estado = 'en_proceso' AND deleted_at IS NULL")
    .get(cuentaBancariaId);
  if (abierta) throw new Error('Ya hay una conciliación en proceso para esta cuenta. Ciérrela antes de iniciar otra.');

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO conciliaciones_bancarias (id, cuenta_bancaria_id, periodo_desde, periodo_hasta, saldo_estado_cuenta, estado, usuario_id)
     VALUES (?, ?, ?, ?, ?, 'en_proceso', ?)`
  ).run(id, cuentaBancariaId, periodoDesde.slice(0, 10), periodoHasta.slice(0, 10), redondear(Number(saldoEstadoCuenta)), usuarioId);
  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias', entidadId: id, accion: 'crear',
    detalle: { periodoDesde, periodoHasta, saldoEstadoCuenta },
  });
  return id;
}

function actualizarSaldoEstadoCuenta(db, { conciliacionId, saldoEstadoCuenta, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  exigirEnProceso(obtenerConciliacionFila(db, conciliacionId));
  if (Number.isNaN(Number(saldoEstadoCuenta))) throw new Error('Saldo inválido');
  db.prepare("UPDATE conciliaciones_bancarias SET saldo_estado_cuenta = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(redondear(Number(saldoEstadoCuenta)), conciliacionId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias', entidadId: conciliacionId, accion: 'editar', detalle: { saldoEstadoCuenta } });
}

function agregarPartidas(db, { conciliacionId, partidas, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  exigirEnProceso(obtenerConciliacionFila(db, conciliacionId));
  if (!partidas || partidas.length === 0) throw new Error('No hay partidas para agregar');
  const insertar = db.prepare(
    `INSERT INTO conciliaciones_bancarias_detalle
       (id, conciliacion_id, fecha, descripcion, monto, origen, conciliado, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'estado_cuenta', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  );
  partidas.forEach((p, i) => {
    const fila = partidas.length > 1 ? ` (partida ${i + 1})` : '';
    if (!p.fecha || !/^\d{4}-\d{2}-\d{2}/.test(p.fecha)) throw new Error(`Fecha inválida${fila}`);
    if (!p.descripcion || !String(p.descripcion).trim()) throw new Error(`La descripción es obligatoria${fila}`);
    const monto = redondear(Number(p.monto));
    if (!monto) throw new Error(`El monto debe ser distinto de cero${fila}`);
    insertar.run(crypto.randomUUID(), conciliacionId, p.fecha.slice(0, 10), String(p.descripcion).trim(), monto);
  });
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias', entidadId: conciliacionId, accion: 'agregar_partidas', detalle: { cantidad: partidas.length } });
  return partidas.length;
}

function obtenerPartidaEditable(db, partidaId) {
  const partida = db.prepare("SELECT * FROM conciliaciones_bancarias_detalle WHERE id = ? AND origen = 'estado_cuenta' AND deleted_at IS NULL").get(partidaId);
  if (!partida) throw new Error('Partida no encontrada');
  exigirEnProceso(obtenerConciliacionFila(db, partida.conciliacion_id));
  return partida;
}

function eliminarPartida(db, { partidaId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const partida = obtenerPartidaEditable(db, partidaId);
  if (partida.conciliado) throw new Error('Deshaga la conciliación de la partida antes de quitarla');
  db.prepare("UPDATE conciliaciones_bancarias_detalle SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(partidaId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias_detalle', entidadId: partidaId, accion: 'eliminar', detalle: { descripcion: partida.descripcion, monto: partida.monto } });
}

function conciliarPareja(db, { partidaId, asientoDetalleId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const partida = obtenerPartidaEditable(db, partidaId);
  if (partida.conciliado) throw new Error('La partida del banco ya está conciliada');
  const conciliacion = obtenerConciliacionFila(db, partida.conciliacion_id);
  const linea = movimientosSistema(db, conciliacion).find((m) => m.asiento_detalle_id === asientoDetalleId);
  if (!linea) throw new Error('El movimiento del sistema no está disponible para esta conciliación');
  if (!linea.disponible) throw new Error('El movimiento del sistema ya está conciliado');
  if (Math.abs(linea.monto - partida.monto) > 0.009) {
    throw new Error(`Los montos no coinciden (banco ${partida.monto.toFixed(2)} vs sistema ${linea.monto.toFixed(2)}). Si la diferencia es un cargo del banco, regístrela aparte.`);
  }
  db.prepare(
    `UPDATE conciliaciones_bancarias_detalle SET asiento_detalle_id = ?, conciliado = 1, tipo_diferencia = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(asientoDetalleId, partidaId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias_detalle', entidadId: partidaId, accion: 'conciliar', detalle: { asientoDetalleId, monto: partida.monto } });
}

// Empareja partida del banco ↔ movimiento del sistema con el mismo monto y fecha cercana
// (±7 días), uno a uno, prefiriendo la fecha más cercana.
function conciliarAutomaticamente(db, { conciliacionId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const conciliacion = obtenerConciliacionFila(db, conciliacionId);
  exigirEnProceso(conciliacion);
  const disponibles = movimientosSistema(db, conciliacion).filter((m) => m.disponible);
  const usados = new Set();
  const actualizar = db.prepare(
    `UPDATE conciliaciones_bancarias_detalle SET asiento_detalle_id = ?, conciliado = 1, tipo_diferencia = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  );
  const unDia = 24 * 60 * 60 * 1000;
  let emparejadas = 0;
  for (const partida of partidasEstadoCuenta(db, conciliacionId).filter((p) => !p.conciliado)) {
    const fechaPartida = new Date(`${partida.fecha}T12:00:00Z`).getTime();
    const candidato = disponibles
      .filter((m) => !usados.has(m.asiento_detalle_id) && Math.abs(m.monto - partida.monto) < 0.009)
      .map((m) => ({ m, dias: Math.abs(new Date(m.fecha).getTime() - fechaPartida) / unDia }))
      .filter((x) => x.dias <= DIAS_TOLERANCIA_AUTOMATICA)
      .sort((a, b) => a.dias - b.dias)[0];
    if (!candidato) continue;
    usados.add(candidato.m.asiento_detalle_id);
    actualizar.run(candidato.m.asiento_detalle_id, partida.id);
    emparejadas += 1;
  }
  if (emparejadas > 0) {
    configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias', entidadId: conciliacionId, accion: 'conciliar_automatico', detalle: { emparejadas } });
  }
  return emparejadas;
}

function idLineaBancos(db, asientoId) {
  return db
    .prepare(
      `SELECT d.id FROM asientos_contables_detalle d JOIN cuentas_contables c ON c.id = d.cuenta_id
       WHERE d.asiento_id = ? AND c.codigo = ?`
    )
    .get(asientoId, CUENTA_BANCOS).id;
}

// Cargo o crédito del banco que no estaba en el sistema (comisión, mantenimiento, intereses):
// se registra contra Gastos Operativos y queda conciliado con la línea de Bancos que genera.
function registrarPartidaEnContabilidad(db, { partidaId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const partida = obtenerPartidaEditable(db, partidaId);
  if (partida.conciliado) throw new Error('La partida ya está conciliada');
  const monto = Math.abs(partida.monto);
  const esCargo = partida.monto < 0;
  const asientoId = contabilidad.generarAsiento(db, {
    fecha: `${partida.fecha}T12:00:00.000Z`,
    concepto: `${esCargo ? 'Cargo' : 'Crédito'} bancario: ${partida.descripcion}`,
    origenModulo: 'caja', origenDocumentoTipo: 'conciliaciones_bancarias_detalle', origenDocumentoId: partidaId, usuarioId,
    lineas: esCargo
      ? [{ cuentaCodigo: CUENTA_GASTOS_BANCARIOS, debe: monto, descripcion: partida.descripcion }, { cuentaCodigo: CUENTA_BANCOS, haber: monto, descripcion: partida.descripcion }]
      : [{ cuentaCodigo: CUENTA_BANCOS, debe: monto, descripcion: partida.descripcion }, { cuentaCodigo: CUENTA_GASTOS_BANCARIOS, haber: monto, descripcion: partida.descripcion }],
  });
  db.prepare(
    `UPDATE conciliaciones_bancarias_detalle SET asiento_id = ?, asiento_detalle_id = ?, conciliado = 1,
       tipo_diferencia = 'cargo_bancario_no_registrado', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(asientoId, idLineaBancos(db, asientoId), partidaId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias_detalle', entidadId: partidaId, accion: 'registrar_en_contabilidad', detalle: { asientoId, monto: partida.monto } });
  return asientoId;
}

// Deshace una conciliación. Si la partida se había registrado en contabilidad, se revierte ese
// asiento con uno espejo (nunca se borra); original y reversión se netean y desaparecen de la lista.
function deshacerConciliacionPartida(db, { partidaId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const partida = obtenerPartidaEditable(db, partidaId);
  if (!partida.conciliado) throw new Error('La partida no está conciliada');
  if (partida.asiento_id) {
    const asiento = db.prepare('SELECT * FROM asientos_contables WHERE id = ?').get(partida.asiento_id);
    const detalle = db.prepare('SELECT d.*, c.codigo FROM asientos_contables_detalle d JOIN cuentas_contables c ON c.id = d.cuenta_id WHERE d.asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: asiento.fecha, concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'caja',
      origenDocumentoTipo: 'conciliaciones_bancarias_detalle_anulacion', origenDocumentoId: partidaId, usuarioId,
      lineas: detalle.map((d) => ({ cuentaCodigo: d.codigo, debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
    });
  }
  db.prepare(
    `UPDATE conciliaciones_bancarias_detalle SET asiento_detalle_id = NULL, asiento_id = NULL, conciliado = 0, tipo_diferencia = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(partidaId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias_detalle', entidadId: partidaId, accion: 'deshacer_conciliacion', detalle: { revirtioAsiento: Boolean(partida.asiento_id) } });
}

function cerrarConciliacion(db, { conciliacionId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const { conciliacion, resumen } = obtenerConciliacion(db, conciliacionId);
  exigirEnProceso(conciliacion);
  if (resumen.partidasPendientes > 0) {
    throw new Error(`Quedan ${resumen.partidasPendientes} partida(s) del banco sin conciliar. Concílielas con un movimiento del sistema o regístrelas en contabilidad.`);
  }
  if (Math.abs(resumen.diferencia) >= 0.01) {
    throw new Error(`La conciliación no cuadra: diferencia de RD$ ${resumen.diferencia.toFixed(2)}. Revise el saldo del estado de cuenta y las partidas.`);
  }
  db.prepare(
    `UPDATE conciliaciones_bancarias SET estado = 'conciliada', saldo_sistema = ?, fecha_conciliada = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(resumen.saldoLibros, conciliacionId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias', entidadId: conciliacionId, accion: 'cerrar', detalle: { saldoLibros: resumen.saldoLibros, saldoEstadoCuenta: resumen.saldoEstadoCuenta } });
}

function reabrirConciliacion(db, { conciliacionId, usuarioId }) {
  session.requerirPermiso('caja.conciliacion.gestionar');
  const conciliacion = obtenerConciliacionFila(db, conciliacionId);
  if (conciliacion.estado !== 'conciliada') throw new Error('La conciliación no está cerrada');
  const posterior = db
    .prepare(
      `SELECT 1 FROM conciliaciones_bancarias WHERE cuenta_bancaria_id = ? AND id != ? AND deleted_at IS NULL
         AND (periodo_hasta > ? OR estado = 'en_proceso')`
    )
    .get(conciliacion.cuenta_bancaria_id, conciliacionId, conciliacion.periodo_hasta);
  if (posterior) throw new Error('Solo se puede reabrir la última conciliación de la cuenta, y sin otra en proceso.');
  db.prepare(
    `UPDATE conciliaciones_bancarias SET estado = 'en_proceso', saldo_sistema = NULL, fecha_conciliada = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(conciliacionId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'caja', entidad: 'conciliaciones_bancarias', entidadId: conciliacionId, accion: 'reabrir' });
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

  ipcMain.handle('caja:listarConciliaciones', (event, filtros) => listarConciliaciones(getDb(), filtros || {}));
  ipcMain.handle('caja:obtenerConciliacion', (event, { conciliacionId }) => obtenerConciliacion(getDb(), conciliacionId));
  const escritura = (canal, fn) => ipcMain.handle(canal, (event, payload) => {
    const db = getDb();
    return db.transaction(() => fn(db, payload))();
  });
  escritura('caja:crearConciliacion', crearConciliacion);
  escritura('caja:actualizarSaldoEstadoCuenta', actualizarSaldoEstadoCuenta);
  escritura('caja:agregarPartidasConciliacion', agregarPartidas);
  escritura('caja:eliminarPartidaConciliacion', eliminarPartida);
  escritura('caja:conciliarPareja', conciliarPareja);
  escritura('caja:conciliarAutomaticamente', conciliarAutomaticamente);
  escritura('caja:registrarPartidaEnContabilidad', registrarPartidaEnContabilidad);
  escritura('caja:deshacerConciliacionPartida', deshacerConciliacionPartida);
  escritura('caja:cerrarConciliacion', cerrarConciliacion);
  escritura('caja:reabrirConciliacion', reabrirConciliacion);
}

module.exports = {
  register, obtenerTurnoAbierto, registrarMovimiento, efectivoEsperado, abrirTurno, cerrarTurno,
  listarTurnos, historialSobrantesFaltantes, movimientosDeTurno, registrarMovimientoManual, obtenerOCrearCajaChica,
  crearGastoCajaChica, listarGastosCajaChica, listarCuentasBancarias, crearCuentaBancaria,
  crearTransferenciaCajaBanco, listarTransferenciasCajaBanco, listarCajas, crearCaja,
  listarConciliaciones, obtenerConciliacion, crearConciliacion, actualizarSaldoEstadoCuenta, agregarPartidas,
  eliminarPartida, conciliarPareja, conciliarAutomaticamente, registrarPartidaEnContabilidad,
  deshacerConciliacionPartida, cerrarConciliacion, reabrirConciliacion, saldoLibroBancos,
};
