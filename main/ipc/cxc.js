const crypto = require('node:crypto');

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

const CUENTA_POR_FORMA_PAGO = { efectivo: '1100', tarjeta: '1200', transferencia: '1200', cheque: '1200' };

// =========================================================================
// Clientes
// =========================================================================

function saldoPendienteCliente(db, clienteId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(dv.total), 0) AS total_facturado
       FROM documentos_venta dv
       WHERE dv.cliente_id = ? AND dv.tipo = 'factura' AND dv.condicion_pago IN ('credito', 'mixto')
         AND dv.estado != 'anulado' AND dv.deleted_at IS NULL`
    )
    .get(clienteId);

  const cobrado = db
    .prepare(
      `SELECT COALESCE(SUM(ria.monto_aplicado), 0) AS total_cobrado
       FROM recibos_ingreso_aplicaciones ria
       JOIN recibos_ingreso ri ON ri.id = ria.recibo_id
       JOIN documentos_venta dv ON dv.id = ria.documento_venta_id
       WHERE dv.cliente_id = ? AND ri.estado != 'anulado'`
    )
    .get(clienteId);

  // La porción en efectivo/tarjeta/transferencia de una factura mixta no es parte del saldo,
  // solo la porción a crédito. Se aproxima restando esos pagos directos registrados en la factura.
  const pagadoEnFactura = db
    .prepare(
      `SELECT COALESCE(SUM(pv.monto), 0) AS total
       FROM pagos_venta pv
       JOIN documentos_venta dv ON dv.id = pv.documento_id
       WHERE dv.cliente_id = ? AND dv.tipo = 'factura' AND dv.condicion_pago = 'mixto'
         AND dv.estado != 'anulado' AND dv.deleted_at IS NULL AND pv.forma_pago != 'credito'`
    )
    .get(clienteId);

  // Notas de crédito sobre CUALQUIER factura del cliente (a crédito o de contado) reducen su
  // saldo; si la factura original era de contado, esto empuja el saldo a negativo = saldo a
  // favor del cliente, tal como pide el Módulo 1 ("reduce CxC o genera saldo a favor").
  const notasCredito = db
    .prepare(
      `SELECT COALESCE(SUM(nc.total), 0) AS total
       FROM documentos_venta nc JOIN documentos_venta f ON f.id = nc.documento_referencia_id
       WHERE nc.tipo = 'nota_credito' AND nc.estado != 'anulado' AND nc.deleted_at IS NULL AND f.cliente_id = ?`
    )
    .get(clienteId).total;

  const notasDebito = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS total FROM documentos_venta
       WHERE tipo = 'nota_debito' AND cliente_id = ? AND estado != 'anulado' AND deleted_at IS NULL`
    )
    .get(clienteId).total;

  return redondear(row.total_facturado - cobrado.total_cobrado - pagadoEnFactura.total - notasCredito + notasDebito);
}

// Saldo pendiente de UN documento específico (factura o nota de débito), para aplicar recibos
// y para reportes de vencidas.
function saldoPorFactura(db, documentoId) {
  const doc = db.prepare('SELECT * FROM documentos_venta WHERE id = ?').get(documentoId);
  if (!doc) return 0;
  const cobrado = db
    .prepare(
      `SELECT COALESCE(SUM(ria.monto_aplicado), 0) AS total FROM recibos_ingreso_aplicaciones ria
       JOIN recibos_ingreso ri ON ri.id = ria.recibo_id WHERE ria.documento_venta_id = ? AND ri.estado != 'anulado'`
    )
    .get(documentoId).total;
  const pagadoDirecto = doc.condicion_pago === 'mixto'
    ? db.prepare("SELECT COALESCE(SUM(monto),0) AS total FROM pagos_venta WHERE documento_id = ? AND forma_pago != 'credito'").get(documentoId).total
    : 0;
  const notaCredito = doc.tipo === 'factura'
    ? db.prepare("SELECT COALESCE(SUM(total),0) AS total FROM documentos_venta WHERE documento_referencia_id = ? AND tipo = 'nota_credito' AND estado != 'anulado' AND deleted_at IS NULL").get(documentoId).total
    : 0;
  return redondear(doc.total - cobrado - pagadoDirecto - notaCredito);
}

