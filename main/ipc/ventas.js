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

// Descuento de una línea: el mayor entre la promoción vigente y el manual (no se suman). El
// manual puede venir en % o en RD$. Devuelve el descuento aplicado, la promoción si fue ella, y
// el manual (para validar el tope del rol).
function descuentoLinea({ bruto, cantidad, promocion, descuentoPct, descuentoMonto }) {
  const manual = descuentoMonto && !descuentoPct ? redondear(descuentoMonto) : redondear(bruto * ((descuentoPct || 0) / 100));
  const promo = !promocion ? 0 : redondear(promocion.tipo_descuento === 'porcentaje'
    ? bruto * (promocion.valor / 100)
    : Math.min(bruto, promocion.valor * cantidad));
  return promo > manual ? { descuento: promo, promocionId: promocion.id, manual } : { descuento: manual, promocionId: null, manual };
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

// Resuelve productos, precios (ITBIS incluido), descuentos por línea y global, y totales.
// Lo comparten factura, cotización y conduce para que calculen exactamente igual.
// validarExistencia: false en cotizaciones (no comprometen mercancía) y en facturas de
// conduces (la mercancía ya salió con el conduce).
// descuentosAutorizados (productoId → RD$) y descuentoGlobalAutorizadoPct: lo que ya se autorizó
// en la cotización o los conduces que se facturan; hasta ahí no se vuelve a aplicar el tope del rol.
function prepararLineasVenta(db, {
  lineas, almacenId, nivelPrecio, usuarioId, descuentoGlobalPct, validarExistencia,
  descuentosAutorizados = new Map(), descuentoGlobalAutorizadoPct = 0,
}) {
  const limiteRol = obtenerLimiteDescuentoRol(db, usuarioId);
  const puedeExceder = Boolean(limiteRol.puede_exceder);

  const lineasCalculadas = lineas.map((l) => {
    const producto = inventario.obtenerProducto(db, l.productoId, almacenId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
    if (!(l.cantidad > 0)) throw new Error(`La cantidad de "${producto.descripcion}" debe ser mayor a cero`);

    if (validarExistencia && !producto.permite_venta_negativo) {
      const disponible = inventario.existenciaDisponibleParaVenta(db, producto, almacenId);
      if (disponible < l.cantidad) {
        throw new Error(`Existencia insuficiente de "${producto.descripcion}" (disponible: ${disponible}, solicitado: ${l.cantidad})`);
      }
    }

    const precioUnitario = l.precioUnitario ?? precioProducto(producto, nivelPrecio);
    const bruto = redondear(precioUnitario * l.cantidad);
    const d = descuentoLinea({ bruto, cantidad: l.cantidad, promocion: producto.promocion, descuentoPct: l.descuentoPct, descuentoMonto: l.descuentoMonto });
    if (d.manual > bruto + 0.001) throw new Error(`El descuento de "${producto.descripcion}" es mayor que el importe de la línea`);
    // El tope del rol limita solo el descuento manual (la promoción la autorizó quien la creó).
    const yaAutorizado = d.manual <= (descuentosAutorizados.get(producto.id) || 0) + 0.01;
    if (!d.promocionId && !puedeExceder && !yaAutorizado && bruto > 0 && (d.manual / bruto) * 100 > limiteRol.limite_descuento_pct + 0.01) {
      throw new Error(`El descuento de la línea "${producto.descripcion}" excede el límite permitido (${limiteRol.limite_descuento_pct}%)`);
    }
    const calc = calcularLinea({ cantidad: l.cantidad, precioUnitario, descuentoMonto: d.descuento, tasaItbisPct: producto.tasa_itbis_pct });

    return {
      producto, cantidad: l.cantidad, precioUnitario, descuentoPct: bruto > 0 ? redondear((d.descuento / bruto) * 100) : 0,
      descuentoMonto: calc.descuento, tasaItbis: producto.tasa_itbis_pct, promocionId: d.promocionId, ...calc,
    };
  });

  if (!puedeExceder && (descuentoGlobalPct || 0) > Math.max(limiteRol.limite_descuento_pct, descuentoGlobalAutorizadoPct + 0.01)) {
    throw new Error(`El descuento global excede el límite permitido para su rol (${limiteRol.limite_descuento_pct}%)`);
  }

  const subtotalLineas = redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
  const itbisLineas = redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
  const totalLineas = redondear(subtotalLineas + itbisLineas);

  const descuentoGlobalMonto = redondear(totalLineas * ((descuentoGlobalPct || 0) / 100));
  const factor = totalLineas > 0 ? (totalLineas - descuentoGlobalMonto) / totalLineas : 1;
  const subtotal = redondear(subtotalLineas * factor);
  const itbisTotal = redondear(itbisLineas * factor);
  return { lineasCalculadas, descuentoGlobalMonto, subtotal, itbisTotal, total: redondear(subtotal + itbisTotal) };
}

// Descuentos que traen la cotización o los conduces que se facturan (ya autorizados al emitirlos).
function descuentosDeOrigen(db, origenes) {
  const descuentosAutorizados = new Map();
  let bruto = 0;
  let global = 0;
  for (const o of origenes) {
    for (const l of db.prepare('SELECT producto_id, descuento_monto, total_linea FROM documentos_venta_detalle WHERE documento_id = ?').all(o.id)) {
      descuentosAutorizados.set(l.producto_id, (descuentosAutorizados.get(l.producto_id) || 0) + (l.descuento_monto || 0));
      bruto += l.total_linea;
    }
    global += o.descuento_total || 0;
  }
  return { descuentosAutorizados, descuentoGlobalAutorizadoPct: bruto > 0 ? (global / bruto) * 100 : 0 };
}

function crearFactura(db, payload) {
  session.requerirPermiso('ventas.factura.crear');
  const {
    modoVenta, sucursalId, almacenId, cajaId, clienteId, vendedorId, usuarioId,
    condicionPago, tipoNcfCodigo, nivelPrecio, monedaId, tasaCambio,
    lineas, descuentoGlobalPct, pagos, esDelivery, direccionEntrega, repartidorId,
    cuentaAbiertaId, cotizacionId, conduceIds, pedidoId,
  } = payload;

  if (!lineas || lineas.length === 0) throw new Error('La factura debe tener al menos una línea');
  if ([cuentaAbiertaId, cotizacionId, conduceIds && conduceIds.length, pedidoId].filter(Boolean).length > 1) {
    throw new Error('Una factura se genera desde una sola fuente: cuenta abierta, cotización, pedido o conduces');
  }
  const cuentaAbierta = cuentaAbiertaId ? validarCobroCuentaAbierta(db, cuentaAbiertaId, lineas) : null;
  const cotizacion = cotizacionId ? validarFacturaDesdeCotizacion(db, cotizacionId, lineas, clienteId) : null;
  const conduces = conduceIds && conduceIds.length ? validarFacturaDesdeConduces(db, conduceIds, lineas, clienteId) : null;
  const pedido = pedidoId ? validarFacturaDesdePedido(db, pedidoId, lineas, clienteId) : null;
  // La reserva del pedido se libera antes de validar existencia: esa mercancía es suya.
  if (pedido) reservarLineasPedido(db, pedido, -1);

  const { lineasCalculadas, descuentoGlobalMonto, subtotal, itbisTotal, total } = prepararLineasVenta(db, {
    lineas, almacenId, nivelPrecio, usuarioId, descuentoGlobalPct, validarExistencia: !conduces,
    ...descuentosDeOrigen(db, [cotizacion, pedido, ...(conduces || [])].filter(Boolean)),
  });

  // --- Retención esperada (cliente agente de retención): se guarda en la factura como referencia;
  // lo que el cliente retiene de verdad se registra al cobrar (recibo de ingreso, cxc.crearRecibo). ---
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
        tasa_itbis, base_imponible, itbis_monto, total_linea, costo_unitario, promocion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Con conduces, la mercancía ya salió del inventario al entregarse: se usa el costo con el
  // que salió (promedio por producto entre los conduces) y no se mueve inventario otra vez.
  const costoConducePorProducto = conduces ? costoPromedioConduces(db, conduces) : null;
  let costoTotal = 0;
  for (const l of lineasCalculadas) {
    // El costo de la línea es el real de lo que salió (con PEPS, el de las capas consumidas).
    const costoLinea = costoConducePorProducto
      ? costoConducePorProducto.get(l.producto.id) * l.cantidad
      : inventario.moverInventarioPorVenta(db, {
        producto: l.producto, almacenId, cantidad: -l.cantidad, documentoOrigenTipo: 'documentos_venta',
        documentoOrigenId: documentoId, usuarioId,
      });
    insertDetalle.run(
      crypto.randomUUID(), documentoId, l.producto.id, l.cantidad, l.precioUnitario, l.descuentoPct,
      l.descuentoMonto, l.tasaItbis, l.baseImponible, l.itbisMonto, l.totalLinea, redondear(costoLinea / l.cantidad), l.promocionId || null
    );
    costoTotal += costoLinea;
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
        conduces
          ? { cuentaCodigo: CUENTA_MERCANCIA_ENTREGADA, haber: costoTotal, descripcion: 'Mercancía entregada con conduce, ya facturada' }
          : { cuentaCodigo: '1300', haber: costoTotal, descripcion: 'Salida de inventario' },
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

  if (cuentaAbierta) {
    db.prepare(
      `UPDATE cuentas_abiertas SET estado = 'facturada', documento_venta_id = ?, fecha_cierre = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(documentoId, cuentaAbierta.id);
    configuracion.registrarAuditoria(db, {
      usuarioId, modulo: 'ventas', entidad: 'cuentas_abiertas', entidadId: cuentaAbierta.id, accion: 'cobrar', detalle: { numero: cuentaAbierta.numero, factura: numero, total },
    });
  }
  for (const origen of [cotizacion, pedido, ...(conduces || [])].filter(Boolean)) {
    db.prepare(
      "UPDATE documentos_venta SET estado = 'facturado', facturado_en_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(documentoId, origen.id);
    configuracion.registrarAuditoria(db, {
      usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: origen.id, accion: 'facturar', detalle: { tipo: origen.tipo, numero: origen.numero, factura: numero },
    });
  }

  return documentoId;
}

// =========================================================================
// Cotizaciones y conduces
// =========================================================================
//
// Cotización: sin compromiso; no mueve inventario ni CxC ni contabilidad. Mientras esté
// vigente se puede facturar respetando sus precios.
// Conduce: entrega mercancía antes de facturar. Saca el inventario y lo pasa a la cuenta
// puente "Mercancía entregada por facturar" (1350); al facturar, de ahí a Costo de Ventas.
// Uno o varios conduces del mismo cliente se facturan juntos, cada uno completo.

const CUENTA_MERCANCIA_ENTREGADA = '1350';

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function detalleDocumento(db, documentoId) {
  return db.prepare('SELECT * FROM documentos_venta_detalle WHERE documento_id = ? AND deleted_at IS NULL').all(documentoId);
}

function validarFacturaDesdeCotizacion(db, cotizacionId, lineasFactura, clienteId) {
  const cot = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'cotizacion' AND deleted_at IS NULL").get(cotizacionId);
  if (!cot) throw new Error('Cotización no encontrada');
  if (cot.estado !== 'abierto') throw new Error(`La cotización ${cot.numero} ya está ${cot.estado === 'facturado' ? 'facturada' : 'anulada'}`);
  if (cot.valida_hasta && cot.valida_hasta < hoyLocal()) throw new Error(`La cotización ${cot.numero} venció el ${cot.valida_hasta}. Haz una nueva con los precios actuales.`);
  if (cot.cliente_id && cot.cliente_id !== clienteId) throw new Error('La factura debe ser para el mismo cliente de la cotización');
  const clave = (productoId, cantidad, precio) => `${productoId}|${redondear(Number(cantidad))}|${redondear(Number(precio))}`;
  const enCotizacion = detalleDocumento(db, cotizacionId).map((l) => clave(l.producto_id, l.cantidad, l.precio_unitario)).sort();
  const enFactura = lineasFactura.map((l) => clave(l.productoId, l.cantidad, l.precioUnitario)).sort();
  if (enCotizacion.join() !== enFactura.join()) {
    throw new Error('Los productos, cantidades o precios no coinciden con la cotización. Para cambiarlos, haz una nueva cotización.');
  }
  return cot;
}

function validarFacturaDesdeConduces(db, conduceIds, lineasFactura, clienteId) {
  if (!clienteId) throw new Error('Facturar conduces requiere el cliente al que se entregaron');
  const conduces = [...new Set(conduceIds)].map((id) => {
    const c = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'conduce' AND deleted_at IS NULL").get(id);
    if (!c) throw new Error('Conduce no encontrado');
    if (c.estado !== 'entregado') throw new Error(`El conduce ${c.numero} ya está ${c.estado === 'facturado' ? 'facturado' : 'anulado'}`);
    if (c.cliente_id !== clienteId) throw new Error(`El conduce ${c.numero} es de otro cliente`);
    return c;
  });
  const enConduces = new Map();
  for (const c of conduces) {
    for (const l of detalleDocumento(db, c.id)) enConduces.set(l.producto_id, redondear((enConduces.get(l.producto_id) || 0) + l.cantidad));
  }
  const enFactura = new Map();
  for (const l of lineasFactura) enFactura.set(l.productoId, redondear((enFactura.get(l.productoId) || 0) + Number(l.cantidad)));
  const iguales = enConduces.size === enFactura.size && [...enConduces].every(([p, cant]) => Math.abs((enFactura.get(p) || 0) - cant) < 0.001);
  if (!iguales) throw new Error('Los productos o cantidades no coinciden con los conduces. Cada conduce se factura completo.');
  return conduces;
}

function costoPromedioConduces(db, conduces) {
  const acumulado = new Map();
  for (const c of conduces) {
    for (const l of detalleDocumento(db, c.id)) {
      const a = acumulado.get(l.producto_id) || { cantidad: 0, costo: 0 };
      a.cantidad += l.cantidad;
      a.costo += l.cantidad * l.costo_unitario;
      acumulado.set(l.producto_id, a);
    }
  }
  return new Map([...acumulado].map(([p, a]) => [p, a.cantidad > 0 ? redondear(a.costo / a.cantidad) : 0]));
}

function insertarDocumentoSinFiscal(db, { tipo, estado, sucursalId, almacenId, clienteId, vendedorId, modoVenta, calculo, concepto, validaHasta, usuarioId }) {
  const documentoId = crypto.randomUUID();
  const numero = siguienteNumero(db, tipo);
  const fechaIso = new Date().toISOString();
  const sucursal = sucursalId || db.prepare('SELECT id FROM sucursales WHERE es_principal = 1').get().id;
  const monedaLocal = db.prepare('SELECT id FROM monedas WHERE es_local = 1').get().id;
  db.prepare(
    `INSERT INTO documentos_venta
       (id, tipo, numero, sucursal_id, almacen_id, cliente_id, vendedor_id, modo_venta, condicion_pago, moneda_id, fecha,
        subtotal, descuento_total, itbis_total, total, estado, concepto, valida_hasta, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'credito', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    documentoId, tipo, numero, sucursal, almacenId, clienteId || null, vendedorId || null, modoVenta || 'completa', monedaLocal, fechaIso,
    calculo.subtotal, calculo.descuentoGlobalMonto, calculo.itbisTotal, calculo.total, estado, concepto || null, validaHasta || null, usuarioId
  );
  const insertDetalle = db.prepare(
    `INSERT INTO documentos_venta_detalle
       (id, documento_id, producto_id, cantidad, precio_unitario, descuento_pct, descuento_monto,
        tasa_itbis, base_imponible, itbis_monto, total_linea, costo_unitario, promocion_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const lineas = calculo.lineasCalculadas.map((l) => {
    const costoUnitario = inventario.costoUnitarioVenta(db, l.producto);
    const detalleId = crypto.randomUUID();
    insertDetalle.run(
      detalleId, documentoId, l.producto.id, l.cantidad, l.precioUnitario, l.descuentoPct,
      l.descuentoMonto, l.tasaItbis, l.baseImponible, l.itbisMonto, l.totalLinea, costoUnitario, l.promocionId || null
    );
    return { ...l, costoUnitario, detalleId };
  });
  return { documentoId, numero, fechaIso, lineas };
}

function crearCotizacion(db, { sucursalId, almacenId, clienteId, vendedorId, usuarioId, nivelPrecio, lineas, descuentoGlobalPct, diasValidez, concepto }) {
  session.requerirPermiso('ventas.cotizacion.crear');
  if (!lineas || lineas.length === 0) throw new Error('La cotización debe tener al menos un producto');
  const dias = Math.round(Number(diasValidez ?? 15));
  if (!(dias >= 1 && dias <= 365)) throw new Error('La validez de la cotización debe estar entre 1 y 365 días');
  if (clienteId && !cxc.obtenerCliente(db, clienteId)) throw new Error('Cliente no encontrado');
  const calculo = prepararLineasVenta(db, { lineas, almacenId, nivelPrecio, usuarioId, descuentoGlobalPct, validarExistencia: false });
  const vence = new Date();
  vence.setDate(vence.getDate() + dias);
  const validaHasta = `${vence.getFullYear()}-${String(vence.getMonth() + 1).padStart(2, '0')}-${String(vence.getDate()).padStart(2, '0')}`;
  const { documentoId, numero } = insertarDocumentoSinFiscal(db, {
    tipo: 'cotizacion', estado: 'abierto', sucursalId, almacenId, clienteId, vendedorId, calculo, concepto, validaHasta, usuarioId,
  });
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'crear', detalle: { tipo: 'cotizacion', numero, total: calculo.total } });
  return documentoId;
}

function crearConduce(db, { sucursalId, almacenId, clienteId, vendedorId, usuarioId, nivelPrecio, lineas, descuentoGlobalPct, concepto }) {
  session.requerirPermiso('ventas.conduce.crear');
  if (!lineas || lineas.length === 0) throw new Error('El conduce debe tener al menos un producto');
  if (!clienteId) throw new Error('El conduce requiere el cliente al que se entrega la mercancía');
  const cliente = cxc.obtenerCliente(db, clienteId);
  if (!cliente) throw new Error('Cliente no encontrado');
  if (cliente.bloqueado) throw new Error(`El cliente está bloqueado: ${cliente.motivo_bloqueo || 'sin motivo registrado'}`);
  const calculo = prepararLineasVenta(db, { lineas, almacenId, nivelPrecio, usuarioId, descuentoGlobalPct, validarExistencia: true });
  const { documentoId, numero, fechaIso, lineas: insertadas } = insertarDocumentoSinFiscal(db, {
    tipo: 'conduce', estado: 'entregado', sucursalId, almacenId, clienteId, vendedorId, calculo, concepto, usuarioId,
  });
  let costoTotal = 0;
  const guardarCosto = db.prepare('UPDATE documentos_venta_detalle SET costo_unitario = ? WHERE id = ?');
  for (const l of insertadas) {
    const costoLinea = inventario.moverInventarioPorVenta(db, {
      producto: l.producto, almacenId, cantidad: -l.cantidad, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId,
    });
    guardarCosto.run(redondear(costoLinea / l.cantidad), l.detalleId);
    costoTotal += costoLinea;
  }
  costoTotal = redondear(costoTotal);
  if (costoTotal > 0) {
    contabilidad.generarAsiento(db, {
      fecha: fechaIso, concepto: `Conduce ${numero} (mercancía entregada por facturar)`, origenModulo: 'ventas',
      origenDocumentoTipo: 'documentos_venta', origenDocumentoId: documentoId, usuarioId,
      lineas: [
        { cuentaCodigo: CUENTA_MERCANCIA_ENTREGADA, debe: costoTotal, descripcion: 'Mercancía entregada por facturar' },
        { cuentaCodigo: '1300', haber: costoTotal, descripcion: 'Salida de inventario por conduce' },
      ],
    });
  }
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'crear', detalle: { tipo: 'conduce', numero, costoTotal } });
  return documentoId;
}

// Pedido u orden de venta: reserva la mercancía para un cliente (existencia comprometida) sin
// facturar ni mover inventario ni contabilidad. Se factura completo, con sus precios, o se anula
// y la reserva se libera.
function reservarLineasPedido(db, pedido, signo) {
  for (const l of detalleDocumento(db, pedido.id)) {
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(l.producto_id);
    inventario.reservarExistencia(db, { producto, almacenId: pedido.almacen_id, cantidad: signo * l.cantidad });
  }
}

function crearPedido(db, { sucursalId, almacenId, clienteId, vendedorId, usuarioId, nivelPrecio, lineas, descuentoGlobalPct, concepto }) {
  session.requerirPermiso('ventas.pedido.crear');
  if (!lineas || lineas.length === 0) throw new Error('El pedido debe tener al menos un producto');
  if (!clienteId) throw new Error('El pedido requiere el cliente para quien se reserva la mercancía');
  const cliente = cxc.obtenerCliente(db, clienteId);
  if (!cliente) throw new Error('Cliente no encontrado');
  if (cliente.bloqueado) throw new Error(`El cliente está bloqueado: ${cliente.motivo_bloqueo || 'sin motivo registrado'}`);
  const calculo = prepararLineasVenta(db, { lineas, almacenId, nivelPrecio, usuarioId, descuentoGlobalPct, validarExistencia: true });
  const { documentoId, numero } = insertarDocumentoSinFiscal(db, {
    tipo: 'pedido', estado: 'abierto', sucursalId, almacenId, clienteId, vendedorId, calculo, concepto, usuarioId,
  });
  reservarLineasPedido(db, { id: documentoId, almacen_id: almacenId }, 1);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'crear', detalle: { tipo: 'pedido', numero, total: calculo.total } });
  return documentoId;
}

function anularPedido(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.pedido.crear');
  const pedido = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'pedido'").get(documentoId);
  if (!pedido) throw new Error('Pedido no encontrado');
  if (pedido.estado === 'facturado') throw new Error('El pedido ya está facturado. Para revertirlo, anula la factura.');
  if (pedido.estado === 'anulado') throw new Error('El pedido ya está anulado');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
  db.prepare("UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(motivo.trim(), usuarioId, documentoId);
  reservarLineasPedido(db, pedido, -1);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'anular', detalle: { tipo: 'pedido', numero: pedido.numero, motivo } });
}

function validarFacturaDesdePedido(db, pedidoId, lineasFactura, clienteId) {
  const pedido = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'pedido' AND deleted_at IS NULL").get(pedidoId);
  if (!pedido) throw new Error('Pedido no encontrado');
  if (pedido.estado !== 'abierto') throw new Error(`El pedido ${pedido.numero} ya está ${pedido.estado === 'facturado' ? 'facturado' : 'anulado'}`);
  if (pedido.cliente_id !== clienteId) throw new Error('La factura debe ser para el mismo cliente del pedido');
  const clave = (productoId, cantidad, precio) => `${productoId}|${redondear(Number(cantidad))}|${redondear(Number(precio))}`;
  const enPedido = detalleDocumento(db, pedidoId).map((l) => clave(l.producto_id, l.cantidad, l.precio_unitario)).sort();
  const enFactura = lineasFactura.map((l) => clave(l.productoId, l.cantidad, l.precioUnitario)).sort();
  if (enPedido.join() !== enFactura.join()) {
    throw new Error('Los productos, cantidades o precios no coinciden con el pedido. Para cambiarlos, anula el pedido y haz uno nuevo.');
  }
  return pedido;
}

function revertirAsientosDocumento(db, documentoId, tipoAnulacion, usuarioId) {
  const codigoPorId = Object.fromEntries(db.prepare('SELECT id, codigo FROM cuentas_contables').all().map((c) => [c.id, c.codigo]));
  const asientos = db
    .prepare("SELECT * FROM asientos_contables WHERE origen_documento_tipo = 'documentos_venta' AND origen_documento_id = ? AND estado = 'confirmado'")
    .all(documentoId);
  for (const asiento of asientos) {
    const det = db.prepare('SELECT * FROM asientos_contables_detalle WHERE asiento_id = ?').all(asiento.id);
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'ventas',
      origenDocumentoTipo: tipoAnulacion, origenDocumentoId: documentoId, usuarioId,
      lineas: det.map((d) => ({ cuentaCodigo: codigoPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
    });
  }
}

function anularCotizacion(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.cotizacion.crear');
  const cot = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'cotizacion'").get(documentoId);
  if (!cot) throw new Error('Cotización no encontrada');
  if (cot.estado !== 'abierto') throw new Error(`La cotización ya está ${cot.estado === 'facturado' ? 'facturada' : 'anulada'}`);
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
  db.prepare("UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(motivo.trim(), usuarioId, documentoId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'anular', detalle: { tipo: 'cotizacion', numero: cot.numero, motivo } });
}

function anularConduce(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.factura.anular');
  const conduce = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'conduce'").get(documentoId);
  if (!conduce) throw new Error('Conduce no encontrado');
  if (conduce.estado === 'facturado') throw new Error('El conduce ya está facturado. Para revertirlo, anula la factura.');
  if (conduce.estado === 'anulado') throw new Error('El conduce ya está anulado');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
  db.prepare("UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(motivo.trim(), usuarioId, documentoId);
  inventario.reingresarDocumento(db, {
    origenTipo: 'documentos_venta', origenId: documentoId, almacenId: conduce.almacen_id, tipoMovimiento: 'ajuste_entrada',
    documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId,
  });
  revertirAsientosDocumento(db, documentoId, 'documentos_venta_anulacion', usuarioId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'anular', detalle: { tipo: 'conduce', numero: conduce.numero, motivo } });
}

// =========================================================================
// Promociones programadas: descuento por producto o por categoría, en % o en RD$ por unidad,
// entre dos fechas. Se aplican solas al vender (la mayor entre promoción y descuento manual).
// Nunca se borran: se desactivan.
// =========================================================================

const FECHA_AAAAMMDD = /^\d{4}-\d{2}-\d{2}$/;

function estadoPromocion(p, hoy) {
  if (!p.activo) return 'desactivada';
  if (p.fecha_fin < hoy) return 'vencida';
  if (p.fecha_inicio > hoy) return 'programada';
  return 'vigente';
}

function listarPromociones(db) {
  const hoy = hoyLocal();
  return db
    .prepare(
      `SELECT pr.*, p.descripcion AS producto_descripcion, p.codigo_interno, p.precio_detalle, c.nombre AS categoria_nombre,
              u.nombre_completo AS usuario_nombre
       FROM promociones pr
       LEFT JOIN productos p ON p.id = pr.producto_id
       LEFT JOIN categorias_producto c ON c.id = pr.categoria_id
       LEFT JOIN usuarios u ON u.id = pr.usuario_id
       WHERE pr.deleted_at IS NULL
       ORDER BY pr.activo DESC, pr.fecha_fin DESC, pr.created_at DESC`
    )
    .all()
    .map((p) => ({ ...p, estado: estadoPromocion(p, hoy) }));
}

function guardarPromocion(db, { promocionId, nombre, productoId, categoriaId, tipoDescuento, valor, fechaInicio, fechaFin, usuarioId }) {
  session.requerirPermiso('ventas.promocion.gestionar');
  if (!nombre || !String(nombre).trim()) throw new Error('Ponle un nombre a la promoción');
  if (Boolean(productoId) === Boolean(categoriaId)) throw new Error('La promoción aplica a un producto o a una categoría (uno de los dos)');
  let producto = null;
  if (productoId) {
    producto = db.prepare('SELECT id, descripcion, precio_detalle FROM productos WHERE id = ? AND deleted_at IS NULL').get(productoId);
    if (!producto) throw new Error('Producto no encontrado');
  } else if (!db.prepare('SELECT 1 FROM categorias_producto WHERE id = ? AND deleted_at IS NULL').get(categoriaId)) {
    throw new Error('Categoría no encontrada');
  }
  if (!['porcentaje', 'monto'].includes(tipoDescuento)) throw new Error('El descuento es en % o en RD$ por unidad');
  const monto = Number(valor);
  if (!(monto > 0)) throw new Error('El descuento debe ser mayor que cero');
  if (tipoDescuento === 'porcentaje' && monto >= 100) throw new Error('Un descuento en % debe ser menor que 100');
  if (tipoDescuento === 'monto' && producto && monto >= producto.precio_detalle) {
    throw new Error(`El descuento por unidad debe ser menor que el precio de "${producto.descripcion}" (${producto.precio_detalle})`);
  }
  if (!FECHA_AAAAMMDD.test(fechaInicio || '') || !FECHA_AAAAMMDD.test(fechaFin || '')) throw new Error('Indique las fechas de inicio y fin');
  if (fechaFin < fechaInicio) throw new Error('La fecha de fin no puede ser anterior a la de inicio');

  const id = promocionId || crypto.randomUUID();
  if (promocionId) {
    const actual = db.prepare('SELECT * FROM promociones WHERE id = ? AND deleted_at IS NULL').get(promocionId);
    if (!actual) throw new Error('Promoción no encontrada');
    if (!actual.activo) throw new Error('La promoción está desactivada; cree una nueva');
    db.prepare(
      `UPDATE promociones SET nombre = ?, producto_id = ?, categoria_id = ?, tipo_descuento = ?, valor = ?, fecha_inicio = ?, fecha_fin = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(String(nombre).trim(), productoId || null, categoriaId || null, tipoDescuento, monto, fechaInicio, fechaFin, id);
  } else {
    db.prepare(
      `INSERT INTO promociones (id, nombre, producto_id, categoria_id, tipo_descuento, valor, fecha_inicio, fecha_fin, activo, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, String(nombre).trim(), productoId || null, categoriaId || null, tipoDescuento, monto, fechaInicio, fechaFin, usuarioId);
  }
  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'promociones', entidadId: id, accion: promocionId ? 'editar' : 'crear',
    detalle: { nombre: String(nombre).trim(), tipoDescuento, valor: monto, fechaInicio, fechaFin },
  });
  return id;
}

function desactivarPromocion(db, { promocionId, usuarioId }) {
  session.requerirPermiso('ventas.promocion.gestionar');
  const promo = db.prepare('SELECT * FROM promociones WHERE id = ? AND deleted_at IS NULL').get(promocionId);
  if (!promo) throw new Error('Promoción no encontrada');
  if (!promo.activo) throw new Error('La promoción ya está desactivada');
  db.prepare("UPDATE promociones SET activo = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(promocionId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'promociones', entidadId: promocionId, accion: 'desactivar', detalle: { nombre: promo.nombre } });
}

function listarDocumentosVenta(db, { tipo, estado, clienteId, limite = 100 } = {}) {
  if (!['cotizacion', 'conduce', 'pedido'].includes(tipo)) throw new Error('Tipo de documento inválido');
  const condiciones = ['dv.tipo = ?', 'dv.deleted_at IS NULL'];
  const params = [tipo];
  if (estado) { condiciones.push('dv.estado = ?'); params.push(estado); }
  if (clienteId) { condiciones.push('dv.cliente_id = ?'); params.push(clienteId); }
  params.push(limite);
  const hoy = hoyLocal();
  return db
    .prepare(
      `SELECT dv.*, COALESCE(c.nombre, 'Consumidor final') AS cliente_nombre, f.numero AS factura_numero, f.ncf AS factura_ncf
       FROM documentos_venta dv LEFT JOIN clientes c ON c.id = dv.cliente_id LEFT JOIN documentos_venta f ON f.id = dv.facturado_en_id
       WHERE ${condiciones.join(' AND ')} ORDER BY dv.fecha DESC LIMIT ?`
    )
    .all(...params)
    .map((d) => ({ ...d, vencida: d.tipo === 'cotizacion' && d.estado === 'abierto' && Boolean(d.valida_hasta) && d.valida_hasta < hoy }));
}

// =========================================================================
// Cuentas abiertas (módulo opcional, tipo bar/mesa)
// =========================================================================
//
// Una cuenta abierta no es un documento fiscal ni mueve inventario: es una lista de productos
// que se van pidiendo. Al cobrarla se crea una factura normal (crearFactura con
// cuentaAbiertaId) y ahí se valida existencia, NCF, pagos y asientos como cualquier venta.

function exigirCuentasAbiertas(db) {
  configuracion.exigirModulo(db, 'cuentas_abiertas');
}

function obtenerCuentaAbiertaFila(db, cuentaId) {
  const cuenta = db.prepare('SELECT * FROM cuentas_abiertas WHERE id = ? AND deleted_at IS NULL').get(cuentaId);
  if (!cuenta) throw new Error('Cuenta no encontrada');
  return cuenta;
}

function exigirCuentaAbierta(cuenta) {
  if (cuenta.estado !== 'abierta') throw new Error(`La cuenta "${cuenta.nombre}" ya está ${cuenta.estado === 'facturada' ? 'cobrada' : 'anulada'}`);
}

function lineasCuenta(db, cuentaId) {
  return db
    .prepare(
      `SELECT d.*, u.nombre_completo AS usuario_nombre FROM cuentas_abiertas_detalle d
       LEFT JOIN usuarios u ON u.id = d.usuario_id
       WHERE d.cuenta_id = ? AND d.deleted_at IS NULL ORDER BY d.created_at ASC`
    )
    .all(cuentaId);
}

function cantidadesPorProducto(lineas, campoProducto, campoCantidad) {
  const mapa = new Map();
  for (const l of lineas) mapa.set(l[campoProducto], redondear((mapa.get(l[campoProducto]) || 0) + Number(l[campoCantidad])));
  return mapa;
}

// Lo que se factura tiene que ser exactamente lo que tiene la cuenta (mismos productos y
// cantidades): si no, quitar algo al cobrar evitaría el permiso y el registro de "quitar línea".
function validarCobroCuentaAbierta(db, cuentaId, lineasFactura) {
  exigirCuentasAbiertas(db);
  const cuenta = obtenerCuentaAbiertaFila(db, cuentaId);
  exigirCuentaAbierta(cuenta);
  const enCuenta = cantidadesPorProducto(lineasCuenta(db, cuentaId), 'producto_id', 'cantidad');
  const enFactura = cantidadesPorProducto(lineasFactura, 'productoId', 'cantidad');
  const iguales = enCuenta.size === enFactura.size
    && [...enCuenta].every(([productoId, cantidad]) => Math.abs((enFactura.get(productoId) || 0) - cantidad) < 0.001);
  if (!iguales) throw new Error('Los productos a cobrar no coinciden con los de la cuenta. Haz los cambios en la cuenta abierta antes de cobrar.');
  return cuenta;
}

function obtenerCuentaAbierta(db, cuentaId) {
  const cuenta = db
    .prepare(
      `SELECT c.*, u.nombre_completo AS usuario_nombre, dv.numero AS factura_numero, dv.ncf AS factura_ncf
       FROM cuentas_abiertas c LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN documentos_venta dv ON dv.id = c.documento_venta_id
       WHERE c.id = ? AND c.deleted_at IS NULL`
    )
    .get(cuentaId);
  if (!cuenta) return null;
  cuenta.lineas = lineasCuenta(db, cuentaId).map((l) => {
    const producto = inventario.obtenerProducto(db, l.producto_id, cuenta.almacen_id);
    return { ...l, producto, precio_unitario: producto.precio_detalle, subtotal: redondear(producto.precio_detalle * l.cantidad) };
  });
  cuenta.total = redondear(cuenta.lineas.reduce((a, l) => a + l.subtotal, 0));
  return cuenta;
}

function listarCuentasAbiertas(db, { estado = 'abierta', limite = 100 } = {}) {
  exigirCuentasAbiertas(db);
  return db
    .prepare('SELECT id FROM cuentas_abiertas WHERE estado = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT ?')
    .all(estado, limite)
    .map(({ id }) => {
      const c = obtenerCuentaAbierta(db, id);
      return { ...c, cantidad_productos: redondear(c.lineas.reduce((a, l) => a + l.cantidad, 0)) };
    });
}

function abrirCuenta(db, { nombre, sucursalId, almacenId, usuarioId }) {
  exigirCuentasAbiertas(db);
  session.requerirPermiso('ventas.cuenta_abierta.gestionar');
  const nombreLimpio = (nombre || '').trim();
  if (!nombreLimpio) throw new Error('Indica la mesa o el nombre de la cuenta');
  const repetida = db.prepare("SELECT 1 FROM cuentas_abiertas WHERE estado = 'abierta' AND deleted_at IS NULL AND lower(nombre) = lower(?)").get(nombreLimpio);
  if (repetida) throw new Error(`Ya hay una cuenta abierta con el nombre "${nombreLimpio}"`);
  const { maximo } = db.prepare('SELECT MAX(CAST(numero AS INTEGER)) AS maximo FROM cuentas_abiertas').get();
  const id = crypto.randomUUID();
  const numero = String((maximo || 0) + 1).padStart(6, '0');
  db.prepare('INSERT INTO cuentas_abiertas (id, numero, nombre, sucursal_id, almacen_id, usuario_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, numero, nombreLimpio, sucursalId || null, almacenId, usuarioId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'cuentas_abiertas', entidadId: id, accion: 'crear', detalle: { numero, nombre: nombreLimpio } });
  return id;
}

function agregarProductoCuenta(db, { cuentaId, productoId, cantidad, nota, usuarioId }) {
  exigirCuentasAbiertas(db);
  session.requerirPermiso('ventas.cuenta_abierta.gestionar');
  const cuenta = obtenerCuentaAbiertaFila(db, cuentaId);
  exigirCuentaAbierta(cuenta);
  const cant = redondear(Number(cantidad) || 0);
  if (cant <= 0) throw new Error('La cantidad debe ser mayor a cero');
  const producto = inventario.obtenerProducto(db, productoId, cuenta.almacen_id);
  if (!producto) throw new Error('Producto no encontrado');
  if (!producto.permite_venta_negativo) {
    const disponible = inventario.existenciaDisponibleParaVenta(db, producto, cuenta.almacen_id);
    const yaEnCuenta = cantidadesPorProducto(lineasCuenta(db, cuentaId), 'producto_id', 'cantidad').get(productoId) || 0;
    if (yaEnCuenta + cant > disponible + 0.001) {
      throw new Error(`Existencia insuficiente de "${producto.descripcion}" (disponible: ${disponible}${yaEnCuenta ? `, ya en la cuenta: ${yaEnCuenta}` : ''})`);
    }
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO cuentas_abiertas_detalle (id, cuenta_id, producto_id, cantidad, nota, usuario_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, cuentaId, productoId, cant, (nota || '').trim() || null, usuarioId);
  db.prepare("UPDATE cuentas_abiertas SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(cuentaId);
  return id;
}

function quitarLineaCuenta(db, { lineaId, motivo, usuarioId }) {
  exigirCuentasAbiertas(db);
  session.requerirPermiso('ventas.cuenta_abierta.anular');
  const linea = db.prepare('SELECT * FROM cuentas_abiertas_detalle WHERE id = ? AND deleted_at IS NULL').get(lineaId);
  if (!linea) throw new Error('Línea no encontrada');
  exigirCuentaAbierta(obtenerCuentaAbiertaFila(db, linea.cuenta_id));
  if (!motivo || !motivo.trim()) throw new Error('Quitar un producto de la cuenta requiere un motivo');
  db.prepare(
    `UPDATE cuentas_abiertas_detalle SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), motivo_eliminacion = ?, usuario_elimino_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo.trim(), usuarioId, lineaId);
  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'ventas', entidad: 'cuentas_abiertas_detalle', entidadId: lineaId, accion: 'quitar',
    detalle: { cuentaId: linea.cuenta_id, productoId: linea.producto_id, cantidad: linea.cantidad, motivo: motivo.trim() },
  });
}

function anularCuentaAbierta(db, { cuentaId, motivo, usuarioId }) {
  exigirCuentasAbiertas(db);
  session.requerirPermiso('ventas.cuenta_abierta.anular');
  const cuenta = obtenerCuentaAbiertaFila(db, cuentaId);
  exigirCuentaAbierta(cuenta);
  if (!motivo || !motivo.trim()) throw new Error('Anular una cuenta requiere un motivo');
  db.prepare(
    `UPDATE cuentas_abiertas SET estado = 'anulada', motivo_anulacion = ?, usuario_anulo_id = ?, fecha_cierre = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo.trim(), usuarioId, cuentaId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'cuentas_abiertas', entidadId: cuentaId, accion: 'anular', detalle: { numero: cuenta.numero, motivo: motivo.trim() } });
}

function anularFactura(db, { documentoId, motivo, usuarioId }) {
  session.requerirPermiso('ventas.factura.anular');
  const documento = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'factura'").get(documentoId);
  if (!documento) throw new Error('Factura no encontrada');
  if (documento.estado === 'anulado') throw new Error('La factura ya está anulada');
  if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
  // Una devolución ya reingresó mercancía y acreditó al cliente: anular la factura encima la
  // devolvería dos veces.
  const notas = db
    .prepare("SELECT numero FROM documentos_venta WHERE documento_referencia_id = ? AND tipo = 'nota_credito' AND estado != 'anulado' AND deleted_at IS NULL")
    .all(documentoId);
  if (notas.length > 0) {
    throw new Error(`La factura tiene devoluciones activas (nota de crédito ${notas.map((n) => n.numero).join(', ')}). Anúlelas primero.`);
  }

  db.prepare(
    `UPDATE documentos_venta SET estado = 'anulado', motivo_anulacion = ?, usuario_anulo_id = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(motivo, usuarioId, documentoId);

  // Documentos que originaron esta factura: vuelven a quedar pendientes de facturar.
  const origenes = db.prepare("SELECT * FROM documentos_venta WHERE facturado_en_id = ? AND tipo IN ('cotizacion', 'conduce', 'pedido')").all(documentoId);
  const deConduces = origenes.some((o) => o.tipo === 'conduce');
  for (const o of origenes) {
    db.prepare(`UPDATE documentos_venta SET estado = ?, facturado_en_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(o.tipo === 'conduce' ? 'entregado' : 'abierto', o.id);
    // Un pedido vuelve a quedar pendiente: su mercancía (que reingresa abajo) queda reservada otra vez.
    if (o.tipo === 'pedido') reservarLineasPedido(db, o, 1);
  }
  db.prepare(
    `UPDATE cuentas_abiertas SET estado = 'abierta', documento_venta_id = NULL, fecha_cierre = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE documento_venta_id = ?`
  ).run(documentoId);

  // Revertir inventario: reingresa lo que salió, a los mismos lotes y al mismo costo. Si la
  // factura venía de conduces, la mercancía salió con el conduce, que sigue vigente: no se toca.
  if (!deConduces) {
    inventario.reingresarDocumento(db, {
      origenTipo: 'documentos_venta', origenId: documentoId, almacenId: documento.almacen_id, tipoMovimiento: 'ajuste_entrada',
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

// Documentos con los que salió del inventario lo facturado: la factura misma o sus conduces.
function origenesInventarioFactura(db, facturaId) {
  const conduces = db.prepare("SELECT id FROM documentos_venta WHERE facturado_en_id = ? AND tipo = 'conduce'").all(facturaId);
  return conduces.length > 0 ? conduces.map((c) => c.id) : [facturaId];
}

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
    // Reingresa a los lotes y al costo con que salió en la factura (si la factura vino de
    // conduces, lo que salió fue con los conduces).
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(l.detalleOriginal.producto_id);
    const costoLinea = inventario.reingresarVenta(db, {
      producto, cantidad: l.cantidad, origenIds: origenesInventarioFactura(db, facturaOrigenId), almacenId: factura.almacen_id,
      documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId,
    });
    insertDetalle.run(
      crypto.randomUUID(), documentoId, l.detalleOriginal.producto_id, l.cantidad,
      l.detalleOriginal.precio_unitario, l.detalleOriginal.tasa_itbis, l.baseImponible, l.itbisMonto, l.totalLinea, redondear(costoLinea / l.cantidad)
    );
    sumarDevueltoOriginal.run(l.cantidad, l.detalleOriginal.id);
    costoTotal += costoLinea;
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
  // Lo que la nota reingresó (componentes, si eran kits) sale de los mismos lotes.
  const reingresado = db
    .prepare(
      `SELECT producto_id, SUM(cantidad) AS cantidad FROM kardex_movimientos
       WHERE documento_origen_tipo = 'documentos_venta' AND documento_origen_id = ? AND cantidad > 0 GROUP BY producto_id`
    )
    .all(documentoId);
  for (const r of reingresado) {
    inventario.retirarEntradas(db, {
      origenTipo: 'documentos_venta', origenId: documentoId, productoId: r.producto_id, almacenId: nota.almacen_id, cantidad: r.cantidad,
      tipoMovimiento: 'salida_venta', documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId,
    });
  }
  const detalle = db.prepare('SELECT * FROM documentos_venta_detalle WHERE documento_id = ?').all(documentoId);
  for (const l of detalle) {
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
      `SELECT strftime('${formato}', dv.fecha, 'localtime') AS periodo, COUNT(*) AS num_facturas,
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
  const dia = fecha || hoyLocal();
  const facturado = db
    .prepare("SELECT COALESCE(SUM(total), 0) AS total FROM documentos_venta WHERE tipo = 'factura' AND estado != 'anulado' AND deleted_at IS NULL AND date(fecha, 'localtime') = date(?)")
    .get(dia).total;
  const filasPago = db
    .prepare(
      `SELECT pv.forma_pago, COALESCE(SUM(pv.monto), 0) AS total
       FROM pagos_venta pv JOIN documentos_venta dv ON dv.id = pv.documento_id
       WHERE dv.estado != 'anulado' AND dv.deleted_at IS NULL AND date(dv.fecha, 'localtime') = date(?)
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
  ipcMain.handle('cuentas:listar', (event, filtros) => listarCuentasAbiertas(getDb(), filtros || {}));
  ipcMain.handle('cuentas:obtener', (event, { cuentaId }) => { const db = getDb(); exigirCuentasAbiertas(db); return obtenerCuentaAbierta(db, cuentaId); });
  ipcMain.handle('cuentas:abrir', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => abrirCuenta(db, payload))();
    return obtenerCuentaAbierta(db, id);
  });
  const escrituraCuenta = (canal, fn, cuentaIdDe) => ipcMain.handle(canal, (event, payload) => {
    const db = getDb();
    db.transaction(() => fn(db, payload))();
    const cuentaId = cuentaIdDe(db, payload);
    return cuentaId ? obtenerCuentaAbierta(db, cuentaId) : null;
  });
  escrituraCuenta('cuentas:agregarProducto', agregarProductoCuenta, (db, p) => p.cuentaId);
  escrituraCuenta('cuentas:quitarLinea', quitarLineaCuenta, (db, p) => (db.prepare('SELECT cuenta_id FROM cuentas_abiertas_detalle WHERE id = ?').get(p.lineaId) || {}).cuenta_id);
  escrituraCuenta('cuentas:anular', anularCuentaAbierta, (db, p) => p.cuentaId);

  const crearYObtener = (canal, fn) => ipcMain.handle(canal, (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => fn(db, payload))();
    return obtenerFactura(db, id);
  });
  crearYObtener('ventas:crearCotizacion', crearCotizacion);
  crearYObtener('ventas:crearConduce', crearConduce);
  crearYObtener('ventas:crearPedido', crearPedido);
  ipcMain.handle('ventas:anularPedido', (event, payload) => { const db = getDb(); db.transaction(() => anularPedido(db, payload))(); return obtenerFactura(db, payload.documentoId); });
  ipcMain.handle('ventas:anularCotizacion', (event, payload) => { const db = getDb(); db.transaction(() => anularCotizacion(db, payload))(); return obtenerFactura(db, payload.documentoId); });
  ipcMain.handle('ventas:anularConduce', (event, payload) => { const db = getDb(); db.transaction(() => anularConduce(db, payload))(); return obtenerFactura(db, payload.documentoId); });
  ipcMain.handle('ventas:listarDocumentos', (event, filtros) => listarDocumentosVenta(getDb(), filtros || {}));
  ipcMain.handle('ventas:listarPromociones', () => listarPromociones(getDb()));
  ipcMain.handle('ventas:guardarPromocion', (event, payload) => { const db = getDb(); return db.transaction(() => guardarPromocion(db, payload))(); });
  ipcMain.handle('ventas:desactivarPromocion', (event, payload) => { const db = getDb(); return db.transaction(() => desactivarPromocion(db, payload))(); });

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
  abrirCuenta, agregarProductoCuenta, quitarLineaCuenta, anularCuentaAbierta, obtenerCuentaAbierta, listarCuentasAbiertas,
  crearCotizacion, crearConduce, anularCotizacion, anularConduce, listarDocumentosVenta, crearPedido, anularPedido,
  listarPromociones, guardarPromocion, desactivarPromocion, descuentoLinea,
  crearNotaCredito, anularNotaCredito, crearNotaDebito, anularNotaDebito, listarNotas,
  ventasPorPeriodo, ventasPorVendedor, ventasPorArticulo, comisionesPorVendedor,
  marcarComisionPagada, margenPorFactura, resumenCobrosDelDia, itbisGeneradoVentas,
};
