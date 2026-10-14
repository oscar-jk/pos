// Reportes personalizados y preferencias de reporte por usuario. La definición de un reporte
// personalizado (fuente, columnas, condiciones, agrupación, orden) la arma y la ejecuta la
// ventana sobre las fuentes de datos que ya existen, así que aquí solo se guarda, se lista y se
// controla quién la puede cambiar. Los datos que muestra siguen pasando por los permisos de cada
// canal de origen.
const crypto = require('node:crypto');
const session = require('../auth/session');

let configuracion = null;
function auditoria() {
  if (!configuracion) configuracion = require('./configuracion');
  return configuracion;
}

const MAX_DEFINICION = 20 * 1024;
const MAX_PREFERENCIA = 20 * 1024;

function requerirSesion() {
  const sesion = session.obtenerSesion();
  if (!sesion) throw new Error('Inicia sesión para continuar');
  return sesion;
}

function fila(r) {
  if (!r) return null;
  let definicion = {};
  try { definicion = JSON.parse(r.definicion); } catch (e) { definicion = {}; }
  return { ...r, compartido: Boolean(r.compartido), definicion };
}

// Los propios y los que otros compartieron.
function listarReportesPersonalizados(db) {
  const { usuarioId } = requerirSesion();
  return db.prepare(
    `SELECT r.id, r.nombre, r.descripcion, r.definicion, r.usuario_id, r.compartido, r.created_at, r.updated_at,
            u.nombre_completo AS autor_nombre
     FROM reportes_personalizados r LEFT JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.deleted_at IS NULL AND (r.usuario_id = ? OR r.compartido = 1)
     ORDER BY r.nombre COLLATE NOCASE`
  ).all(usuarioId).map((r) => ({ ...fila(r), propio: r.usuario_id === usuarioId }));
}

function validarDefinicion(definicion) {
  if (!definicion || typeof definicion !== 'object' || Array.isArray(definicion)) throw new Error('La definición del reporte no es válida');
  if (!definicion.fuente || typeof definicion.fuente !== 'string') throw new Error('Elige de dónde salen los datos del reporte');
  if (!Array.isArray(definicion.columnas) || definicion.columnas.length === 0) throw new Error('Elige al menos una columna');
  const texto = JSON.stringify(definicion);
  if (texto.length > MAX_DEFINICION) throw new Error('El reporte tiene demasiadas opciones. Simplifícalo');
  return texto;
}

// Solo el autor lo cambia; un administrador (configuración) también, para poder ordenar los
// reportes compartidos.
function puedeModificar(reporte, usuarioId) {
  return reporte.usuario_id === usuarioId || session.tienePermiso('configuracion.gestionar');
}

function guardarReportePersonalizado(db, { id, nombre, descripcion, definicion, compartido }) {
  const { usuarioId } = requerirSesion();
  const limpio = String(nombre || '').trim();
  if (!limpio) throw new Error('Ponle un nombre al reporte');
  if (limpio.length > 80) throw new Error('El nombre del reporte es muy largo (máximo 80 caracteres)');
  const texto = validarDefinicion(definicion);
  if (id) {
    const actual = db.prepare('SELECT * FROM reportes_personalizados WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!actual) throw new Error('Reporte no encontrado');
    if (!puedeModificar(actual, usuarioId)) throw new Error('Solo quien creó este reporte lo puede cambiar');
    db.prepare(
      `UPDATE reportes_personalizados SET nombre = ?, descripcion = ?, definicion = ?, compartido = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(limpio, descripcion || null, texto, compartido ? 1 : 0, id);
    auditoria().registrarAuditoria(db, { usuarioId, modulo: 'reportes', entidad: 'reportes_personalizados', entidadId: id, accion: 'editar', detalle: { nombre: limpio, fuente: definicion.fuente, compartido: Boolean(compartido) } });
    return id;
  }
  const nuevoId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO reportes_personalizados (id, nombre, descripcion, definicion, usuario_id, compartido) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(nuevoId, limpio, descripcion || null, texto, usuarioId, compartido ? 1 : 0);
  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'reportes', entidad: 'reportes_personalizados', entidadId: nuevoId, accion: 'crear', detalle: { nombre: limpio, fuente: definicion.fuente, compartido: Boolean(compartido) } });
  return nuevoId;
}

// Baja lógica: el reporte deja de verse, la fila queda.
function eliminarReportePersonalizado(db, { id }) {
  const { usuarioId } = requerirSesion();
  const actual = db.prepare('SELECT * FROM reportes_personalizados WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!actual) throw new Error('Reporte no encontrado');
  if (!puedeModificar(actual, usuarioId)) throw new Error('Solo quien creó este reporte lo puede eliminar');
  db.prepare("UPDATE reportes_personalizados SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'reportes', entidad: 'reportes_personalizados', entidadId: id, accion: 'eliminar', detalle: { nombre: actual.nombre } });
}

function validarClave(clave) {
  if (typeof clave !== 'string' || !/^[a-z0-9_.:-]{1,100}$/i.test(clave)) throw new Error('Preferencia no válida');
  return clave;
}

function obtenerPreferencia(db, { clave }) {
  const { usuarioId } = requerirSesion();
  const r = db.prepare('SELECT valor FROM preferencias_usuario WHERE usuario_id = ? AND clave = ? AND deleted_at IS NULL').get(usuarioId, validarClave(clave));
  if (!r) return null;
  try { return JSON.parse(r.valor); } catch (e) { return null; }
}

// valor null borra la preferencia (vuelve a lo predeterminado).
function guardarPreferencia(db, { clave, valor }) {
  const { usuarioId } = requerirSesion();
  validarClave(clave);
  const texto = valor === null || valor === undefined ? null : JSON.stringify(valor);
  if (texto && texto.length > MAX_PREFERENCIA) throw new Error('La preferencia es demasiado grande');
  const actual = db.prepare('SELECT id FROM preferencias_usuario WHERE usuario_id = ? AND clave = ?').get(usuarioId, clave);
  if (actual) {
    db.prepare(
      `UPDATE preferencias_usuario SET valor = ?, deleted_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(texto || 'null', texto ? null : new Date().toISOString(), actual.id);
  } else if (texto) {
    db.prepare('INSERT INTO preferencias_usuario (id, usuario_id, clave, valor) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), usuarioId, clave, texto);
  }
}

function register(ipcMain, getDb) {
  ipcMain.handle('reportes:listarPersonalizados', () => listarReportesPersonalizados(getDb()));
  ipcMain.handle('reportes:guardarPersonalizado', (event, payload) => {
    const db = getDb();
    const id = db.transaction(() => guardarReportePersonalizado(db, payload || {}))();
    return listarReportesPersonalizados(db).find((r) => r.id === id);
  });
  ipcMain.handle('reportes:eliminarPersonalizado', (event, payload) => {
    const db = getDb();
    db.transaction(() => eliminarReportePersonalizado(db, payload || {}))();
    return true;
  });
  ipcMain.handle('reportes:obtenerPreferencia', (event, payload) => obtenerPreferencia(getDb(), payload || {}));
  ipcMain.handle('reportes:guardarPreferencia', (event, payload) => {
    const db = getDb();
    db.transaction(() => guardarPreferencia(db, payload || {}))();
    return true;
  });
}

module.exports = {
  register, listarReportesPersonalizados, guardarReportePersonalizado, eliminarReportePersonalizado, obtenerPreferencia, guardarPreferencia,
};
