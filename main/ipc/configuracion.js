const crypto = require('node:crypto');

const { hashPassword } = require('../auth/password');
const session = require('../auth/session');

// Bitácora de auditoría transversal: creación, anulación, cierre y acciones administrativas
// de todos los módulos.
function registrarAuditoria(db, { usuarioId, modulo, entidad, entidadId, accion, detalle }) {
  db.prepare(
    `INSERT INTO bitacora_auditoria (id, usuario_id, modulo, entidad, entidad_id, accion, detalle)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), usuarioId || null, modulo, entidad, entidadId, accion, detalle ? JSON.stringify(detalle) : null);
}

function listarBitacora(db, { modulo, limite = 100 } = {}) {
  session.requerirAlgunPermiso('configuracion.gestionar', 'configuracion.auditoria.ver');
  const condiciones = [];
  const params = [];
  if (modulo) { condiciones.push('b.modulo = ?'); params.push(modulo); }
  params.push(limite);
  return db
    .prepare(
      `SELECT b.*, u.nombre_completo AS usuario_nombre FROM bitacora_auditoria b LEFT JOIN usuarios u ON u.id = b.usuario_id
       ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
       ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(...params);
}

// =========================================================================
// Datos del negocio
// =========================================================================

function obtenerDatosNegocio(db) {
  const filas = db.prepare("SELECT clave, valor FROM parametros_negocio WHERE clave LIKE 'negocio_%'").all();
  const datos = {};
  filas.forEach(({ clave, valor }) => { datos[clave] = valor; });
  return datos;
}

function actualizarDatosNegocio(db, { nombre, iniciales, colorAcento, rnc, direccion, telefono }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  const upsert = db.prepare(
    `INSERT INTO parametros_negocio (clave, valor, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at`
  );
  upsert.run('negocio_nombre', nombre);
  upsert.run('negocio_iniciales', iniciales);
  upsert.run('negocio_color_acento', colorAcento);
  upsert.run('negocio_rnc', rnc || '');
  upsert.run('negocio_direccion', direccion || '');
  upsert.run('negocio_telefono', telefono || '');
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: 'negocio', accion: 'editar', detalle: { nombre, iniciales, colorAcento, rnc, direccion, telefono } });
}

// =========================================================================
// Parámetros de negocio (días de crédito, ventana de vencimiento, mora, etc.)
// =========================================================================

function listarParametrosNegocio(db) {
  return db.prepare("SELECT * FROM parametros_negocio WHERE clave NOT LIKE 'negocio_%' AND clave NOT LIKE 'modulo_%' ORDER BY clave").all();
}

// =========================================================================
// Módulos opcionales: el negocio decide si los usa. Se guardan en parametros_negocio como
// modulo_<clave> = '1' | '0', y cada módulo verifica en el proceso principal que esté activo.
// =========================================================================

const MODULOS_OPCIONALES = [
  {
    clave: 'cuentas_abiertas', nombre: 'Cuentas abiertas',
    descripcion: 'Cuentas tipo bar o mesa: se abren con un nombre o número de mesa, se les van agregando productos y al final se cobran como una factura.',
  },
];

function moduloActivo(db, clave) {
  const fila = db.prepare('SELECT valor FROM parametros_negocio WHERE clave = ?').get(`modulo_${clave}`);
  return Boolean(fila && fila.valor === '1');
}

function exigirModulo(db, clave) {
  if (!moduloActivo(db, clave)) {
    const modulo = MODULOS_OPCIONALES.find((m) => m.clave === clave);
    throw new Error(`El módulo "${modulo ? modulo.nombre : clave}" no está activado. Actívalo en Configuración → Módulos.`);
  }
}

function listarModulos(db) {
  return MODULOS_OPCIONALES.map((m) => ({ ...m, activo: moduloActivo(db, m.clave) }));
}

function modulosActivos(db) {
  return Object.fromEntries(MODULOS_OPCIONALES.map((m) => [m.clave, moduloActivo(db, m.clave)]));
}

function actualizarModulo(db, { clave, activo, usuarioId }) {
  session.requerirPermiso('configuracion.gestionar');
  const modulo = MODULOS_OPCIONALES.find((m) => m.clave === clave);
  if (!modulo) throw new Error('Módulo desconocido');
  db.prepare(
    `INSERT INTO parametros_negocio (clave, valor, descripcion, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at`
  ).run(`modulo_${clave}`, activo ? '1' : '0', `Módulo opcional: ${modulo.nombre}`);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: `modulo_${clave}`, accion: activo ? 'activar_modulo' : 'desactivar_modulo' });
}

