// Sesión y datos generales de la app, versión web. Los permisos del rol de cada usuario deciden
// qué módulos ve; la verificación fuerte de permisos vive en la app de escritorio (proceso
// principal). Esto es una demo de flujo, no un sistema de control de acceso.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return; // ya estamos en Electron: no pisar el bridge real
  const store = window.PuntoXWebStore;

  const SESION_CLAVE = 'punto-x-web-sesion';
  function obtenerSesion() {
    try { return JSON.parse(sessionStorage.getItem(SESION_CLAVE)); } catch (e) { return null; }
  }
  function guardarSesion(usuario) {
    sessionStorage.setItem(SESION_CLAVE, JSON.stringify(usuario ? { id: usuario.id, nombreCompleto: usuario.nombre_completo, rol: usuario.rol_nombre } : null));
  }

  window.puntoXAuth = {
    login: async ({ usuario, password }) => {
      const db = store.cargar();
      const fila = db.usuarios.find((u) => u.usuario === usuario && u.activo);
      if (!fila || fila.password_hash !== store.hashSimple(password)) {
        throw new Error("Error invoking remote method 'auth:login': Error: Usuario o contraseña incorrectos");
      }
      guardarSesion(fila);
      return { ok: true };
    },
    logout: async () => { guardarSesion(null); },
    sesionActual: async () => obtenerSesion(),
  };

  window.puntoX = {
    getAppInfo: async () => {
      const db = store.cargar();
      const sesion = obtenerSesion();
      let usuario = null;
      if (sesion) {
        const fila = db.usuarios.find((u) => u.id === sesion.id);
        if (fila) {
          usuario = {
            id: fila.id, nombreCompleto: fila.nombre_completo, rol: fila.rol_nombre,
            // Los permisos del rol: el menú y las pantallas muestran solo lo que el rol permite.
            // (En la demo la regla vive en la pantalla; en escritorio, además, en el proceso principal.)
            permisos: store.permisosDeUsuario(db, fila),
          };
        }
      }
      return {
        version: 'web-demo', sucursal: db.sucursales[0].nombre, sucursalId: db.idsPrincipales.sucursalId,
        almacenId: db.idsPrincipales.almacenId, cajaId: db.idsPrincipales.cajaId, monedaId: db.idsPrincipales.monedaId,
        negocio: { nombre: db.parametrosNegocio.negocio_nombre, iniciales: db.parametrosNegocio.negocio_iniciales, logo: db.parametrosNegocio.negocio_logo || undefined },
        usuario,
      };
    },
  };
})();
