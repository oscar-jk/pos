// Sesión del usuario actual, en memoria en el proceso principal. No hace falta un token:
// Punto X es una app de escritorio de un solo proceso por instalación, así que la sesión
// vive mientras la app esté abierta y basta con guardarla en una variable de módulo.
let sesionActual = null; // { usuarioId, nombreCompleto, usuario, rolId, rolNombre, permisos: Set<string> }

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
  return Boolean(sesionActual && sesionActual.permisos.has(codigo));
}

// Lanza un error claro si no hay sesión o si la sesión activa no tiene el permiso pedido.
// Es la barrera real: aunque alguien manipule la pantalla, esto se valida en el proceso
// principal, que es el único que toca la base de datos.
function requerirPermiso(codigo) {
  if (!sesionActual) throw new Error('No hay una sesión activa. Inicie sesión de nuevo.');
  if (!sesionActual.permisos.has(codigo)) {
    throw new Error(`Su rol (${sesionActual.rolNombre}) no tiene permiso para esta acción.`);
  }
}

// Igual que requerirPermiso, pero basta con tener cualquiera de los códigos dados —
// para acciones que más de un permiso habilita (ej. ver la bitácora la habilita tanto
// 'configuracion.gestionar' como el más acotado 'configuracion.auditoria.ver').
function requerirAlgunPermiso(...codigos) {
  if (!sesionActual) throw new Error('No hay una sesión activa. Inicie sesión de nuevo.');
  if (!codigos.some((c) => sesionActual.permisos.has(c))) {
    throw new Error(`Su rol (${sesionActual.rolNombre}) no tiene permiso para esta acción.`);
  }
}

function usuarioActualId() {
  if (!sesionActual) throw new Error('No hay una sesión activa. Inicie sesión de nuevo.');
  return sesionActual.usuarioId;
}

module.exports = { iniciarSesion, cerrarSesion, obtenerSesion, tienePermiso, requerirPermiso, requerirAlgunPermiso, usuarioActualId };
