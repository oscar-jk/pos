// Sidebar fijo compartido por todas las pantallas. Íconos y estructura calcados del
// mockup de referencia (design-reference/dashboard.real.html).
const MODULOS = [
  {
    clave: 'dashboard', etiqueta: 'Dashboard', ruta: '../dashboard/index.html',
    icono: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  },
  {
    clave: 'ventas', etiqueta: 'Ventas y Facturación', ruta: '../ventas/index.html',
    icono: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.4V3z"/>',
  },
  {
    // Módulo opcional: solo aparece si está activado en Configuración → Módulos.
    clave: 'cuentas_abiertas', etiqueta: 'Cuentas abiertas', ruta: '../ventas/cuentas-abiertas.html', moduloOpcional: 'cuentas_abiertas',
    icono: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  },
  {
    clave: 'inventario', etiqueta: 'Inventario', ruta: '../inventario/index.html',
    icono: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/>',
  },
  {
    clave: 'compras', etiqueta: 'Compras y Proveedores', ruta: '../compras/index.html',
    icono: '<path d="M3 4h2l2.2 11.6a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20 8H6"/><circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="20" r="1.4" fill="currentColor" stroke="none"/>',
  },
  {
    clave: 'cxc', etiqueta: 'Cuentas por Cobrar', ruta: '../cuentas-por-cobrar/index.html',
    icono: '<circle cx="9" cy="7" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="18" cy="16.5" r="3" fill="currentColor" stroke="none" opacity="0.35"/>',
  },
  {
    clave: 'cxp', etiqueta: 'Cuentas por Pagar', ruta: '../cuentas-por-pagar/index.html',
    icono: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 12h6M9 16h4" opacity="0.5"/>',
  },
  {
    clave: 'caja', etiqueta: 'Caja y Tesorería', ruta: '../caja/index.html',
    icono: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14" r="1.3" fill="currentColor" stroke="none"/>',
  },
  {
    clave: 'contabilidad', etiqueta: 'Contabilidad', ruta: '../contabilidad/index.html',
    icono: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 8h6M9 12h6M9 16h4" opacity="0.5"/>',
  },
  {
    clave: 'reportes', etiqueta: 'Reportes', ruta: '../reportes/index.html',
    icono: '<rect x="4" y="13" width="4" height="7" rx="1" opacity="0.4" fill="currentColor" stroke="none"/><rect x="10" y="8" width="4" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="16" y="4" width="4" height="16" rx="1" opacity="0.65" fill="currentColor" stroke="none"/>',
  },
];

const CONFIGURACION = {
  clave: 'configuracion', etiqueta: 'Configuración', ruta: '../configuracion/index.html',
  icono: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5c.1-.5.1-1 0-1.5l1.6-1.3-1.6-2.8-1.9.6a7 7 0 0 0-1.3-.8l-.3-2h-3.2l-.3 2c-.5.2-.9.5-1.3.8l-1.9-.6-1.6 2.8 1.6 1.3c-.1.5-.1 1 0 1.5l-1.6 1.3 1.6 2.8 1.9-.6c.4.3.8.6 1.3.8l.3 2h3.2l.3-2c.5-.2.9-.5 1.3-.8l1.9.6 1.6-2.8z"/>',
};

function navItem({ clave, etiqueta, ruta, icono }, activo) {
  const claseActiva = clave === activo ? ' is-active' : '';
  return `
    <a class="sidebar__nav-item${claseActiva}" href="${ruta}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icono}</svg>
      ${etiqueta}
    </a>
  `;
}

function modulosVisibles(modulosActivos) {
  return MODULOS.filter((m) => !m.moduloOpcional || (modulosActivos && modulosActivos[m.moduloOpcional]));
}

function renderSidebar(moduloActivo, negocio, modulosActivos) {
  const nombre = (negocio && negocio.nombre) || 'Mi Negocio';
  const iniciales = (negocio && negocio.iniciales) || 'MN';

  const items = modulosVisibles(modulosActivos).map((m) => navItem(m, moduloActivo)).join('');

  return `
    <nav class="sidebar">
      <div class="sidebar__brand">
        <div class="sidebar__badge">${iniciales}</div>
        <div>
          <div class="sidebar__brand-name">${nombre}</div>
          <div class="sidebar__brand-subtitle">Punto de venta</div>
        </div>
      </div>

      <div class="sidebar__nav">${items}</div>

      <div class="sidebar__footer">
        ${navItem(CONFIGURACION, moduloActivo)}
        <div class="sidebar__footer-text">
          Punto X · Sistema de Facturación<br />
          Creado por ODTeam X
        </div>
      </div>
    </nav>
  `;
}

window.PuntoXSidebar = { renderSidebar, modulosVisibles, MODULOS, CONFIGURACION };
