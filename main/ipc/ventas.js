const crypto = require('node:crypto');

const inventario = require('./inventario');
const cxc = require('./cxc');
const caja = require('./caja');
const contabilidad = require('./contabilidad');
const configuracion = require('./configuracion');
const session = require('../auth/session');

const CUENTA_POR_FORMA_PAGO = {
  efectivo: '1100', // Caja
  tarjeta: '1200', // Bancos
  transferencia: '1200', // Bancos
  credito: '1400', // Clientes (CxC)
};

function redondear(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function siguienteNumero(db, tipo) {
  const row = db
    .prepare(
      "SELECT MAX(CAST(numero AS INTEGER)) AS maximo FROM documentos_venta WHERE tipo = ?"
    )
    .get(tipo);
  const siguiente = (row.maximo || 0) + 1;
  return String(siguiente).padStart(6, '0');
}

function tomarNcf(db, codigoTipoNcf) {
  const tipo = db.prepare('SELECT * FROM tipos_ncf WHERE codigo = ? AND activo = 1').get(codigoTipoNcf);
  if (!tipo) throw new Error(`Tipo de NCF ${codigoTipoNcf} no está configurado`);
  if (tipo.secuencia_actual > tipo.secuencia_hasta) {
    throw new Error(`Se agotó la numeración de NCF para ${tipo.nombre}. Configure un nuevo rango.`);
  }
  const ncf = `${tipo.codigo}${String(tipo.secuencia_actual).padStart(8, '0')}`;
  db.prepare('UPDATE tipos_ncf SET secuencia_actual = secuencia_actual + 1, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run(tipo.id);
  return { ncf, tipoNcfId: tipo.id };
}

function precioProducto(producto, nivelPrecio) {
  if (nivelPrecio === 'mayorista') return producto.precio_mayorista || producto.precio_detalle;
  if (nivelPrecio === 'distribuidor') return producto.precio_distribuidor || producto.precio_detalle;
  return producto.precio_detalle;
}

// Calcula una línea a partir del precio con ITBIS incluido y el descuento manual
// (por % o por monto fijo — el que no se envía se deriva del otro).
function calcularLinea({ cantidad, precioUnitario, descuentoPct, descuentoMonto, tasaItbisPct }) {
  const bruto = redondear(precioUnitario * cantidad);
  let descuento;
  if (descuentoMonto && !descuentoPct) {
    descuento = descuentoMonto;
  } else {
    descuento = redondear(bruto * ((descuentoPct || 0) / 100));
  }
  const totalLinea = redondear(bruto - descuento);
  const baseImponible = redondear(totalLinea / (1 + tasaItbisPct));
  const itbisMonto = redondear(totalLinea - baseImponible);
  return { bruto, descuento, totalLinea, baseImponible, itbisMonto };
}

function obtenerLimiteDescuentoRol(db, usuarioId) {
  const row = db
    .prepare(
      `SELECT r.limite_descuento_pct,
              EXISTS(
                SELECT 1 FROM roles_permisos rp JOIN permisos p ON p.id = rp.permiso_id
                WHERE rp.rol_id = r.id AND p.codigo = 'ventas.descuento.exceder_limite'
              ) AS puede_exceder
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`
    )
    .get(usuarioId);
  return row || { limite_descuento_pct: 0, puede_exceder: 0 };
}

function crearFactura(db, payload) {
  session.requerirPermiso('ventas.factura.crear');
  const {
    modoVenta, sucursalId, almacenId, cajaId, clienteId, vendedorId, usuarioId,
    condicionPago, tipoNcfCodigo, nivelPrecio, monedaId, tasaCambio,
    lineas, descuentoGlobalPct, pagos, esDelivery, direccionEntrega, repartidorId,
  } = payload;

  if (!lineas || lineas.length === 0) throw new Error('La factura debe tener al menos una línea');

  const limiteRol = obtenerLimiteDescuentoRol(db, usuarioId);
  const puedeExceder = Boolean(limiteRol.puede_exceder);

  // --- Resolver producto + calcular cada línea ---
  const lineasCalculadas = lineas.map((l) => {
    const producto = inventario.obtenerProducto(db, l.productoId, almacenId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);

    if (!puedeExceder && (l.descuentoPct || 0) > limiteRol.limite_descuento_pct) {
      throw new Error(`El descuento de la línea "${producto.descripcion}" excede el límite permitido (${limiteRol.limite_descuento_pct}%)`);
    }

    if (!producto.permite_venta_negativo) {
      const disponible = inventario.existenciaDisponibleParaVenta(db, producto, almacenId);
      if (disponible < l.cantidad) {
        throw new Error(`Existencia insuficiente de "${producto.descripcion}" (disponible: ${disponible}, solicitado: ${l.cantidad})`);
      }
    }

    const precioUnitario = l.precioUnitario ?? precioProducto(producto, nivelPrecio);
    const calc = calcularLinea({
      cantidad: l.cantidad, precioUnitario, descuentoPct: l.descuentoPct,
      descuentoMonto: l.descuentoMonto, tasaItbisPct: producto.tasa_itbis_pct,
    });

    return {
      producto, cantidad: l.cantidad, precioUnitario, descuentoPct: l.descuentoPct || 0,
      descuentoMonto: calc.descuento, tasaItbis: producto.tasa_itbis_pct, ...calc,
    };
  });

  if (!puedeExceder && (descuentoGlobalPct || 0) > limiteRol.limite_descuento_pct) {
    throw new Error(`El descuento global excede el límite permitido para su rol (${limiteRol.limite_descuento_pct}%)`);
  }

  const subtotalLineas = redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
  const itbisLineas = redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
  const totalLineas = redondear(subtotalLineas + itbisLineas);

  const descuentoGlobalMonto = redondear(totalLineas * ((descuentoGlobalPct || 0) / 100));
  const factor = totalLineas > 0 ? (totalLineas - descuentoGlobalMonto) / totalLineas : 1;
  const subtotal = redondear(subtotalLineas * factor);
  const itbisTotal = redondear(itbisLineas * factor);
  const total = redondear(subtotal + itbisTotal);

  // --- Retención (informativa por ahora; no se neta contra el cobro — ver nota en README del módulo) ---
  let retencionIsr = 0;
  let retencionItbis = 0;
  let cliente = null;
  if (clienteId) {
    cliente = cxc.obtenerCliente(db, clienteId);
    if (!cliente) throw new Error('Cliente no encontrado');
    if (cliente.bloqueado) throw new Error(`El cliente está bloqueado: ${cliente.motivo_bloqueo || 'sin motivo registrado'}`);
    if (cliente.es_agente_retencion) {
      retencionIsr = redondear(subtotal * (cliente.pct_retencion_isr / 100));
      retencionItbis = redondear(itbisTotal * (cliente.pct_retencion_itbis / 100));
    }
  }

  // --- Validar que los pagos cuadren con el total ---
  const sumaPagos = redondear((pagos || []).reduce((acc, p) => acc + p.monto, 0));
  if (Math.abs(sumaPagos - total) > 0.01) {
    throw new Error(`Los pagos (${sumaPagos}) no cuadran con el total de la factura (${total})`);
  }

  const montoCredito = redondear((pagos || []).filter((p) => p.formaPago === 'credito').reduce((acc, p) => acc + p.monto, 0));
  if (montoCredito > 0) {
    if (!cliente) throw new Error('Una venta a crédito requiere un cliente registrado');
    const motivoMora = cxc.verificarBloqueoPorMora(db, clienteId);
    if (motivoMora) throw new Error(`Crédito bloqueado por mora: ${motivoMora}`);
    const saldoActual = cxc.saldoPendienteCliente(db, clienteId);
    if (saldoActual + montoCredito > cliente.limite_credito) {
      throw new Error(
        `La venta excede el límite de crédito del cliente (límite: ${cliente.limite_credito}, saldo actual: ${saldoActual}, esta venta: ${montoCredito})`
      );
    }
  }

  const montoEfectivo = redondear((pagos || []).filter((p) => p.formaPago === 'efectivo').reduce((acc, p) => acc + p.monto, 0));
  let turnoCaja = null;
  if (montoEfectivo > 0) {
    turnoCaja = caja.obtenerTurnoAbierto(db, cajaId);
    if (!turnoCaja) throw new Error('Debe abrir un turno de caja antes de facturar al contado en efectivo');
  }

  // --- NCF y número ---
  const codigoNcf = tipoNcfCodigo || (cliente ? cliente.tipo_comprobante_default : null) || 'consumo';
  const codigoTipoNcfMap = { consumo: 'B02', credito_fiscal: 'B01', gubernamental: 'B14', regimen_especial: 'B15' };
  const { ncf, tipoNcfId } = tomarNcf(db, codigoTipoNcfMap[codigoNcf] || codigoNcf);
  const numero = siguienteNumero(db, 'factura');
  const fechaIso = new Date().toISOString();

  // --- Insertar documento y líneas ---
  const documentoId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO documentos_venta
       (id, tipo, numero, ncf, tipo_ncf_id, sucursal_id, almacen_id, cliente_id, vendedor_id,
        modo_venta, condicion_pago, moneda_id, tasa_cambio, fecha, subtotal, descuento_total,
        itbis_total, retencion_isr, retencion_itbis, total, estado, es_delivery, repartidor_id,
        direccion_entrega, estado_delivery, usuario_id)
     VALUES (?, 'factura', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'facturado', ?, ?, ?, ?, ?)`
  ).run(
    documentoId, numero, ncf, tipoNcfId, sucursalId, almacenId, clienteId || null, vendedorId || null,
    modoVenta, condicionPago, monedaId, tasaCambio || 1, fechaIso, subtotal, descuentoGlobalMonto,
    itbisTotal, retencionIsr, retencionItbis, total,
    esDelivery ? 1 : 0, repartidorId || null, direccionEntrega || null, esDelivery ? 'pendiente' : null, usuarioId
  );

  const insertDetalle = db.prepare(
    `INSERT INTO documentos_venta_detalle
       (id, documento_id, producto_id, cantidad, precio_unitario, descuento_pct, descuento_monto,
        tasa_itbis, base_imponible, itbis_monto, total_linea, costo_unitario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let costoTotal = 0;
  for (const l of lineasCalculadas) {
    const costoUnitarioLinea = inventario.costoUnitarioVenta(db, l.producto);
    insertDetalle.run(
      crypto.randomUUID(), documentoId, l.producto.id, l.cantidad, l.precioUnitario, l.descuentoPct,
      l.descuentoMonto, l.tasaItbis, l.baseImponible, l.itbisMonto, l.totalLinea, costoUnitarioLinea
    );
    inventario.moverInventarioPorVenta(db, {
      producto: l.producto, almacenId, cantidad: -l.cantidad, documentoOrigenTipo: 'documentos_venta',
      documentoOrigenId: documentoId, usuarioId,
    });
    costoTotal += costoUnitarioLinea * l.cantidad;
  }
  costoTotal = redondear(costoTotal);

  const insertPago = db.prepare(
    `INSERT INTO pagos_venta (id, documento_id, forma_pago, monto, referencia) VALUES (?, ?, ?, ?, ?)`
  );
  for (const p of pagos) {
    insertPago.run(crypto.randomUUID(), documentoId, p.formaPago, p.monto, p.referencia || null);
    if (p.formaPago === 'efectivo' && p.monto > 0) {
      caja.registrarMovimiento(db, {
        turnoCajaId: turnoCaja.id, tipo: 'venta_efectivo', concepto: `Factura ${numero}`,
        monto: p.monto, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId,
      });
    }
  }

  // --- Asiento contable de la venta ---
  const lineasAsiento = [];
  for (const forma of ['efectivo', 'tarjeta', 'transferencia', 'credito']) {
    const monto = redondear((pagos || []).filter((p) => p.formaPago === forma).reduce((acc, p) => acc + p.monto, 0));
    if (monto > 0) lineasAsiento.push({ cuentaCodigo: CUENTA_POR_FORMA_PAGO[forma], debe: monto, descripcion: `Venta ${forma}` });
  }
  lineasAsiento.push({ cuentaCodigo: '4100', haber: subtotal, descripcion: 'Ingresos por ventas' });
  if (itbisTotal > 0) lineasAsiento.push({ cuentaCodigo: '2200', haber: itbisTotal, descripcion: 'ITBIS por pagar' });
  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `Factura de venta ${numero}`, origenModulo: 'ventas',
    origenDocumentoTipo: 'documentos_venta', origenDocumentoId: documentoId, usuarioId, lineas: lineasAsiento,
  });

  if (costoTotal > 0) {
    contabilidad.generarAsiento(db, {
      fecha: fechaIso, concepto: `Costo de venta - Factura ${numero}`, origenModulo: 'ventas',
      origenDocumentoTipo: 'documentos_venta', origenDocumentoId: documentoId, usuarioId,
      lineas: [
        { cuentaCodigo: '5100', debe: costoTotal, descripcion: 'Costo de ventas' },
        { cuentaCodigo: '1300', haber: costoTotal, descripcion: 'Salida de inventario' },
      ],
    });
  }

  // --- Comisión de vendedor ---
  if (vendedorId) {
    const vendedor = db.prepare('SELECT pct_comision FROM usuarios WHERE id = ?').get(vendedorId);
    if (vendedor && vendedor.pct_comision > 0) {
      const monto = redondear(total * (vendedor.pct_comision / 100));
      db.prepare(
        `INSERT INTO comisiones_vendedor (id, vendedor_id, documento_venta_id, monto_comision)
         VALUES (?, ?, ?, ?)`
      ).run(crypto.randomUUID(), vendedorId, documentoId, monto);
    }
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'crear', detalle: { numero, total },
  });

  return documentoId;
}

