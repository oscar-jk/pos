// Compras y Proveedores, versión web. Réplica de main/ipc/compras.js: la "factura de
// compra" fusiona recepción de mercancía + factura (igual que en la app de escritorio),
// puede ir contra una orden de compra con recepción parcial, y genera su asiento contable.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;
  const inv = window.puntoXInventario._interno;
  const caja = window.puntoXCaja._interno;
  const conta = window.puntoXContabilidad._interno;

  function saldoPendienteProveedor(db, proveedorId) {
    const facturado = db.documentosCompra
      .filter((d) => d.proveedor_id === proveedorId && d.tipo === 'factura_compra' && d.condicion_pago === 'credito' && d.estado !== 'anulado')
      .reduce((acc, d) => acc + d.total, 0);
    const pagado = db.pagosProveedorAplicaciones
      .filter((a) => { const doc = db.documentosCompra.find((d) => d.id === a.documento_compra_id); return doc && doc.proveedor_id === proveedorId; })
      .filter((a) => { const p = db.pagosProveedor.find((x) => x.id === a.pago_id); return p && p.estado !== 'anulado'; })
      .reduce((acc, a) => acc + a.monto_aplicado, 0);
    return store.redondear(facturado - pagado);
  }

  function obtenerProveedor(db, proveedorId) {
    const p = db.proveedores.find((x) => x.id === proveedorId);
    return p ? { ...p, saldo_pendiente: saldoPendienteProveedor(db, proveedorId) } : null;
  }

  function siguienteNumeroCompra(db, tipo) {
    const conteo = db.documentosCompra.filter((d) => d.tipo === tipo).length;
    return String(conteo + 1).padStart(6, '0');
  }

  function obtenerOrdenCompra(db, documentoId) {
    const d = db.documentosCompra.find((x) => x.id === documentoId);
    if (!d) return null;
    const proveedor = db.proveedores.find((p) => p.id === d.proveedor_id);
    const lineas = db.documentosCompraDetalle.filter((l) => l.documento_id === documentoId)
      .map((l) => ({ ...l, producto_descripcion: (db.productos.find((p) => p.id === l.producto_id) || {}).descripcion, pendiente: store.redondear(l.cantidad - l.cantidad_recibida) }));
    return { ...d, proveedor_nombre: proveedor ? proveedor.nombre : '—', lineas };
  }

  function actualizarEstadoOrdenCompra(db, ordenId) {
    const lineas = db.documentosCompraDetalle.filter((l) => l.documento_id === ordenId);
    const totalCantidad = lineas.reduce((acc, l) => acc + l.cantidad, 0);
    const totalRecibido = lineas.reduce((acc, l) => acc + l.cantidad_recibida, 0);
    const orden = db.documentosCompra.find((d) => d.id === ordenId);
    orden.estado = totalCantidad > 0 && totalRecibido >= totalCantidad ? 'recibido_total' : (totalRecibido > 0 ? 'recibido_parcial' : 'abierto');
  }

  function obtenerFacturaCompra(db, documentoId) {
    const d = db.documentosCompra.find((x) => x.id === documentoId);
    if (!d) return null;
    const proveedor = db.proveedores.find((p) => p.id === d.proveedor_id);
    const lineas = db.documentosCompraDetalle.filter((l) => l.documento_id === documentoId)
      .map((l) => ({ ...l, producto_descripcion: (db.productos.find((p) => p.id === l.producto_id) || {}).descripcion }));
    return { ...d, proveedor_nombre: proveedor ? proveedor.nombre : '—', lineas };
  }

  window.puntoXCompras = {
    buscarProveedores: async ({ texto, limite = 20 } = {}) => {
      const db = store.cargar();
      const t = (texto || '').toLowerCase();
      return db.proveedores.filter((p) => p.activo !== false && (p.nombre.toLowerCase().includes(t) || (p.rnc || '').includes(t))).slice(0, limite);
    },
    obtenerProveedor: async ({ proveedorId }) => obtenerProveedor(store.cargar(), proveedorId),
    listarProveedores: async ({ texto = '' } = {}) => {
      const db = store.cargar();
      const t = texto.toLowerCase();
      return db.proveedores.filter((p) => p.nombre.toLowerCase().includes(t)).map((p) => obtenerProveedor(db, p.id));
    },
    crearProveedor: async (payload) => {
      const db = store.cargar();
      if (!payload.nombre || !payload.nombre.trim()) throw new Error('El nombre del proveedor es obligatorio');
      const id = store.uuid();
      db.proveedores.push({ id, nombre: payload.nombre.trim(), rnc: payload.rnc || null, dias_credito: payload.diasCredito || 0, direccion: payload.direccion || null, telefono: payload.telefono || null, email: payload.email || null, activo: true });
      store.guardar();
      return obtenerProveedor(db, id);
    },
    guardarProveedor: async ({ proveedorId, payload }) => {
      const db = store.cargar();
      const p = db.proveedores.find((x) => x.id === proveedorId);
      if (!p) throw new Error('Proveedor no encontrado');
      Object.assign(p, { nombre: payload.nombre.trim(), rnc: payload.rnc || null, dias_credito: payload.diasCredito || 0, direccion: payload.direccion || null, telefono: payload.telefono || null, email: payload.email || null, activo: payload.activo !== false });
      store.guardar();
      return obtenerProveedor(db, proveedorId);
    },

    crearOrden: async ({ proveedorId, lineas, usuarioId }) => {
      const db = store.cargar();
      if (!lineas || lineas.length === 0) throw new Error('La orden de compra debe tener al menos una línea');
      const proveedor = db.proveedores.find((p) => p.id === proveedorId);
      if (!proveedor) throw new Error('Proveedor no encontrado');
      const lineasCalc = lineas.map((l) => {
        const producto = db.productos.find((p) => p.id === l.productoId);
        if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
        const tasa = db.tasasItbis.find((t) => t.id === producto.tasa_itbis_id);
        const tasaPct = tasa ? tasa.porcentaje : 0.18;
        const baseImponible = store.redondear(l.costoUnitario * l.cantidad);
        const itbisMonto = store.redondear(baseImponible * tasaPct);
        return { producto, cantidad: l.cantidad, costoUnitario: l.costoUnitario, tasaItbis: tasaPct, baseImponible, itbisMonto, totalLinea: store.redondear(baseImponible + itbisMonto) };
      });
      const subtotal = store.redondear(lineasCalc.reduce((acc, l) => acc + l.baseImponible, 0));
      const itbisTotal = store.redondear(lineasCalc.reduce((acc, l) => acc + l.itbisMonto, 0));
      const total = store.redondear(subtotal + itbisTotal);
      const documentoId = store.uuid();
      db.documentosCompra.push({ id: documentoId, tipo: 'orden_compra', numero: siguienteNumeroCompra(db, 'orden_compra'), proveedor_id: proveedorId, fecha: store.ahora(), condicion_pago: 'credito', subtotal, itbis_total: itbisTotal, total, estado: 'abierto', usuario_id: usuarioId, documento_referencia_id: null, almacen_id: null, ncf_proveedor: null });
      for (const l of lineasCalc) {
        db.documentosCompraDetalle.push({ id: store.uuid(), documento_id: documentoId, producto_id: l.producto.id, cantidad: l.cantidad, cantidad_recibida: 0, costo_unitario: l.costoUnitario, tasa_itbis: l.tasaItbis, itbis_monto: l.itbisMonto, total_linea: l.totalLinea });
      }
      store.guardar();
      return obtenerOrdenCompra(db, documentoId);
    },
    listarOrdenes: async ({ estado, proveedorId, limite = 50 } = {}) => {
      const db = store.cargar();
      return db.documentosCompra.filter((d) => d.tipo === 'orden_compra').filter((d) => !estado || d.estado === estado).filter((d) => !proveedorId || d.proveedor_id === proveedorId)
        .slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limite)
        .map((o) => {
          const lineas = db.documentosCompraDetalle.filter((l) => l.documento_id === o.id);
          const totalCantidad = lineas.reduce((acc, l) => acc + l.cantidad, 0);
          const totalRecibido = lineas.reduce((acc, l) => acc + l.cantidad_recibida, 0);
          const proveedor = db.proveedores.find((p) => p.id === o.proveedor_id);
          return { ...o, proveedor_nombre: proveedor ? proveedor.nombre : '—', porcentaje_recibido: totalCantidad > 0 ? store.redondear((totalRecibido / totalCantidad) * 100) : 0 };
        });
    },
    obtenerOrden: async ({ documentoId }) => obtenerOrdenCompra(store.cargar(), documentoId),
    anularOrden: async ({ documentoId, motivo, usuarioId }) => {
      const db = store.cargar();
      const documento = db.documentosCompra.find((d) => d.id === documentoId);
      if (!documento) throw new Error('Orden de compra no encontrada');
      if (documento.estado === 'anulado') throw new Error('La orden ya está anulada');
      if (documento.estado !== 'abierto') throw new Error('Solo se puede anular una orden que todavía no tiene mercancía recibida');
      if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
      documento.estado = 'anulado'; documento.motivo_anulacion = motivo; documento.usuario_anulo_id = usuarioId;
      store.guardar();
      return obtenerOrdenCompra(db, documentoId);
    },

    crearFacturaCompra: async (payload) => {
      const db = store.cargar();
      const { proveedorId, almacenId, ncfProveedor, condicionPago, diasCredito, lineas, pagos, usuarioId, cajaId, ordenCompraId } = payload;
      if (!lineas || lineas.length === 0) throw new Error('La factura de compra debe tener al menos una línea');
      const proveedor = db.proveedores.find((p) => p.id === proveedorId);
      if (!proveedor) throw new Error('Proveedor no encontrado');

      if (ordenCompraId) {
        const orden = db.documentosCompra.find((d) => d.id === ordenCompraId);
        if (!orden || orden.estado === 'anulado') throw new Error('Orden de compra no encontrada o anulada');
        for (const l of lineas) {
          if (!l.ordenDetalleId) continue;
          const detalleOrden = db.documentosCompraDetalle.find((x) => x.id === l.ordenDetalleId);
          const pendiente = store.redondear(detalleOrden.cantidad - detalleOrden.cantidad_recibida);
          if (l.cantidad > pendiente + 0.001) throw new Error(`La cantidad a recibir (${l.cantidad}) excede lo pendiente de la orden (${pendiente})`);
        }
      }

      const lineasCalculadas = lineas.map((l) => {
        const producto = db.productos.find((p) => p.id === l.productoId);
        if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
        const tasa = db.tasasItbis.find((t) => t.id === producto.tasa_itbis_id);
        const tasaPct = tasa ? tasa.porcentaje : 0.18;
        const baseImponible = store.redondear(l.costoUnitario * l.cantidad);
        const itbisMonto = store.redondear(baseImponible * tasaPct);
        return { producto, cantidad: l.cantidad, costoUnitario: l.costoUnitario, tasaItbis: tasaPct, baseImponible, itbisMonto, totalLinea: store.redondear(baseImponible + itbisMonto), ordenDetalleId: l.ordenDetalleId || null };
      });
      const subtotal = store.redondear(lineasCalculadas.reduce((acc, l) => acc + l.baseImponible, 0));
      const itbisTotal = store.redondear(lineasCalculadas.reduce((acc, l) => acc + l.itbisMonto, 0));
      const total = store.redondear(subtotal + itbisTotal);

      const sumaPagos = store.redondear((pagos || []).reduce((acc, p) => acc + p.monto, 0));
      const montoCredito = store.redondear((pagos || []).filter((p) => p.formaPago === 'credito').reduce((acc, p) => acc + p.monto, 0));
      if (Math.abs(sumaPagos - total) > 0.01) throw new Error(`Los pagos (${sumaPagos}) no cuadran con el total de la factura (${total})`);

      const montoEfectivo = store.redondear((pagos || []).filter((p) => p.formaPago === 'efectivo').reduce((acc, p) => acc + p.monto, 0));
      let turno = null;
      if (montoEfectivo > 0) {
        turno = db.turnosCaja.find((t) => t.caja_id === cajaId && t.estado === 'abierto');
        if (!turno) throw new Error('Debe abrir un turno de caja antes de pagar una compra en efectivo');
      }

      const documentoId = store.uuid();
      const numero = siguienteNumeroCompra(db, 'factura_compra');
      const fechaIso = store.ahora();
      const dias = diasCredito ?? proveedor.dias_credito;
      const fechaVencimiento = new Date();
      fechaVencimiento.setDate(fechaVencimiento.getDate() + (montoCredito > 0 ? dias : 0));

      db.documentosCompra.push({
        id: documentoId, tipo: 'factura_compra', numero, proveedor_id: proveedorId, almacen_id: almacenId, ncf_proveedor: ncfProveedor || null,
        documento_referencia_id: ordenCompraId || null, fecha: fechaIso, condicion_pago: montoCredito > 0 ? (sumaPagos > montoCredito ? 'mixto' : 'credito') : 'contado',
        dias_credito: dias, fecha_vencimiento: fechaVencimiento.toISOString(), subtotal, itbis_total: itbisTotal, total, estado: 'facturado', usuario_id: usuarioId,
      });
      for (const l of lineasCalculadas) {
        db.documentosCompraDetalle.push({ id: store.uuid(), documento_id: documentoId, producto_id: l.producto.id, cantidad: l.cantidad, cantidad_recibida: l.cantidad, costo_unitario: l.costoUnitario, tasa_itbis: l.tasaItbis, itbis_monto: l.itbisMonto, total_linea: l.totalLinea });
        inv.registrarMovimiento(db, { productoId: l.producto.id, almacenId, tipoMovimiento: 'entrada_compra', cantidad: l.cantidad, costoUnitario: l.costoUnitario, documentoOrigenTipo: 'documentos_compra', documentoOrigenId: documentoId, usuarioId });
        if (l.ordenDetalleId) { const dOrden = db.documentosCompraDetalle.find((x) => x.id === l.ordenDetalleId); dOrden.cantidad_recibida = store.redondear(dOrden.cantidad_recibida + l.cantidad); }
      }
      if (ordenCompraId) actualizarEstadoOrdenCompra(db, ordenCompraId);

      const CUENTA_POR_FORMA_PAGO = { efectivo: '1100', tarjeta: '1200', transferencia: '1200', cheque: '1200', credito: '2100' };
      const lineasAsiento = [{ cuentaCodigo: '1300', debe: subtotal, descripcion: 'Entrada de inventario' }];
      if (itbisTotal > 0) lineasAsiento.push({ cuentaCodigo: '1500', debe: itbisTotal, descripcion: 'ITBIS pagado (crédito fiscal)' });
      for (const forma of ['efectivo', 'tarjeta', 'transferencia', 'cheque', 'credito']) {
        const monto = store.redondear((pagos || []).filter((p) => p.formaPago === forma).reduce((acc, p) => acc + p.monto, 0));
        if (monto > 0) lineasAsiento.push({ cuentaCodigo: CUENTA_POR_FORMA_PAGO[forma], haber: monto, descripcion: `Compra ${forma}` });
      }
      conta.generarAsiento(db, { fecha: fechaIso, concepto: `Factura de compra ${numero}`, origenModulo: 'compras', origenDocumentoTipo: 'documentos_compra', origenDocumentoId: documentoId, usuarioId, lineas: lineasAsiento });

      for (const p of (pagos || [])) {
        if (p.formaPago === 'efectivo' && p.monto > 0) caja.registrarMovimiento(db, { turnoCajaId: turno.id, tipo: 'salida_manual', concepto: `Pago compra ${numero}`, monto: -p.monto, documentoOrigenTipo: 'documentos_compra', documentoOrigenId: documentoId, usuarioId });
      }
      store.guardar();
      return obtenerFacturaCompra(db, documentoId);
    },

    anularFacturaCompra: async ({ documentoId, motivo, usuarioId }) => {
      const db = store.cargar();
      const documento = db.documentosCompra.find((d) => d.id === documentoId);
      if (!documento) throw new Error('Factura de compra no encontrada');
      if (documento.estado === 'anulado') throw new Error('La factura ya está anulada');
      if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
      documento.estado = 'anulado'; documento.motivo_anulacion = motivo; documento.usuario_anulo_id = usuarioId;

      const detalle = db.documentosCompraDetalle.filter((l) => l.documento_id === documentoId);
      for (const l of detalle) {
        inv.registrarMovimiento(db, { productoId: l.producto_id, almacenId: documento.almacen_id, tipoMovimiento: 'ajuste_salida', cantidad: -l.cantidad, costoUnitario: l.costo_unitario, documentoOrigenTipo: 'documentos_compra_anulacion', documentoOrigenId: documentoId, usuarioId });
        if (documento.documento_referencia_id) {
          const detalleOrden = db.documentosCompraDetalle.find((x) => x.documento_id === documento.documento_referencia_id && x.producto_id === l.producto_id);
          if (detalleOrden) detalleOrden.cantidad_recibida = Math.max(0, store.redondear(detalleOrden.cantidad_recibida - l.cantidad));
        }
      }
      if (documento.documento_referencia_id) actualizarEstadoOrdenCompra(db, documento.documento_referencia_id);

      const cuentasPorId = Object.fromEntries(db.cuentasContables.map((c) => [c.id, c.codigo]));
      const asientos = db.asientosContables.filter((a) => a.origen_documento_tipo === 'documentos_compra' && a.origen_documento_id === documentoId && a.estado === 'confirmado');
      for (const asiento of asientos) {
        const det = db.asientosContablesDetalle.filter((d) => d.asiento_id === asiento.id);
        conta.generarAsiento(db, {
          fecha: store.ahora(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'compras', origenDocumentoTipo: 'documentos_compra_anulacion', origenDocumentoId: documentoId, usuarioId,
          lineas: det.map((d) => ({ cuentaCodigo: cuentasPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
        });
      }
      store.guardar();
      return obtenerFacturaCompra(db, documentoId);
    },
    listarFacturas: async ({ proveedorId, limite = 50 } = {}) => {
      const db = store.cargar();
      return db.documentosCompra.filter((d) => d.tipo === 'factura_compra').filter((d) => !proveedorId || d.proveedor_id === proveedorId)
        .slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limite)
        .map((d) => ({ ...d, proveedor_nombre: (db.proveedores.find((p) => p.id === d.proveedor_id) || {}).nombre || '—' }));
    },
    obtenerFactura: async ({ documentoId }) => obtenerFacturaCompra(store.cargar(), documentoId),

    comparacionMejorCosto: async ({ productoId }) => {
      const db = store.cargar();
      return db.documentosCompraDetalle
        .filter((l) => l.producto_id === productoId)
        .map((l) => ({ ...l, documento: db.documentosCompra.find((d) => d.id === l.documento_id) }))
        .filter((x) => x.documento && x.documento.tipo === 'factura_compra' && x.documento.estado !== 'anulado')
        .map((x) => ({ fecha: x.documento.fecha, numero: x.documento.numero, proveedor_nombre: (db.proveedores.find((p) => p.id === x.documento.proveedor_id) || {}).nombre, costo_unitario: x.costo_unitario, cantidad: x.cantidad }))
        .sort((a, b) => a.costo_unitario - b.costo_unitario);
    },
    comprasPorProducto: async ({ desde, hasta } = {}) => {
      const db = store.cargar();
      const filas = db.documentosCompraDetalle
        .map((l) => ({ l, documento: db.documentosCompra.find((d) => d.id === l.documento_id) }))
        .filter((x) => x.documento && x.documento.tipo === 'factura_compra' && x.documento.estado !== 'anulado')
        .filter((x) => !desde || x.documento.fecha >= desde).filter((x) => !hasta || x.documento.fecha <= hasta);
      const porProducto = {};
      for (const { l } of filas) {
        const producto = db.productos.find((p) => p.id === l.producto_id);
        if (!producto) continue;
        porProducto[l.producto_id] = porProducto[l.producto_id] || { producto_id: l.producto_id, codigo_interno: producto.codigo_interno, descripcion: producto.descripcion, cantidad_total: 0, costo_total: 0 };
        porProducto[l.producto_id].cantidad_total += l.cantidad;
        porProducto[l.producto_id].costo_total += l.total_linea;
      }
      return Object.values(porProducto).sort((a, b) => b.costo_total - a.costo_total);
    },

    _interno: { saldoPendienteProveedor, obtenerOrdenCompra, actualizarEstadoOrdenCompra },
  };
})();
