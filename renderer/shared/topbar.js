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
          ${window.PuntoXIconos.icono('buscar', 18)}
        </span>
        <input type="text" id="topbar-consulta" placeholder="Consultar precio y existencia de un producto (F2)..." autocomplete="off" />
        <div id="topbar-consulta-resultados" class="topbar__consulta" style="display:none;"></div>
      </div>
      <button class="topbar__bell topbar__tema" id="topbar-tema" type="button" aria-label="Cambiar entre tema claro y oscuro" title="Tema claro/oscuro">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
      </button>
      <button class="topbar__bell" type="button" aria-label="Notificaciones">
        ${window.PuntoXIconos.icono('alerta', 20)}
      </button>
      <div class="topbar__user">
        <div class="topbar__user-avatar">${esc(initials(nombre))}</div>
        <div>
          <div class="topbar__user-name">${esc(nombre)}</div>
          <div class="topbar__user-role">${esc(rol)}</div>
        </div>
        <button id="topbar-btn-salir" type="button" aria-label="Cerrar sesión" title="Cerrar sesión" style="background:none; border:none; cursor:pointer; color:var(--color-text-muted); margin-left:4px; padding:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        </button>
      </div>
    </header>
  `;
}

// --- Consulta rápida de precio y existencia (mostrador), sin crear ningún documento ---

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
      <div class="topbar__consulta-nombre">${esc(p.descripcion)} <span>${esc(p.codigo_interno)}</span></div>
      <div class="topbar__consulta-precios">
        <div><small>Detalle</small>${fmtTopbar(p.precio_detalle)}</div>
        <div><small>Mayorista</small>${fmtTopbar(p.precio_mayorista || p.precio_detalle)}</div>
        <div><small>Distribuidor</small>${fmtTopbar(p.precio_distribuidor || p.precio_detalle)}</div>
        ${p.promocion && p.precio_promocion !== null ? `<div class="topbar__consulta-promo"><small>${esc(p.promocion.nombre || 'Promoción')}</small>${fmtTopbar(p.precio_promocion)}</div>` : ''}
      </div>
      ${p.es_kit ? '<div class="topbar__consulta-existencias">Kit: se arma con la existencia de sus componentes</div>' : `
      <div class="topbar__consulta-existencias">${(p.existencias || []).map((e) => `
        <span><strong style="color:${e.disponible > 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${esc(e.disponible)}</strong> ${esc(e.almacen_nombre)}${e.comprometida > 0 ? ` <em>(${esc(e.comprometida)} en pedidos)</em>` : ''}</span>`).join('')}</div>`}
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
        panel.innerHTML = `<div class="topbar__consulta-vacio">${esc(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''))}</div>`;
      }
      panel.style.display = 'block';
    }, 200);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; panel.style.display = 'none'; input.blur(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.topbar__search')) panel.style.display = 'none'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'F2') { e.preventDefault(); input.focus(); input.select(); } });
}

// Botón de tema: alterna claro/oscuro y recuerda la elección en este equipo.
function enlazarTema() {
  const boton = document.getElementById('topbar-tema');
  if (!boton || !window.PuntoXTema) return;
  boton.addEventListener('click', () => window.PuntoXTema.alternar());
}

window.PuntoXTopbar = { renderTopbar, enlazarConsultaPrecio, enlazarTema };
