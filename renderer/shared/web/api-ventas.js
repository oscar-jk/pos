// Ventas y Facturación, versión web. Réplica de main/ipc/ventas.js sobre el store local:
// mismo cálculo de ITBIS incluido, mismo manejo de inventario/kits, mismas notas de
// crédito/débito — sin el límite de descuento por rol (no hay matriz de roles en la web) y
// sin el asiento contable en partida doble (eso se muestra solo en la app de escritorio).
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;
  const inv = window.puntoXInventario._interno;
  const cxcInterno = window.puntoXCxc._interno;
  const cajaInterno = window.puntoXCaja._interno;

  const CODIGO_TIPO_NCF = { consumo: 'B02', credito_fiscal: 'B01', gubernamental: 'B14', regimen_especial: 'B15' };

  function tomarNcf(db, codigoTipo) {
    db.secuenciasNcf = db.secuenciasNcf || {};
    const codigo = CODIGO_TIPO_NCF[codigoTipo] || codigoTipo || 'B02';
    db.secuenciasNcf[codigo] = (db.secuenciasNcf[codigo] || 0) + 1;
    return `${codigo}${String(db.secuenciasNcf[codigo]).padStart(8, '0')}`;
  }

  function precioProducto(producto, nivel) {
    if (nivel === 'mayorista') return producto.precio_mayorista || producto.precio_detalle;
    if (nivel === 'distribuidor') return producto.precio_distribuidor || producto.precio_detalle;
    return producto.precio_detalle;
  }

  function calcularLinea({ cantidad, precioUnitario, descuentoPct, descuentoMonto, tasaItbisPct }) {
    const bruto = store.redondear(precioUnitario * cantidad);
    const descuento = descuentoMonto && !descuentoPct ? descuentoMonto : store.redondear(bruto * ((descuentoPct || 0) / 100));
    const totalLinea = store.redondear(bruto - descuento);
    const baseImponible = store.redondear(totalLinea / (1 + tasaItbisPct));
    const itbisMonto = store.redondear(totalLinea - baseImponible);
    return { bruto, descuento, totalLinea, baseImponible, itbisMonto };
  }

  function obtenerFactura(db, documentoId) {
    const d = db.documentosVenta.find((x) => x.id === documentoId);
    if (!d) return null;
    const cliente = d.cliente_id ? db.clientes.find((c) => c.id === d.cliente_id) : null;
    const vendedor = d.vendedor_id ? db.usuarios.find((u) => u.id === d.vendedor_id) : null;
    const lineas = db.documentosVentaDetalle.filter((l) => l.documento_id === documentoId).map((l) => ({
      ...l, producto_descripcion: (db.productos.find((p) => p.id === l.producto_id) || {}).descripcion || '—',
      codigo_interno: (db.productos.find((p) => p.id === l.producto_id) || {}).codigo_interno || '',
    }));
    const pagos = db.pagosVenta.filter((p) => p.documento_id === documentoId);
    return { ...d, cliente_nombre: cliente ? cliente.nombre : 'Consumidor final', vendedor_nombre: vendedor ? vendedor.nombre_completo : null, lineas, pagos };
  }

  function crearFactura(payload) {
    const db = store.cargar();
    const {
      modoVenta, sucursalId, almacenId, cajaId, clienteId, vendedorId, usuarioId, condicionPago,
      tipoNcfCodigo, nivelPrecio, monedaId, tasaCambio, lineas, descuentoGlobalPct, pagos,
    } = payload;
    if (!lineas || lineas.length === 0) throw new Error('La factura debe tener al menos una línea');

    const lineasCalculadas = lineas.map((l) => {
      const producto = db.productos.find((p) => p.id === l.productoId);
      if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
      const tasa = db.tasasItbis.find((t) => t.id === producto.tasa_itbis_id);
      const tasaPct = tasa ? tasa.porcentaje : 0.18;
      if (!producto.permite_venta_negativo) {
        const disp = inv.existenciaDisponibleParaVenta(db, producto, almacenId);
        if (disp < l.cantidad) throw new Error(`Existencia insuficiente de "${producto.descripcion}" (disponible: ${disp}, solicitado: ${l.cantidad})`);
      }
      const precioUnitario = l.precioUnitario ?? precioProducto(producto, nivelPrecio);
      const calc = calcularLinea({ cantidad: l.cantidad, precioUnitario, descuentoPct: l.descuentoPct, descuentoMonto: l.descuentoMonto, tasaItbisPct: tasaPct });
      return { producto, cantidad: l.cantidad, precioUnitario, descuentoPct: l.descuentoPct || 0, descuentoMonto: calc.descuento, tasaItbis: tasaPct, ...calc };
    });

    const subtotalLineas = store.redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
    const itbisLineas = store.redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
    const totalLineas = store.redondear(subtotalLineas + itbisLineas);
    const descuentoGlobalMonto = store.redondear(totalLineas * ((descuentoGlobalPct || 0) / 100));
    const factor = totalLineas > 0 ? (totalLineas - descuentoGlobalMonto) / totalLineas : 1;
    const subtotal = store.redondear(subtotalLineas * factor);
    const itbisTotal = store.redondear(itbisLineas * factor);
    const total = store.redondear(subtotal + itbisTotal);

    let cliente = null;
    if (clienteId) {
      cliente = db.clientes.find((c) => c.id === clienteId);
      if (!cliente) throw new Error('Cliente no encontrado');
      if (cliente.bloqueado) throw new Error(`El cliente está bloqueado: ${cliente.motivo_bloqueo || 'sin motivo registrado'}`);
    }

    const sumaPagos = store.redondear((pagos || []).reduce((acc, p) => acc + p.monto, 0));
    if (Math.abs(sumaPagos - total) > 0.01) throw new Error(`Los pagos (${sumaPagos}) no cuadran con el total de la factura (${total})`);

    const montoCredito = store.redondear((pagos || []).filter((p) => p.formaPago === 'credito').reduce((acc, p) => acc + p.monto, 0));
    if (montoCredito > 0) {
      if (!cliente) throw new Error('Una venta a crédito requiere un cliente registrado');
      const motivoMora = cxcInterno.verificarBloqueoPorMora ? cxcInterno.verificarBloqueoPorMora(clienteId) : null;
      if (motivoMora) throw new Error(`Crédito bloqueado por mora: ${motivoMora}`);
      const saldoActual = cxcInterno.saldoPendienteCliente(db, clienteId);
      if (saldoActual + montoCredito > cliente.limite_credito) throw new Error(`La venta excede el límite de crédito del cliente (límite: ${cliente.limite_credito}, saldo actual: ${saldoActual})`);
    }

    const montoEfectivo = store.redondear((pagos || []).filter((p) => p.formaPago === 'efectivo').reduce((acc, p) => acc + p.monto, 0));
    let turno = null;
    if (montoEfectivo > 0) {
      turno = db.turnosCaja.find((t) => t.caja_id === cajaId && t.estado === 'abierto');
      if (!turno) throw new Error('Debe abrir un turno de caja antes de facturar al contado en efectivo');
    }

    const codigoNcf = tipoNcfCodigo || (cliente ? cliente.tipo_comprobante_default : null) || 'consumo';
    const ncf = tomarNcf(db, codigoNcf);
    const documentoId = store.uuid();
    const numero = store.siguienteNumero('factura');
    const fechaIso = store.ahora();

    db.documentosVenta.push({
      id: documentoId, tipo: 'factura', numero, ncf, sucursal_id: sucursalId, almacen_id: almacenId, cliente_id: clienteId || null,
      vendedor_id: vendedorId || null, modo_venta: modoVenta, condicion_pago: condicionPago, moneda_id: monedaId, tasa_cambio: tasaCambio || 1,
      documento_referencia_id: null, fecha: fechaIso, subtotal, descuento_total: descuentoGlobalMonto, itbis_total: itbisTotal, total,
      estado: 'facturado', concepto: null, usuario_id: usuarioId,
    });

    for (const l of lineasCalculadas) {
      db.documentosVentaDetalle.push({
        id: store.uuid(), documento_id: documentoId, producto_id: l.producto.id, cantidad: l.cantidad, precio_unitario: l.precioUnitario,
        descuento_pct: l.descuentoPct, descuento_monto: l.descuentoMonto, tasa_itbis: l.tasaItbis, base_imponible: l.baseImponible,
        itbis_monto: l.itbisMonto, total_linea: l.totalLinea, costo_unitario: inv.costoUnitarioVenta(db, l.producto), cantidad_devuelta: 0,
      });
      inv.moverInventarioPorVenta(db, { producto: l.producto, almacenId, cantidad: -l.cantidad, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId });
    }

    for (const p of pagos) {
      db.pagosVenta.push({ id: store.uuid(), documento_id: documentoId, forma_pago: p.formaPago, monto: p.monto, referencia: p.referencia || null });
      if (p.formaPago === 'efectivo' && p.monto > 0) cajaInterno.registrarMovimiento(db, { turnoCajaId: turno.id, tipo: 'venta_efectivo', concepto: `Factura ${numero}`, monto: p.monto, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId });
    }

    if (vendedorId) {
      const vendedor = db.usuarios.find((u) => u.id === vendedorId);
      if (vendedor && vendedor.pct_comision > 0) {
        db.comisionesVendedor.push({ id: store.uuid(), vendedor_id: vendedorId, documento_venta_id: documentoId, monto_comision: store.redondear(total * (vendedor.pct_comision / 100)), pagada: false, fecha_pago: null });
      }
    }

    store.guardar();
    return documentoId;
  }

  function anularFactura({ documentoId, motivo, usuarioId }) {
    const db = store.cargar();
    const documento = db.documentosVenta.find((d) => d.id === documentoId);
    if (!documento) throw new Error('Factura no encontrada');
    if (documento.estado === 'anulado') throw new Error('La factura ya está anulada');
    if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
    documento.estado = 'anulado'; documento.motivo_anulacion = motivo; documento.usuario_anulo_id = usuarioId;

    for (const l of db.documentosVentaDetalle.filter((x) => x.documento_id === documentoId)) {
      const producto = db.productos.find((p) => p.id === l.producto_id);
      inv.moverInventarioPorVenta(db, { producto, almacenId: documento.almacen_id, cantidad: l.cantidad, documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId });
    }
    for (const m of db.movimientosCaja.filter((x) => x.documento_origen_tipo === 'documentos_venta' && x.documento_origen_id === documentoId)) {
      cajaInterno.registrarMovimiento(db, { turnoCajaId: m.turno_caja_id, tipo: 'venta_efectivo', concepto: `Anulación factura ${documento.numero}`, monto: -m.monto, documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId });
    }
    for (const c of db.comisionesVendedor.filter((x) => x.documento_venta_id === documentoId)) c.monto_comision = 0;
    store.guardar();
  }

  function listarFacturas({ desde, hasta, estado, clienteId, limite = 50 } = {}) {
    const db = store.cargar();
    return db.documentosVenta
      .filter((d) => d.tipo === 'factura')
      .filter((d) => !desde || d.fecha >= desde)
      .filter((d) => !hasta || d.fecha <= hasta)
      .filter((d) => !estado || d.estado === estado)
      .filter((d) => !clienteId || d.cliente_id === clienteId)
      .slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limite)
      .map((d) => ({
        ...d, cliente_nombre: d.cliente_id ? (db.clientes.find((c) => c.id === d.cliente_id) || {}).nombre || '—' : 'Consumidor final',
        vendedor_nombre: d.vendedor_id ? (db.usuarios.find((u) => u.id === d.vendedor_id) || {}).nombre_completo : null,
        usuario_anulo_nombre: d.usuario_anulo_id ? (db.usuarios.find((u) => u.id === d.usuario_anulo_id) || {}).nombre_completo : null,
      }));
  }

  function crearNotaCredito({ facturaOrigenId, lineas, motivo, cajaId, usuarioId }) {
    const db = store.cargar();
    if (!lineas || lineas.length === 0) throw new Error('La devolución debe tener al menos una línea');
    if (!motivo || !motivo.trim()) throw new Error('La devolución requiere un motivo');
    const factura = db.documentosVenta.find((d) => d.id === facturaOrigenId && d.tipo === 'factura');
    if (!factura) throw new Error('Factura de origen no encontrada');
    if (factura.estado === 'anulado') throw new Error('No se puede devolver mercancía de una factura anulada');

    const lineasCalculadas = lineas.map((l) => {
      const detalleOriginal = db.documentosVentaDetalle.find((x) => x.id === l.detalleId && x.documento_id === facturaOrigenId);
      if (!detalleOriginal) throw new Error('Línea de la factura original no encontrada');
      if (!l.cantidad || l.cantidad <= 0) throw new Error('La cantidad a devolver debe ser mayor a cero');
      const pendiente = store.redondear(detalleOriginal.cantidad - detalleOriginal.cantidad_devuelta);
      if (l.cantidad > pendiente + 0.001) throw new Error(`La cantidad a devolver (${l.cantidad}) excede lo pendiente de devolver en esta línea (${pendiente})`);
      const proporcion = l.cantidad / detalleOriginal.cantidad;
      return {
        detalleOriginal, cantidad: l.cantidad, baseImponible: store.redondear(detalleOriginal.base_imponible * proporcion),
        itbisMonto: store.redondear(detalleOriginal.itbis_monto * proporcion), totalLinea: store.redondear(detalleOriginal.total_linea * proporcion),
        costoUnitario: detalleOriginal.costo_unitario,
      };
    });
    const subtotal = store.redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
    const itbisTotal = store.redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
    const total = store.redondear(subtotal + itbisTotal);

    let turno = null;
    if (!factura.cliente_id) {
      if (!cajaId) throw new Error('Se requiere una caja para devolver en efectivo a un cliente no registrado');
      turno = db.turnosCaja.find((t) => t.caja_id === cajaId && t.estado === 'abierto');
      if (!turno) throw new Error('Debe abrir un turno de caja antes de procesar esta devolución en efectivo');
    }

    const documentoId = store.uuid();
    const numero = store.siguienteNumero('nota_credito');
    db.documentosVenta.push({
      id: documentoId, tipo: 'nota_credito', numero, sucursal_id: factura.sucursal_id, almacen_id: factura.almacen_id,
      cliente_id: factura.cliente_id, vendedor_id: factura.vendedor_id, modo_venta: factura.modo_venta, condicion_pago: 'contado',
      moneda_id: factura.moneda_id, tasa_cambio: factura.tasa_cambio, documento_referencia_id: facturaOrigenId, fecha: store.ahora(),
      subtotal, descuento_total: 0, itbis_total: itbisTotal, total, estado: 'facturado', concepto: motivo.trim(), usuario_id: usuarioId,
    });
    for (const l of lineasCalculadas) {
      db.documentosVentaDetalle.push({
        id: store.uuid(), documento_id: documentoId, producto_id: l.detalleOriginal.producto_id, cantidad: l.cantidad,
        precio_unitario: l.detalleOriginal.precio_unitario, tasa_itbis: l.detalleOriginal.tasa_itbis, base_imponible: l.baseImponible,
        itbis_monto: l.itbisMonto, total_linea: l.totalLinea, costo_unitario: l.costoUnitario, cantidad_devuelta: 0,
      });
      const producto = db.productos.find((p) => p.id === l.detalleOriginal.producto_id);
      inv.moverInventarioPorVenta(db, { producto, almacenId: factura.almacen_id, cantidad: l.cantidad, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId });
      l.detalleOriginal.cantidad_devuelta = store.redondear(l.detalleOriginal.cantidad_devuelta + l.cantidad);
    }
    if (!factura.cliente_id) {
      cajaInterno.registrarMovimiento(db, { turnoCajaId: turno.id, tipo: 'salida_manual', concepto: `Devolución en efectivo - Nota de crédito ${numero}`, monto: -total, documentoOrigenTipo: 'documentos_venta', documentoOrigenId: documentoId, usuarioId });
    }
    if (factura.vendedor_id && factura.total > 0) {
      const comision = db.comisionesVendedor.find((c) => c.documento_venta_id === facturaOrigenId);
      if (comision) comision.monto_comision = Math.max(0, store.redondear(comision.monto_comision - comision.monto_comision * (total / factura.total)));
    }
    store.guardar();
    return documentoId;
  }

  function anularNotaCredito({ documentoId, motivo, usuarioId }) {
    const db = store.cargar();
    const nota = db.documentosVenta.find((d) => d.id === documentoId && d.tipo === 'nota_credito');
    if (!nota) throw new Error('Nota de crédito no encontrada');
    if (nota.estado === 'anulado') throw new Error('La nota de crédito ya está anulada');
    if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
    nota.estado = 'anulado'; nota.motivo_anulacion = motivo; nota.usuario_anulo_id = usuarioId;
    for (const l of db.documentosVentaDetalle.filter((x) => x.documento_id === documentoId)) {
      const producto = db.productos.find((p) => p.id === l.producto_id);
      inv.moverInventarioPorVenta(db, { producto, almacenId: nota.almacen_id, cantidad: -l.cantidad, documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId });
      if (nota.documento_referencia_id) {
        const original = db.documentosVentaDetalle.find((x) => x.documento_id === nota.documento_referencia_id && x.producto_id === l.producto_id);
        if (original) original.cantidad_devuelta = Math.max(0, store.redondear(original.cantidad_devuelta - l.cantidad));
      }
    }
    for (const m of db.movimientosCaja.filter((x) => x.documento_origen_tipo === 'documentos_venta' && x.documento_origen_id === documentoId)) {
      cajaInterno.registrarMovimiento(db, { turnoCajaId: m.turno_caja_id, tipo: 'salida_manual', concepto: `Anulación nota de crédito ${nota.numero}`, monto: -m.monto, documentoOrigenTipo: 'documentos_venta_anulacion', documentoOrigenId: documentoId, usuarioId });
    }
    store.guardar();
  }

  function crearNotaDebito({ clienteId, facturaOrigenId, sucursalId, almacenId, monedaId, concepto, monto, tasaItbisId, usuarioId }) {
    const db = store.cargar();
    if (!clienteId) throw new Error('La nota de débito requiere un cliente');
    if (!concepto || !concepto.trim()) throw new Error('El concepto de la nota de débito es obligatorio');
    if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
    const cliente = db.clientes.find((c) => c.id === clienteId);
    if (!cliente) throw new Error('Cliente no encontrado');
    let facturaOrigen = null;
    if (facturaOrigenId) {
      facturaOrigen = db.documentosVenta.find((d) => d.id === facturaOrigenId && d.tipo === 'factura' && d.cliente_id === clienteId);
      if (!facturaOrigen) throw new Error('Factura de referencia no encontrada para este cliente');
    }
    const tasa = db.tasasItbis.find((t) => t.id === tasaItbisId);
    if (!tasa) throw new Error('Tasa de ITBIS no válida');
    const sucursalFinal = sucursalId || (facturaOrigen ? facturaOrigen.sucursal_id : null);
    const almacenFinal = almacenId || (facturaOrigen ? facturaOrigen.almacen_id : null);
    if (!sucursalFinal || !almacenFinal) throw new Error('Sucursal y almacén son obligatorios');
    const total = store.redondear(monto);
    const baseImponible = store.redondear(total / (1 + tasa.porcentaje));
    const itbisMonto = store.redondear(total - baseImponible);
    const documentoId = store.uuid();
    const numero = store.siguienteNumero('nota_debito');
    db.documentosVenta.push({
      id: documentoId, tipo: 'nota_debito', numero, sucursal_id: sucursalFinal, almacen_id: almacenFinal, cliente_id: clienteId,
      condicion_pago: 'credito', moneda_id: monedaId, tasa_cambio: 1, documento_referencia_id: facturaOrigenId || null, fecha: store.ahora(),
      subtotal: baseImponible, descuento_total: 0, itbis_total: itbisMonto, total, estado: 'facturado', concepto: concepto.trim(), usuario_id: usuarioId,
    });
    store.guardar();
    return documentoId;
  }

  function anularNotaDebito({ documentoId, motivo, usuarioId }) {
    const db = store.cargar();
    const nota = db.documentosVenta.find((d) => d.id === documentoId && d.tipo === 'nota_debito');
    if (!nota) throw new Error('Nota de débito no encontrada');
    if (nota.estado === 'anulado') throw new Error('La nota de débito ya está anulada');
    if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
    nota.estado = 'anulado'; nota.motivo_anulacion = motivo; nota.usuario_anulo_id = usuarioId;
    store.guardar();
  }

  function listarNotas({ tipo, clienteId, limite = 50 } = {}) {
    const db = store.cargar();
    return db.documentosVenta
      .filter((d) => d.tipo === tipo)
      .filter((d) => {
        if (!clienteId) return true;
        if (tipo === 'nota_credito') { const f = db.documentosVenta.find((x) => x.id === d.documento_referencia_id); return f && f.cliente_id === clienteId; }
        return d.cliente_id === clienteId;
      })
      .slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limite)
      .map((d) => {
        const clienteRefId = tipo === 'nota_credito' ? (db.documentosVenta.find((x) => x.id === d.documento_referencia_id) || {}).cliente_id : d.cliente_id;
        const cliente = clienteRefId ? db.clientes.find((c) => c.id === clienteRefId) : null;
        const facturaOrigen = d.documento_referencia_id ? db.documentosVenta.find((x) => x.id === d.documento_referencia_id) : null;
        return { ...d, cliente_nombre: cliente ? cliente.nombre : 'Consumidor final', factura_origen_numero: facturaOrigen ? facturaOrigen.numero : null };
      });
  }

  window.puntoXVentas = {
    crearFactura: async (payload) => { const id = crearFactura(payload); return obtenerFactura(store.cargar(), id); },
    anularFactura: async (payload) => { anularFactura(payload); return obtenerFactura(store.cargar(), payload.documentoId); },
    listarFacturas: async (filtros) => listarFacturas(filtros || {}),
    obtenerFactura: async ({ documentoId }) => obtenerFactura(store.cargar(), documentoId),

    crearNotaCredito: async (payload) => { const id = crearNotaCredito(payload); return obtenerFactura(store.cargar(), id); },
    anularNotaCredito: async (payload) => { anularNotaCredito(payload); return obtenerFactura(store.cargar(), payload.documentoId); },
    crearNotaDebito: async (payload) => { const id = crearNotaDebito(payload); return obtenerFactura(store.cargar(), id); },
    anularNotaDebito: async (payload) => { anularNotaDebito(payload); return obtenerFactura(store.cargar(), payload.documentoId); },
    listarNotas: async (filtros) => listarNotas(filtros || {}),

    listarMonedas: async () => store.cargar().monedas,
    listarVendedores: async () => store.cargar().usuarios.filter((u) => u.activo),

    ventasPorPeriodo: async () => [], ventasPorVendedor: async () => [], ventasPorArticulo: async () => [],
    comisionesPorVendedor: async () => {
      const db = store.cargar();
      const porVendedor = {};
      for (const c of db.comisionesVendedor) {
        porVendedor[c.vendedor_id] = porVendedor[c.vendedor_id] || { vendedor_id: c.vendedor_id, num_ventas: 0, comision_generada: 0, comision_pagada: 0, comision_pendiente: 0 };
        const f = porVendedor[c.vendedor_id];
        f.num_ventas += 1; f.comision_generada += c.monto_comision; f[c.pagada ? 'comision_pagada' : 'comision_pendiente'] += c.monto_comision;
      }
      return Object.values(porVendedor).map((f) => ({ ...f, vendedor_nombre: (db.usuarios.find((u) => u.id === f.vendedor_id) || {}).nombre_completo || '—' }));
    },
    margenPorFactura: async () => [], resumenCobrosDelDia: async () => ({ fecha: '', totalFacturado: 0, totalCobrado: 0, porForma: { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 } }),
    itbisGeneradoVentas: async () => [],
  };
})();
