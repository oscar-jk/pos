const { verifyPassword } = require('../auth/password');
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
  };
}

function login(db, { usuario, password }) {
  if (!usuario || !password) throw new Error('Usuario y contraseña son obligatorios');
  const fila = db
    .prepare(
      `SELECT u.*, r.nombre AS rol_nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.usuario = ? AND u.deleted_at IS NULL`
    )
    .get(usuario);

  if (!fila || !verifyPassword(password, fila.password_hash)) {
    throw new Error('Usuario o contraseña incorrectos');
  }
  if (!fila.activo) throw new Error('Este usuario está desactivado. Contacte al administrador.');

  const codigosPermisos = permisosDeRol(db, fila.rol_id);
  session.iniciarSesion({
    usuarioId: fila.id, nombreCompleto: fila.nombre_completo, usuario: fila.usuario,
    rolId: fila.rol_id, rolNombre: fila.rol_nombre, permisos: new Set(codigosPermisos),
  });

  configuracion.registrarAuditoria(db, { usuarioId: fila.id, modulo: 'configuracion', entidad: 'usuarios', entidadId: fila.id, accion: 'iniciar_sesion' });
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
}

module.exports = { register };