const VALORES_PERMITIDOS = { metodo_valoracion: ['promedio_ponderado', 'peps'] };

function actualizarParametroNegocio(db, clave, valor, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  if (VALORES_PERMITIDOS[clave] && !VALORES_PERMITIDOS[clave].includes(String(valor))) {
    throw new Error(`Valor inválido para ${clave}: use ${VALORES_PERMITIDOS[clave].join(' o ')}`);
  }
  db.prepare("UPDATE parametros_negocio SET valor = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE clave = ?").run(String(valor), clave);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: clave, accion: 'editar', detalle: { valor } });
}

// =========================================================================
// Monedas y tasa de cambio del día (Módulo 1: multimoneda). La tasa es RD$ por unidad de la
// moneda; se registra una por día y queda congelada en cada factura que la usa.
// =========================================================================

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tasaDelDia(db, monedaId, fecha = hoyLocal()) {
  const fila = db.prepare('SELECT tasa FROM tasas_cambio WHERE moneda_id = ? AND fecha = ? AND deleted_at IS NULL').get(monedaId, fecha);
  return fila ? fila.tasa : null;
}

function listarMonedas(db) {
  const hoy = hoyLocal();
  return db
    .prepare('SELECT id, codigo, nombre, es_local FROM monedas WHERE activo = 1 AND deleted_at IS NULL ORDER BY es_local DESC, codigo')
    .all()
    .map((m) => ({
      ...m,
      tasa_hoy: m.es_local ? 1 : tasaDelDia(db, m.id, hoy),
      historial: m.es_local ? [] : db
        .prepare(
          `SELECT t.fecha, t.tasa, u.nombre_completo AS usuario_nombre FROM tasas_cambio t LEFT JOIN usuarios u ON u.id = t.usuario_id
           WHERE t.moneda_id = ? AND t.deleted_at IS NULL ORDER BY t.fecha DESC LIMIT 7`
        )
        .all(m.id),
    }));
}

