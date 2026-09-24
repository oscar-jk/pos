// Cuentas por Pagar, versión web. Réplica de main/ipc/cxp.js.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;
  const caja = window.puntoXCaja._interno;
  const conta = window.puntoXContabilidad._interno;
  const comprasInterno = window.puntoXCompras._interno;

  function saldoPorFacturaCompra(db, documentoId) {
    const doc = db.documentosCompra.find((d) => d.id === documentoId);
    if (!doc) return 0;
    const pagado = db.pagosProveedorAplicaciones
      .filter((a) => a.documento_compra_id === documentoId)
      .filter((a) => { const p = db.pagosProveedor.find((x) => x.id === a.pago_id); return p && p.estado !== 'anulado'; })
      .reduce((acc, a) => acc + a.monto_aplicado, 0);
    return store.redondear(doc.total - pagado);
  }

  function facturasAbiertasProveedor(db, proveedorId) {
    return db.documentosCompra
      .filter((d) => d.proveedor_id === proveedorId && d.tipo === 'factura_compra' && ['credito', 'mixto'].includes(d.condicion_pago) && d.estado !== 'anulado')
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map((f) => ({ ...f, saldo_pendiente: saldoPorFacturaCompra(db, f.id) }))
      .filter((f) => f.saldo_pendiente > 0.01);
  }

  function diasRestantes(fechaVencimiento) {
    return Math.ceil((new Date(fechaVencimiento) - Date.now()) / (1000 * 60 * 60 * 24));
  }
  function tramoPorDiasMora(dias) {
    if (dias <= 0) return 'corriente';
    if (dias <= 30) return 'dias_0_30';
    if (dias <= 60) return 'dias_31_60';
    if (dias <= 90) return 'dias_61_90';
    return 'dias_90_mas';
  }

  window.puntoXCxp = {
    facturasAbiertas: async ({ proveedorId }) => facturasAbiertasProveedor(store.cargar(), proveedorId),

    crearPago: async ({ proveedorId, fecha, formaPago, numeroCheque, bancoCheque, fechaCheque, prioridad, aplicaciones, cajaId, usuarioId }) => {
      const db = store.cargar();
      if (!aplicaciones || aplicaciones.length === 0) throw new Error('El pago debe aplicarse a al menos una factura');
      const montoTotal = store.redondear(aplicaciones.reduce((acc, a) => acc + a.montoAplicado, 0));
      if (montoTotal <= 0) throw new Error('El monto del pago debe ser mayor a cero');
      for (const a of aplicaciones) {
        const saldo = saldoPorFacturaCompra(db, a.documentoCompraId);
        if (a.montoAplicado > saldo + 0.01) throw new Error(`El monto aplicado excede el saldo pendiente (${saldo})`);
      }
      let turno = null;
      if (formaPago === 'efectivo') {
        turno = db.turnosCaja.find((t) => t.caja_id === cajaId && t.estado === 'abierto');
        if (!turno) throw new Error('Debe abrir un turno de caja antes de pagar a un proveedor en efectivo');
      }
      if (formaPago === 'cheque' && !numeroCheque) throw new Error('El número de cheque es obligatorio');

      const pagoId = store.uuid();
      const numero = store.siguienteNumero('pagos_proveedor');
      const fechaIso = fecha || store.ahora();
      db.pagosProveedor.push({ id: pagoId, numero, proveedor_id: proveedorId, fecha: fechaIso, forma_pago: formaPago, monto_total: montoTotal, numero_cheque: numeroCheque || null, banco_cheque: bancoCheque || null, fecha_cheque: fechaCheque || null, estado_cheque: formaPago === 'cheque' ? 'pendiente' : null, prioridad: prioridad || 'normal', usuario_id: usuarioId, estado: 'confirmado' });
      for (const a of aplicaciones) db.pagosProveedorAplicaciones.push({ id: store.uuid(), pago_id: pagoId, documento_compra_id: a.documentoCompraId, monto_aplicado: a.montoAplicado });

      if (formaPago === 'efectivo') caja.registrarMovimiento(db, { turnoCajaId: turno.id, tipo: 'salida_manual', concepto: `Pago a proveedor ${numero}`, monto: -montoTotal, documentoOrigenTipo: 'pagos_proveedor', documentoOrigenId: pagoId, usuarioId });

      const CUENTA_POR_FORMA_PAGO = { efectivo: '1100', transferencia: '1200', cheque: '1200' };
      conta.generarAsiento(db, {
        fecha: fechaIso, concepto: `Pago a proveedor ${numero}`, origenModulo: 'cxp', origenDocumentoTipo: 'pagos_proveedor', origenDocumentoId: pagoId, usuarioId,
        lineas: [{ cuentaCodigo: '2100', debe: montoTotal, descripcion: 'Aplicado a cuentas por pagar' }, { cuentaCodigo: CUENTA_POR_FORMA_PAGO[formaPago] || '1100', haber: montoTotal, descripcion: 'Salida de pago' }],
      });
      store.guardar();
      return { id: pagoId };
    },
    anularPago: async ({ pagoId, motivo, usuarioId }) => {
      const db = store.cargar();
      const pago = db.pagosProveedor.find((p) => p.id === pagoId);
      if (!pago) throw new Error('Pago no encontrado');
      if (pago.estado === 'anulado') throw new Error('El pago ya está anulado');
      if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
      pago.estado = 'anulado'; pago.motivo_anulacion = motivo; pago.usuario_anulo_id = usuarioId;

      for (const m of db.movimientosCaja.filter((x) => x.documento_origen_tipo === 'pagos_proveedor' && x.documento_origen_id === pagoId)) {
        caja.registrarMovimiento(db, { turnoCajaId: m.turno_caja_id, tipo: 'salida_manual', concepto: `Anulación pago ${pago.numero}`, monto: -m.monto, documentoOrigenTipo: 'pagos_proveedor_anulacion', documentoOrigenId: pagoId, usuarioId });
      }
      const cuentasPorId = Object.fromEntries(db.cuentasContables.map((c) => [c.id, c.codigo]));
      for (const asiento of db.asientosContables.filter((a) => a.origen_documento_tipo === 'pagos_proveedor' && a.origen_documento_id === pagoId && a.estado === 'confirmado')) {
        const det = db.asientosContablesDetalle.filter((d) => d.asiento_id === asiento.id);
        conta.generarAsiento(db, { fecha: store.ahora(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'cxp', origenDocumentoTipo: 'pagos_proveedor_anulacion', origenDocumentoId: pagoId, usuarioId, lineas: det.map((d) => ({ cuentaCodigo: cuentasPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })) });
      }
      store.guardar();
    },
    listarPagos: async ({ proveedorId, limite = 50 } = {}) => {
      const db = store.cargar();
      return db.pagosProveedor.filter((p) => !proveedorId || p.proveedor_id === proveedorId).slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limite)
        .map((p) => ({ ...p, proveedor_nombre: (db.proveedores.find((x) => x.id === p.proveedor_id) || {}).nombre || '—', usuario_nombre: (db.usuarios.find((u) => u.id === p.usuario_id) || {}).nombre_completo || '' }));
    },

    antiguedadSaldos: async () => {
      const db = store.cargar();
      const resultado = [];
      for (const proveedor of db.proveedores.filter((p) => p.activo !== false)) {
        const facturas = facturasAbiertasProveedor(db, proveedor.id);
        if (facturas.length === 0) continue;
        const tramos = { corriente: 0, dias_0_30: 0, dias_31_60: 0, dias_61_90: 0, dias_90_mas: 0 };
        for (const f of facturas) tramos[tramoPorDiasMora(-diasRestantes(f.fecha_vencimiento))] += f.saldo_pendiente;
        resultado.push({ proveedorId: proveedor.id, proveedorNombre: proveedor.nombre, total: store.redondear(Object.values(tramos).reduce((a, b) => a + b, 0)), tramos });
      }
      return resultado;
    },
    facturasProximasAVencer: async () => {
      const db = store.cargar();
      const resultado = [];
      for (const proveedor of db.proveedores) {
        for (const f of facturasAbiertasProveedor(db, proveedor.id)) resultado.push({ ...f, proveedor_nombre: proveedor.nombre, dias_restantes: diasRestantes(f.fecha_vencimiento) });
      }
      return resultado.sort((a, b) => a.dias_restantes - b.dias_restantes);
    },
    chequesPosdatadosPendientes: async () => {
      const db = store.cargar();
      return db.pagosProveedor.filter((p) => p.forma_pago === 'cheque' && p.estado_cheque === 'pendiente' && p.estado !== 'anulado')
        .map((p) => ({ ...p, proveedor_nombre: (db.proveedores.find((x) => x.id === p.proveedor_id) || {}).nombre || '—' }))
        .sort((a, b) => new Date(a.fecha_cheque) - new Date(b.fecha_cheque));
    },
    marcarChequeCobrado: async ({ pagoId }) => {
      const db = store.cargar();
      const p = db.pagosProveedor.find((x) => x.id === pagoId);
      if (p) { p.estado_cheque = 'cobrado'; store.guardar(); }
    },
  };
})();