function anularFactura(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.factura.anular');
  const documento = db.prepare('SELECT * FROM documentos_venta WHERE id = ?').get(documentoId);
  if (!documento) throw new Error('Factura no encontrada');
  if (documento.estado === 'anulado') throw new Error('La factura ya está anulada');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);

  // Revertir inventario: reingresa cada línea vendida (a los componentes, si era un kit).
  const detalle = db.prepare('SELECT * FROM documentos_venta_detalle WHERE documento_id = ?').all(documentoId);
  for (const l of detalle) {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(l.producto_id);
    inventario.moverInventarioPorVenta(db, {
      producto, almacenId: documento.almacen_id, cantidad: l.cantidad,
      documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId,
    });
  }

  // Revertir caja: una salida negativa por cada movimiento de venta en efectivo asociado.
  const movimientosCaja = db
    .prepare("SELECT * FROM movimientos_caja WHERE documento_origen_tipo = 'documentos_venta' AND documento_origen_id = ?")
    .all(documentoId);
  for (const m of movimientosCaja) {
    caja.registrarMovimiento(db, {
      turnoCajaId: m.turno_caja_id, tipo: 'venta_efectivo', concepto: `Anulación factura ${documento.numero}`,
      monto: -m.monto, documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId,
    });
  }

  // Revertir contabilidad: asiento espejo (debe/haber invertidos) de cada asiento original.
  const asientosOriginales = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'documentos_venta' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(documentoId);
  for (const asiento of asientosOriginales) {
    const detalleAsiento = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
    const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'ventas',
      origenDocumentoTipo: 'documentos_venta_anulacion', origenDocumentoId: documentoId, usuarioId,
      lineas: detalleAsiento.map((d) => ({
        cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}`,
      })),
    });
  }

  // Ajustar comisión asociada a cero (se conserva el registro para trazabilidad).
  db.prepare(
    "UPDATE comisiones_vendedor SET monto_comision = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE documento_venta_id = ?"
  ).run(documentoId);

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'anular', detalle: { numero: documento.numero, motivo },
  });
}

// =========================================================================
// Nota de crédito (devolución) — parcial por línea específica. Siempre reingresa inventario.
// Si la factura de origen tiene cliente registrado, acredita su cuenta (reduce lo que debe, o
// genera saldo a favor si la factura era de contado). Si es una venta rápida sin cliente
// registrado, no hay cuenta que acreditar: se devuelve en efectivo desde caja.
// No se le asigna NCF propio — el documento fuente no detalla la secuencia fiscal (B04) para
// notas de crédito, y CLAUDE.md prohíbe improvisar reglas de NCF/e-CF no explícitas.
// =========================================================================

function crearNotaCredito(db, { facturaOrigenId, lineas, motivo, cajaId, usuarioId }) {
  session.requerirPermiso('ventas.devolucion.crear');
  if (!lineas || lineas.length === 0) throw new Error('La devolución debe tener al menos una línea');
  if (!motivo || !motivo.trim()) throw new Error('La devolución requiere un motivo');

  const factura = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'factura'").get(facturaOrigenId);
  if (!factura) throw new Error('Factura de origen no encontrada');
  if (factura.estado === 'anulado') throw new Error('No se puede devolver mercancía de una factura anulada');

  const lineasCalculadas = lineas.map((l) => {
    const detalleOriginal = db.prepare('SELECT * FROM documentos_venta_detalle WHERE id = ? AND documento_id = ?').get(l.detalleId, facturaOrigenId);
    if (!detalleOriginal) throw new Error('Línea de la factura original no encontrada');
    if (!l.cantidad || l.cantidad <= 0) throw new Error('La cantidad a devolver debe ser mayor a cero');
    const pendiente = redondear(detalleOriginal.cantidad - detalleOriginal.cantidad_devuelta);
    if (l.cantidad > pendiente + 0.001) {
      throw new Error(`La cantidad a devolver (${l.cantidad}) excede lo pendiente de devolver en esta línea (${pendiente})`);
    }
    const proporcion = l.cantidad / detalleOriginal.cantidad;
    return {
      detalleOriginal, cantidad: l.cantidad,
      baseImponible: redondear(detalleOriginal.base_imponible * proporcion),
      itbisMonto: redondear(detalleOriginal.itbis_monto * proporcion),
      totalLinea: redondear(detalleOriginal.total_linea * proporcion),
      costoUnitario: detalleOriginal.costo_unitario,
    };
  });

  const subtotal = redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
  const itbisTotal = redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
  const total = redondear(subtotal + itbisTotal);

  let turno = null;
  if (!factura.cliente_id) {
    if (!cajaId) throw new Error('Se requiere una caja para devolver en efectivo a un cliente no registrado');
    turno = caja.obtenerTurnoAbierto(db, cajaId);
    if (!turno) throw new Error('Debe abrir un turno de caja antes de procesar esta devolución en efectivo');
  }

  const documentoId = crypto.randomUUID();
  const numero = siguienteNumero(db, 'nota_credito');
  const fechaIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO documentos_venta
       (id, tipo, numero, sucursal_id, almacen_id, cliente_id, vendedor_id, modo_venta, condicion_pago,
        moneda_id, tasa_cambio, documento_referencia_id, fecha, subtotal, itbis_total, total, estado, concepto, usuario_id)
     VALUES (?, 'nota_credito', ?, ?, ?, ?, ?, ?, 'contado', ?, ?, ?, ?, ?, ?, ?, 'facturado', ?, ?)`
  ).run(
    documentoId, numero, factura.sucursal_id, factura.almacen_id, factura.cliente_id, factura.vendedor_id,
    factura.modo_venta, factura.moneda_id, factura.tasa_cambio, facturaOrigenId, fechaIso,
    subtotal, itbisTotal, total, motivo.trim(), usuarioId
  );

  const insertDetalle = db.prepare(
    `INSERT INTO documentos_venta_detalle
       (id, documento_id, producto_id, cantidad, precio_unitario, tasa_itbis, base_imponible, itbis_monto, total_linea, costo_unitario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const sumarDevueltoOriginal = db.prepare('UPDATE documentos_venta_detalle SET cantidad_devuelta = cantidad_devuelta + ? WHERE id = ?');

  let costoTotal = 0;
  for (const l of lineasCalculadas) {
    insertDetalle.run(
      crypto.randomUUID(), documentoId, l.detalleOriginal.producto_id, l.cantidad,
      l.detalleOriginal.precio_unitario, l.detalleOriginal.tasa_itbis, l.baseImponible, l.itbisMonto, l.totalLinea, l.costoUnitario
    );
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(l.detalleOriginal.producto_id);
    inventario.moverInventarioPorVenta(db, {
      producto, almacenId: factura.almacen_id, cantidad: l.cantidad, // positivo = reingresa
      documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId,
    });
    sumarDevueltoOriginal.run(l.cantidad, l.detalleOriginal.id);
    costoTotal += l.costoUnitario * l.cantidad;
  }
  costoTotal = redondear(costoTotal);

  const cuentaContrapartida = factura.cliente_id ? '1400' : '1100';
  const lineasAsiento = [{ cuentaCodigo: '4100', debe: subtotal, descripcion: 'Devolución de ventas' }];
  if (itbisTotal > 0) lineasAsiento.push({ cuentaCodigo: '2200', debe: itbisTotal, descripcion: 'ITBIS de la devolución' });
  lineasAsiento.push({
    cuentaCodigo: cuentaContrapartida, haber: total,
    descripcion: factura.cliente_id ? 'Crédito a cuenta del cliente' : 'Devolución en efectivo',
  });
  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `Nota de crédito ${numero} (devolución de factura ${factura.numero})`, origenModulo: 'ventas',
    origenDocumentoTipo: 'documentos_venta', origenDocumentoId: documentoId, usuarioId, lineas: lineasAsiento,
  });

  if (costoTotal > 0) {
    contabilidad.generarAsiento(db, {
      fecha: fechaIso, concepto: `Reingreso de inventario - Nota de crédito ${numero}`, origenModulo: 'ventas',
      origenDocumentoTipo: 'documentos_venta', origenDocumentoId: documentoId, usuarioId,
      lineas: [
        { cuentaCodigo: '1300', debe: costoTotal, descripcion: 'Reingreso de inventario' },
        { cuentaCodigo: '5100', haber: costoTotal, descripcion: 'Reversión de costo de ventas' },
      ],
    });
  }

  if (!factura.cliente_id) {
    caja.registrarMovimiento(db, {
      turnoCajaId: turno.id, tipo: 'salida_manual', concepto: `Devolución en efectivo - Nota de crédito ${numero}`,
      monto: -total, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId,
    });
  }

  // Reduce proporcionalmente la comisión pendiente del vendedor sobre lo devuelto.
  if (factura.vendedor_id && factura.total > 0) {
    const comision = db.prepare('SELECT * FROM comisiones_vendedor WHERE documento_venta_id = ?').get(facturaOrigenId);
    if (comision) {
      const reduccion = redondear(comision.monto_comision * (total / factura.total));
      db.prepare(
        "UPDATE comisiones_vendedor SET monto_comision = MAX(0, monto_comision - ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
      ).run(reduccion, comision.id);
    }
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'crear_nota_credito',
    detalle: { numero, facturaOrigen: factura.numero, motivo: motivo.trim(), total },
  });

  return documentoId;
}

function anularNotaCredito(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.devolucion.crear');
  const nota = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'nota_credito'").get(documentoId);
  if (!nota) throw new Error('Nota de crédito no encontrada');
  if (nota.estado === 'anulado') throw new Error('La nota de crédito ya está anulada');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);

  // Revertir: la mercancía devuelta vuelve a salir, y la línea original deja de contarla como devuelta.
  const detalle = db.prepare('SELECT * FROM documentos_venta_detalle WHERE documento_id = ?').all(documentoId);
  for (const l of detalle) {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(l.producto_id);
    inventario.moverInventarioPorVenta(db, {
      producto, almacenId: nota.almacen_id, cantidad: -l.cantidad,
      documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId,
    });
    if (nota.documento_referencia_id) {
      db.prepare('UPDATE documentos_venta_detalle SET cantidad_devuelta = MAX(0, cantidad_devuelta - ?) WHERE documento_id = ? AND producto_id = ?')
        .run(l.cantidad, nota.documento_referencia_id, l.producto_id);
    }
  }

  const movimientosCaja = db
    .prepare("SELECT * FROM movimientos_caja WHERE documento_origen_tipo = 'documentos_venta' AND documento_origen_id = ?")
    .all(documentoId);
  for (const m of movimientosCaja) {
    caja.registrarMovimiento(db, {
      turnoCajaId: m.turno_caja_id, tipo: 'salida_manual', concepto: `Anulación nota de crédito ${nota.numero}`,
      monto: -m.monto, documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId,
    });
  }

  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'documentos_venta' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(documentoId);
  const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
  const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
  for (const asiento of asientos) {
    const detalleAsiento = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'ventas',
      origenDocumentoTipo: 'documentos_venta_anulacion', origenDocumentoId: documentoId, usuarioId,
      lineas: detalleAsiento.map((d) => ({
        cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}`,
      })),
    });
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'anular', detalle: { numero: nota.numero, motivo },
  });
}