function guardarTasaCambio(db, { monedaId, tasa, usuarioId }) {
  session.requerirPermiso('configuracion.gestionar');
  const moneda = db.prepare('SELECT * FROM monedas WHERE id = ? AND deleted_at IS NULL').get(monedaId);
  if (!moneda) throw new Error('Moneda no encontrada');
  if (moneda.es_local) throw new Error('La moneda local no lleva tasa de cambio');
  const valor = Math.round(Number(tasa) * 10000) / 10000;
  if (!(valor > 0)) throw new Error('La tasa debe ser mayor que cero');
  const hoy = hoyLocal();
  const existente = db.prepare('SELECT id, tasa FROM tasas_cambio WHERE moneda_id = ? AND fecha = ?').get(monedaId, hoy);
  if (existente) {
    db.prepare("UPDATE tasas_cambio SET tasa = ?, usuario_id = ?, deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(valor, usuarioId, existente.id);
  } else {
    db.prepare('INSERT INTO tasas_cambio (id, moneda_id, fecha, tasa, usuario_id) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), monedaId, hoy, valor, usuarioId);
  }
  registrarAuditoria(db, {
    usuarioId, modulo: 'configuracion', entidad: 'tasas_cambio', entidadId: monedaId, accion: existente ? 'editar' : 'crear',
    detalle: { moneda: moneda.codigo, fecha: hoy, tasa: valor, anterior: existente ? existente.tasa : null },
  });
  return valor;
}

// =========================================================================
// Usuarios
// =========================================================================

function listarUsuarios(db) {
  return db
    .prepare(
      `SELECT u.id, u.nombre_completo, u.usuario, u.rol_id, r.nombre AS rol_nombre, u.sucursal_id, u.pct_comision, u.activo
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.deleted_at IS NULL ORDER BY u.nombre_completo`
    )
    .all();
}

function crearUsuario(db, { nombreCompleto, usuario, password, rolId, sucursalId, pctComision }, usuarioCreadorId) {
  session.requerirPermiso('configuracion.gestionar');
  if (!nombreCompleto || !usuario || !password || !rolId) throw new Error('Nombre, usuario, contraseña y rol son obligatorios');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
  const existe = db.prepare('SELECT 1 FROM usuarios WHERE usuario = ? AND deleted_at IS NULL').get(usuario);
  if (existe) throw new Error(`Ya existe un usuario con el nombre de acceso "${usuario}"`);

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO usuarios (id, nombre_completo, usuario, password_hash, rol_id, sucursal_id, pct_comision, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, nombreCompleto, usuario, hashPassword(password), rolId, sucursalId || null, pctComision || 0);
  registrarAuditoria(db, { usuarioId: usuarioCreadorId, modulo: 'configuracion', entidad: 'usuarios', entidadId: id, accion: 'crear', detalle: { usuario, rolId } });
  return id;
}

function actualizarUsuario(db, usuarioId, { nombreCompleto, rolId, sucursalId, pctComision, activo, password }, usuarioEditorId) {
  session.requerirPermiso('configuracion.gestionar');
  db.prepare(
    `UPDATE usuarios SET nombre_completo = ?, rol_id = ?, sucursal_id = ?, pct_comision = ?, activo = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(nombreCompleto, rolId, sucursalId || null, pctComision || 0, activo === false ? 0 : 1, usuarioId);
  if (password) {
    if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
    db.prepare("UPDATE usuarios SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hashPassword(password), usuarioId);
  }
  registrarAuditoria(db, { usuarioId: usuarioEditorId, modulo: 'configuracion', entidad: 'usuarios', entidadId: usuarioId, accion: 'editar', detalle: { rolId, activo } });
}

// =========================================================================
// Roles y matriz de permisos
// =========================================================================

function listarRoles(db) {
  return db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM usuarios u WHERE u.rol_id = r.id AND u.deleted_at IS NULL) AS total_usuarios
       FROM roles r WHERE r.deleted_at IS NULL ORDER BY r.nombre`
    )
    .all();
}

function listarPermisos(db) {
  return db.prepare('SELECT * FROM permisos WHERE deleted_at IS NULL ORDER BY modulo, codigo').all();
}

function permisosDeRol(db, rolId) {
  return db
    .prepare('SELECT permiso_id FROM roles_permisos WHERE rol_id = ? AND deleted_at IS NULL')
    .all(rolId)
    .map((r) => r.permiso_id);
}

// Reemplaza el set completo de permisos de un rol. `roles_permisos` tiene UNIQUE(rol_id,
// permiso_id), así que un permiso que se quita y luego se vuelve a asignar no puede
// re-insertarse (la fila borrada lógicamente sigue ocupando esa combinación) — hay que
// restaurarla en vez de insertar una duplicada, coherente con "nunca borrar físicamente".
function actualizarPermisosRol(db, rolId, permisoIds, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  const nuevoSet = new Set(permisoIds);
  const filasExistentes = db.prepare('SELECT id, permiso_id, deleted_at FROM roles_permisos WHERE rol_id = ?').all(rolId);
  const filaPorPermiso = new Map(filasExistentes.map((f) => [f.permiso_id, f]));

  const restaurarOActivar = db.prepare("UPDATE roles_permisos SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");
  const desactivar = db.prepare("UPDATE roles_permisos SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");
  const insertar = db.prepare('INSERT INTO roles_permisos (id, rol_id, permiso_id) VALUES (?, ?, ?)');

  for (const permisoId of nuevoSet) {
    const fila = filaPorPermiso.get(permisoId);
    if (fila) restaurarOActivar.run(fila.id);
    else insertar.run(crypto.randomUUID(), rolId, permisoId);
  }
  for (const fila of filasExistentes) {
    if (!nuevoSet.has(fila.permiso_id) && !fila.deleted_at) desactivar.run(fila.id);
  }

  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'roles', entidadId: rolId, accion: 'editar_permisos', detalle: { totalPermisos: permisoIds.length } });
}

