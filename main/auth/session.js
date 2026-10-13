// Sesión del usuario actual, en memoria en el proceso principal. No hace falta un token:
// Punto X es una app de escritorio de un solo proceso por instalación, así que la sesión
// vive mientras la app esté abierta y basta con guardarla en una variable de módulo.
let sesionActual = null; // { usuarioId, nombreCompleto, usuario, rolId, rolNombre, permisos: Set<string>, debeCambiarPassword }

function iniciarSesion(datos) {
  sesionActual = datos;
}

function cerrarSesion() {
  sesionActual = null;
}

function obtenerSesion() {
  return sesionActual;
}

function tienePermiso(codigo) {
  return Boolean(sesionActual && !sesionActual.debeCambiarPassword && sesionActual.permisos.has(codigo));
}

// Con la contraseña de fábrica (o una puesta por el administrador) el usuario solo puede
// cambiarla: ninguna otra operación se permite hasta entonces.
function exigirSesionUtil() {
  if (!sesionActual) throw new Error('No hay una sesión activa. Inicie sesión de nuevo.');
  if (sesionActual.debeCambiarPassword) throw new Error('Debe cambiar su contraseña antes de continuar.');
}

// Cambio del rol o de los permisos del rol del usuario conectado (se aplica de inmediato).
function actualizarRol({ rolId, rolNombre, permisos }) {
  if (!sesionActual) return;
  Object.assign(sesionActual, { rolId, rolNombre, permisos });
}

function marcarPasswordCambiada() {
  if (sesionActual) sesionActual.debeCambiarPassword = false;
}

// Lanza un error claro si no hay sesión o si la sesión activa no tiene el permiso pedido.
// Es la barrera real: aunque alguien manipule la pantalla, esto se valida en el proceso
// principal, que es el único que toca la base de datos.
function requerirPermiso(codigo) {
  exigirSesionUtil();
  if (!sesionActual.permisos.has(codigo)) {
    throw new Error(`Su rol (${sesionActual.rolNombre}) no tiene permiso para esta acción.`);
  }
}

// Igual que requerirPermiso, pero basta con tener cualquiera de los códigos dados —
// para acciones que más de un permiso habilita (ej. ver la bitácora la habilita tanto
// 'configuracion.gestionar' como el más acotado 'configuracion.auditoria.ver').
function requerirAlgunPermiso(...codigos) {
  exigirSesionUtil();
  if (!codigos.some((c) => sesionActual.permisos.has(c))) {
    throw new Error(`Su rol (${sesionActual.rolNombre}) no tiene permiso para esta acción.`);
  }
}

function usuarioActualId() {
  exigirSesionUtil();
  return sesionActual.usuarioId;
}

module.exports = {
  iniciarSesion, cerrarSesion, obtenerSesion, tienePermiso, requerirPermiso, requerirAlgunPermiso, usuarioActualId,
  exigirSesionUtil, marcarPasswordCambiada, actualizarRol,
};
