// Bootstrap compartido: exige sesión activa (si no hay, redirige al login), monta
// sidebar + topbar, y devuelve la info de la app (negocio, usuario, permisos, sucursal)
// para que cada pantalla la use en su propio contenido.
async function initPuntoXShell(moduloActivo) {
  const info = await window.puntoX.getAppInfo();

  if (!info.usuario) {
    window.location.href = '../login/index.html';
    return null;
  }

  document.getElementById('sidebar-container').innerHTML =
    window.PuntoXSidebar.renderSidebar(moduloActivo, info.negocio);
  document.getElementById('topbar-container').innerHTML =
    window.PuntoXTopbar.renderTopbar(info.usuario);

  const permisos = new Set(info.usuario.permisos || []);
  info.tienePermiso = (codigo) => permisos.has(codigo);
  activarControlDePermisos(info);

  const btnSalir = document.getElementById('topbar-btn-salir');
  if (btnSalir) {
    btnSalir.addEventListener('click', async () => {
      await window.puntoXAuth.logout();
      window.location.href = '../login/index.html';
    });
  }

  return info;
}

// Oculta cualquier elemento con data-permiso="codigo[,codigo2...]" si el usuario no tiene
// ninguno de esos permisos. El backend ya rechaza la acción sin importar la UI (session.
// requerirPermiso en cada handler de main/ipc/*.js es la barrera real); esto es solo para no
// mostrar botones que el usuario no puede usar. Un MutationObserver aplica la regla a
// cualquier HTML insertado después (tablas recargadas, modales, pestañas), sin que cada
// módulo tenga que acordarse de llamarlo.
function activarControlDePermisos(info) {
  function evaluar(el) {
    const codigos = el.dataset.permiso.split(',').map((c) => c.trim()).filter(Boolean);
    const autorizado = codigos.some((c) => info.tienePermiso(c));
    el.style.display = autorizado ? '' : 'none';
  }
  document.querySelectorAll('[data-permiso]').forEach(evaluar);
  const observer = new MutationObserver((mutaciones) => {
    for (const m of mutaciones) {
      for (const nodo of m.addedNodes) {
        if (nodo.nodeType !== 1) continue;
        if (nodo.matches && nodo.matches('[data-permiso]')) evaluar(nodo);
        if (nodo.querySelectorAll) nodo.querySelectorAll('[data-permiso]').forEach(evaluar);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

window.PuntoXShell = { initPuntoXShell };
