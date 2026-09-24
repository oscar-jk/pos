// Topbar fijo compartido: búsqueda, notificaciones y usuario actual.
function initials(nombreCompleto) {
  if (!nombreCompleto) return '--';
  const partes = nombreCompleto.trim().split(/\s+/);
  const primeras = partes.slice(0, 2).map((p) => p[0].toUpperCase());
  return primeras.join('') || '--';
}

function renderTopbar(usuario) {
  const nombre = (usuario && usuario.nombreCompleto) || 'Sin sesión';
  const rol = (usuario && usuario.rol) || '';

  return `
    <header class="topbar">
      <div class="topbar__search">
        <span class="topbar__search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A9490" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        </span>
        <input type="text" placeholder="Buscar cliente, producto o factura..." />
      </div>
      <button class="topbar__bell" aria-label="Notificaciones">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 3 1 5 2 6H4c1-1 2-3 2-6z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/></svg>
      </button>
      <div class="topbar__user">
        <div class="topbar__user-avatar">${initials(nombre)}</div>
        <div>
          <div class="topbar__user-name">${nombre}</div>
          <div class="topbar__user-role">${rol}</div>
        </div>
        <button id="topbar-btn-salir" title="Cerrar sesión" style="background:none; border:none; cursor:pointer; color:var(--color-text-faint); margin-left:4px; padding:6px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        </button>
      </div>
    </header>
  `;
}

window.PuntoXTopbar = { renderTopbar };