function actualizarLimiteDescuentoRol(db, rolId, limitePct, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  db.prepare("UPDATE roles SET limite_descuento_pct = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(limitePct, rolId);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'roles', entidadId: rolId, accion: 'editar', detalle: { limiteDescuentoPct: limitePct } });
}

// =========================================================================
// Parámetros fiscales: tasas de ITBIS y tipos de NCF
// =========================================================================

function listarTasasItbis(db) {
  return db.prepare('SELECT * FROM tasas_itbis WHERE deleted_at IS NULL ORDER BY porcentaje DESC').all();
}

function crearTasaItbis(db, { nombre, porcentaje, esDefault }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  if (!nombre || porcentaje === undefined) throw new Error('Nombre y porcentaje son obligatorios');
  const id = crypto.randomUUID();
  if (esDefault) db.prepare('UPDATE tasas_itbis SET es_default = 0').run();
  db.prepare('INSERT INTO tasas_itbis (id, nombre, porcentaje, es_default, activo) VALUES (?, ?, ?, ?, 1)').run(id, nombre, porcentaje, esDefault ? 1 : 0);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tasas_itbis', entidadId: id, accion: 'crear', detalle: { nombre, porcentaje } });
  return id;
}

function actualizarTasaItbis(db, tasaId, { nombre, porcentaje, esDefault, activo }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  if (esDefault) db.prepare('UPDATE tasas_itbis SET es_default = 0').run();
  db.prepare(
    `UPDATE tasas_itbis SET nombre = ?, porcentaje = ?, es_default = ?, activo = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(nombre, porcentaje, esDefault ? 1 : 0, activo === false ? 0 : 1, tasaId);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tasas_itbis', entidadId: tasaId, accion: 'editar', detalle: { nombre, porcentaje } });
}

function listarTiposNcf(db) {
  return db.prepare('SELECT * FROM tipos_ncf WHERE deleted_at IS NULL ORDER BY codigo').all();
}

function crearTipoNcf(db, { codigo, nombre, aplicaCliente, secuenciaDesde, secuenciaHasta }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  if (!codigo || !nombre || !aplicaCliente) throw new Error('Código, nombre y tipo de cliente son obligatorios');
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tipos_ncf (id, codigo, nombre, aplica_cliente, secuencia_desde, secuencia_hasta, secuencia_actual, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, codigo, nombre, aplicaCliente, secuenciaDesde || 1, secuenciaHasta || 500, secuenciaDesde || 1);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: id, accion: 'crear', detalle: { codigo, secuenciaHasta } });
  return id;
}

// Solo permite ampliar el rango (secuencia_hasta) y activar/desactivar — nunca mover la
// secuencia_actual hacia atrás, para no arriesgar reutilizar un NCF ya emitido.
function ampliarRangoNcf(db, tipoNcfId, nuevaSecuenciaHasta, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  const tipo = db.prepare('SELECT * FROM tipos_ncf WHERE id = ?').get(tipoNcfId);
  if (!tipo) throw new Error('Tipo de NCF no encontrado');
  if (nuevaSecuenciaHasta < tipo.secuencia_actual) throw new Error('El nuevo rango no puede ser menor a la numeración ya emitida');
  db.prepare("UPDATE tipos_ncf SET secuencia_hasta = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(nuevaSecuenciaHasta, tipoNcfId);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: tipoNcfId, accion: 'editar', detalle: { nuevaSecuenciaHasta } });
}

function actualizarEstadoTipoNcf(db, tipoNcfId, activo, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  db.prepare("UPDATE tipos_ncf SET activo = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(activo ? 1 : 0, tipoNcfId);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: tipoNcfId, accion: 'editar', detalle: { activo } });
}

// =========================================================================
// Sucursales
// =========================================================================

function listarSucursales(db) {
  return db.prepare('SELECT * FROM sucursales WHERE deleted_at IS NULL ORDER BY nombre').all();
}

function crearSucursal(db, { nombre, direccion, telefono }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  if (!nombre) throw new Error('El nombre de la sucursal es obligatorio');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO sucursales (id, nombre, direccion, telefono, activo) VALUES (?, ?, ?, ?, 1)').run(id, nombre, direccion || null, telefono || null);
  registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'sucursales', entidadId: id, accion: 'crear', detalle: { nombre } });
  return id;
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('config:datosNegocio', () => obtenerDatosNegocio(getDb()));
  ipcMain.handle('config:actualizarDatosNegocio', (event, { payload, usuarioId }) => {
    const db = getDb();
    db.transaction(() => actualizarDatosNegocio(db, payload, usuarioId))();
    return obtenerDatosNegocio(db);
  });

  ipcMain.handle('config:parametrosNegocio', () => listarParametrosNegocio(getDb()));
  ipcMain.handle('config:actualizarParametro', (event, { clave, valor, usuarioId }) => {
    const db = getDb();
    db.transaction(() => actualizarParametroNegocio(db, clave, valor, usuarioId))();
    return listarParametrosNegocio(db);
  });

  ipcMain.handle('config:listarUsuarios', () => listarUsuarios(getDb()));
  ipcMain.handle('config:crearUsuario', (event, { payload, usuarioCreadorId }) => {
    const db = getDb();
    db.transaction(() => crearUsuario(db, payload, usuarioCreadorId))();
    return listarUsuarios(db);
  });
  ipcMain.handle('config:actualizarUsuario', (event, { usuarioId, payload, usuarioEditorId }) => {
    const db = getDb();
    db.transaction(() => actualizarUsuario(db, usuarioId, payload, usuarioEditorId))();
    return listarUsuarios(db);
  });

  ipcMain.handle('config:listarRoles', () => listarRoles(getDb()));
  ipcMain.handle('config:listarPermisos', () => listarPermisos(getDb()));
  ipcMain.handle('config:permisosDeRol', (event, { rolId }) => permisosDeRol(getDb(), rolId));
  ipcMain.handle('config:actualizarPermisosRol', (event, { rolId, permisoIds, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => actualizarPermisosRol(db, rolId, permisoIds, usuarioId))();
  });
  ipcMain.handle('config:actualizarLimiteDescuentoRol', (event, { rolId, limitePct, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => actualizarLimiteDescuentoRol(db, rolId, limitePct, usuarioId))();
  });

  ipcMain.handle('config:listarTasasItbis', () => listarTasasItbis(getDb()));
  ipcMain.handle('config:crearTasaItbis', (event, { payload, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => crearTasaItbis(db, payload, usuarioId))();
  });
  ipcMain.handle('config:actualizarTasaItbis', (event, { tasaId, payload, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => actualizarTasaItbis(db, tasaId, payload, usuarioId))();
  });

  ipcMain.handle('config:listarTiposNcf', () => listarTiposNcf(getDb()));
  ipcMain.handle('config:crearTipoNcf', (event, { payload, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => crearTipoNcf(db, payload, usuarioId))();
  });
  ipcMain.handle('config:ampliarRangoNcf', (event, { tipoNcfId, nuevaSecuenciaHasta, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => ampliarRangoNcf(db, tipoNcfId, nuevaSecuenciaHasta, usuarioId))();
  });
  ipcMain.handle('config:actualizarEstadoTipoNcf', (event, { tipoNcfId, activo, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => actualizarEstadoTipoNcf(db, tipoNcfId, activo, usuarioId))();
  });

  ipcMain.handle('config:listarSucursales', () => listarSucursales(getDb()));
  ipcMain.handle('config:crearSucursal', (event, { payload, usuarioId }) => {
    const db = getDb();
    return db.transaction(() => crearSucursal(db, payload, usuarioId))();
  });

  ipcMain.handle('config:listarBitacora', (event, filtros) => listarBitacora(getDb(), filtros || {}));

  ipcMain.handle('config:listarModulos', () => listarModulos(getDb()));
  ipcMain.handle('config:listarMonedas', () => listarMonedas(getDb()));
  ipcMain.handle('config:guardarTasaCambio', (event, payload) => { const db = getDb(); return db.transaction(() => guardarTasaCambio(db, payload))(); });
  ipcMain.handle('config:actualizarModulo', (event, payload) => {
    const db = getDb();
    db.transaction(() => actualizarModulo(db, payload))();
    return listarModulos(db);
  });
}

module.exports = {
  register, registrarAuditoria, listarBitacora, obtenerDatosNegocio, actualizarDatosNegocio,
  listarParametrosNegocio, actualizarParametroNegocio, listarUsuarios, crearUsuario, actualizarUsuario,
  listarRoles, listarPermisos, permisosDeRol, actualizarPermisosRol, actualizarLimiteDescuentoRol,
  listarTasasItbis, crearTasaItbis, actualizarTasaItbis, listarTiposNcf, crearTipoNcf, ampliarRangoNcf,
  actualizarEstadoTipoNcf, listarSucursales, crearSucursal,
  listarModulos, modulosActivos, moduloActivo, exigirModulo, actualizarModulo,
  listarMonedas, tasaDelDia, guardarTasaCambio,
};
