// Caja y Tesorería, versión web. Réplica de main/ipc/caja.js sobre el store local.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;
  const conta = window.puntoXContabilidad._interno;

  function efectivoEsperado(db, turno) {
    const total = db.movimientosCaja.filter((m) => m.turno_caja_id === turno.id).reduce((acc, m) => acc + m.monto, 0);
    return store.redondear(turno.fondo_inicial + total);
  }

  function registrarMovimiento(db, { turnoCajaId, tipo, concepto, monto, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
    const id = store.uuid();
    db.movimientosCaja.push({ id, turno_caja_id: turnoCajaId, tipo, concepto, monto, documento_origen_tipo: documentoOrigenTipo || null, documento_origen_id: documentoOrigenId || null, usuario_id: usuarioId, created_at: store.ahora() });
    return id;
  }

  window.puntoXCaja = {
    obtenerCajaPrincipal: async () => store.cargar().cajas[0],
    listarCajas: async () => store.cargar().cajas,
    crearCaja: async ({ nombre }) => {
      const db = store.cargar();
      const id = store.uuid();
      db.cajas.push({ id, nombre, deleted_at: null });
      store.guardar();
      return { id };
    },

    obtenerTurnoAbierto: async ({ cajaId }) => {
      const db = store.cargar();
      return db.turnosCaja.find((t) => t.caja_id === cajaId && t.estado === 'abierto') || null;
    },
    abrirTurno: async ({ cajaId, fondoInicial, usuarioId }) => {
      const db = store.cargar();
      if (db.turnosCaja.some((t) => t.caja_id === cajaId && t.estado === 'abierto')) throw new Error('Ya hay un turno abierto para esta caja');
      const id = store.uuid();
      const turno = { id, caja_id: cajaId, usuario_id: usuarioId, fondo_inicial: fondoInicial || 0, fecha_apertura: store.ahora(), fecha_cierre: null, efectivo_esperado: null, efectivo_contado: null, diferencia: null, estado: 'abierto' };
      db.turnosCaja.push(turno);
      store.guardar();
      return turno;
    },
    cerrarTurno: async ({ turnoId, efectivoContado }) => {
      const db = store.cargar();
      const t = db.turnosCaja.find((x) => x.id === turnoId);
      if (!t) throw new Error('Turno no encontrado');
      if (t.estado === 'cerrado') throw new Error('El turno ya está cerrado');
      const esperado = efectivoEsperado(db, t);
      t.fecha_cierre = store.ahora(); t.efectivo_esperado = esperado; t.efectivo_contado = efectivoContado;
      t.diferencia = store.redondear(efectivoContado - esperado); t.estado = 'cerrado';
      store.guardar();
      return t;
    },
    listarTurnos: async () => {
      const db = store.cargar();
      return db.turnosCaja.slice().reverse().map((t) => ({
        ...t, caja_nombre: (db.cajas.find((c) => c.id === t.caja_id) || {}).nombre || '—',
        usuario_nombre: (db.usuarios.find((u) => u.id === t.usuario_id) || {}).nombre_completo || '',
      }));
    },
    efectivoEsperado: async ({ turnoId }) => {
      const db = store.cargar();
      const t = db.turnosCaja.find((x) => x.id === turnoId);
      return t ? efectivoEsperado(db, t) : 0;
    },
    movimientosDeTurno: async ({ turnoId }) => {
      const db = store.cargar();
      return db.movimientosCaja.filter((m) => m.turno_caja_id === turnoId).slice().reverse()
        .map((m) => ({ ...m, usuario_nombre: (db.usuarios.find((u) => u.id === m.usuario_id) || {}).nombre_completo || '' }));
    },
    registrarMovimientoManual: async ({ turnoCajaId, tipo, concepto, monto, usuarioId }) => {
      const db = store.cargar();
      if (!concepto || !concepto.trim()) throw new Error('El concepto del movimiento es obligatorio');
      if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
      const t = db.turnosCaja.find((x) => x.id === turnoCajaId);
      if (!t || t.estado !== 'abierto') throw new Error('El turno no está abierto');
      const montoFirmado = tipo === 'salida_manual' ? -Math.abs(monto) : Math.abs(monto);
      const id = registrarMovimiento(db, { turnoCajaId, tipo, concepto: concepto.trim(), monto: montoFirmado, usuarioId });
      store.guardar();
      return { id };
    },

    obtenerCajaChica: async ({ cajaId, fondoAsignado }) => {
      const db = store.cargar();
      let cc = db.cajaChica.find((x) => x.caja_id === cajaId);
      if (!cc) { cc = { id: store.uuid(), caja_id: cajaId, nombre: 'Caja chica', fondo_asignado: fondoAsignado || 0, activo: true }; db.cajaChica.push(cc); store.guardar(); }
      return cc;
    },
    crearGastoCajaChica: async ({ cajaChicaId, turnoCajaId, concepto, categoria, monto, comprobanteRuta, usuarioId }) => {
      const db = store.cargar();
      if (!concepto || !concepto.trim()) throw new Error('El concepto del gasto es obligatorio');
      if (!comprobanteRuta || !comprobanteRuta.trim()) throw new Error('El comprobante del gasto es obligatorio');
      if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
      const id = store.uuid();
      const fechaIso = store.ahora();
      db.gastosCajaChica.push({ id, caja_chica_id: cajaChicaId, concepto: concepto.trim(), categoria: categoria || null, monto, comprobante_ruta: comprobanteRuta.trim(), fecha: fechaIso, usuario_id: usuarioId, estado: 'confirmado' });
      if (turnoCajaId) registrarMovimiento(db, { turnoCajaId, tipo: 'gasto_caja_chica', concepto: `Caja chica: ${concepto.trim()}`, monto: -Math.abs(monto), documentoOrigenTipo: 'gastos_caja_chica', documentoOrigenId: id, usuarioId });
      conta.generarAsiento(db, {
        fecha: fechaIso, concepto: `Gasto de caja chica: ${concepto.trim()}`, origenModulo: 'caja', origenDocumentoTipo: 'gastos_caja_chica', origenDocumentoId: id, usuarioId,
        lineas: [{ cuentaCodigo: '6100', debe: monto, descripcion: concepto.trim() }, { cuentaCodigo: '1100', haber: monto, descripcion: 'Salida de caja' }],
      });
      store.guardar();
      return { id };
    },
    listarGastosCajaChica: async ({ cajaChicaId } = {}) => {
      const db = store.cargar();
      return db.gastosCajaChica.filter((g) => !cajaChicaId || g.caja_chica_id === cajaChicaId).slice().reverse()
        .map((g) => ({ ...g, usuario_nombre: (db.usuarios.find((u) => u.id === g.usuario_id) || {}).nombre_completo || '' }));
    },

    listarCuentasBancarias: async () => store.cargar().cuentasBancarias || [],
    crearCuentaBancaria: async ({ nombre, banco, numeroCuenta, monedaId }) => {
      const db = store.cargar();
      db.cuentasBancarias = db.cuentasBancarias || [];
      const cuenta = { id: store.uuid(), nombre, banco, numero_cuenta: numeroCuenta || null, moneda_id: monedaId, activo: true };
      db.cuentasBancarias.push(cuenta);
      store.guardar();
      return cuenta;
    },
    crearTransferenciaBanco: async ({ cajaId, turnoCajaId, cuentaBancariaId, tipo, monto, usuarioId }) => {
      const db = store.cargar();
      if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a cero');
      if (tipo === 'deposito' && turnoCajaId) {
        const t = db.turnosCaja.find((x) => x.id === turnoCajaId);
        if (t && efectivoEsperado(db, t) < monto) throw new Error('El efectivo esperado en caja es menor al monto a depositar');
      }
      const id = store.uuid();
      const fechaIso = store.ahora();
      db.transferenciasBanco = db.transferenciasBanco || [];
      db.transferenciasBanco.push({ id, caja_id: cajaId, cuenta_bancaria_id: cuentaBancariaId, tipo, monto, fecha: fechaIso, usuario_id: usuarioId });
      if (turnoCajaId) registrarMovimiento(db, { turnoCajaId, tipo: 'transferencia_banco', concepto: `${tipo === 'deposito' ? 'Depósito' : 'Retiro'} a banco`, monto: tipo === 'deposito' ? -Math.abs(monto) : Math.abs(monto), documentoOrigenTipo: 'transferencias_banco', documentoOrigenId: id, usuarioId });
      conta.generarAsiento(db, {
        fecha: fechaIso, concepto: `${tipo === 'deposito' ? 'Depósito' : 'Retiro'} a banco`, origenModulo: 'caja', origenDocumentoTipo: 'transferencias_banco', origenDocumentoId: id, usuarioId,
        lineas: tipo === 'deposito'
          ? [{ cuentaCodigo: '1200', debe: monto, descripcion: 'Depósito a banco' }, { cuentaCodigo: '1100', haber: monto, descripcion: 'Salida de caja' }]
          : [{ cuentaCodigo: '1100', debe: monto, descripcion: 'Retiro de banco' }, { cuentaCodigo: '1200', haber: monto, descripcion: 'Salida de banco' }],
      });
      store.guardar();
      return { id };
    },
    listarTransferenciasBanco: async () => {
      const db = store.cargar();
      return (db.transferenciasBanco || []).slice().reverse().map((t) => ({
        ...t, cuenta_nombre: ((db.cuentasBancarias || []).find((c) => c.id === t.cuenta_bancaria_id) || {}).nombre || '—',
        banco: ((db.cuentasBancarias || []).find((c) => c.id === t.cuenta_bancaria_id) || {}).banco || '—',
        usuario_nombre: (db.usuarios.find((u) => u.id === t.usuario_id) || {}).nombre_completo || '',
      }));
    },

    _interno: { efectivoEsperado, registrarMovimiento },
  };
})();
