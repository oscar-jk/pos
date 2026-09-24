// Configuración, versión web. Datos del negocio, usuarios, parámetros fiscales, sucursales y
// bitácora — todo funcional. La matriz de roles y permisos se muestra de forma informativa
// solamente (un único rol "Administrador/Dueño" con todo marcado): la versión web no aplica
// permisos por rol, así que editarlos aquí no cambiaría el comportamiento de nada.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;

  const ROL_UNICO = { id: 'rol-unico-web', nombre: 'Administrador/Dueño', descripcion: 'En la versión web de prueba todos los usuarios tienen acceso completo.', es_rol_sistema: true, limite_descuento_pct: 100 };
  const PERMISOS_INFORMATIVOS = [
    ['ventas', 'ventas.factura.crear', 'Crear factura de venta'], ['ventas', 'ventas.factura.anular', 'Anular factura de venta'],
    ['inventario', 'inventario.producto.crear', 'Crear/editar productos'], ['inventario', 'inventario.ajuste.crear', 'Registrar ajustes'],
    ['compras', 'compras.orden.crear', 'Crear orden de compra'], ['compras', 'compras.factura.crear', 'Registrar factura de compra'],
    ['cxc', 'cxc.recibo.crear', 'Registrar cobros'], ['cxp', 'cxp.pago.crear', 'Registrar pagos'],
    ['caja', 'caja.apertura', 'Abrir/cerrar turno de caja'], ['contabilidad', 'contabilidad.asiento_manual.crear', 'Registrar asientos manuales'],
    ['configuracion', 'configuracion.gestionar', 'Gestionar configuración del negocio'],
  ].map(([modulo, codigo, descripcion]) => ({ id: codigo, modulo, codigo, descripcion }));

  function bitacora(db, { usuarioId, modulo, entidad, entidadId, accion, detalle }) {
    db.bitacora.push({ id: store.uuid(), usuario_id: usuarioId || null, modulo, entidad, entidad_id: entidadId, accion, detalle: detalle ? JSON.stringify(detalle) : null, created_at: store.ahora() });
  }

  window.puntoXConfig = {
    obtenerDatosNegocio: async () => {
      const db = store.cargar();
      return { negocio_nombre: db.parametrosNegocio.negocio_nombre, negocio_iniciales: db.parametrosNegocio.negocio_iniciales, negocio_color_acento: db.parametrosNegocio.negocio_color_acento || '#146356' };
    },
    actualizarDatosNegocio: async ({ payload, usuarioId }) => {
      const db = store.cargar();
      db.parametrosNegocio.negocio_nombre = payload.nombre;
      db.parametrosNegocio.negocio_iniciales = payload.iniciales;
      db.parametrosNegocio.negocio_color_acento = payload.colorAcento;
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: 'negocio', accion: 'editar' });
      store.guardar();
      return window.puntoXConfig.obtenerDatosNegocio();
    },

    listarParametrosNegocio: async () => {
      const db = store.cargar();
      return Object.entries(db.parametrosNegocio).filter(([k]) => !k.startsWith('negocio_')).map(([clave, valor]) => ({ clave, valor }));
    },
    actualizarParametro: async ({ clave, valor, usuarioId }) => {
      const db = store.cargar();
      db.parametrosNegocio[clave] = String(valor);
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: clave, accion: 'editar' });
      store.guardar();
      return window.puntoXConfig.listarParametrosNegocio();
    },

    listarUsuarios: async () => {
      const db = store.cargar();
      return db.usuarios.map((u) => ({ id: u.id, nombre_completo: u.nombre_completo, usuario: u.usuario, rol_id: ROL_UNICO.id, rol_nombre: u.rol_nombre || ROL_UNICO.nombre, pct_comision: u.pct_comision || 0, activo: u.activo }));
    },
    crearUsuario: async ({ payload, usuarioCreadorId }) => {
      const db = store.cargar();
      if (!payload.nombreCompleto || !payload.usuario || !payload.password) throw new Error('Nombre, usuario y contraseña son obligatorios');
      if (payload.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
      if (db.usuarios.some((u) => u.usuario === payload.usuario)) throw new Error(`Ya existe un usuario con el nombre de acceso "${payload.usuario}"`);
      const id = store.uuid();
      db.usuarios.push({ id, nombre_completo: payload.nombreCompleto, usuario: payload.usuario, password_hash: store.hashSimple(payload.password), rol_nombre: ROL_UNICO.nombre, pct_comision: payload.pctComision || 0, activo: true });
      bitacora(db, { usuarioId: usuarioCreadorId, modulo: 'configuracion', entidad: 'usuarios', entidadId: id, accion: 'crear' });
      store.guardar();
      return window.puntoXConfig.listarUsuarios();
    },
    actualizarUsuario: async ({ usuarioId, payload, usuarioEditorId }) => {
      const db = store.cargar();
      const u = db.usuarios.find((x) => x.id === usuarioId);
      if (!u) throw new Error('Usuario no encontrado');
      u.nombre_completo = payload.nombreCompleto; u.pct_comision = payload.pctComision || 0; u.activo = payload.activo !== false;
      if (payload.password) {
        if (payload.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
        u.password_hash = store.hashSimple(payload.password);
      }
      bitacora(db, { usuarioId: usuarioEditorId, modulo: 'configuracion', entidad: 'usuarios', entidadId: usuarioId, accion: 'editar' });
      store.guardar();
      return window.puntoXConfig.listarUsuarios();
    },

    listarRoles: async () => [{ ...ROL_UNICO, total_usuarios: store.cargar().usuarios.length }],
    listarPermisos: async () => PERMISOS_INFORMATIVOS,
    permisosDeRol: async () => PERMISOS_INFORMATIVOS.map((p) => p.id),
    actualizarPermisosRol: async () => { /* informativo: no aplica en la versión web */ },
    actualizarLimiteDescuentoRol: async () => { /* informativo: no aplica en la versión web */ },

    listarTasasItbis: async () => store.cargar().tasasItbis,
    crearTasaItbis: async ({ payload, usuarioId }) => {
      const db = store.cargar();
      if (!payload.nombre || payload.porcentaje === undefined) throw new Error('Nombre y porcentaje son obligatorios');
      const id = store.uuid();
      if (payload.esDefault) db.tasasItbis.forEach((t) => { t.es_default = false; });
      db.tasasItbis.push({ id, nombre: payload.nombre, porcentaje: payload.porcentaje, es_default: Boolean(payload.esDefault), activo: true });
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'tasas_itbis', entidadId: id, accion: 'crear' });
      store.guardar();
      return id;
    },
    actualizarTasaItbis: async ({ tasaId, payload, usuarioId }) => {
      const db = store.cargar();
      const t = db.tasasItbis.find((x) => x.id === tasaId);
      if (!t) throw new Error('Tasa no encontrada');
      if (payload.esDefault) db.tasasItbis.forEach((x) => { x.es_default = false; });
      Object.assign(t, { nombre: payload.nombre, porcentaje: payload.porcentaje, es_default: Boolean(payload.esDefault), activo: payload.activo !== false });
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'tasas_itbis', entidadId: tasaId, accion: 'editar' });
      store.guardar();
    },

    listarTiposNcf: async () => store.cargar().tiposNcf || [],
    crearTipoNcf: async ({ payload, usuarioId }) => {
      const db = store.cargar();
      db.tiposNcf = db.tiposNcf || [];
      if (!payload.codigo || !payload.nombre || !payload.aplicaCliente) throw new Error('Código, nombre y tipo de cliente son obligatorios');
      const id = store.uuid();
      db.tiposNcf.push({ id, codigo: payload.codigo, nombre: payload.nombre, aplica_cliente: payload.aplicaCliente, secuencia_desde: payload.secuenciaDesde || 1, secuencia_hasta: payload.secuenciaHasta || 500, secuencia_actual: payload.secuenciaDesde || 1, activo: true });
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: id, accion: 'crear' });
      store.guardar();
      return id;
    },
    ampliarRangoNcf: async ({ tipoNcfId, nuevaSecuenciaHasta, usuarioId }) => {
      const db = store.cargar();
      const t = (db.tiposNcf || []).find((x) => x.id === tipoNcfId);
      if (!t) throw new Error('Tipo de NCF no encontrado');
      if (nuevaSecuenciaHasta < t.secuencia_actual) throw new Error('El nuevo rango no puede ser menor a la numeración ya emitida');
      t.secuencia_hasta = nuevaSecuenciaHasta;
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: tipoNcfId, accion: 'editar' });
      store.guardar();
    },
    actualizarEstadoTipoNcf: async ({ tipoNcfId, activo, usuarioId }) => {
      const db = store.cargar();
      const t = (db.tiposNcf || []).find((x) => x.id === tipoNcfId);
      if (t) { t.activo = Boolean(activo); bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: tipoNcfId, accion: 'editar' }); store.guardar(); }
    },

    listarSucursales: async () => store.cargar().sucursales,
    crearSucursal: async ({ payload, usuarioId }) => {
      const db = store.cargar();
      if (!payload.nombre) throw new Error('El nombre de la sucursal es obligatorio');
      const id = store.uuid();
      db.sucursales.push({ id, nombre: payload.nombre, direccion: payload.direccion || null, telefono: payload.telefono || null, es_principal: false, activo: true });
      bitacora(db, { usuarioId, modulo: 'configuracion', entidad: 'sucursales', entidadId: id, accion: 'crear' });
      store.guardar();
      return id;
    },

    listarBitacora: async ({ modulo, limite = 100 } = {}) => {
      const db = store.cargar();
      return db.bitacora.filter((b) => !modulo || b.modulo === modulo).slice().reverse().slice(0, limite)
        .map((b) => ({ ...b, usuario_nombre: (db.usuarios.find((u) => u.id === b.usuario_id) || {}).nombre_completo || '—' }));
    },
  };
})();
