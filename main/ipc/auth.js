const { verifyPassword, hashPassword } = require('../auth/password');
const session = require('../auth/session');
const configuracion = require('./configuracion');

function permisosDeRol(db, rolId) {
  return db
    .prepare(
      `SELECT p.codigo FROM roles_permisos rp JOIN permisos p ON p.id = rp.permiso_id
       WHERE rp.rol_id = ? AND rp.deleted_at IS NULL AND p.deleted_at IS NULL`
    )
    .all(rolId)
    .map((r) => r.codigo);
}

function sesionPublica(sesion) {
  if (!sesion) return null;
  return {
    usuarioId: sesion.usuarioId, nombreCompleto: sesion.nombreCompleto, usuario: sesion.usuario,
    rolId: sesion.rolId, rolNombre: sesion.rolNombre, permisos: Array.from(sesion.permisos),
    debeCambiarPassword: Boolean(sesion.debeCambiarPassword),
  };
}

// Bloqueo temporal por intentos fallidos (en memoria: la app es un solo proceso por equipo).
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const intentos = new Map(); // usuario -> { fallos, hasta }

function login(db, { usuario, password }) {
  if (!usuario || !password) throw new Error('Usuario y contraseña son obligatorios');
  const registro = intentos.get(usuario);
  if (registro && registro.hasta > Date.now()) {
    const minutos = Math.ceil((registro.hasta - Date.now()) / 60000);
    throw new Error(`Demasiados intentos fallidos. Intente de nuevo en ${minutos} min.`);
  }
  const fila = db
    .prepare(
      `SELECT u.*, r.nombre AS rol_nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.usuario = ? AND u.deleted_at IS NULL`
    )
    .get(usuario);

  if (!fila || !verifyPassword(password, fila.password_hash)) {
    const r = intentos.get(usuario) || { fallos: 0, hasta: 0 };
    r.fallos += 1;
    if (r.fallos >= MAX_INTENTOS) { r.hasta = Date.now() + BLOQUEO_MS; r.fallos = 0; }
    intentos.set(usuario, r);
    if (fila) {
      configuracion.registrarAuditoria(db, { usuarioId: fila.id, modulo: 'configuracion', entidad: 'usuarios', entidadId: fila.id, accion: 'login_fallido' });
    }
    throw new Error('Usuario o contraseña incorrectos');
  }
  intentos.delete(usuario);
  if (!fila.activo) throw new Error('Este usuario está desactivado. Contacte al administrador.');

  const codigosPermisos = permisosDeRol(db, fila.rol_id);
  session.iniciarSesion({
    usuarioId: fila.id, nombreCompleto: fila.nombre_completo, usuario: fila.usuario,
    rolId: fila.rol_id, rolNombre: fila.rol_nombre, permisos: new Set(codigosPermisos),
    debeCambiarPassword: Boolean(fila.debe_cambiar_password),
  });

  configuracion.registrarAuditoria(db, { usuarioId: fila.id, modulo: 'configuracion', entidad: 'usuarios', entidadId: fila.id, accion: 'iniciar_sesion' });
  return sesionPublica(session.obtenerSesion());
}

const LARGO_MINIMO = 8;

// Cambio de contraseña del usuario de la sesión. Es lo único que se permite mientras la marca
// debe_cambiar_password está activa (contraseña de fábrica o puesta por el administrador).
function cambiarPassword(db, { actual, nueva }) {
  const sesion = session.obtenerSesion();
  if (!sesion) throw new Error('No hay una sesión activa. Inicie sesión de nuevo.');
  const fila = db.prepare('SELECT * FROM usuarios WHERE id = ? AND deleted_at IS NULL').get(sesion.usuarioId);
  if (!fila) throw new Error('Usuario no encontrado');
  if (!actual || !verifyPassword(actual, fila.password_hash)) throw new Error('La contraseña actual no es correcta');
  if (!nueva || nueva.length < LARGO_MINIMO) throw new Error(`La nueva contraseña debe tener al menos ${LARGO_MINIMO} caracteres`);
  if (nueva === actual) throw new Error('La nueva contraseña debe ser distinta de la actual');
  db.prepare("UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(hashPassword(nueva), fila.id);
  session.marcarPasswordCambiada();
  configuracion.registrarAuditoria(db, { usuarioId: fila.id, modulo: 'configuracion', entidad: 'usuarios', entidadId: fila.id, accion: 'cambiar_password' });
  return sesionPublica(session.obtenerSesion());
}

function logout(db) {
  const sesion = session.obtenerSesion();
  if (sesion) {
    configuracion.registrarAuditoria(db, { usuarioId: sesion.usuarioId, modulo: 'configuracion', entidad: 'usuarios', entidadId: sesion.usuarioId, accion: 'cerrar_sesion' });
  }
  session.cerrarSesion();
}

function register(ipcMain, getDb) {
  ipcMain.handle('auth:login', (event, payload) => {
    const db = getDb();
    return db.transaction(() => login(db, payload))();
  });
  ipcMain.handle('auth:logout', () => {
    const db = getDb();
    logout(db);
    return true;
  });
  ipcMain.handle('auth:sesionActual', () => sesionPublica(session.obtenerSesion()));
  ipcMain.handle('auth:cambiarPassword', (event, payload) => {
    const db = getDb();
    return db.transaction(() => cambiarPassword(db, payload || {}))();
  });
}

module.exports = { register, login, cambiarPassword, LARGO_MINIMO };