function facturasAbiertasCliente(db, clienteId) {
  const documentos = db
    .prepare(
      `SELECT * FROM documentos_venta WHERE cliente_id = ? AND estado != 'anulado' AND deleted_at IS NULL
       AND ((tipo = 'factura' AND condicion_pago IN ('credito','mixto')) OR tipo = 'nota_debito')
       ORDER BY fecha ASC`
    )
    .all(clienteId);
  return documentos
    .map((f) => ({ ...f, saldo_pendiente: saldoPorFactura(db, f.id) }))
    .filter((f) => f.saldo_pendiente > 0.01);
}

function diasCreditoDefault(db) {
  const row = db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'dias_credito_default'").get();
  return row ? parseInt(row.valor, 10) : 30;
}

function diasMoraBloqueo(db) {
  const row = db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'dias_mora_bloqueo_credito'").get();
  return row ? parseInt(row.valor, 10) : 60;
}

function diasMoraFactura(db, factura, diasCredito) {
  const vencimiento = new Date(factura.fecha);
  vencimiento.setDate(vencimiento.getDate() + diasCredito);
  const hoy = new Date();
  return Math.floor((hoy - vencimiento) / (1000 * 60 * 60 * 24));
}

// Verifica si el cliente debe bloquearse automáticamente por mora, además del flag manual
// `bloqueado` y de la validación de límite de crédito que ya hace Ventas.
function verificarBloqueoPorMora(db, clienteId) {
  const cliente = db.prepare('SELECT dias_credito FROM clientes WHERE id = ?').get(clienteId);
  if (!cliente) return null;
  const limiteDias = diasMoraBloqueo(db);
  const facturas = facturasAbiertasCliente(db, clienteId);
  const vencidaSevera = facturas.find((f) => diasMoraFactura(db, f, cliente.dias_credito) > limiteDias);
  if (vencidaSevera) {
    return `Factura ${vencidaSevera.numero} vencida hace más de ${limiteDias} días`;
  }
  return null;
}

function obtenerCliente(db, clienteId) {
  const cliente = db
    .prepare(
      `SELECT c.*, cc.nivel_precio, cc.nombre AS categoria_nombre
       FROM clientes c LEFT JOIN categorias_cliente cc ON cc.id = c.categoria_id
       WHERE c.id = ? AND c.deleted_at IS NULL`
    )
    .get(clienteId);
  if (!cliente) return null;
  const saldo = saldoPendienteCliente(db, clienteId);
  return { ...cliente, saldo_pendiente: saldo, credito_disponible: redondear(cliente.limite_credito - saldo) };
}

function listarClientes(db, { texto = '', limite = 100 } = {}) {
  const like = `%${texto}%`;
  const clientes = db
    .prepare(
      `SELECT c.*, cc.nombre AS categoria_nombre FROM clientes c LEFT JOIN categorias_cliente cc ON cc.id = c.categoria_id
       WHERE c.deleted_at IS NULL AND (c.nombre LIKE ? OR c.rnc_cedula LIKE ?) ORDER BY c.nombre LIMIT ?`
    )
    .all(like, like, limite);
  return clientes.map((c) => ({ ...c, saldo_pendiente: saldoPendienteCliente(db, c.id) }));
}

