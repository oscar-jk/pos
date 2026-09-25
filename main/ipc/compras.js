const crypto = require('node:crypto');

const inventario = require('./inventario');
const contabilidad = require('./contabilidad');
const caja = require('./caja');
const configuracion = require('./configuracion');
const session = require('../auth/session');

// Módulo 3. Cubre: ficha de proveedor, orden de compra (documento de intención, no mueve
// inventario), y "factura de compra" — que actúa como la recepción real de mercancía
// (mueve inventario, actualiza costo) y, si trae NCF/condición de pago, también como la
// factura que genera el pasivo — fusionando ambos roles en un solo acto, que es como
// ocurre en la mayoría de compras de un negocio pequeño cuando el proveedor entrega la
// factura junto con la mercancía. Puede crearse suelta o contra una orden de compra
// (con recepción parcial). También notas de crédito (devolución a proveedor o rebaja de
// precio) y de débito (aumento de precio) sobre una factura de compra. Quedan fuera:
// presupuesto/cotización de compra como documento separado y liquidación de mercancía importada.

function redondear(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function siguienteNumero(db, tipo) {
  const row = db.prepare('SELECT MAX(CAST(numero AS INTEGER)) AS maximo FROM documentos_compra WHERE tipo = ?').get(tipo);
  return String((row.maximo || 0) + 1).padStart(6, '0');
}

// =========================================================================
// Proveedores
// =========================================================================

// Saldo de un documento por pagar (factura de compra o nota de débito):
//   total − lo pagado al contado − pagos aplicados − notas de crédito que lo referencian.
// Si las notas de crédito superan lo que se debía (p. ej. devolución de una compra ya pagada),
// el exceso es saldo a favor del negocio con ese proveedor.
function saldoDocumentoCompra(db, doc) {
  const pagos = db
    .prepare(
      `SELECT COALESCE(SUM(ppa.monto_aplicado), 0) AS total FROM pagos_proveedor_aplicaciones ppa
       JOIN pagos_proveedor pp ON pp.id = ppa.pago_id WHERE ppa.documento_compra_id = ? AND pp.estado != 'anulado'`
    )
    .get(doc.id).total;
  const pagadoAlContado = doc.tipo === 'factura_compra' && doc.condicion_pago === 'contado' ? doc.total : 0;
  const notasCredito = doc.tipo === 'factura_compra'
    ? db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM documentos_compra WHERE tipo = 'nota_credito' AND documento_referencia_id = ? AND estado != 'anulado' AND deleted_at IS NULL").get(doc.id).total
    : 0;
  const saldo = redondear(doc.total - pagadoAlContado - pagos - notasCredito);
  return { saldo, pendiente: Math.max(0, saldo), exceso: Math.max(0, -saldo) };
}

function documentosPorPagarProveedor(db, proveedorId) {
  return db
    .prepare(
      `SELECT * FROM documentos_compra WHERE proveedor_id = ? AND tipo IN ('factura_compra', 'nota_debito')
       AND estado != 'anulado' AND deleted_at IS NULL ORDER BY fecha ASC`
    )
    .all(proveedorId);
}

function saldoPendienteProveedor(db, proveedorId) {
  return redondear(documentosPorPagarProveedor(db, proveedorId).reduce((acc, d) => acc + saldoDocumentoCompra(db, d).pendiente, 0));
}

// Crédito que el proveedor le debe al negocio: excesos de notas de crédito, menos lo ya usado
// como forma de pago ('saldo_a_favor') o devuelto por el proveedor ('reembolso_*').
function saldoAFavorProveedor(db, proveedorId) {
  const excesos = documentosPorPagarProveedor(db, proveedorId)
    .filter((d) => d.tipo === 'factura_compra')
    .reduce((acc, d) => acc + saldoDocumentoCompra(db, d).exceso, 0);
  const usado = db
    .prepare(
      `SELECT COALESCE(SUM(monto_total), 0) AS total FROM pagos_proveedor
       WHERE proveedor_id = ? AND estado != 'anulado' AND (forma_pago = 'saldo_a_favor' OR forma_pago LIKE 'reembolso_%')`
    )
    .get(proveedorId).total;
  return redondear(excesos - usado);
}

function obtenerProveedor(db, proveedorId) {
  const proveedor = db.prepare('SELECT * FROM proveedores WHERE id = ? AND deleted_at IS NULL').get(proveedorId);
  if (!proveedor) return null;
  return { ...proveedor, saldo_pendiente: saldoPendienteProveedor(db, proveedorId), saldo_a_favor: saldoAFavorProveedor(db, proveedorId) };
}

function listarProveedores(db, { texto = '', limite = 100 } = {}) {
  const like = `%${texto}%`;
  const proveedores = db
    .prepare(
      `SELECT * FROM proveedores WHERE deleted_at IS NULL AND (nombre LIKE ? OR rnc LIKE ?) ORDER BY nombre LIMIT ?`
    )
    .all(like, like, limite);
  return proveedores.map((p) => ({ ...p, saldo_pendiente: saldoPendienteProveedor(db, p.id), saldo_a_favor: saldoAFavorProveedor(db, p.id) }));
}

function guardarProveedor(db, payload, proveedorIdExistente) {
  if (!payload.nombre || !payload.nombre.trim()) throw new Error('El nombre del proveedor es obligatorio');
  const proveedorId = proveedorIdExistente || crypto.randomUUID();

  if (proveedorIdExistente) {
    db.prepare(
      `UPDATE proveedores SET nombre = ?, rnc = ?, dias_credito = ?, direccion = ?, telefono = ?, email = ?,
         activo = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(
      payload.nombre.trim(), payload.rnc || null, payload.diasCredito || 0, payload.direccion || null,
      payload.telefono || null, payload.email || null, payload.activo === false ? 0 : 1, proveedorId
    );
  } else {
    db.prepare(
      `INSERT INTO proveedores (id, nombre, rnc, dias_credito, direccion, telefono, email, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(proveedorId, payload.nombre.trim(), payload.rnc || null, payload.diasCredito || 0, payload.direccion || null, payload.telefono || null, payload.email || null);
  }
  return proveedorId;
}

// =========================================================================
// Orden de compra (documento de intención — nunca mueve inventario ni costo)
// =========================================================================

function crearOrdenCompra(db, { proveedorId, lineas, usuarioId }) {
  session.requerirPermiso('compras.orden.crear');
  if (!lineas || lineas.length === 0) throw new Error('La orden de compra debe tener al menos una línea');
  const proveedor = db.prepare('SELECT * FROM proveedores WHERE id = ? AND deleted_at IS NULL').get(proveedorId);
  if (!proveedor) throw new Error('Proveedor no encontrado');

  const lineasCalc = lineas.map((l) => {
    const producto = db.prepare('SELECT p.*, t.porcentaje AS tasa_itbis_pct FROM productos p JOIN tasas_itbis t ON t.id = p.tasa_itbis_id WHERE p.id = ?').get(l.productoId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
    const baseImponible = redondear(l.costoUnitario * l.cantidad);
    const itbisMonto = redondear(baseImponible * producto.tasa_itbis_pct);
    return { producto, cantidad: l.cantidad, costoUnitario: l.costoUnitario, tasaItbis: producto.tasa_itbis_pct, baseImponible, itbisMonto, totalLinea: redondear(baseImponible + itbisMonto) };
  });
  const subtotal = redondear(lineasCalc.reduce((acc, l) => acc + l.baseImponible, 0));
  const itbisTotal = redondear(lineasCalc.reduce((acc, l) => acc + l.itbisMonto, 0));
  const total = redondear(subtotal + itbisTotal);

  const documentoId = crypto.randomUUID();
  const numero = siguienteNumero(db, 'orden_compra');
  db.prepare(
    `INSERT INTO documentos_compra (id, tipo, numero, proveedor_id, fecha, condicion_pago, subtotal, itbis_total, total, estado, usuario_id)
     VALUES (?, 'orden_compra', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'credito', ?, ?, ?, 'abierto', ?)`
  ).run(documentoId, numero, proveedorId, subtotal, itbisTotal, total, usuarioId);

  const insertDetalle = db.prepare(
    `INSERT INTO documentos_compra_detalle (id, documento_id, producto_id, cantidad, cantidad_recibida, costo_unitario, tasa_itbis, itbis_monto, total_linea)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
  );
  for (const l of lineasCalc) {
    insertDetalle.run(crypto.randomUUID(), documentoId, l.producto.id, l.cantidad, l.costoUnitario, l.tasaItbis, l.itbisMonto, l.totalLinea);
  }

  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'compras', entidad: 'documentos_compra', entidadId: documentoId, accion: 'crear', detalle: { numero, tipo: 'orden_compra' } });
  return documentoId;
}

function listarOrdenesCompra(db, { estado, proveedorId, limite = 50 } = {}) {
  const condiciones = ["tipo = 'orden_compra'"];
  const params = [];
  if (estado) { condiciones.push('estado = ?'); params.push(estado); }
  if (proveedorId) { condiciones.push('proveedor_id = ?'); params.push(proveedorId); }
  params.push(limite);
  const ordenes = db
    .prepare(`SELECT dc.*, p.nombre AS proveedor_nombre FROM documentos_compra dc JOIN proveedores p ON p.id = dc.proveedor_id WHERE ${condiciones.join(' AND ')} ORDER BY dc.fecha DESC LIMIT ?`)
    .all(...params);
  return ordenes.map((o) => {
    const lineas = db.prepare('SELECT cantidad, cantidad_recibida FROM documentos_compra_detalle WHERE documento_id = ?').all(o.id);
    const totalCantidad = lineas.reduce((acc, l) => acc + l.cantidad, 0);
    const totalRecibido = lineas.reduce((acc, l) => acc + l.cantidad_recibida, 0);
    return { ...o, porcentaje_recibido: totalCantidad > 0 ? redondear((totalRecibido / totalCantidad) * 100) : 0 };
  });
}

function obtenerOrdenCompra(db, documentoId) {
  const documento = db
    .prepare(`SELECT dc.*, p.nombre AS proveedor_nombre FROM documentos_compra dc JOIN proveedores p ON p.id = dc.proveedor_id WHERE dc.id = ?`)
    .get(documentoId);
  if (!documento) return null;
  documento.lineas = db
    .prepare(`SELECT dcd.*, pr.descripcion AS producto_descripcion, pr.codigo_interno FROM documentos_compra_detalle dcd JOIN productos pr ON pr.id = dcd.producto_id WHERE dcd.documento_id = ?`)
    .all(documentoId)
    .map((l) => ({ ...l, pendiente: redondear(l.cantidad - l.cantidad_recibida) }));
  return documento;
}

function anularOrdenCompra(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('compras.orden.crear');
  const documento = db.prepare('SELECT * FROM documentos_compra WHERE id = ?').get(documentoId);
  if (!documento) throw new Error('Orden de compra no encontrada');
  if (documento.estado === 'anulado') throw new Error('La orden ya está anulada');
  if (documento.estado !== 'abierto') throw new Error('Solo se puede anular una orden que todavía no tiene mercancía recibida');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE documentos_compra SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'compras', entidad: 'documentos_compra', entidadId: documentoId, accion: 'anular', detalle: { numero: documento.numero, motivo } });
}

function actualizarEstadoOrdenCompra(db, ordenId) {
  const lineas = db.prepare('SELECT cantidad, cantidad_recibida FROM documentos_compra_detalle WHERE documento_id = ?').all(ordenId);
  const totalCantidad = lineas.reduce((acc, l) => acc + l.cantidad, 0);
  const totalRecibido = lineas.reduce((acc, l) => acc + l.cantidad_recibida, 0);
  const estado = totalCantidad > 0 && totalRecibido >= totalCantidad ? 'recibido_total' : (totalRecibido > 0 ? 'recibido_parcial' : 'abierto');
  db.prepare("UPDATE documentos_compra SET estado = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(estado, ordenId);
}

// =========================================================================
// Factura de compra / recepción (mueve inventario, actualiza costo, genera CxP si es a
// crédito). Si trae ordenCompraId, además registra lo recibido contra esa orden.
// =========================================================================

function crearFacturaCompra(db, payload) {
  session.requerirPermiso('compras.factura.crear');
  const { proveedorId, almacenId, sucursalId, ncfProveedor, condicionPago, diasCredito, lineas, pagos, usuarioId, cajaId, ordenCompraId } = payload;
  if (!lineas || lineas.length === 0) throw new Error('La factura de compra debe tener al menos una línea');

  const proveedor = db.prepare('SELECT * FROM proveedores WHERE id = ? AND deleted_at IS NULL').get(proveedorId);
  if (!proveedor) throw new Error('Proveedor no encontrado');

  if (ordenCompraId) {
    const orden = db.prepare('SELECT * FROM documentos_compra WHERE id = ?').get(ordenCompraId);
    if (!orden || orden.estado === 'anulado') throw new Error('Orden de compra no encontrada o anulada');
    for (const l of lineas) {
      if (!l.ordenDetalleId) continue;
      const detalleOrden = db.prepare('SELECT * FROM documentos_compra_detalle WHERE id = ?').get(l.ordenDetalleId);
      const pendiente = redondear(detalleOrden.cantidad - detalleOrden.cantidad_recibida);
      if (l.cantidad > pendiente + 0.001) {
        throw new Error(`La cantidad a recibir (${l.cantidad}) excede lo pendiente de la orden (${pendiente})`);
      }
    }
  }

  const lineasCalculadas = lineas.map((l) => {
    const producto = db.prepare('SELECT p.*, t.porcentaje AS tasa_itbis_pct FROM productos p JOIN tasas_itbis t ON t.id = p.tasa_itbis_id WHERE p.id = ?').get(l.productoId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
    const baseImponible = redondear(l.costoUnitario * l.cantidad);
    const itbisMonto = redondear(baseImponible * producto.tasa_itbis_pct);
    const totalLinea = redondear(baseImponible + itbisMonto);
    return { producto, cantidad: l.cantidad, costoUnitario: l.costoUnitario, tasaItbis: producto.tasa_itbis_pct, baseImponible, itbisMonto, totalLinea, ordenDetalleId: l.ordenDetalleId || null };
  });

  const subtotal = redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
  const itbisTotal = redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
  const total = redondear(subtotal + itbisTotal);

  const sumaPagos = redondear((pagos || []).reduce((acc, p) => acc + p.monto, 0));
  const montoCredito = redondear((pagos || []).filter((p) => p.formaPago === 'credito').reduce((acc, p) => acc + p.monto, 0));
  if (Math.abs(sumaPagos - total) > 0.01) {
    throw new Error(`Los pagos (${sumaPagos}) no cuadran con el total de la factura (${total})`);
  }

  const montoEfectivo = redondear((pagos || []).filter((p) => p.formaPago === 'efectivo').reduce((acc, p) => acc + p.monto, 0));
  let turno = null;
  if (montoEfectivo > 0) {
    turno = caja.obtenerTurnoAbierto(db, cajaId);
    if (!turno) throw new Error('Debe abrir un turno de caja antes de pagar una compra en efectivo');
  }

  const documentoId = crypto.randomUUID();
  const numero = siguienteNumero(db, 'factura_compra');
  const fechaIso = new Date().toISOString();
  const dias = diasCredito ?? proveedor.dias_credito;
  const fechaVencimiento = new Date();
  fechaVencimiento.setDate(fechaVencimiento.getDate() + (montoCredito > 0 ? dias : 0));

  db.prepare(
    `INSERT INTO documentos_compra
       (id, tipo, numero, proveedor_id, almacen_id, ncf_proveedor, documento_referencia_id, fecha, condicion_pago,
        dias_credito, fecha_vencimiento, subtotal, itbis_total, total, estado, usuario_id)
     VALUES (?, 'factura_compra', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'facturado', ?)`
  ).run(
    documentoId, numero, proveedorId, almacenId, ncfProveedor || null, ordenCompraId || null, fechaIso,
    montoCredito > 0 ? (sumaPagos > montoCredito ? 'mixto' : 'credito') : 'contado', dias,
    fechaVencimiento.toISOString(), subtotal, itbisTotal, total, usuarioId
  );

  const insertDetalle = db.prepare(
    `INSERT INTO documentos_compra_detalle
       (id, documento_id, producto_id, cantidad, cantidad_recibida, costo_unitario, tasa_itbis, itbis_monto, total_linea)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const sumarRecibidoOrden = db.prepare('UPDATE documentos_compra_detalle SET cantidad_recibida = cantidad_recibida + ? WHERE id = ?');
  for (const l of lineasCalculadas) {
    insertDetalle.run(crypto.randomUUID(), documentoId, l.producto.id, l.cantidad, l.cantidad, l.costoUnitario, l.tasaItbis, l.itbisMonto, l.totalLinea);
    inventario.registrarMovimientoInventario(db, {
      productoId: l.producto.id, almacenId, tipoMovimiento: 'entrada_compra', cantidad: l.cantidad,
      costoUnitario: l.costoUnitario, documentoOrigenTipo: 'documentos_compra', documentoOrigenId: documentoId, usuarioId,
    });
    if (l.ordenDetalleId) sumarRecibidoOrden.run(l.cantidad, l.ordenDetalleId);
  }
  if (ordenCompraId) actualizarEstadoOrdenCompra(db, ordenCompraId);

  const CUENTA_POR_FORMA_PAGO = { efectivo: '1100', tarjeta: '1200', transferencia: '1200', cheque: '1200', credito: '2100' };
  const lineasAsiento = [
    { cuentaCodigo: '1300', debe: subtotal, descripcion: 'Entrada de inventario' },
  ];
  if (itbisTotal > 0) lineasAsiento.push({ cuentaCodigo: '1500', debe: itbisTotal, descripcion: 'ITBIS pagado (crédito fiscal)' });
  for (const forma of ['efectivo', 'tarjeta', 'transferencia', 'cheque', 'credito']) {
    const monto = redondear((pagos || []).filter((p) => p.formaPago === forma).reduce((acc, p) => acc + p.monto, 0));
    if (monto > 0) lineasAsiento.push({ cuentaCodigo: CUENTA_POR_FORMA_PAGO[forma], haber: monto, descripcion: `Compra ${forma}` });
  }
  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `Factura de compra ${numero}`, origenModulo: 'compras',
    origenDocumentoTipo: 'documentos_compra', origenDocumentoId: documentoId, usuarioId, lineas: lineasAsiento,
  });

  // Nota: las formas de pago directas de la compra (no crédito) se registran como movimiento de
  // caja cuando son en efectivo; documentos_compra no tiene una tabla de pagos_directos propia
  // como documentos_venta — el asiento contable de arriba ya refleja el resto de formas de pago.
  for (const p of (pagos || [])) {
    if (p.formaPago === 'efectivo' && p.monto > 0) {
      caja.registrarMovimiento(db, {
        turnoCajaId: turno.id, tipo: 'salida_manual', concepto: `Pago compra ${numero}`, monto: -p.monto,
        documentoOrigenTipo: 'documentos_compra', documentoOrigenId: documentoId, usuarioId,
      });
    }
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'compras', entidad: 'documentos_compra', entidadId: documentoId, accion: 'crear', detalle: { numero, total, tipo: 'factura_compra' },
  });

  return documentoId;
}

function anularFacturaCompra(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('compras.factura.anular');
  const documento = db.prepare('SELECT * FROM documentos_compra WHERE id = ?').get(documentoId);
  if (!documento) throw new Error('Factura de compra no encontrada');
  if (documento.estado === 'anulado') throw new Error('La factura ya está anulada');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
  const notas = db
    .prepare("SELECT numero, tipo FROM documentos_compra WHERE documento_referencia_id = ? AND tipo IN ('nota_credito', 'nota_debito') AND estado != 'anulado' AND deleted_at IS NULL")
    .all(documentoId);
  if (notas.length > 0) {
    throw new Error(`La factura tiene notas de compra activas (${notas.map((n) => `${n.tipo === 'nota_credito' ? 'NC' : 'ND'} ${n.numero}`).join(', ')}). Anúlelas primero.`);
  }

  db.prepare(
    `UPDATE documentos_compra SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);

  const detalle = db.prepare('SELECT * FROM documentos_compra_detalle WHERE documento_id = ?').all(documentoId);
  for (const l of detalle) {
    inventario.registrarMovimientoInventario(db, {
      productoId: l.producto_id, almacenId: documento.almacen_id, tipoMovimiento: 'ajuste_salida',
      cantidad: -l.cantidad, costoUnitario: l.costo_unitario, documentoOrigenTipo: 'documentos_compra_anulacion',
      documentoOrigenId: documentoId, usuarioId,
    });
    // Si esta factura venía contra una orden de compra, revierte lo recibido en esa línea
    // (se empareja por producto dentro de la misma orden; no hay una columna que enlace
    // directamente la línea de la factura con la línea de la orden que originó).
    if (documento.documento_referencia_id) {
      const detalleOrden = db
        .prepare('SELECT * FROM documentos_compra_detalle WHERE documento_id = ? AND producto_id = ?')
        .get(documento.documento_referencia_id, l.producto_id);
      if (detalleOrden) {
        db.prepare('UPDATE documentos_compra_detalle SET cantidad_recibida = MAX(0, cantidad_recibida - ?) WHERE id = ?').run(l.cantidad, detalleOrden.id);
      }
    }
  }
  if (documento.documento_referencia_id) actualizarEstadoOrdenCompra(db, documento.documento_referencia_id);

  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'documentos_compra' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(documentoId);
  const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
  const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
  for (const asiento of asientos) {
    const det = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'compras',
      origenDocumentoTipo: 'documentos_compra_anulacion', origenDocumentoId: documentoId, usuarioId,
      lineas: det.map((d) => ({ cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
    });
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'compras', entidad: 'documentos_compra', entidadId: documentoId, accion: 'anular', detalle: { numero: documento.numero, motivo },
  });
}

function listarFacturasCompra(db, { proveedorId, limite = 50 } = {}) {
  const condiciones = ["tipo = 'factura_compra'"];
  const params = [];
  if (proveedorId) { condiciones.push('proveedor_id = ?'); params.push(proveedorId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT dc.*, p.nombre AS proveedor_nombre FROM documentos_compra dc JOIN proveedores p ON p.id = dc.proveedor_id
       WHERE ${condiciones.join(' AND ')} ORDER BY dc.fecha DESC LIMIT ?`
    )
    .all(...params);
}

function obtenerFacturaCompra(db, documentoId) {
  const documento = db
    .prepare(`SELECT dc.*, p.nombre AS proveedor_nombre FROM documentos_compra dc JOIN proveedores p ON p.id = dc.proveedor_id WHERE dc.id = ?`)
    .get(documentoId);
  if (!documento) return null;
  documento.lineas = db
    .prepare(`SELECT dcd.*, p.descripcion AS producto_descripcion FROM documentos_compra_detalle dcd JOIN productos p ON p.id = dcd.producto_id WHERE dcd.documento_id = ?`)
    .all(documentoId);
  return documento;
}

// =========================================================================
// Notas de crédito y débito de compra
// =========================================================================
//
// Siempre se emiten contra una factura de compra:
//   - Nota de crédito, devolución: saca mercancía del inventario al costo de la factura.
//   - Nota de crédito, ajuste de costo: el proveedor rebaja el precio (sin devolver mercancía).
//   - Nota de débito, ajuste de costo: el proveedor sube el precio. Es un documento por pagar.
// En los ajustes de costo, la parte proporcional a la mercancía que sigue en existencia mueve el
// costo promedio (Inventario 1300) y la parte que ya se vendió va a Costo de Ventas (5100).
// La nota de crédito reduce el saldo de la factura; si lo supera, queda saldo a favor.

const TIPOS_NOTA = ['nota_credito', 'nota_debito'];

function existenciaTotalProducto(db, productoId) {
  return db.prepare('SELECT COALESCE(SUM(cantidad_disponible), 0) AS total FROM existencias WHERE producto_id = ?').get(productoId).total;
}

function cantidadDevueltaLinea(db, detalleFacturaId) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(d.cantidad), 0) AS total FROM documentos_compra_detalle d
       JOIN documentos_compra n ON n.id = d.documento_id
       WHERE d.detalle_referencia_id = ? AND n.tipo = 'nota_credito' AND n.tipo_ajuste = 'devolucion'
         AND n.estado != 'anulado' AND n.deleted_at IS NULL`
    )
    .get(detalleFacturaId).total;
}

function obtenerFacturaVigente(db, facturaId) {
  const factura = db.prepare("SELECT * FROM documentos_compra WHERE id = ? AND tipo = 'factura_compra' AND deleted_at IS NULL").get(facturaId);
  if (!factura) throw new Error('Factura de compra no encontrada');
  if (factura.estado === 'anulado') throw new Error('La factura de compra está anulada');
  return factura;
}

// Líneas de la factura con lo que todavía se puede devolver, para armar la nota.
function lineasParaNota(db, facturaId) {
  const factura = obtenerFacturaVigente(db, facturaId);
  return db
    .prepare(
      `SELECT d.*, p.descripcion AS producto_descripcion, p.codigo_interno FROM documentos_compra_detalle d
       JOIN productos p ON p.id = d.producto_id WHERE d.documento_id = ? AND d.deleted_at IS NULL`
    )
    .all(facturaId)
    .map((l) => {
      const devuelta = cantidadDevueltaLinea(db, l.id);
      return {
        ...l, cantidad_devuelta: devuelta, disponible_devolver: redondear(l.cantidad - devuelta),
        existencia_almacen: inventario.existenciaDisponible(db, l.producto_id, factura.almacen_id),
      };
    });
}

function actualizarCostoPromedio(db, productoId, costo) {
  db.prepare("UPDATE productos SET costo_promedio = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(costo, productoId);
}

// Devolución: sale la mercancía al costo de la factura y el costo promedio se recalcula para
// que el valor que queda en inventario baje exactamente lo devuelto. Si eso no se puede (no
// queda existencia, o el promedio quedaría negativo), la diferencia entre el valor que sale
// del inventario y lo que acredita el proveedor va a Costo de Ventas.
function aplicarDevolucion(db, { lineaFactura, cantidad, factura, documentoId, usuarioId }) {
  const producto = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(lineaFactura.producto_id);
  const base = redondear(cantidad * lineaFactura.costo_unitario);
  const existenciaAntes = existenciaTotalProducto(db, lineaFactura.producto_id);
  const promedio = producto.costo_promedio || 0;
  const existenciaDespues = redondear(existenciaAntes - cantidad);
  const nuevoPromedio = existenciaDespues > 0 ? Math.max(0, redondear((existenciaAntes * promedio - base) / existenciaDespues)) : promedio;
  const valorSalida = redondear(existenciaAntes * promedio - Math.max(0, existenciaDespues) * nuevoPromedio);

  inventario.registrarMovimientoInventario(db, {
    productoId: lineaFactura.producto_id, almacenId: factura.almacen_id, tipoMovimiento: 'devolucion_compra',
    cantidad: -cantidad, costoUnitario: lineaFactura.costo_unitario, documentoOrigenTipo: 'documentos_compra',
    documentoOrigenId: documentoId, usuarioId,
  });
  if (existenciaDespues > 0) actualizarCostoPromedio(db, lineaFactura.producto_id, nuevoPromedio);
  return { base, montoInventario: valorSalida, montoCostoVentas: redondear(base - valorSalida) };
}

// Ajuste de costo (signo +1 nota de débito, −1 nota de crédito). La proporción que sigue en
// existencia se estima como existencia actual ÷ unidades netas compradas en la factura (con
// costo promedio no se puede saber qué unidades exactas se vendieron).
function aplicarAjusteCosto(db, { lineaFactura, base, signo, factura, documentoId, usuarioId }) {
  const producto = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(lineaFactura.producto_id);
  const promedio = producto.costo_promedio || 0;
  const existencia = existenciaTotalProducto(db, lineaFactura.producto_id);
  const unidadesNetas = redondear(lineaFactura.cantidad - cantidadDevueltaLinea(db, lineaFactura.id));
  const proporcion = unidadesNetas > 0 ? Math.min(1, Math.max(0, existencia) / unidadesNetas) : 0;
  let montoInventario = redondear(base * proporcion);
  let nuevoPromedio = promedio;
  if (existencia > 0 && montoInventario > 0) {
    nuevoPromedio = redondear((existencia * promedio + signo * montoInventario) / existencia);
    if (nuevoPromedio < 0) {
      nuevoPromedio = 0;
      montoInventario = redondear(existencia * promedio);
    }
    actualizarCostoPromedio(db, lineaFactura.producto_id, nuevoPromedio);
    inventario.registrarMovimientoInventario(db, {
      productoId: lineaFactura.producto_id, almacenId: factura.almacen_id, tipoMovimiento: 'ajuste_costo_compra',
      cantidad: 0, costoUnitario: nuevoPromedio, documentoOrigenTipo: 'documentos_compra', documentoOrigenId: documentoId, usuarioId,
    });
  } else {
    montoInventario = 0;
  }
  return { base, montoInventario, montoCostoVentas: redondear(base - montoInventario) };
}

function crearNotaCompra(db, { tipo, tipoAjuste, facturaId, ncfProveedor, concepto, lineas, usuarioId }) {
  if (!TIPOS_NOTA.includes(tipo)) throw new Error('Tipo de nota inválido');
  session.requerirPermiso(tipo === 'nota_credito' ? 'compras.devolucion.crear' : 'compras.nota_debito.crear');
  const ajuste = tipo === 'nota_debito' ? 'ajuste_costo' : tipoAjuste;
  if (!['devolucion', 'ajuste_costo'].includes(ajuste)) throw new Error('Indique si la nota es por devolución o por ajuste de precio');
  if (!concepto || !concepto.trim()) throw new Error('Indique el motivo de la nota');
  if (!lineas || lineas.length === 0) throw new Error('La nota debe tener al menos una línea');

  const factura = obtenerFacturaVigente(db, facturaId);
  const proveedor = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(factura.proveedor_id);
  const lineasFactura = new Map(lineasParaNota(db, facturaId).map((l) => [l.id, l]));

  // Validar todo antes de mover inventario.
  const usadas = new Set();
  const devueltoPorProducto = new Map();
  const pedidas = lineas.map((l) => {
    const lineaFactura = lineasFactura.get(l.detalleReferenciaId);
    if (!lineaFactura) throw new Error('Una de las líneas no pertenece a la factura');
    if (usadas.has(lineaFactura.id)) throw new Error(`El producto "${lineaFactura.producto_descripcion}" está repetido en la nota`);
    usadas.add(lineaFactura.id);
    if (ajuste === 'devolucion') {
      const cantidad = redondear(Number(l.cantidad) || 0);
      if (cantidad <= 0) throw new Error(`La cantidad a devolver de "${lineaFactura.producto_descripcion}" debe ser mayor a cero`);
      if (cantidad > lineaFactura.disponible_devolver + 0.001) {
        throw new Error(`No puede devolver ${cantidad} de "${lineaFactura.producto_descripcion}": de esa factura quedan ${lineaFactura.disponible_devolver} por devolver`);
      }
      const acumulado = redondear((devueltoPorProducto.get(lineaFactura.producto_id) || 0) + cantidad);
      devueltoPorProducto.set(lineaFactura.producto_id, acumulado);
      if (acumulado > lineaFactura.existencia_almacen + 0.001) {
        throw new Error(`No hay existencia suficiente de "${lineaFactura.producto_descripcion}" para devolver (disponible: ${lineaFactura.existencia_almacen})`);
      }
      return { lineaFactura, cantidad };
    }
    const monto = redondear(Number(l.monto) || 0);
    if (monto <= 0) throw new Error(`El monto del ajuste de "${lineaFactura.producto_descripcion}" debe ser mayor a cero`);
    return { lineaFactura, monto };
  });

  const documentoId = crypto.randomUUID();
  const numero = siguienteNumero(db, tipo);
  const fechaIso = new Date().toISOString();
  const signo = tipo === 'nota_debito' ? 1 : -1;

  const calculadas = pedidas.map((p) => {
    const r = ajuste === 'devolucion'
      ? aplicarDevolucion(db, { lineaFactura: p.lineaFactura, cantidad: p.cantidad, factura, documentoId, usuarioId })
      : aplicarAjusteCosto(db, { lineaFactura: p.lineaFactura, base: p.monto, signo, factura, documentoId, usuarioId });
    const itbis = redondear(r.base * p.lineaFactura.tasa_itbis);
    return { ...p, ...r, itbis, totalLinea: redondear(r.base + itbis) };
  });
  const subtotal = redondear(calculadas.reduce((a, c) => a + c.base, 0));
  const itbisTotal = redondear(calculadas.reduce((a, c) => a + c.itbis, 0));
  const total = redondear(subtotal + itbisTotal);
  const montoInventario = redondear(calculadas.reduce((a, c) => a + c.montoInventario, 0));
  const montoCostoVentas = redondear(calculadas.reduce((a, c) => a + c.montoCostoVentas, 0));

  const vencimiento = new Date();
  vencimiento.setDate(vencimiento.getDate() + (tipo === 'nota_debito' ? (proveedor.dias_credito || 0) : 0));
  db.prepare(
    `INSERT INTO documentos_compra
       (id, tipo, numero, proveedor_id, almacen_id, ncf_proveedor, documento_referencia_id, fecha, condicion_pago,
        dias_credito, fecha_vencimiento, subtotal, itbis_total, total, estado, tipo_ajuste, concepto, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'credito', ?, ?, ?, ?, ?, 'facturado', ?, ?, ?)`
  ).run(
    documentoId, tipo, numero, factura.proveedor_id, factura.almacen_id, ncfProveedor || null, facturaId, fechaIso,
    tipo === 'nota_debito' ? (proveedor.dias_credito || 0) : 0, vencimiento.toISOString(), subtotal, itbisTotal, total,
    ajuste, concepto.trim(), usuarioId
  );
  const insertDetalle = db.prepare(
    `INSERT INTO documentos_compra_detalle
       (id, documento_id, producto_id, cantidad, cantidad_recibida, costo_unitario, tasa_itbis, itbis_monto, total_linea,
        detalle_referencia_id, base_imponible, monto_inventario, monto_costo_ventas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of calculadas) {
    const cantidad = ajuste === 'devolucion' ? c.cantidad : 0;
    insertDetalle.run(
      crypto.randomUUID(), documentoId, c.lineaFactura.producto_id, cantidad, cantidad,
      ajuste === 'devolucion' ? c.lineaFactura.costo_unitario : 0, c.lineaFactura.tasa_itbis, c.itbis, c.totalLinea,
      c.lineaFactura.id, c.base, c.montoInventario, c.montoCostoVentas
    );
  }

  // Nota de débito: Inventario, Costo de Ventas e ITBIS pagado al debe; Proveedores al haber.
  // Nota de crédito: al revés. Montos con signo (+ debe, − haber), porque en una devolución
  // Costo de Ventas puede quedar del lado contrario si el valor en inventario difería del costo.
  const linea = (cuentaCodigo, montoConSigno, descripcion) => (
    montoConSigno >= 0 ? { cuentaCodigo, debe: montoConSigno, descripcion } : { cuentaCodigo, haber: -montoConSigno, descripcion }
  );
  const lineasAsiento = [
    linea('1300', signo * montoInventario, ajuste === 'devolucion' ? 'Devolución a proveedor' : 'Ajuste de costo de inventario'),
    linea('5100', signo * montoCostoVentas, 'Ajuste de costo de mercancía ya vendida'),
    linea('1500', signo * itbisTotal, 'Ajuste ITBIS pagado (crédito fiscal)'),
    linea('2100', -signo * total, tipo === 'nota_credito' ? 'Nota de crédito del proveedor' : 'Nota de débito del proveedor'),
  ];
  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `${tipo === 'nota_credito' ? 'Nota de crédito' : 'Nota de débito'} de compra ${numero} (factura ${factura.numero})`,
    origenModulo: 'compras', origenDocumentoTipo: 'documentos_compra', origenDocumentoId: documentoId, usuarioId, lineas: lineasAsiento,
  });

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'compras', entidad: 'documentos_compra', entidadId: documentoId, accion: 'crear',
    detalle: { tipo, tipoAjuste: ajuste, numero, total, facturaNumero: factura.numero },
  });
  return documentoId;
}

