const crypto = require('node:crypto');

const compras = require('./compras');
const caja = require('./caja');
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

const CUENTA_POR_FORMA_PAGO = { efectivo: '1100', transferencia: '1200', cheque: '1200' };

// Saldo pendiente de UNA factura de compra específica.
function saldoPorFacturaCompra(db, documentoId) {
  const doc = db.prepare('SELECT * FROM documentos_compra WHERE id = ?').get(documentoId);
  if (!doc) return 0;
  const pagado = db
    .prepare(
      `SELECT COALESCE(SUM(ppa.monto_aplicado), 0) AS total FROM pagos_proveedor_aplicaciones ppa
       JOIN pagos_proveedor pp ON pp.id = ppa.pago_id WHERE ppa.documento_compra_id = ? AND pp.estado != 'anulado'`
    )
    .get(documentoId).total;
  return redondear(doc.total - pagado);
}

function facturasAbiertasProveedor(db, proveedorId) {
  const facturas = db
    .prepare(
      `SELECT * FROM documentos_compra WHERE proveedor_id = ? AND tipo = 'factura_compra' AND condicion_pago IN ('credito','mixto')
       AND estado != 'anulado' AND deleted_at IS NULL ORDER BY fecha ASC`
    )
    .all(proveedorId);
  return facturas.map((f) => ({ ...f, saldo_pendiente: saldoPorFacturaCompra(db, f.id) })).filter((f) => f.saldo_pendiente > 0.01);
}

function diasRestantes(fechaVencimiento) {
  const venc = new Date(fechaVencimiento);
  const hoy = new Date();
  return Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));
}

// =========================================================================
// Pagos a proveedor
// =========================================================================

