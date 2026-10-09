// Envoltorio de ipcMain: el usuario que firma cada operación sale de la sesión del proceso
// principal, nunca del payload. La ventana puede mandar cualquier usuarioId (DevTools, un
// script inyectado); si se confiara en él, un cajero firmaría como el dueño y heredaría su
// tope de descuento, y la bitácora quedaría a nombre de otro.
const session = require('../auth/session');

const CAMPOS_USUARIO = ['usuarioId', 'usuarioCreadorId'];

function sanear(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const sesion = session.obtenerSesion();
  const limpio = { ...payload };
  for (const campo of CAMPOS_USUARIO) {
    if (campo in limpio || sesion) limpio[campo] = sesion ? sesion.usuarioId : undefined;
  }
  return limpio;
}

function protegerIpc(ipcMain) {
  const envuelto = Object.create(ipcMain);
  envuelto.handle = function handle(canal, fn) {
      // auth:login no lleva usuario de sesión (todavía no hay).
      if (canal.startsWith('auth:')) return ipcMain.handle(canal, fn);
    return ipcMain.handle(canal, (event, payload, ...resto) => {
      // Con la contraseña pendiente de cambio, solo se atienden los canales auth:*.
      const sesion = session.obtenerSesion();
      if (sesion && sesion.debeCambiarPassword) throw new Error('Debe cambiar su contraseña antes de continuar.');
      return fn(event, sanear(payload), ...resto);
    });
  };
  return envuelto;
}

module.exports = { protegerIpc, sanear };