function anularNotaCompra(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('compras.factura.anular');
  const nota = db.prepare("SELECT * FROM documentos_compra WHERE id = ? AND tipo IN ('nota_credito', 'nota_debito')").get(documentoId);
  if (!nota) throw new Error('Nota de compra no encontrada');
  if (nota.estado === 'anulado') throw new Error('La nota ya está anulada');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  if (nota.tipo === 'nota_debito') {
    const pagada = db
      .prepare(
        `SELECT 1 FROM pagos_proveedor_aplicaciones ppa JOIN pagos_proveedor pp ON pp.id = ppa.pago_id
         WHERE ppa.documento_compra_id = ? AND pp.estado != 'anulado' LIMIT 1`
      )
      .get(documentoId);
    if (pagada) throw new Error('La nota de débito tiene pagos aplicados. Anule esos pagos primero.');
  } else {
    // Si el crédito de esta nota ya se usó (como pago de otra factura o reembolso), anularla
    // dejaría el saldo a favor en negativo.
    const factura = db.prepare('SELECT * FROM documentos_compra WHERE id = ?').get(nota.documento_referencia_id);
    const excesoActual = saldoDocumentoCompra(db, factura).exceso;
    const excesoSinNota = Math.max(0, -(saldoDocumentoCompra(db, factura).saldo + nota.total));
    const disponible = saldoAFavorProveedor(db, nota.proveedor_id);
    if (disponible - (excesoActual - excesoSinNota) < -0.009) {
      throw new Error('El saldo a favor que generó esta nota ya se usó en pagos o reembolsos. Anule esos movimientos primero.');
    }
  }

  db.prepare(
    `UPDATE documentos_compra SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);

  const signo = nota.tipo === 'nota_debito' ? 1 : -1;
  for (const l of db.prepare('SELECT * FROM documentos_compra_detalle WHERE documento_id = ?').all(documentoId)) {
    if (nota.tipo_ajuste === 'devolucion') {
      inventario.registrarMovimientoInventario(db, {
        productoId: l.producto_id, almacenId: nota.almacen_id, tipoMovimiento: 'ajuste_entrada', cantidad: l.cantidad,
        costoUnitario: l.costo_unitario, documentoOrigenTipo: 'documentos_compra_anulacion', documentoOrigenId: documentoId, usuarioId,
      });
    } else if (l.monto_inventario > 0) {
      const existencia = existenciaTotalProducto(db, l.producto_id);
      if (existencia > 0) {
        const promedio = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(l.producto_id).costo_promedio || 0;
        const nuevoPromedio = Math.max(0, redondear((existencia * promedio - signo * l.monto_inventario) / existencia));
        actualizarCostoPromedio(db, l.producto_id, nuevoPromedio);
        inventario.registrarMovimientoInventario(db, {
          productoId: l.producto_id, almacenId: nota.almacen_id, tipoMovimiento: 'ajuste_costo_compra', cantidad: 0,
          costoUnitario: nuevoPromedio, documentoOrigenTipo: 'documentos_compra_anulacion', documentoOrigenId: documentoId, usuarioId,
        });
      }
    }
  }

  const codigoPorId = Object.fromEntries(db.prepare('SELECT id, codigo FROM cuentas_contables').all().map((c) => [c.id, c.codigo]));
  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'documentos_compra' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(documentoId);
  for (const asiento of asientos) {
    const det = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'compras',
      origenDocumentoTipo: 'documentos_compra_anulacion', origenDocumentoId: documentoId, usuarioId,
      lineas: det.map((d) => ({ cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
    });
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'compras', entidad: 'documentos_compra', entidadId: documentoId, accion: 'anular', detalle: { tipo: nota.tipo, numero: nota.numero, motivo },
  });
}

function listarNotasCompra(db, { proveedorId, facturaId, limite = 100 } = {}) {
  const condiciones = ["n.tipo IN ('nota_credito', 'nota_debito')", 'n.deleted_at IS NULL'];
  const params = [];
  if (proveedorId) { condiciones.push('n.proveedor_id = ?'); params.push(proveedorId); }
  if (facturaId) { condiciones.push('n.documento_referencia_id = ?'); params.push(facturaId); }
  params.push(limite);
  return db
    .prepare(
      `SELECT n.*, p.nombre AS proveedor_nombre, f.numero AS factura_numero FROM documentos_compra n
       JOIN proveedores p ON p.id = n.proveedor_id LEFT JOIN documentos_compra f ON f.id = n.documento_referencia_id
       WHERE ${condiciones.join(' AND ')} ORDER BY n.fecha DESC LIMIT ?`
    )
    .all(...params);
}

function obtenerNotaCompra(db, documentoId) {
  const nota = db
    .prepare(
      `SELECT n.*, p.nombre AS proveedor_nombre, f.numero AS factura_numero FROM documentos_compra n
       JOIN proveedores p ON p.id = n.proveedor_id LEFT JOIN documentos_compra f ON f.id = n.documento_referencia_id
       WHERE n.id = ? AND n.tipo IN ('nota_credito', 'nota_debito')`
    )
    .get(documentoId);
  if (!nota) return null;
  nota.lineas = db
    .prepare(
      `SELECT d.*, p.descripcion AS producto_descripcion, p.codigo_interno FROM documentos_compra_detalle d
       JOIN productos p ON p.id = d.producto_id WHERE d.documento_id = ?`
    )
    .all(documentoId);
  return nota;
}

// =========================================================================
// Reportes
// =========================================================================

// Comparación de mejor costo: todas las compras históricas de un producto, ordenadas por
// costo, para negociar con proveedores o decidir a quién comprarle.
function comparacionMejorCosto(db, { productoId }) {
  return db
    .prepare(
      `SELECT dc.fecha, dc.numero, p.nombre AS proveedor_nombre, dcd.costo_unitario, dcd.cantidad
       FROM documentos_compra_detalle dcd
       JOIN documentos_compra dc ON dc.id = dcd.documento_id
       JOIN proveedores p ON p.id = dc.proveedor_id
       WHERE dcd.producto_id = ? AND dc.tipo = 'factura_compra' AND dc.estado != 'anulado'
       ORDER BY dcd.costo_unitario ASC`
    )
    .all(productoId);
}

// Neto de notas: las devoluciones restan cantidad y costo; las rebajas y aumentos de precio
// solo mueven el costo.
function comprasPorProducto(db, { desde, hasta } = {}) {
  const condiciones = ["dc.tipo IN ('factura_compra', 'nota_credito', 'nota_debito')", "dc.estado != 'anulado'"];
  const params = [];
  if (desde) { condiciones.push('dc.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('dc.fecha <= ?'); params.push(hasta); }
  return db
    .prepare(
      `SELECT p.id AS producto_id, p.codigo_interno, p.descripcion,
              SUM(CASE WHEN dc.tipo = 'nota_credito' THEN -dcd.cantidad WHEN dc.tipo = 'factura_compra' THEN dcd.cantidad ELSE 0 END) AS cantidad_total,
              ROUND(SUM(CASE WHEN dc.tipo = 'nota_credito' THEN -dcd.total_linea ELSE dcd.total_linea END), 2) AS costo_total
       FROM documentos_compra_detalle dcd
       JOIN documentos_compra dc ON dc.id = dcd.documento_id
       JOIN productos p ON p.id = dcd.producto_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY p.id ORDER BY costo_total DESC`
    )
    .all(...params);
}

// =========================================================================
// Formato 606 (DGII): compras de bienes y servicios del mes
// =========================================================================
//
// Estructura según la Norma General 07-2018 (herramienta de Formato 606): encabezado
// 606|RNC informante|AAAAMM|cantidad de registros, y 23 campos por registro separados por |.
// Entran facturas de compra (tipo 09, forman parte del costo de venta), notas de crédito y
// débito de proveedores (línea propia, con el NCF de la factura afectada como NCF modificado)
// y gastos de caja chica con NCF (tipo elegido al registrarlos). Lo que no tenga RNC/cédula o
// NCF válidos no se reporta y se lista aparte para que se corrija.

const FORMA_PAGO_606 = { efectivo: '01', transferencia: '02', credito: '04', nota_credito: '06', mixto: '07' };
const FORMATO_NCF = /^(B\d{10}|E\d{12})$/;

function limpiarIdentificacion(texto) {
  return (texto || '').replace(/[^0-9]/g, '');
}

function tipoIdentificacion(rnc) {
  if (rnc.length === 9) return '1';
  if (rnc.length === 11) return '2';
  return null;
}

// Fecha local del negocio (el proceso principal corre en la zona horaria del equipo).
function fechaAAAAMMDD(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function rangoPeriodo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || '');
  if (!m) throw new Error('Indique el mes a reportar (AAAA-MM)');
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  return { desde: new Date(anio, mes - 1, 1).toISOString(), hasta: new Date(anio, mes, 1).toISOString(), aaaamm: `${m[1]}${m[2]}` };
}

// Forma de pago de una factura de compra. De contado no guarda la forma, pero el asiento sí:
// la salida fue por Caja (efectivo) o por Bancos (transferencia/cheque).
function formaPagoFactura(db, factura) {
  if (factura.condicion_pago === 'credito') return FORMA_PAGO_606.credito;
  if (factura.condicion_pago === 'mixto') return FORMA_PAGO_606.mixto;
  const porCaja = db
    .prepare(
      `SELECT 1 FROM asientos_contables a JOIN asientos_contables_detalle d ON d.asiento_id = a.id
       JOIN cuentas_contables c ON c.id = d.cuenta_id
       WHERE a.origen_documento_tipo = 'documentos_compra' AND a.origen_documento_id = ? AND c.codigo = '1100' AND d.haber > 0 LIMIT 1`
    )
    .get(factura.id);
  return porCaja ? FORMA_PAGO_606.efectivo : FORMA_PAGO_606.transferencia;
}

// Fecha de pago: la de la factura si fue de contado; si fue a crédito, la del último pago,
// solo cuando ya está saldada.
function fechaPagoFactura(db, factura) {
  if (factura.condicion_pago === 'contado') return fechaAAAAMMDD(factura.fecha);
  if (saldoDocumentoCompra(db, factura).pendiente > 0.01) return '';
  const ultimo = db
    .prepare(
      `SELECT MAX(pp.fecha) AS fecha FROM pagos_proveedor_aplicaciones ppa JOIN pagos_proveedor pp ON pp.id = ppa.pago_id
       WHERE ppa.documento_compra_id = ? AND pp.estado != 'anulado'`
    )
    .get(factura.id).fecha;
  return ultimo ? fechaAAAAMMDD(ultimo) : '';
}

function registro606({ rnc, tipoBienes, ncf, ncfModificado, fecha, fechaPago, servicios, bienes, itbis, formaPago }) {
  const montoFacturado = redondear(servicios + bienes);
  return {
    rnc, tipo_id: tipoIdentificacion(rnc), tipo_bienes_servicios: tipoBienes, ncf, ncf_modificado: ncfModificado || '',
    fecha_comprobante: fecha, fecha_pago: fechaPago || '', monto_servicios: redondear(servicios), monto_bienes: redondear(bienes),
    monto_facturado: montoFacturado, itbis_facturado: redondear(itbis), itbis_retenido: 0, itbis_proporcionalidad: 0,
    itbis_al_costo: 0, itbis_por_adelantar: redondear(itbis), itbis_percibido: 0, tipo_retencion_isr: '', retencion_renta: 0,
    isr_percibido: 0, impuesto_selectivo: 0, otros_impuestos: 0, propina_legal: 0, forma_pago: formaPago,
  };
}

function reporte606(db, { periodo }) {
  session.requerirPermiso('compras.reportes.ver');
  const { desde, hasta, aaaamm } = rangoPeriodo(periodo);
  const rncNegocio = limpiarIdentificacion((db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'negocio_rnc'").get() || {}).valor);
  const registros = [];
  const excluidos = [];

  const validar = ({ nombre, rnc, ncf, ncfModificado, exigeModificado }) => {
    if (!tipoIdentificacion(rnc)) return `${nombre ? `${nombre}: ` : ''}sin RNC o cédula válido`;
    if (!ncf) return 'sin NCF';
    if (!FORMATO_NCF.test(ncf)) return `NCF con formato inválido (${ncf})`;
    if (exigeModificado && !ncfModificado) return 'la factura afectada no tiene NCF';
    return null;
  };

  const documentos = db
    .prepare(
      `SELECT dc.*, p.nombre AS proveedor_nombre, p.rnc AS proveedor_rnc, f.ncf_proveedor AS ncf_factura, f.numero AS factura_numero
       FROM documentos_compra dc JOIN proveedores p ON p.id = dc.proveedor_id
       LEFT JOIN documentos_compra f ON f.id = dc.documento_referencia_id
       WHERE dc.tipo IN ('factura_compra', 'nota_credito', 'nota_debito') AND dc.estado != 'anulado' AND dc.deleted_at IS NULL
         AND dc.fecha >= ? AND dc.fecha < ?
       ORDER BY dc.fecha ASC`
    )
    .all(desde, hasta);
  const ETIQUETA = { factura_compra: 'Factura de compra', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };
  for (const d of documentos) {
    const rnc = limpiarIdentificacion(d.proveedor_rnc);
    const ncf = (d.ncf_proveedor || '').trim().toUpperCase();
    const esNota = d.tipo !== 'factura_compra';
    const ncfModificado = esNota ? (d.ncf_factura || '').trim().toUpperCase() : '';
    const referencia = { origen: ETIQUETA[d.tipo], numero: d.numero, proveedor: d.proveedor_nombre, fecha: d.fecha, total: d.total };
    const motivo = validar({ nombre: d.proveedor_nombre, rnc, ncf, ncfModificado, exigeModificado: esNota });
    if (motivo) { excluidos.push({ ...referencia, motivo }); continue; }
    registros.push({
      ...referencia,
      ...registro606({
        rnc, tipoBienes: '09', ncf, ncfModificado, fecha: fechaAAAAMMDD(d.fecha),
        fechaPago: esNota ? '' : fechaPagoFactura(db, d), servicios: 0, bienes: d.subtotal, itbis: d.itbis_total,
        formaPago: d.tipo === 'nota_credito' ? FORMA_PAGO_606.nota_credito : (d.tipo === 'nota_debito' ? FORMA_PAGO_606.credito : formaPagoFactura(db, d)),
      }),
    });
  }

  const gastos = db
    .prepare("SELECT * FROM gastos_caja_chica WHERE estado != 'anulado' AND deleted_at IS NULL AND fecha >= ? AND fecha < ? ORDER BY fecha ASC")
    .all(desde, hasta);
  for (const g of gastos) {
    const rnc = limpiarIdentificacion(g.rnc_suplidor);
    const ncf = (g.ncf || '').trim().toUpperCase();
    const referencia = { origen: 'Gasto de caja chica', numero: g.concepto, proveedor: '', fecha: g.fecha, total: g.monto };
    const motivo = validar({ rnc, ncf });
    if (motivo) { excluidos.push({ ...referencia, motivo }); continue; }
    const base = redondear(g.monto - (g.itbis_facturado || 0));
    registros.push({
      ...referencia,
      ...registro606({
        rnc, tipoBienes: g.tipo_bienes_servicios || '02', ncf, fecha: fechaAAAAMMDD(g.fecha), fechaPago: fechaAAAAMMDD(g.fecha),
        servicios: g.clase_monto === 'servicios' ? base : 0, bienes: g.clase_monto === 'servicios' ? 0 : base,
        itbis: g.itbis_facturado || 0, formaPago: FORMA_PAGO_606.efectivo,
      }),
    });
  }

  const suma = (campo) => redondear(registros.reduce((a, r) => a + r[campo], 0));
  return {
    periodo: aaaamm, rncNegocio: rncNegocio || null, registros, excluidos,
    totales: { cantidad: registros.length, servicios: suma('monto_servicios'), bienes: suma('monto_bienes'), facturado: suma('monto_facturado'), itbis: suma('itbis_facturado') },
  };
}

const CAMPOS_606 = [
  ['rnc', 'RNC o Cédula'], ['tipo_id', 'Tipo Id'], ['tipo_bienes_servicios', 'Tipo Bienes y Servicios Comprados'],
  ['ncf', 'NCF'], ['ncf_modificado', 'NCF o Documento Modificado'], ['fecha_comprobante', 'Fecha Comprobante'],
  ['fecha_pago', 'Fecha Pago'], ['monto_servicios', 'Monto Facturado en Servicios'], ['monto_bienes', 'Monto Facturado en Bienes'],
  ['monto_facturado', 'Total Monto Facturado'], ['itbis_facturado', 'ITBIS Facturado'], ['itbis_retenido', 'ITBIS Retenido'],
  ['itbis_proporcionalidad', 'ITBIS sujeto a Proporcionalidad (Art. 349)'], ['itbis_al_costo', 'ITBIS llevado al Costo'],
  ['itbis_por_adelantar', 'ITBIS por Adelantar'], ['itbis_percibido', 'ITBIS percibido en compras'],
  ['tipo_retencion_isr', 'Tipo de Retención en ISR'], ['retencion_renta', 'Monto Retención Renta'],
  ['isr_percibido', 'ISR Percibido en compras'], ['impuesto_selectivo', 'Impuesto Selectivo al Consumo'],
  ['otros_impuestos', 'Otros Impuesto/Tasas'], ['propina_legal', 'Monto Propina Legal'], ['forma_pago', 'Forma de Pago'],
];
const CAMPOS_MONTO_606 = new Set(['monto_servicios', 'monto_bienes', 'monto_facturado', 'itbis_facturado', 'itbis_por_adelantar']);

// Los montos obligatorios van siempre con dos decimales; los opcionales en cero van vacíos.
function valor606(registro, campo) {
  const v = registro[campo];
  if (typeof v === 'number') return CAMPOS_MONTO_606.has(campo) || v !== 0 ? v.toFixed(2) : '';
  return v ?? '';
}

function txt606(reporte) {
  if (!reporte.rncNegocio || !tipoIdentificacion(reporte.rncNegocio)) {
    throw new Error('Configure el RNC del negocio en Configuración → Negocio antes de generar el archivo 606');
  }
  const lineas = [`606|${reporte.rncNegocio}|${reporte.periodo}|${reporte.registros.length}`];
  for (const r of reporte.registros) lineas.push(CAMPOS_606.map(([campo]) => valor606(r, campo)).join('|'));
  return `${lineas.join('\r\n')}\r\n`;
}

function csv606(reporte) {
  const celda = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lineas = [CAMPOS_606.map(([, titulo]) => celda(titulo)).join(',')];
  for (const r of reporte.registros) lineas.push(CAMPOS_606.map(([campo]) => celda(valor606(r, campo))).join(','));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('compras:reporte606', (event, { periodo }) => reporte606(getDb(), { periodo }));
  ipcMain.handle('compras:exportar606', async (event, { periodo, formato }) => {
    const { dialog, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    const reporte = reporte606(getDb(), { periodo });
    const esTxt = formato === 'txt';
    const contenido = esTxt ? txt606(reporte) : csv606(reporte);
    const nombre = esTxt ? `DGII_F_606_${reporte.rncNegocio}_${reporte.periodo}.TXT` : `Formato_606_${reporte.periodo}.csv`;
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: esTxt ? 'Guardar archivo 606 para la DGII' : 'Guardar 606 para Excel', defaultPath: nombre,
      filters: esTxt ? [{ name: 'Archivo de texto', extensions: ['TXT', 'txt'] }] : [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { cancelado: true };
    fs.writeFileSync(filePath, contenido, 'utf8');
    return { ruta: filePath, registros: reporte.registros.length };
  });

  ipcMain.handle('proveedores:buscar', (event, { texto, limite = 20 }) => {
    const db = getDb();
    const like = `%${texto || ''}%`;
    return db.prepare(`SELECT id, nombre, rnc, dias_credito FROM proveedores WHERE deleted_at IS NULL AND activo = 1 AND (nombre LIKE ? OR rnc LIKE ?) ORDER BY nombre LIMIT ?`).all(like, like, limite);
  });
  ipcMain.handle('proveedores:obtener', (event, { proveedorId }) => obtenerProveedor(getDb(), proveedorId));
  ipcMain.handle('proveedores:listar', (event, filtros) => listarProveedores(getDb(), filtros || {}));
  ipcMain.handle('proveedores:crear', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => guardarProveedor(db, payload))();
    return obtenerProveedor(db, id);
  });
  ipcMain.handle('proveedores:guardar', (event, { proveedorId, payload }) => {
    const db = getDb();
    const id = db.transaction(() => guardarProveedor(db, payload, proveedorId))();
    return obtenerProveedor(db, id);
  });

  ipcMain.handle('compras:crearFacturaCompra', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => crearFacturaCompra(db, payload))();
    return obtenerFacturaCompra(db, id);
  });
  ipcMain.handle('compras:anularFacturaCompra', (event, payload) => {
    const db = getDb();
    db.transaction(() => anularFacturaCompra(db, payload))();
    return obtenerFacturaCompra(db, payload.documentoId);
  });
  ipcMain.handle('compras:listarFacturas', (event, filtros) => listarFacturasCompra(getDb(), filtros || {}));
  ipcMain.handle('compras:obtenerFactura', (event, { documentoId }) => obtenerFacturaCompra(getDb(), documentoId));

  ipcMain.handle('compras:crearOrden', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => crearOrdenCompra(db, payload))();
    return obtenerOrdenCompra(db, id);
  });
  ipcMain.handle('compras:listarOrdenes', (event, filtros) => listarOrdenesCompra(getDb(), filtros || {}));
  ipcMain.handle('compras:obtenerOrden', (event, { documentoId }) => obtenerOrdenCompra(getDb(), documentoId));
  ipcMain.handle('compras:anularOrden', (event, payload) => {
    const db = getDb();
    db.transaction(() => anularOrdenCompra(db, payload))();
    return obtenerOrdenCompra(db, payload.documentoId);
  });

  ipcMain.handle('compras:comparacionMejorCosto', (event, { productoId }) => comparacionMejorCosto(getDb(), { productoId }));
  ipcMain.handle('compras:comprasPorProducto', (event, filtros) => comprasPorProducto(getDb(), filtros || {}));

  ipcMain.handle('compras:lineasParaNota', (event, { facturaId }) => lineasParaNota(getDb(), facturaId));
  ipcMain.handle('compras:crearNota', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => crearNotaCompra(db, payload))();
    return obtenerNotaCompra(db, id);
  });
  ipcMain.handle('compras:anularNota', (event, payload) => {
    const db = getDb();
    db.transaction(() => anularNotaCompra(db, payload))();
    return obtenerNotaCompra(db, payload.documentoId);
  });
  ipcMain.handle('compras:listarNotas', (event, filtros) => listarNotasCompra(getDb(), filtros || {}));
  ipcMain.handle('compras:obtenerNota', (event, { documentoId }) => obtenerNotaCompra(getDb(), documentoId));
}

module.exports = {
  register, obtenerProveedor, listarProveedores, guardarProveedor, saldoPendienteProveedor, saldoAFavorProveedor,
  saldoDocumentoCompra, documentosPorPagarProveedor,
  crearFacturaCompra, anularFacturaCompra, listarFacturasCompra, obtenerFacturaCompra,
  crearOrdenCompra, listarOrdenesCompra, obtenerOrdenCompra, anularOrdenCompra,
  lineasParaNota, crearNotaCompra, anularNotaCompra, listarNotasCompra, obtenerNotaCompra,
  comparacionMejorCosto, comprasPorProducto, reporte606, txt606, csv606,
};