// =========================================================================
// Nota de débito de venta — cargo adicional post-factura (flete, ajuste de precio, interés
// por mora...). No mueve inventario. Puede referenciar una factura origen, o quedar suelta
// contra la cuenta general del cliente cuando el cargo no corresponde a una factura puntual.
// Igual que la nota de crédito, no se le asigna NCF propio (ver nota arriba).
// =========================================================================

function crearNotaDebito(db, { clienteId, facturaOrigenId, sucursalId, almacenId, monedaId, concepto, monto, tasaItbisId, usuarioId }) {
  session.requerirPermiso('ventas.nota_debito.crear');
  if (!clienteId) throw new Error('La nota de débito requiere un cliente');
  if (!concepto || !concepto.trim()) throw new Error('El concepto de la nota de débito es obligatorio');
  if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');

  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ? AND deleted_at IS NULL').get(clienteId);
  if (!cliente) throw new Error('Cliente no encontrado');

  let facturaOrigen = null;
  if (facturaOrigenId) {
    facturaOrigen = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'factura' AND cliente_id = ?").get(facturaOrigenId, clienteId);
    if (!facturaOrigen) throw new Error('Factura de referencia no encontrada para este cliente');
  }

  const tasa = db.prepare('SELECT * FROM tasas_itbis WHERE id = ?').get(tasaItbisId);
  if (!tasa) throw new Error('Tasa de ITBIS no válida');

  const sucursalFinal = sucursalId || (facturaOrigen ? facturaOrigen.sucursal_id : null);
  const almacenFinal = almacenId || (facturaOrigen ? facturaOrigen.almacen_id : null);
  if (!sucursalFinal || !almacenFinal) throw new Error('Sucursal y almacén son obligatorios');

  const total = redondear(monto);
  const baseImponible = redondear(total / (1 + tasa.porcentaje));
  const itbisMonto = redondear(total - baseImponible);

  const documentoId = crypto.randomUUID();
  const numero = siguienteNumero(db, 'nota_debito');
  const fechaIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO documentos_venta
       (id, tipo, numero, sucursal_id, almacen_id, cliente_id, condicion_pago, moneda_id, tasa_cambio,
        documento_referencia_id, fecha, subtotal, itbis_total, total, estado, concepto, usuario_id)
     VALUES (?, 'nota_debito', ?, ?, ?, ?, 'credito', ?, 1, ?, ?, ?, ?, ?, 'facturado', ?, ?)`
  ).run(
    documentoId, numero, sucursalFinal, almacenFinal, clienteId, monedaId, facturaOrigenId || null,
    fechaIso, baseImponible, itbisMonto, total, concepto.trim(), usuarioId
  );

  contabilidad.generarAsiento(db, {
    fecha: fechaIso, concepto: `Nota de débito ${numero}: ${concepto.trim()}`, origenModulo: 'ventas',
    origenDocumentoTipo: 'documentos_venta', origenDocumentoId: documentoId, usuarioId,
    lineas: [
      { cuentaCodigo: '1400', debe: total, descripcion: 'Cargo adicional a cuenta del cliente' },
      ...(baseImponible > 0 ? [{ cuentaCodigo: '4100', haber: baseImponible, descripcion: 'Ingreso por cargo adicional' }] : []),
      ...(itbisMonto > 0 ? [{ cuentaCodigo: '2200', haber: itbisMonto, descripcion: 'ITBIS del cargo adicional' }] : []),
    ],
  });

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'crear_nota_debito',
    detalle: { numero, cliente: cliente.nombre, concepto: concepto.trim(), total },
  });

  return documentoId;
}

function anularNotaDebito(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.nota_debito.crear');
  const nota = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'nota_debito'").get(documentoId);
  if (!nota) throw new Error('Nota de débito no encontrada');
  if (nota.estado === 'anulado') throw new Error('La nota de débito ya está anulada');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');

  db.prepare(
    `UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);

  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'documentos_venta' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(documentoId);
  const cuentas = db.prepare('SELECT id, codigo FROM cuentas_contables').all();
  const codigoPorId = Object.fromEntries(cuentas.map((c) => [c.id, c.codigo]));
  for (const asiento of asientos) {
    const detalleAsiento = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'ventas',
      origenDocumentoTipo: 'documentos_venta_anulacion', origenDocumentoId: documentoId, usuarioId,
      lineas: detalleAsiento.map((d) => ({
        cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}`,
      })),
    });
  }

  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'anular', detalle: { numero: nota.numero, motivo },
  });
}

function listarNotas(db, { tipo, clienteId, limite = 50 } = {}) {
  const condiciones = ['dv.tipo = ?'];
  const params = [tipo];
  if (clienteId) {
    condiciones.push(tipo === 'nota_credito' ? 'f.cliente_id = ?' : 'dv.cliente_id = ?');
    params.push(clienteId);
  }
  params.push(limite);
  const joinFactura = tipo === 'nota_credito' ? 'LEFT JOIN documentos_venta f ON f.id = dv.documento_referencia_id' : '';
  const clienteExpr = tipo === 'nota_credito' ? 'f.cliente_id' : 'dv.cliente_id';
  return db
    .prepare(
      `SELECT dv.*, COALESCE(c.nombre, 'Consumidor final') AS cliente_nombre, fo.numero AS factura_origen_numero
       FROM documentos_venta dv
       ${joinFactura}
       LEFT JOIN clientes c ON c.id = ${clienteExpr}
       LEFT JOIN documentos_venta fo ON fo.id = dv.documento_referencia_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY dv.fecha DESC LIMIT ?`
    )
    .all(...params);
}

function listarFacturas(db, { desde, hasta, estado, clienteId, limite = 50 }) {
  const condiciones = ["dv.tipo = 'factura'"];
  const params = [];
  if (desde) { condiciones.push('dv.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('dv.fecha <= ?'); params.push(hasta); }
  if (estado) { condiciones.push('dv.estado = ?'); params.push(estado); }
  if (clienteId) { condiciones.push('dv.cliente_id = ?'); params.push(clienteId); }
  params.push(limite);

  return db
    .prepare(
      `SELECT dv.id, dv.numero, dv.ncf, dv.fecha, dv.total, dv.estado, dv.condicion_pago,
              dv.motivo_anulacion, ua.nombre_completo AS usuario_anulo_nombre,
              COALESCE(c.nombre, 'Consumidor final') AS cliente_nombre, u.nombre_completo AS vendedor_nombre
       FROM documentos_venta dv
       LEFT JOIN clientes c ON c.id = dv.cliente_id
       LEFT JOIN usuarios u ON u.id = dv.vendedor_id
       LEFT JOIN usuarios ua ON ua.id = dv.usuario_anulo_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY dv.fecha DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// Reportes (Módulo 1). Todas parten de documentos_venta / documentos_venta_detalle y no
// netean devoluciones (notas de crédito) salvo que se indique — muestran lo facturado, que
// es lo que pide el documento fuente para estos reportes.
// =========================================================================

function condicionesFecha(desde, hasta, params, alias = 'dv') {
  const condiciones = [];
  if (desde) { condiciones.push(`${alias}.fecha >= ?`); params.push(desde); }
  if (hasta) { condiciones.push(`${alias}.fecha <= ?`); params.push(hasta); }
  return condiciones;
}

const FORMATO_AGRUPACION = { dia: '%Y-%m-%d', semana: '%Y-%W', mes: '%Y-%m' };

function ventasPorPeriodo(db, { desde, hasta, sucursalId, vendedorId, clienteId, tipoNcfCodigo, agrupacion = 'dia' } = {}) {
  const params = [];
  const condiciones = ["dv.tipo = 'factura'", "dv.estado != 'anulado'", 'dv.deleted_at IS NULL', ...condicionesFecha(desde, hasta, params)];
  if (sucursalId) { condiciones.push('dv.sucursal_id = ?'); params.push(sucursalId); }
  if (vendedorId) { condiciones.push('dv.vendedor_id = ?'); params.push(vendedorId); }
  if (clienteId) { condiciones.push('dv.cliente_id = ?'); params.push(clienteId); }
  if (tipoNcfCodigo) { condiciones.push('tn.codigo = ?'); params.push(tipoNcfCodigo); }
  const formato = FORMATO_AGRUPACION[agrupacion] || FORMATO_AGRUPACION.dia;

  return db
    .prepare(
      `SELECT strftime('${formato}', dv.fecha) AS periodo, COUNT(*) AS num_facturas,
              SUM(dv.subtotal) AS subtotal, SUM(dv.descuento_total) AS descuento,
              SUM(dv.itbis_total) AS itbis, SUM(dv.total) AS total
       FROM documentos_venta dv LEFT JOIN tipos_ncf tn ON tn.id = dv.tipo_ncf_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY periodo ORDER BY periodo`
    )
    .all(...params);
}

function ventasPorVendedor(db, { desde, hasta } = {}) {
  const params = [];
  const condiciones = ["dv.tipo = 'factura'", "dv.estado != 'anulado'", 'dv.deleted_at IS NULL', 'dv.vendedor_id IS NOT NULL', ...condicionesFecha(desde, hasta, params)];
  return db
    .prepare(
      `SELECT u.id AS vendedor_id, u.nombre_completo AS vendedor_nombre,
              COUNT(dv.id) AS num_facturas, SUM(dv.total) AS total_vendido
       FROM documentos_venta dv JOIN usuarios u ON u.id = dv.vendedor_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY u.id ORDER BY total_vendido DESC`
    )
    .all(...params);
}

// Cubre a la vez "Ventas por Artículo" y "Productos Más y Menos Vendidos": mismo dato,
// distinto orden. orden: cantidad_desc (default) | cantidad_asc | ingreso_desc | ingreso_asc.
function ventasPorArticulo(db, { desde, hasta, orden = 'cantidad_desc', limite = 100 } = {}) {
  const params = [];
  const condiciones = ["dv.tipo = 'factura'", "dv.estado != 'anulado'", 'dv.deleted_at IS NULL', ...condicionesFecha(desde, hasta, params)];
  const columnas = { cantidad_desc: 'cantidad_vendida DESC', cantidad_asc: 'cantidad_vendida ASC', ingreso_desc: 'ingreso DESC', ingreso_asc: 'ingreso ASC' };
  params.push(limite);
  return db
    .prepare(
      `SELECT p.id AS producto_id, p.codigo_interno, p.descripcion,
              SUM(dvd.cantidad) AS cantidad_vendida, SUM(dvd.total_linea) AS ingreso,
              SUM(dvd.total_linea - dvd.costo_unitario * dvd.cantidad) AS utilidad
       FROM documentos_venta_detalle dvd
       JOIN documentos_venta dv ON dv.id = dvd.documento_id
       JOIN productos p ON p.id = dvd.producto_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY p.id ORDER BY ${columnas[orden] || columnas.cantidad_desc} LIMIT ?`
    )
    .all(...params);
}

function comisionesPorVendedor(db, { desde, hasta } = {}) {
  const params = [];
  const condiciones = ["dv.estado != 'anulado'", ...condicionesFecha(desde, hasta, params)];
  return db
    .prepare(
      `SELECT u.id AS vendedor_id, u.nombre_completo AS vendedor_nombre,
              COUNT(cv.id) AS num_ventas,
              SUM(cv.monto_comision) AS comision_generada,
              SUM(CASE WHEN cv.pagada = 1 THEN cv.monto_comision ELSE 0 END) AS comision_pagada,
              SUM(CASE WHEN cv.pagada = 0 THEN cv.monto_comision ELSE 0 END) AS comision_pendiente
       FROM comisiones_vendedor cv
       JOIN usuarios u ON u.id = cv.vendedor_id
       JOIN documentos_venta dv ON dv.id = cv.documento_venta_id
       WHERE ${condiciones.join(' AND ')} AND cv.deleted_at IS NULL
       GROUP BY u.id ORDER BY comision_generada DESC`
    )
    .all(...params);
}

function marcarComisionPagada(db, { comisionId, usuarioId }) {
  session.requerirPermiso('configuracion.gestionar');
  db.prepare(
    "UPDATE comisiones_vendedor SET pagada = 1, fecha_pago = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(comisionId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'comisiones_vendedor', entidadId: comisionId, accion: 'marcar_pagada' });
}

function margenPorFactura(db, { desde, hasta, limite = 100 } = {}) {
  const params = [];
  const condiciones = ["dv.tipo = 'factura'", "dv.estado != 'anulado'", 'dv.deleted_at IS NULL', ...condicionesFecha(desde, hasta, params)];
  params.push(limite);
  const filas = db
    .prepare(
      `SELECT dv.id, dv.numero, dv.fecha, COALESCE(c.nombre, 'Consumidor final') AS cliente_nombre,
              SUM(dvd.base_imponible) AS ingreso, SUM(dvd.costo_unitario * dvd.cantidad) AS costo
       FROM documentos_venta dv
       JOIN documentos_venta_detalle dvd ON dvd.documento_id = dv.id
       LEFT JOIN clientes c ON c.id = dv.cliente_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY dv.id ORDER BY dv.fecha DESC LIMIT ?`
    )
    .all(...params);
  return filas.map((f) => {
    const utilidad = redondear(f.ingreso - f.costo);
    return { ...f, utilidad, margen_pct: f.ingreso > 0 ? redondear((utilidad / f.ingreso) * 100) : 0 };
  });
}

function resumenCobrosDelDia(db, { fecha } = {}) {
  const dia = fecha || new Date().toISOString().slice(0, 10);
  const facturado = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS total FROM documentos_venta WHERE tipo = 'factura' AND estado != 'anulado' AND deleted_at IS NULL AND date(fecha) = date(?)")
    .get(dia).total;
  const filasPago = db
    .prepare(
      `SELECT pv.forma_pago, COALESCE(SUM(pv.monto), 0) AS total
       FROM pagos_venta pv JOIN documentos_venta dv ON dv.id = pv.documento_id
       WHERE dv.estado != 'anulado' AND dv.deleted_at IS NULL AND date(dv.fecha) = date(?)
       GROUP BY pv.forma_pago`
    )
    .all(dia);
  const porForma = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };
  filasPago.forEach((f) => { porForma[f.forma_pago] = f.total; });
  const totalCobrado = redondear(Object.values(porForma).reduce((a, b) => a + b, 0));
  return { fecha: dia, totalFacturado: redondear(facturado), totalCobrado, porForma };
}

function itbisGeneradoVentas(db, { desde, hasta } = {}) {
  const params = [];
  const condiciones = ["dv.tipo = 'factura'", "dv.estado != 'anulado'", 'dv.deleted_at IS NULL', ...condicionesFecha(desde, hasta, params)];
  return db
    .prepare(
      `SELECT dvd.tasa_itbis, SUM(dvd.base_imponible) AS base_total, SUM(dvd.itbis_monto) AS itbis_total
       FROM documentos_venta_detalle dvd JOIN documentos_venta dv ON dv.id = dvd.documento_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY dvd.tasa_itbis ORDER BY dvd.tasa_itbis DESC`
    )
    .all(...params);
}

function obtenerFactura(db, documentoId) {
  const documento = db
    .prepare(
      `SELECT dv.*, COALESCE(c.nombre, 'Consumidor final') AS cliente_nombre, u.nombre_completo AS vendedor_nombre
       FROM documentos_venta dv
       LEFT JOIN clientes c ON c.id = dv.cliente_id
       LEFT JOIN usuarios u ON u.id = dv.vendedor_id
       WHERE dv.id = ?`
    )
    .get(documentoId);
  if (!documento) return null;
  documento.lineas = db
    .prepare(
      `SELECT dvd.*, p.descripcion AS producto_descripcion, p.codigo_interno
       FROM documentos_venta_detalle dvd JOIN productos p ON p.id = dvd.producto_id
       WHERE dvd.documento_id = ?`
    )
    .all(documentoId);
  documento.pagos = db.prepare('SELECT * FROM pagos_venta WHERE documento_id = ?').all(documentoId);
  return documento;
}

function register(ipcMain, getDb) {
  ipcMain.handle('ventas:crearFactura', (event, payload) => {
    const db = getDb();
    const transaccion = db.transaction(() => crearFactura(db, payload));
    const documentoId = transaccion();
    return obtenerFactura(db, documentoId);
  });

  ipcMain.handle('ventas:anularFactura', (event, payload) => {
    const db = getDb();
    const transaccion = db.transaction(() => anularFactura(db, payload));
    transaccion();
    return obtenerFactura(db, payload.documentoId);
  });

  ipcMain.handle('ventas:listarFacturas', (event, filtros) => {
    const db = getDb();
    return listarFacturas(db, filtros || {});
  });

  ipcMain.handle('ventas:obtenerFactura', (event, { documentoId }) => {
    const db = getDb();
    return obtenerFactura(db, documentoId);
  });

  ipcMain.handle('ventas:crearNotaCredito', (event, payload) => {
    const db = getDb();
    const documentoId = db.transaction(() => crearNotaCredito(db, payload))();
    return obtenerFactura(db, documentoId);
  });
  ipcMain.handle('ventas:anularNotaCredito', (event, payload) => {
    const db = getDb();
    db.transaction(() => anularNotaCredito(db, payload))();
    return obtenerFactura(db, payload.documentoId);
  });

  ipcMain.handle('ventas:crearNotaDebito', (event, payload) => {
    const db = getDb();
    const documentoId = db.transaction(() => crearNotaDebito(db, payload))();
    return obtenerFactura(db, documentoId);
  });
  ipcMain.handle('ventas:anularNotaDebito', (event, payload) => {
    const db = getDb();
    db.transaction(() => anularNotaDebito(db, payload))();
    return obtenerFactura(db, payload.documentoId);
  });

  ipcMain.handle('ventas:listarNotas', (event, filtros) => listarNotas(getDb(), filtros || {}));

  ipcMain.handle('ventas:reportes:ventasPorPeriodo', (event, filtros) => ventasPorPeriodo(getDb(), filtros || {}));
  ipcMain.handle('ventas:reportes:ventasPorVendedor', (event, filtros) => ventasPorVendedor(getDb(), filtros || {}));
  ipcMain.handle('ventas:reportes:ventasPorArticulo', (event, filtros) => ventasPorArticulo(getDb(), filtros || {}));
  ipcMain.handle('ventas:reportes:comisionesPorVendedor', (event, filtros) => comisionesPorVendedor(getDb(), filtros || {}));
  ipcMain.handle('ventas:reportes:marcarComisionPagada', (event, payload) => {
    const db = getDb();
    db.transaction(() => marcarComisionPagada(db, payload))();
  });
  ipcMain.handle('ventas:reportes:margenPorFactura', (event, filtros) => margenPorFactura(getDb(), filtros || {}));
  ipcMain.handle('ventas:reportes:resumenCobrosDelDia', (event, filtros) => resumenCobrosDelDia(getDb(), filtros || {}));
  ipcMain.handle('ventas:reportes:itbisGeneradoVentas', (event, filtros) => itbisGeneradoVentas(getDb(), filtros || {}));

  ipcMain.handle('ventas:monedas', () => {
    const db = getDb();
    return db.prepare('SELECT id, codigo, nombre FROM monedas WHERE activo = 1').all();
  });

  ipcMain.handle('ventas:vendedores', () => {
    const db = getDb();
    return db
      .prepare(
        `SELECT u.id, u.nombre_completo, u.pct_comision FROM usuarios u
         JOIN roles_permisos rp ON rp.rol_id = u.rol_id JOIN permisos p ON p.id = rp.permiso_id
         WHERE p.codigo = 'ventas.factura.crear' AND u.activo = 1
         GROUP BY u.id`
      )
      .all();
  });
}

module.exports = {
  register, calcularLinea, crearFactura, anularFactura, listarFacturas, obtenerFactura,
  crearNotaCredito, anularNotaCredito, crearNotaDebito, anularNotaDebito, listarNotas,
  ventasPorPeriodo, ventasPorVendedor, ventasPorArticulo, comisionesPorVendedor,
  marcarComisionPagada, margenPorFactura, resumenCobrosDelDia, itbisGeneradoVentas,
};