function guardarCliente(db, payload, clienteIdExistente) {
  session.requerirPermiso('cxc.cliente.editar');
  if (!payload.nombre || !payload.nombre.trim()) throw new Error('El nombre del cliente es obligatorio');
  const clienteId = clienteIdExistente || crypto.randomUUID();

  if (clienteIdExistente) {
    db.prepare(
      `UPDATE clientes SET nombre = ?, rnc_cedula = ?, categoria_id = ?, limite_credito = ?, dias_credito = ?,
         tipo_comprobante_default = ?, es_agente_retencion = ?, pct_retencion_isr = ?, pct_retencion_itbis = ?,
         direccion = ?, telefono = ?, email = ?, bloqueado = ?, motivo_bloqueo = ?, activo = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    ).run(
      payload.nombre.trim(), payload.rncCedula || null, payload.categoriaId || null, payload.limiteCredito || 0,
      payload.diasCredito || 0, payload.tipoComprobanteDefault || 'consumo', payload.esAgenteRetencion ? 1 : 0,
      payload.pctRetencionIsr || 0, payload.pctRetencionItbis || 0, payload.direccion || null, payload.telefono || null,
      payload.email || null, payload.bloqueado ? 1 : 0, payload.motivoBloqueo || null, payload.activo === false ? 0 : 1,
      clienteId
    );
  } else {
    db.prepare(
      `INSERT INTO clientes
         (id, nombre, rnc_cedula, categoria_id, limite_credito, dias_credito, tipo_comprobante_default,
          es_agente_retencion, pct_retencion_isr, pct_retencion_itbis, direccion, telefono, email, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      clienteId, payload.nombre.trim(), payload.rncCedula || null, payload.categoriaId || null,
      payload.limiteCredito || 0, payload.diasCredito || diasCreditoDefault(db), payload.tipoComprobanteDefault || 'consumo',
      payload.esAgenteRetencion ? 1 : 0, payload.pctRetencionIsr || 0, payload.pctRetencionItbis || 0,
      payload.direccion || null, payload.telefono || null, payload.email || null
    );
  }

  return clienteId;
}

// Estado de cuenta: facturas a crédito, notas de crédito/débito y recibos aplicados, en
// orden cronológico. Las notas de crédito se buscan por factura de origen del cliente (no
// tienen cliente_id propio, lo heredan de la factura que devuelven).
function estadoCuenta(db, clienteId) {
  const facturas = db
    .prepare(
      `SELECT id, numero, fecha, total, 'factura' AS tipo FROM documentos_venta
       WHERE cliente_id = ? AND tipo = 'factura' AND condicion_pago IN ('credito','mixto') AND estado != 'anulado' AND deleted_at IS NULL`
    )
    .all(clienteId);
  const notasCredito = db
    .prepare(
      `SELECT nc.id, nc.numero, nc.fecha, nc.total, 'nota_credito' AS tipo FROM documentos_venta nc
       JOIN documentos_venta f ON f.id = nc.documento_referencia_id
       WHERE f.cliente_id = ? AND nc.tipo = 'nota_credito' AND nc.estado != 'anulado' AND nc.deleted_at IS NULL`
    )
    .all(clienteId);
  const notasDebito = db
    .prepare(
      `SELECT id, numero, fecha, total, 'nota_debito' AS tipo FROM documentos_venta
       WHERE cliente_id = ? AND tipo = 'nota_debito' AND estado != 'anulado' AND deleted_at IS NULL`
    )
    .all(clienteId);
  const recibos = db
    .prepare(
      `SELECT ri.id, ri.numero, ri.fecha, ri.monto_total AS total, 'recibo' AS tipo FROM recibos_ingreso ri
       WHERE ri.cliente_id = ? AND ri.estado != 'anulado'`
    )
    .all(clienteId);

  const movimientos = [...facturas, ...notasDebito, ...recibos, ...notasCredito].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  let saldo = 0;
  return movimientos.map((m) => {
    saldo += (m.tipo === 'factura' || m.tipo === 'nota_debito') ? m.total : -m.total;
    return { ...m, saldo_acumulado: redondear(saldo) };
  });
}

// =========================================================================
// Recibos de ingreso (cobros)
// =========================================================================

function crearRecibo(db, { clienteId, fecha, formaPago, referencia, aplicaciones, cajaId, usuarioId }) {
  session.requerirPermiso('cxc.recibo.crear');
  if (!aplicaciones || aplicaciones.length === 0) throw new Error('El recibo debe aplicarse a al menos una factura');

  const montoTotal = redondear(aplicaciones.reduce((acc, a) => acc + a.montoAplicado, 0));
  if (montoTotal <= 0) throw new Error('El monto del recibo debe ser mayor a cero');

  for (const a of aplicaciones) {
    const saldo = saldoPorFactura(db, a.documentoVentaId);
    if (a.montoAplicado > saldo + 0.01) {
      const factura = db.prepare('SELECT numero FROM documentos_venta WHERE id = ?').get(a.documentoVentaId);
      throw new Error(`El monto aplicado a la factura ${factura ? factura.numero : ''} (${a.montoAplicado}) excede su saldo pendiente (${saldo})`);
    }
  }

  let turno = null;
  if (formaPago === 'efectivo') {
    turno = caja.obtenerTurnoAbierto(db, cajaId);
    if (!turno) throw new Error('Debe abrir un turno de caja antes de recibir cobros en efectivo');
  }

  const reciboId = crypto.randomUUID();
  const numero = siguienteNumeroDocumento(db, 'recibos_ingreso');
  const fechaIso = fecha || new Date().toISOString();
  db.prepare(
    `INSERT INTO recibos_ingreso (id, numero, cliente_id, fecha, forma_pago, monto_total, referencia, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(reciboId, numero, clienteId, fechaIso, formaPago, montoTotal, referencia || null, usuarioId);

  const insertAplicacion = db.prepare(
    `INSERT INTO recibos_ingreso_aplicaciones (id, recibo_id, documento_venta_id, monto_aplicado) VALUES (?, ?, ?, ?)`
  );
  for (const a of aplicaciones) {
    insertAplicacion.run(crypto.randomUUID(), reciboId, a.documentoVentaId, a.montoAplicado);
  }

  if (formaPago === 'efectivo') {
    caja.registrarMovimiento(db, {
      turnoCajaId: turno.id, tipo: 'cobro_cxc', concepto: `Recibo de ingreso ${numero}`, monto: montoTotal,
      documentoOrigenTipo: 'recibos_ingreso', documentoOrigenId: reciboId, usuarioId,
    });
  }

  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `Recibo de ingreso ${numero}`, origenModulo: 'cxc',
    origenDocumentoTipo: 'recibos_ingreso', origenDocumentoId: reciboId, usuarioId,
    lineas: [
      { cuentaCodigo: CUENTA_POR_FORMA_PAGO[formaPago] || '1100', debe: montoTotal, descripcion: 'Cobro recibido' },
      { cuentaCodigo: '1400', haber: montoTotal, descripcion: 'Aplicado a cuentas por cobrar' },
    ],
  });

  return reciboId;
}

function anularRecibo(db, { reciboId, motivo, usuarioId }) {
  session.requerirPermiso('cxc.recibo.anular');
  const recibo = db.prepare('SELECT * FROM recibos_ingreso WHERE id = ?').get(reciboId);
  if (!recibo) throw new Error('Recibo no encontrado');
  if (recibo.estado === 'anulado') throw new Error('El recibo ya está anulado');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE recibos_ingreso SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, reciboId);

  const movimientosCaja = db
    .prepare("SELECT * FROM movimientos_caja WHERE documento_origen_tipo = 'recibos_ingreso' AND documento_origen_id = ?")
    .all(reciboId);
  for (const m of movimientosCaja) {
    caja.registrarMovimiento(db, {
      turnoCajaId: m.turno_caja_id, tipo: 'cobro_cxc', concepto: `Anulación recibo ${recibo.numero}`,
      monto: -m.monto, documentoOrigenTipo: 'recibos_ingreso_anulacion', documentoOrigenId: reciboId, usuarioId,
    });
  }

  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'recibos_ingreso' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(reciboId);
  const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
  const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
  for (const asiento of asientos) {
    const detalle = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'cxc',
      origenDocumentoTipo: 'recibos_ingreso_anulacion', origenDocumentoId: reciboId, usuarioId,
      lineas: detalle.map((d) => ({ cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
    });
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'cxc', entidad: 'recibos_ingreso', entidadId: reciboId, accion: 'anular', detalle: { numero: recibo.numero, motivo },
  });
}

function listarRecibos(db, { clienteId, limite = 50 } = {}) {
  const condiciones = [];
  const params = [];
  if (clienteId) { condiciones.push('ri.cliente_id = ?'); params.push(clienteId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT ri.*, c.nombre AS cliente_nombre, u.nombre_completo AS usuario_nombre
       FROM recibos_ingreso ri JOIN clientes c ON c.id = ri.cliente_id LEFT JOIN usuarios u ON u.id = ri.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY ri.fecha DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// Reportes: antigüedad de saldos y facturas vencidas
// =========================================================================

function tramoPorDiasMora(dias) {
  if (dias <= 0) return 'corriente';
  if (dias <= 30) return 'dias_0_30';
  if (dias <= 60) return 'dias_31_60';
  if (dias <= 90) return 'dias_61_90';
  return 'dias_90_mas';
}

function antiguedadSaldos(db) {
  const clientes = db.prepare('SELECT id, nombre, dias_credito FROM clientes WHERE deleted_at IS NULL AND activo = 1').all();
  const resultado = [];
  for (const cliente of clientes) {
    const facturas = facturasAbiertasCliente(db, cliente.id);
    if (facturas.length === 0) continue;
    const tramos = { corriente: 0, dias_0_30: 0, dias_31_60: 0, dias_61_90: 0, dias_90_mas: 0 };
    for (const f of facturas) {
      const dias = diasMoraFactura(db, f, cliente.dias_credito);
      tramos[tramoPorDiasMora(dias)] += f.saldo_pendiente;
    }
    const total = Object.values(tramos).reduce((a, b) => a + b, 0);
    resultado.push({ clienteId: cliente.id, clienteNombre: cliente.nombre, total: redondear(total), tramos });
  }
  return resultado;
}

function facturasVencidas(db) {
  const clientes = db.prepare('SELECT id, nombre, dias_credito, telefono FROM clientes WHERE deleted_at IS NULL').all();
  const resultado = [];
  for (const cliente of clientes) {
    const facturas = facturasAbiertasCliente(db, cliente.id);
    for (const f of facturas) {
      const dias = diasMoraFactura(db, f, cliente.dias_credito);
      if (dias > 0) resultado.push({ ...f, cliente_nombre: cliente.nombre, cliente_telefono: cliente.telefono, dias_mora: dias });
    }
  }
  return resultado.sort((a, b) => b.dias_mora - a.dias_mora);
}

// =========================================================================
// Gestión de cobros
// =========================================================================

function crearGestionCobro(db, { clienteId, fechaContacto, tipoContacto, notas, resultado, proximaFechaContacto, usuarioId }) {
  session.requerirPermiso('cxc.gestion_cobro.crear');
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO gestion_cobros (id, cliente_id, fecha_contacto, tipo_contacto, notas, resultado, proxima_fecha_contacto, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, clienteId, fechaContacto || new Date().toISOString(), tipoContacto, notas || null, resultado || null, proximaFechaContacto || null, usuarioId);
  return id;
}

function listarGestionCobros(db, { clienteId, limite = 50 } = {}) {
  const condiciones = [];
  const params = [];
  if (clienteId) { condiciones.push('g.cliente_id = ?'); params.push(clienteId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT g.*, c.nombre AS cliente_nombre, u.nombre_completo AS usuario_nombre FROM gestion_cobros g
       JOIN clientes c ON c.id = g.cliente_id LEFT JOIN usuarios u ON u.id = g.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY g.fecha_contacto DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// CxC de empleados
// =========================================================================

function crearCxcEmpleado(db, { usuarioId, tipo, monto, descuentoSugeridoNomina, fecha, notas, usuarioRegistroId }) {
  if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO cxc_empleados
       (id, usuario_id, tipo, monto, saldo_pendiente, descuento_sugerido_nomina, fecha, notas, usuario_registro_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, usuarioId, tipo, monto, monto, descuentoSugeridoNomina || 0, fecha || new Date().toISOString(), notas || null, usuarioRegistroId);
  return id;
}

function registrarPagoCxcEmpleado(db, { cxcEmpleadoId, monto, usuarioId }) {
  const cxc = db.prepare('SELECT * FROM cxc_empleados WHERE id = ?').get(cxcEmpleadoId);
  if (!cxc) throw new Error('Registro no encontrado');
  if (monto > cxc.saldo_pendiente + 0.01) throw new Error('El monto excede el saldo pendiente');

  db.prepare('INSERT INTO cxc_empleados_pagos (id, cxc_empleado_id, monto, fecha, usuario_id) VALUES (?, ?, ?, strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'), ?)')
    .run(crypto.randomUUID(), cxcEmpleadoId, monto, usuarioId);

  const nuevoSaldo = redondear(cxc.saldo_pendiente - monto);
  db.prepare(
    `UPDATE cxc_empleados SET saldo_pendiente = ?, estado = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(nuevoSaldo, nuevoSaldo <= 0.01 ? 'pagado' : 'pendiente', cxcEmpleadoId);
}

function listarCxcEmpleados(db, { usuarioId, limite = 50 } = {}) {
  const condiciones = [];
  const params = [];
  if (usuarioId) { condiciones.push('ce.usuario_id = ?'); params.push(usuarioId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT ce.*, u.nombre_completo AS empleado_nombre FROM cxc_empleados ce JOIN usuarios u ON u.id = ce.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY ce.fecha DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('clientes:buscar', (event, { texto, limite = 20 }) => {
    const db = getDb();
    const like = `%${texto || ''}%`;
    return db
      .prepare(
        `SELECT id, nombre, rnc_cedula, categoria_id, limite_credito, bloqueado
         FROM clientes WHERE deleted_at IS NULL AND activo = 1 AND (nombre LIKE ? OR rnc_cedula LIKE ?)
         ORDER BY nombre LIMIT ?`
      )
      .all(like, like, limite);
  });
  ipcMain.handle('clientes:obtener', (event, { clienteId }) => obtenerCliente(getDb(), clienteId));
  ipcMain.handle('clientes:listar', (event, filtros) => listarClientes(getDb(), filtros || {}));
  ipcMain.handle('clientes:categorias', () => getDb().prepare('SELECT id, nombre, nivel_precio FROM categorias_cliente WHERE deleted_at IS NULL').all());
  ipcMain.handle('clientes:crear', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => guardarCliente(db, payload))();
    return obtenerCliente(db, id);
  });
  ipcMain.handle('clientes:guardar', (event, { clienteId, payload }) => {
    const db = getDb();
    const id = db.transaction(() => guardarCliente(db, payload, clienteId))();
    return obtenerCliente(db, id);
  });
  ipcMain.handle('clientes:facturasAbiertas', (event, { clienteId }) => facturasAbiertasCliente(getDb(), clienteId));
  ipcMain.handle('clientes:estadoCuenta', (event, { clienteId }) => estadoCuenta(getDb(), clienteId));

  ipcMain.handle('cxc:crearRecibo', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearRecibo(db, payload))();
  });
  ipcMain.handle('cxc:anularRecibo', (event, payload) => {
    const db = getDb();
    return db.transaction(() => anularRecibo(db, payload))();
  });
  ipcMain.handle('cxc:listarRecibos', (event, filtros) => listarRecibos(getDb(), filtros || {}));

  ipcMain.handle('cxc:antiguedadSaldos', () => antiguedadSaldos(getDb()));
  ipcMain.handle('cxc:facturasVencidas', () => facturasVencidas(getDb()));

  ipcMain.handle('cxc:crearGestionCobro', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearGestionCobro(db, payload))();
  });
  ipcMain.handle('cxc:listarGestionCobros', (event, filtros) => listarGestionCobros(getDb(), filtros || {}));

  ipcMain.handle('cxc:crearCxcEmpleado', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearCxcEmpleado(db, payload))();
  });
  ipcMain.handle('cxc:registrarPagoCxcEmpleado', (event, payload) => {
    const db = getDb();
    return db.transaction(() => registrarPagoCxcEmpleado(db, payload))();
  });
  ipcMain.handle('cxc:listarCxcEmpleados', (event, filtros) => listarCxcEmpleados(getDb(), filtros || {}));
}

module.exports = {
  register, obtenerCliente, saldoPendienteCliente, saldoPorFactura, facturasAbiertasCliente,
  verificarBloqueoPorMora, guardarCliente, listarClientes, estadoCuenta,
  crearRecibo, anularRecibo, listarRecibos, antiguedadSaldos, facturasVencidas,
  crearGestionCobro, listarGestionCobros, crearCxcEmpleado, registrarPagoCxcEmpleado, listarCxcEmpleados,
};