function crearPago(db, { proveedorId, fecha, formaPago, numeroCheque, bancoCheque, fechaCheque, prioridad, aplicaciones, cajaId, usuarioId }) {
  session.requerirPermiso('cxp.pago.crear');
  if (!aplicaciones || aplicaciones.length === 0) throw new Error('El pago debe aplicarse a al menos una factura');

  const montoTotal = redondear(aplicaciones.reduce((acc, a) => acc + a.montoAplicado, 0));
  if (montoTotal <= 0) throw new Error('El monto del pago debe ser mayor a cero');

  for (const a of aplicaciones) {
    const saldo = saldoPorFacturaCompra(db, a.documentoCompraId);
    if (a.montoAplicado > saldo + 0.01) {
      const factura = db.prepare('SELECT numero FROM documentos_compra WHERE id = ?').get(a.documentoCompraId);
      throw new Error(`El monto aplicado a la factura ${factura ? factura.numero : ''} (${a.montoAplicado}) excede su saldo pendiente (${saldo})`);
    }
  }

  let turno = null;
  if (formaPago === 'efectivo') {
    turno = caja.obtenerTurnoAbierto(db, cajaId);
    if (!turno) throw new Error('Debe abrir un turno de caja antes de pagar a un proveedor en efectivo');
  }
  if (formaPago === 'cheque' && !numeroCheque) throw new Error('El número de cheque es obligatorio');

  const pagoId = crypto.randomUUID();
  const numero = siguienteNumeroDocumento(db, 'pagos_proveedor');
  const fechaIso = fecha || new Date().toISOString();
  db.prepare(
    `INSERT INTO pagos_proveedor
       (id, numero, proveedor_id, fecha, forma_pago, monto_total, numero_cheque, banco_cheque, fecha_cheque,
        estado_cheque, prioridad, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pagoId, numero, proveedorId, fechaIso, formaPago, montoTotal, numeroCheque || null, bancoCheque || null,
    fechaCheque || null, formaPago === 'cheque' ? 'pendiente' : null, prioridad || 'normal', usuarioId
  );

  const insertAplicacion = db.prepare(
    `INSERT INTO pagos_proveedor_aplicaciones (id, pago_id, documento_compra_id, monto_aplicado) VALUES (?, ?, ?, ?)`
  );
  for (const a of aplicaciones) {
    insertAplicacion.run(crypto.randomUUID(), pagoId, a.documentoCompraId, a.montoAplicado);
  }

  if (formaPago === 'efectivo') {
    caja.registrarMovimiento(db, {
      turnoCajaId: turno.id, tipo: 'salida_manual', concepto: `Pago a proveedor ${numero}`, monto: -montoTotal,
      documentoOrigenTipo: 'pagos_proveedor', documentoOrigenId: pagoId, usuarioId,
    });
  }

  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `Pago a proveedor ${numero}`, origenModulo: 'cxp',
    origenDocumentoTipo: 'pagos_proveedor', origenDocumentoId: pagoId, usuarioId,
    lineas: [
      { cuentaCodigo: '2100', debe: montoTotal, descripcion: 'Aplicado a cuentas por pagar' },
      { cuentaCodigo: CUENTA_POR_FORMA_PAGO[formaPago] || '1100', haber: montoTotal, descripcion: 'Salida de pago' },
    ],
  });

  return pagoId;
}

function anularPago(db, { pagoId, motivo, usuarioId }) {
  session.requerirPermiso('cxp.pago.anular');
  const pago = db.prepare('SELECT * FROM pagos_proveedor WHERE id = ?').get(pagoId);
  if (!pago) throw new Error('Pago no encontrado');
  if (pago.estado === 'anulado') throw new Error('El pago ya está anulado');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE pagos_proveedor SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, pagoId);

  const movimientosCaja = db
    .prepare("SELECT * FROM movimientos_caja WHERE documento_origen_tipo = 'pagos_proveedor' AND documento_origen_id = ?")
    .all(pagoId);
  for (const m of movimientosCaja) {
    caja.registrarMovimiento(db, {
      turnoCajaId: m.turno_caja_id, tipo: 'salida_manual', concepto: `Anulación pago ${pago.numero}`,
      monto: -m.monto, documentoOrigenTipo: 'pagos_proveedor_anulacion', documentoOrigenId: pagoId, usuarioId,
    });
  }

  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'pagos_proveedor' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(pagoId);
  const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
  const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
  for (const asiento of asientos) {
    const det = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'cxp',
      origenDocumentoTipo: 'pagos_proveedor_anulacion', origenDocumentoId: pagoId, usuarioId,
      lineas: det.map((d) => ({ cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
    });
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'cxp', entidad: 'pagos_proveedor', entidadId: pagoId, accion: 'anular', detalle: { numero: pago.numero, motivo },
  });
}

function listarPagos(db, { proveedorId, limite = 50 } = {}) {
  const condiciones = [];
  const params = [];
  if (proveedorId) { condiciones.push('pp.proveedor_id = ?'); params.push(proveedorId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT pp.*, p.nombre AS proveedor_nombre, u.nombre_completo AS usuario_nombre
       FROM pagos_proveedor pp JOIN proveedores p ON p.id = pp.proveedor_id LEFT JOIN usuarios u ON u.id = pp.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY pp.fecha DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// Reportes
// =========================================================================

function tramoPorDiasMora(dias) {
  if (dias <= 0) return 'corriente';
  if (dias <= 30) return 'dias_0_30';
  if (dias <= 60) return 'dias_31_60';
  if (dias <= 90) return 'dias_61_90';
  return 'dias_90_mas';
}

function antiguedadSaldos(db) {
  const proveedores = db.prepare('SELECT id, nombre FROM proveedores WHERE deleted_at IS NULL AND activo = 1').all();
  const resultado = [];
  for (const proveedor of proveedores) {
    const facturas = facturasAbiertasProveedor(db, proveedor.id);
    if (facturas.length === 0) continue;
    const tramos = { corriente: 0, dias_0_30: 0, dias_31_60: 0, dias_61_90: 0, dias_90_mas: 0 };
    for (const f of facturas) {
      const dias = -diasRestantes(f.fecha_vencimiento); // positivo = días de mora
      tramos[tramoPorDiasMora(dias)] += f.saldo_pendiente;
    }
    const total = Object.values(tramos).reduce((a, b) => a + b, 0);
    resultado.push({ proveedorId: proveedor.id, proveedorNombre: proveedor.nombre, total: redondear(total), tramos });
  }
  return resultado;
}

function facturasProximasAVencer(db) {
  const proveedores = db.prepare('SELECT id, nombre FROM proveedores WHERE deleted_at IS NULL').all();
  const resultado = [];
  for (const proveedor of proveedores) {
    for (const f of facturasAbiertasProveedor(db, proveedor.id)) {
      resultado.push({ ...f, proveedor_nombre: proveedor.nombre, dias_restantes: diasRestantes(f.fecha_vencimiento) });
    }
  }
  return resultado.sort((a, b) => a.dias_restantes - b.dias_restantes);
}

function chequesPosdatadosPendientes(db) {
  return db
    .prepare(
      `SELECT pp.*, p.nombre AS proveedor_nombre FROM pagos_proveedor pp JOIN proveedores p ON p.id = pp.proveedor_id
       WHERE pp.forma_pago = 'cheque' AND pp.estado_cheque = 'pendiente' AND pp.estado != 'anulado'
       ORDER BY pp.fecha_cheque ASC`
    )
    .all();
}

function marcarChequeCobrado(db, { pagoId }) {
  db.prepare("UPDATE pagos_proveedor SET estado_cheque = 'cobrado', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(pagoId);
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('cxp:facturasAbiertas', (event, { proveedorId }) => facturasAbiertasProveedor(getDb(), proveedorId));

  ipcMain.handle('cxp:crearPago', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearPago(db, payload))();
  });
  ipcMain.handle('cxp:anularPago', (event, payload) => {
    const db = getDb();
    return db.transaction(() => anularPago(db, payload))();
  });
  ipcMain.handle('cxp:listarPagos', (event, filtros) => listarPagos(getDb(), filtros || {}));

  ipcMain.handle('cxp:antiguedadSaldos', () => antiguedadSaldos(getDb()));
  ipcMain.handle('cxp:facturasProximasAVencer', () => facturasProximasAVencer(getDb()));
  ipcMain.handle('cxp:chequesPosdatadosPendientes', () => chequesPosdatadosPendientes(getDb()));
  ipcMain.handle('cxp:marcarChequeCobrado', (event, payload) => {
    const db = getDb();
    return db.transaction(() => marcarChequeCobrado(db, payload))();
  });
}

module.exports = {
  register, saldoPorFacturaCompra, facturasAbiertasProveedor, crearPago, anularPago, listarPagos,
  antiguedadSaldos, facturasProximasAVencer, chequesPosdatadosPendientes, marcarChequeCobrado,
};
