// Cuentas por Cobrar, versión web. Réplica de main/ipc/cxc.js sobre el store local.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;
  const caja = window.puntoXCaja._interno;
  const conta = window.puntoXContabilidad._interno;
  const CUENTA_POR_FORMA_PAGO = { efectivo: '1100', tarjeta: '1200', transferencia: '1200', cheque: '1200' };

  function saldoPorFactura(db, documentoId) {
    const doc = db.documentosVenta.find((d) => d.id === documentoId);
    if (!doc) return 0;
    const cobrado = db.recibosIngresoAplicaciones
      .filter((a) => a.documento_venta_id === documentoId)
      .filter((a) => { const r = db.recibosIngreso.find((ri) => ri.id === a.recibo_id); return r && r.estado !== 'anulado'; })
      .reduce((acc, a) => acc + a.monto_aplicado, 0);
    const pagadoDirecto = doc.condicion_pago === 'mixto'
      ? db.pagosVenta.filter((p) => p.documento_id === documentoId && p.forma_pago !== 'credito').reduce((acc, p) => acc + p.monto, 0)
      : 0;
    const notaCredito = doc.tipo === 'factura'
      ? db.documentosVenta.filter((n) => n.documento_referencia_id === documentoId && n.tipo === 'nota_credito' && n.estado !== 'anulado').reduce((acc, n) => acc + n.total, 0)
      : 0;
    return store.redondear(doc.total - cobrado - pagadoDirecto - notaCredito);
  }

  function saldoPendienteCliente(db, clienteId) {
    const facturado = db.documentosVenta
      .filter((d) => d.cliente_id === clienteId && d.tipo === 'factura' && ['credito', 'mixto'].includes(d.condicion_pago) && d.estado !== 'anulado')
      .reduce((acc, d) => acc + d.total, 0);
    const cobrado = db.recibosIngresoAplicaciones
      .filter((a) => { const r = db.recibosIngreso.find((ri) => ri.id === a.recibo_id); return r && r.cliente_id === clienteId && r.estado !== 'anulado'; })
      .reduce((acc, a) => acc + a.monto_aplicado, 0);
    const pagadoEnMixta = db.documentosVenta
      .filter((d) => d.cliente_id === clienteId && d.tipo === 'factura' && d.condicion_pago === 'mixto' && d.estado !== 'anulado')
      .reduce((acc, d) => acc + db.pagosVenta.filter((p) => p.documento_id === d.id && p.forma_pago !== 'credito').reduce((a, p) => a + p.monto, 0), 0);
    const notasCredito = db.documentosVenta
      .filter((n) => n.tipo === 'nota_credito' && n.estado !== 'anulado')
      .filter((n) => { const f = db.documentosVenta.find((d) => d.id === n.documento_referencia_id); return f && f.cliente_id === clienteId; })
      .reduce((acc, n) => acc + n.total, 0);
    const notasDebito = db.documentosVenta
      .filter((n) => n.tipo === 'nota_debito' && n.cliente_id === clienteId && n.estado !== 'anulado')
      .reduce((acc, n) => acc + n.total, 0);
    return store.redondear(facturado - cobrado - pagadoEnMixta - notasCredito + notasDebito);
  }

  function facturasAbiertasCliente(db, clienteId) {
    return db.documentosVenta
      .filter((d) => d.cliente_id === clienteId && d.estado !== 'anulado'
        && ((d.tipo === 'factura' && ['credito', 'mixto'].includes(d.condicion_pago)) || d.tipo === 'nota_debito'))
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map((d) => ({ ...d, saldo_pendiente: saldoPorFactura(db, d.id) }))
      .filter((d) => d.saldo_pendiente > 0.01);
  }

  function clienteConSaldo(db, c) {
    return { ...c, saldo_pendiente: saldoPendienteCliente(db, c.id), credito_disponible: store.redondear(c.limite_credito - saldoPendienteCliente(db, c.id)) };
  }

  function diasCreditoDefault(db) { return parseInt(db.parametrosNegocio.dias_credito_default || '30', 10); }
  function diasMoraBloqueo(db) { return parseInt(db.parametrosNegocio.dias_mora_bloqueo_credito || '60', 10); }
  function diasMoraFactura(factura, diasCredito) {
    const venc = new Date(factura.fecha);
    venc.setDate(venc.getDate() + diasCredito);
    return Math.floor((Date.now() - venc.getTime()) / (1000 * 60 * 60 * 24));
  }

  window.puntoXCxc = {
    listarCategorias: async () => store.cargar().categoriasCliente,

    buscarClientes: async ({ texto, limite = 20 } = {}) => {
      const db = store.cargar();
      const t = (texto || '').toLowerCase();
      return db.clientes.filter((c) => c.activo !== false && (c.nombre.toLowerCase().includes(t) || (c.rnc_cedula || '').includes(t))).slice(0, limite);
    },
    obtenerCliente: async ({ clienteId }) => {
      const db = store.cargar();
      const c = db.clientes.find((x) => x.id === clienteId);
      if (!c) return null;
      const cat = db.categoriasCliente.find((cc) => cc.id === c.categoria_id);
      return { ...clienteConSaldo(db, c), categoria_nombre: cat ? cat.nombre : null, nivel_precio: cat ? cat.nivel_precio : null };
    },
    listarClientes: async ({ texto = '' } = {}) => {
      const db = store.cargar();
      const t = texto.toLowerCase();
      return db.clientes.filter((c) => c.nombre.toLowerCase().includes(t)).map((c) => {
        const cat = db.categoriasCliente.find((cc) => cc.id === c.categoria_id);
        return { ...clienteConSaldo(db, c), categoria_nombre: cat ? cat.nombre : null };
      });
    },
    crearCliente: async (payload) => {
      const db = store.cargar();
      if (!payload.nombre || !payload.nombre.trim()) throw new Error('El nombre del cliente es obligatorio');
      const id = store.uuid();
      db.clientes.push({
        id, nombre: payload.nombre.trim(), rnc_cedula: payload.rncCedula || null, categoria_id: payload.categoriaId || null,
        limite_credito: payload.limiteCredito || 0, dias_credito: payload.diasCredito ?? diasCreditoDefault(db),
        tipo_comprobante_default: payload.tipoComprobanteDefault || 'consumo', es_agente_retencion: Boolean(payload.esAgenteRetencion),
        pct_retencion_isr: payload.pctRetencionIsr || 0, pct_retencion_itbis: payload.pctRetencionItbis || 0,
        direccion: payload.direccion || null, telefono: payload.telefono || null, email: payload.email || null,
        bloqueado: false, motivo_bloqueo: null, activo: true,
      });
      store.guardar();
      return window.puntoXCxc.obtenerCliente({ clienteId: id });
    },
    guardarCliente: async ({ clienteId, payload }) => {
      const db = store.cargar();
      const c = db.clientes.find((x) => x.id === clienteId);
      if (!c) throw new Error('Cliente no encontrado');
      Object.assign(c, {
        nombre: payload.nombre.trim(), rnc_cedula: payload.rncCedula || null, categoria_id: payload.categoriaId || null,
        limite_credito: payload.limiteCredito || 0, dias_credito: payload.diasCredito || 0,
        tipo_comprobante_default: payload.tipoComprobanteDefault || 'consumo', es_agente_retencion: Boolean(payload.esAgenteRetencion),
        pct_retencion_isr: payload.pctRetencionIsr || 0, pct_retencion_itbis: payload.pctRetencionItbis || 0,
        direccion: payload.direccion || null, telefono: payload.telefono || null, email: payload.email || null,
        bloqueado: Boolean(payload.bloqueado), motivo_bloqueo: payload.motivoBloqueo || null, activo: payload.activo !== false,
      });
      store.guardar();
      return window.puntoXCxc.obtenerCliente({ clienteId });
    },
    facturasAbiertas: async ({ clienteId }) => facturasAbiertasCliente(store.cargar(), clienteId),
    estadoCuenta: async ({ clienteId }) => {
      const db = store.cargar();
      const facturas = db.documentosVenta.filter((d) => d.cliente_id === clienteId && d.tipo === 'factura' && ['credito', 'mixto'].includes(d.condicion_pago) && d.estado !== 'anulado')
        .map((d) => ({ id: d.id, numero: d.numero, fecha: d.fecha, total: d.total, tipo: 'factura' }));
      const notasCredito = db.documentosVenta.filter((n) => n.tipo === 'nota_credito' && n.estado !== 'anulado')
        .filter((n) => { const f = db.documentosVenta.find((d) => d.id === n.documento_referencia_id); return f && f.cliente_id === clienteId; })
        .map((n) => ({ id: n.id, numero: n.numero, fecha: n.fecha, total: n.total, tipo: 'nota_credito' }));
      const notasDebito = db.documentosVenta.filter((n) => n.tipo === 'nota_debito' && n.cliente_id === clienteId && n.estado !== 'anulado')
        .map((n) => ({ id: n.id, numero: n.numero, fecha: n.fecha, total: n.total, tipo: 'nota_debito' }));
      const recibos = db.recibosIngreso.filter((r) => r.cliente_id === clienteId && r.estado !== 'anulado')
        .map((r) => ({ id: r.id, numero: r.numero, fecha: r.fecha, total: r.monto_total, tipo: 'recibo' }));
      const movimientos = [...facturas, ...notasDebito, ...recibos, ...notasCredito].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      let saldo = 0;
      return movimientos.map((m) => {
        saldo += (m.tipo === 'factura' || m.tipo === 'nota_debito') ? m.total : -m.total;
        return { ...m, saldo_acumulado: store.redondear(saldo) };
      });
    },

    crearRecibo: async ({ clienteId, formaPago, referencia, aplicaciones, cajaId, usuarioId }) => {
      const db = store.cargar();
      if (!aplicaciones || aplicaciones.length === 0) throw new Error('El recibo debe aplicarse a al menos una factura');
      const montoTotal = store.redondear(aplicaciones.reduce((acc, a) => acc + a.montoAplicado, 0));
      if (montoTotal <= 0) throw new Error('El monto del recibo debe ser mayor a cero');
      for (const a of aplicaciones) {
        const saldo = saldoPorFactura(db, a.documentoVentaId);
        if (a.montoAplicado > saldo + 0.01) throw new Error(`El monto aplicado excede el saldo pendiente (${saldo})`);
      }
      let turno = null;
      if (formaPago === 'efectivo') {
        turno = db.turnosCaja.find((t) => t.caja_id === cajaId && t.estado === 'abierto');
        if (!turno) throw new Error('Debe abrir un turno de caja antes de recibir cobros en efectivo');
      }
      const id = store.uuid();
      const numero = store.siguienteNumero('recibos_ingreso');
      const fechaIso = store.ahora();
      db.recibosIngreso.push({ id, numero, cliente_id: clienteId, fecha: fechaIso, forma_pago: formaPago, monto_total: montoTotal, referencia: referencia || null, estado: 'confirmado', usuario_id: usuarioId });
      for (const a of aplicaciones) db.recibosIngresoAplicaciones.push({ id: store.uuid(), recibo_id: id, documento_venta_id: a.documentoVentaId, monto_aplicado: a.montoAplicado });

      if (formaPago === 'efectivo') caja.registrarMovimiento(db, { turnoCajaId: turno.id, tipo: 'cobro_cxc', concepto: `Recibo de ingreso ${numero}`, monto: montoTotal, documentoOrigenTipo: 'recibos_ingreso', documentoOrigenId: id, usuarioId });
      conta.generarAsiento(db, {
        fecha: fechaIso, concepto: `Recibo de ingreso ${numero}`, origenModulo: 'cxc', origenDocumentoTipo: 'recibos_ingreso', origenDocumentoId: id, usuarioId,
        lineas: [{ cuentaCodigo: CUENTA_POR_FORMA_PAGO[formaPago] || '1100', debe: montoTotal, descripcion: 'Cobro recibido' }, { cuentaCodigo: '1400', haber: montoTotal, descripcion: 'Aplicado a cuentas por cobrar' }],
      });
      store.guardar();
      return { id };
    },
    anularRecibo: async ({ reciboId, motivo, usuarioId }) => {
      const db = store.cargar();
      const r = db.recibosIngreso.find((x) => x.id === reciboId);
      if (!r) throw new Error('Recibo no encontrado');
      if (r.estado === 'anulado') throw new Error('El recibo ya está anulado');
      if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
      r.estado = 'anulado'; r.motivo_anulacion = motivo; r.usuario_anulo_id = usuarioId;
      for (const m of db.movimientosCaja.filter((x) => x.documento_origen_tipo === 'recibos_ingreso' && x.documento_origen_id === reciboId)) {
        caja.registrarMovimiento(db, { turnoCajaId: m.turno_caja_id, tipo: 'cobro_cxc', concepto: `Anulación recibo ${r.numero}`, monto: -m.monto, documentoOrigenTipo: 'recibos_ingreso_anulacion', documentoOrigenId: reciboId, usuarioId });
      }
      const cuentasPorId = Object.fromEntries(db.cuentasContables.map((c) => [c.id, c.codigo]));
      for (const asiento of db.asientosContables.filter((a) => a.origen_documento_tipo === 'recibos_ingreso' && a.origen_documento_id === reciboId && a.estado === 'confirmado')) {
        const det = db.asientosContablesDetalle.filter((d) => d.asiento_id === asiento.id);
        conta.generarAsiento(db, {
          fecha: store.ahora(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'cxc', origenDocumentoTipo: 'recibos_ingreso_anulacion', origenDocumentoId: reciboId, usuarioId,
          lineas: det.map((d) => ({ cuentaCodigo: cuentasPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
        });
      }
      store.guardar();
    },
    listarRecibos: async () => {
      const db = store.cargar();
      return db.recibosIngreso.slice().reverse().map((r) => ({ ...r, cliente_nombre: (db.clientes.find((c) => c.id === r.cliente_id) || {}).nombre || '—' }));
    },

    antiguedadSaldos: async () => {
      const db = store.cargar();
      const resultado = [];
      for (const cliente of db.clientes.filter((c) => c.activo !== false)) {
        const facturas = facturasAbiertasCliente(db, cliente.id);
        if (facturas.length === 0) continue;
        const tramos = { corriente: 0, dias_0_30: 0, dias_31_60: 0, dias_61_90: 0, dias_90_mas: 0 };
        for (const f of facturas) {
          const dias = diasMoraFactura(f, cliente.dias_credito);
          const clave = dias <= 0 ? 'corriente' : dias <= 30 ? 'dias_0_30' : dias <= 60 ? 'dias_31_60' : dias <= 90 ? 'dias_61_90' : 'dias_90_mas';
          tramos[clave] += f.saldo_pendiente;
        }
        resultado.push({ clienteId: cliente.id, clienteNombre: cliente.nombre, total: store.redondear(Object.values(tramos).reduce((a, b) => a + b, 0)), tramos });
      }
      return resultado;
    },
    facturasVencidas: async () => {
      const db = store.cargar();
      const resultado = [];
      for (const cliente of db.clientes) {
        for (const f of facturasAbiertasCliente(db, cliente.id)) {
          const dias = diasMoraFactura(f, cliente.dias_credito);
          if (dias > 0) resultado.push({ ...f, cliente_nombre: cliente.nombre, cliente_telefono: cliente.telefono, dias_mora: dias });
        }
      }
      return resultado.sort((a, b) => b.dias_mora - a.dias_mora);
    },
    verificarBloqueoPorMora: (clienteId) => {
      const db = store.cargar();
      const cliente = db.clientes.find((c) => c.id === clienteId);
      if (!cliente) return null;
      const limite = diasMoraBloqueo(db);
      const vencida = facturasAbiertasCliente(db, clienteId).find((f) => diasMoraFactura(f, cliente.dias_credito) > limite);
      return vencida ? `Factura ${vencida.numero} vencida hace más de ${limite} días` : null;
    },

    crearGestionCobro: async ({ clienteId, tipoContacto, notas, resultado, proximaFechaContacto, usuarioId }) => {
      const db = store.cargar();
      const id = store.uuid();
      db.gestionCobros.push({ id, cliente_id: clienteId, fecha_contacto: store.ahora(), tipo_contacto: tipoContacto, notas: notas || null, resultado: resultado || null, proxima_fecha_contacto: proximaFechaContacto || null, usuario_id: usuarioId });
      store.guardar();
      return { id };
    },
    listarGestionCobros: async () => {
      const db = store.cargar();
      return db.gestionCobros.slice().reverse().map((g) => ({ ...g, cliente_nombre: (db.clientes.find((c) => c.id === g.cliente_id) || {}).nombre || '—' }));
    },

    crearCxcEmpleado: async ({ usuarioId, tipo, monto, descuentoSugeridoNomina, notas, usuarioRegistroId }) => {
      const db = store.cargar();
      if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
      const id = store.uuid();
      db.cxcEmpleados.push({ id, usuario_id: usuarioId, tipo, monto, saldo_pendiente: monto, descuento_sugerido_nomina: descuentoSugeridoNomina || 0, fecha: store.ahora(), notas: notas || null, estado: 'pendiente', usuario_registro_id: usuarioRegistroId });
      store.guardar();
      return { id };
    },
    registrarPagoCxcEmpleado: async ({ cxcEmpleadoId, monto }) => {
      const db = store.cargar();
      const c = db.cxcEmpleados.find((x) => x.id === cxcEmpleadoId);
      if (!c) throw new Error('Registro no encontrado');
      if (monto > c.saldo_pendiente + 0.01) throw new Error('El monto excede el saldo pendiente');
      c.saldo_pendiente = store.redondear(c.saldo_pendiente - monto);
      c.estado = c.saldo_pendiente <= 0.01 ? 'pagado' : 'pendiente';
      store.guardar();
    },
    listarCxcEmpleados: async () => {
      const db = store.cargar();
      return db.cxcEmpleados.slice().reverse().map((c) => ({ ...c, empleado_nombre: (db.usuarios.find((u) => u.id === c.usuario_id) || {}).nombre_completo || '—' }));
    },

    _interno: { saldoPendienteCliente, saldoPorFactura, facturasAbiertasCliente },
  };
})();
