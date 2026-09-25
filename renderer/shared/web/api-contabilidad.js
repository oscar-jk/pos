// Contabilidad, versión web. Motor de partida doble simplificado: sin cierre de periodos
// (siempre hay "periodo abierto"), pero con el mismo catálogo de cuentas y la misma
// generación automática de asientos que la app de escritorio, para que Balance General,
// Estado de Resultados y Balance de Comprobación reflejen de verdad lo que pasa en Ventas,
// Compras, CxC, CxP y Caja.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;

  const CUENTAS = [
    ['1000', 'ACTIVO', 'activo', null, 0], ['1100', 'Caja', 'activo', '1000', 1], ['1200', 'Bancos', 'activo', '1000', 1],
    ['1300', 'Inventario', 'activo', '1000', 1], ['1400', 'Clientes (CxC)', 'activo', '1000', 1], ['1500', 'ITBIS Pagado (crédito fiscal)', 'activo', '1000', 1],
    ['2000', 'PASIVO', 'pasivo', null, 0], ['2100', 'Proveedores (CxP)', 'pasivo', '2000', 1], ['2200', 'ITBIS por Pagar', 'pasivo', '2000', 1],
    ['3000', 'PATRIMONIO', 'patrimonio', null, 0], ['3100', 'Capital/Patrimonio', 'patrimonio', '3000', 1],
    ['4000', 'INGRESOS', 'ingreso', null, 0], ['4100', 'Ingresos por Ventas', 'ingreso', '4000', 1],
    ['5000', 'COSTOS', 'costo', null, 0], ['5100', 'Costo de Ventas', 'costo', '5000', 1],
    ['6000', 'GASTOS', 'gasto', null, 0], ['6100', 'Gastos Operativos', 'gasto', '6000', 1],
  ];

  function asegurarCuentas(db) {
    if (db.cuentasContables && db.cuentasContables.length > 0) return;
    db.cuentasContables = CUENTAS.map(([codigo, nombre, tipo, padreCodigo, esMovimiento]) => ({
      id: store.uuid(), codigo, nombre, tipo, cuenta_padre_id: padreCodigo, es_movimiento: Boolean(esMovimiento), activo: true,
    }));
    db.asientosContables = db.asientosContables || [];
    db.asientosContablesDetalle = db.asientosContablesDetalle || [];
    store.guardar();
  }

  function cuentaPorCodigo(db, codigo) {
    const c = db.cuentasContables.find((x) => x.codigo === codigo);
    if (!c) throw new Error(`No existe la cuenta contable ${codigo} en el catálogo`);
    return c;
  }

  // lineas: [{ cuentaCodigo, debe, haber, descripcion }]. Sin exigir periodo abierto — la
  // versión web no maneja cierre de periodos.
  function generarAsiento(db, { fecha, concepto, origenModulo, origenDocumentoTipo, origenDocumentoId, usuarioId, lineas }) {
    asegurarCuentas(db);
    const totalDebe = store.redondear(lineas.reduce((acc, l) => acc + (l.debe || 0), 0));
    const totalHaber = store.redondear(lineas.reduce((acc, l) => acc + (l.haber || 0), 0));
    if (Math.abs(totalDebe - totalHaber) > 0.01) throw new Error(`Asiento contable descuadrado: debe ${totalDebe} vs haber ${totalHaber}`);
    if (totalDebe === 0) throw new Error('El asiento no puede estar vacío');

    const asientoId = store.uuid();
    const numero = `A-${String((db.asientosContables.length || 0) + 1).padStart(6, '0')}`;
    db.asientosContables.push({ id: asientoId, numero, fecha, concepto, origen_modulo: origenModulo, origen_documento_tipo: origenDocumentoTipo || null, origen_documento_id: origenDocumentoId || null, es_manual: false, estado: 'confirmado', usuario_id: usuarioId, motivo_anulacion: null });
    for (const l of lineas) {
      if (!l.debe && !l.haber) continue;
      db.asientosContablesDetalle.push({ id: store.uuid(), asiento_id: asientoId, cuenta_id: cuentaPorCodigo(db, l.cuentaCodigo).id, debe: l.debe || 0, haber: l.haber || 0, descripcion: l.descripcion || null });
    }
    return asientoId;
  }

  function balanceComprobacion(db, { desde, hasta } = {}) {
    asegurarCuentas(db);
    // Un asiento manual anulado cuenta junto con su reversión (se netean), igual que en escritorio.
    const asientos = db.asientosContables.filter((a) => (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta));
    const idsAsiento = new Set(asientos.map((a) => a.id));
    const filas = db.cuentasContables.filter((c) => c.es_movimiento).map((c) => {
      const detalle = db.asientosContablesDetalle.filter((d) => d.cuenta_id === c.id && idsAsiento.has(d.asiento_id));
      const totalDebe = store.redondear(detalle.reduce((acc, d) => acc + d.debe, 0));
      const totalHaber = store.redondear(detalle.reduce((acc, d) => acc + d.haber, 0));
      const naturalezaDeudora = ['activo', 'costo', 'gasto'].includes(c.tipo);
      const saldo = naturalezaDeudora ? totalDebe - totalHaber : totalHaber - totalDebe;
      return { id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, total_debe: totalDebe, total_haber: totalHaber, saldo: store.redondear(saldo) };
    });
    return filas.filter((f) => f.total_debe > 0 || f.total_haber > 0).sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  function estadoResultados(db, { desde, hasta } = {}) {
    const balance = balanceComprobacion(db, { desde, hasta });
    const ingresos = balance.filter((c) => c.tipo === 'ingreso');
    const costos = balance.filter((c) => c.tipo === 'costo');
    const gastos = balance.filter((c) => c.tipo === 'gasto');
    const totalIngresos = store.redondear(ingresos.reduce((acc, c) => acc + c.saldo, 0));
    const totalCostos = store.redondear(costos.reduce((acc, c) => acc + c.saldo, 0));
    const totalGastos = store.redondear(gastos.reduce((acc, c) => acc + c.saldo, 0));
    const utilidadBruta = store.redondear(totalIngresos - totalCostos);
    const utilidadNeta = store.redondear(utilidadBruta - totalGastos);
    return { ingresos, costos, gastos, totalIngresos, totalCostos, totalGastos, utilidadBruta, utilidadNeta };
  }

  function balanceGeneral(db, { hasta } = {}) {
    const balance = balanceComprobacion(db, { hasta });
    const activos = balance.filter((c) => c.tipo === 'activo');
    const pasivos = balance.filter((c) => c.tipo === 'pasivo');
    const patrimonio = balance.filter((c) => c.tipo === 'patrimonio');
    const totalActivo = store.redondear(activos.reduce((acc, c) => acc + c.saldo, 0));
    const totalPasivo = store.redondear(pasivos.reduce((acc, c) => acc + c.saldo, 0));
    const totalPatrimonioRegistrado = store.redondear(patrimonio.reduce((acc, c) => acc + c.saldo, 0));
    const resultados = estadoResultados(db, { hasta });
    const totalPatrimonio = store.redondear(totalPatrimonioRegistrado + resultados.utilidadNeta);
    return { activos, pasivos, patrimonio, totalActivo, totalPasivo, totalPatrimonioRegistrado, utilidadDelPeriodo: resultados.utilidadNeta, totalPatrimonio, cuadra: Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) < 0.01 };
  }

  function libroMayor(db, { cuentaId, desde, hasta }) {
    asegurarCuentas(db);
    const cuenta = db.cuentasContables.find((c) => c.id === cuentaId);
    const asientosValidos = db.asientosContables.filter((a) => (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta));
    const idsPorAsiento = Object.fromEntries(asientosValidos.map((a) => [a.id, a]));
    const movimientos = db.asientosContablesDetalle
      .filter((d) => d.cuenta_id === cuentaId && idsPorAsiento[d.asiento_id])
      .map((d) => ({ ...idsPorAsiento[d.asiento_id], debe: d.debe, haber: d.haber, descripcion: d.descripcion }))
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const naturalezaDeudora = cuenta && ['activo', 'costo', 'gasto'].includes(cuenta.tipo);
    let saldo = 0;
    const conSaldo = movimientos.map((m) => {
      saldo += naturalezaDeudora ? (m.debe - m.haber) : (m.haber - m.debe);
      return { ...m, saldo_acumulado: store.redondear(saldo) };
    });
    return { cuenta, movimientos: conSaldo, saldoFinal: store.redondear(saldo) };
  }

  function listarAsientos(db, { desde, hasta, origenModulo, limite = 100 } = {}) {
    asegurarCuentas(db);
    const cuentasPorId = Object.fromEntries(db.cuentasContables.map((c) => [c.id, c]));
    return db.asientosContables
      .filter((a) => (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta) && (!origenModulo || a.origen_modulo === origenModulo))
      .slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, limite)
      .map((a) => ({
        ...a, usuario_nombre: (db.usuarios.find((u) => u.id === a.usuario_id) || {}).nombre_completo || '',
        lineas: db.asientosContablesDetalle.filter((d) => d.asiento_id === a.id).map((d) => ({ ...d, cuenta_codigo: (cuentasPorId[d.cuenta_id] || {}).codigo, cuenta_nombre: (cuentasPorId[d.cuenta_id] || {}).nombre })),
      }));
  }

  window.puntoXContabilidad = {
    listarCuentas: async () => { const db = store.cargar(); asegurarCuentas(db); return db.cuentasContables; },
    crearCuenta: async ({ codigo, nombre, tipo, cuentaPadreId, esMovimiento }) => {
      const db = store.cargar();
      if (db.cuentasContables.some((c) => c.codigo === codigo)) throw new Error(`Ya existe una cuenta con el código ${codigo}`);
      const c = { id: store.uuid(), codigo, nombre, tipo, cuenta_padre_id: cuentaPadreId || null, es_movimiento: esMovimiento !== false, activo: true };
      db.cuentasContables.push(c);
      store.guardar();
      return c.id;
    },
    actualizarCuenta: async ({ cuentaId, payload }) => {
      const db = store.cargar();
      const c = db.cuentasContables.find((x) => x.id === cuentaId);
      if (!c) throw new Error('Cuenta no encontrada');
      Object.assign(c, { nombre: payload.nombre, cuenta_padre_id: payload.cuentaPadreId || null, es_movimiento: payload.esMovimiento !== false, activo: payload.activo !== false });
      store.guardar();
    },

    listarAsientos: async (filtros) => listarAsientos(store.cargar(), filtros || {}),
    libroMayor: async (filtros) => libroMayor(store.cargar(), filtros),
    balanceComprobacion: async (filtros) => balanceComprobacion(store.cargar(), filtros || {}),
    estadoResultados: async (filtros) => estadoResultados(store.cargar(), filtros || {}),
    balanceGeneral: async (filtros) => balanceGeneral(store.cargar(), filtros || {}),

    crearAsientoManual: async ({ fecha, concepto, lineas, usuarioId }) => {
      const db = store.cargar();
      const id = generarAsiento(db, { fecha: fecha || store.ahora(), concepto, origenModulo: 'contabilidad', origenDocumentoTipo: null, origenDocumentoId: null, usuarioId, lineas });
      const asiento = db.asientosContables.find((a) => a.id === id);
      asiento.es_manual = true;
      store.guardar();
      return id;
    },
    anularAsiento: async ({ asientoId, motivo, usuarioId }) => {
      const db = store.cargar();
      const asiento = db.asientosContables.find((a) => a.id === asientoId);
      if (!asiento) throw new Error('Asiento no encontrado');
      if (!asiento.es_manual) throw new Error('Solo se pueden anular asientos manuales; los automáticos se anulan revirtiendo la operación que los originó');
      if (asiento.estado === 'anulado') throw new Error('El asiento ya está anulado');
      if (!motivo || !motivo.trim()) throw new Error('La anulación requiere un motivo');
      asiento.estado = 'anulado'; asiento.motivo_anulacion = motivo;
      const cuentasPorId = Object.fromEntries(db.cuentasContables.map((c) => [c.id, c.codigo]));
      const detalle = db.asientosContablesDetalle.filter((d) => d.asiento_id === asientoId);
      generarAsiento(db, {
        fecha: store.ahora(), concepto: `Reversión: ${asiento.concepto}`, origenModulo: 'contabilidad',
        origenDocumentoTipo: 'asientos_contables_anulacion', origenDocumentoId: asientoId, usuarioId,
        lineas: detalle.map((d) => ({ cuentaCodigo: cuentasPorId[d.cuenta_id], debe: d.haber, haber: d.debe, descripcion: `Reversión: ${d.descripcion || ''}` })),
      });
      store.guardar();
    },

    listarPeriodos: async () => [],
    cerrarPeriodo: async () => { throw new Error('El cierre de periodos no está disponible en la versión web de prueba'); },
    reabrirPeriodo: async () => { throw new Error('El cierre de periodos no está disponible en la versión web de prueba'); },

    _interno: { generarAsiento, asegurarCuentas },
  };
})();
