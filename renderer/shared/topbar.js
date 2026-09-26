// Topbar fijo compartido: consulta rápida de precio y existencia, notificaciones y usuario actual.
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
        <input type="text" id="topbar-consulta" placeholder="Consultar precio y existencia de un producto (F2)..." autocomplete="off" />
        <div id="topbar-consulta-resultados" class="topbar__consulta" style="display:none;"></div>
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

// --- Consulta rápida de precio y existencia (mostrador), sin crear ningún documento ---

function escTopbar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTopbar(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// La versión web no tiene la consulta completa: se arma con la búsqueda de productos.
async function consultarPrecios(texto, almacenId) {
  if (window.puntoXInventario.consultarPrecio) return window.puntoXInventario.consultarPrecio({ texto });
  const productos = await window.puntoXInventario.buscarProductos({ texto, almacenId, limite: 8 });
  return productos.map((p) => ({ ...p, existencias: [{ almacen_nombre: 'Disponible', disponible: p.cantidad_disponible, comprometida: 0 }], precio_promocion: null }));
}

function renderConsulta(productos) {
  if (productos.length === 0) return '<div class="topbar__consulta-vacio">Sin resultados</div>';
  return productos.map((p) => `
    <div class="topbar__consulta-item">
      <div class="topbar__consulta-nombre">${escTopbar(p.descripcion)} <span>${escTopbar(p.codigo_interno)}</span></div>
      <div class="topbar__consulta-precios">
        <div><small>Detalle</small>${fmtTopbar(p.precio_detalle)}</div>
        <div><small>Mayorista</small>${fmtTopbar(p.precio_mayorista || p.precio_detalle)}</div>
        <div><small>Distribuidor</small>${fmtTopbar(p.precio_distribuidor || p.precio_detalle)}</div>
        ${p.promocion && p.precio_promocion !== null ? `<div class="topbar__consulta-promo"><small>${escTopbar(p.promocion.nombre || 'Promoción')}</small>${fmtTopbar(p.precio_promocion)}</div>` : ''}
      </div>
      ${p.es_kit ? '<div class="topbar__consulta-existencias">Kit: se arma con la existencia de sus componentes</div>' : `
      <div class="topbar__consulta-existencias">${(p.existencias || []).map((e) => `
        <span><strong style="color:${e.disponible > 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${e.disponible}</strong> ${escTopbar(e.almacen_nombre)}${e.comprometida > 0 ? ` <em>(${e.comprometida} en pedidos)</em>` : ''}</span>`).join('')}</div>`}
    </div>`).join('');
}

function enlazarConsultaPrecio(info) {
  const input = document.getElementById('topbar-consulta');
  const panel = document.getElementById('topbar-consulta-resultados');
  if (!input || !window.puntoXInventario) return;
  let espera = null;
  input.addEventListener('input', () => {
    clearTimeout(espera);
    const texto = input.value.trim();
    if (!texto) { panel.style.display = 'none'; return; }
    espera = setTimeout(async () => {
      try {
        panel.innerHTML = renderConsulta(await consultarPrecios(texto, info.almacenId));
      } catch (err) {
        panel.innerHTML = `<div class="topbar__consulta-vacio">${escTopbar(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''))}</div>`;
      }
      panel.style.display = 'block';
    }, 200);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; panel.style.display = 'none'; input.blur(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.topbar__search')) panel.style.display = 'none'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'F2') { e.preventDefault(); input.focus(); input.select(); } });
}

window.PuntoXTopbar = { renderTopbar, enlazarConsultaPrecio };
