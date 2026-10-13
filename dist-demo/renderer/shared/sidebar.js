// Sidebar fijo compartido por todas las pantallas. Íconos del pack de línea de Nodo
// (renderer/shared/iconos.js); `icono` es el nombre del icono.
const MODULOS = [
  {
    clave: 'dashboard', etiqueta: 'Dashboard', ruta: '../dashboard/index.html',
    icono: 'panel',
  },
  {
    clave: 'ventas', etiqueta: 'Ventas y Facturación', ruta: '../ventas/index.html',
    icono: 'caja-registradora',
  },
  {
    // Módulo opcional: solo aparece si está activado en Configuración → Módulos.
    clave: 'cuentas_abiertas', etiqueta: 'Cuentas abiertas', ruta: '../ventas/cuentas-abiertas.html', moduloOpcional: 'cuentas_abiertas',
    icono: 'mesa',
  },
  {
    clave: 'inventario', etiqueta: 'Inventario', ruta: '../inventario/index.html',
    icono: 'inventario',
  },
  {
    clave: 'compras', etiqueta: 'Compras y Proveedores', ruta: '../compras/index.html',
    icono: 'compras',
  },
  {
    clave: 'cxc', etiqueta: 'Cuentas por Cobrar', ruta: '../cuentas-por-cobrar/index.html',
    icono: 'clientes',
  },
  {
    clave: 'cxp', etiqueta: 'Cuentas por Pagar', ruta: '../cuentas-por-pagar/index.html',
    icono: 'proveedor',
  },
  {
    clave: 'caja', etiqueta: 'Caja y Tesorería', ruta: '../caja/index.html',
    icono: 'efectivo',
  },
  {
    clave: 'contabilidad', etiqueta: 'Contabilidad', ruta: '../contabilidad/index.html',
    icono: 'factura',
  },
  {
    clave: 'reportes', etiqueta: 'Reportes', ruta: '../reportes/index.html',
    icono: 'reportes',
  },
];

const CONFIGURACION = {
  clave: 'configuracion', etiqueta: 'Configuración', ruta: '../configuracion/index.html',
  icono: 'ajustes',
};

function navItem({ clave, etiqueta, ruta, icono }, activo) {
  const claseActiva = clave === activo ? ' is-active' : '';
  return `
    <a class="sidebar__nav-item${claseActiva}" href="${ruta}"${clave === activo ? ' aria-current="page"' : ''}>
      ${window.PuntoXIconos.icono(icono, 20)}
      ${etiqueta}
    </a>
  `;
}

function modulosVisibles(modulosActivos) {
  return MODULOS.filter((m) => !m.moduloOpcional || (modulosActivos && modulosActivos[m.moduloOpcional]));
}

// El distintivo muestra el logo del negocio (si lo cargó en Configuración) o sus iniciales.
function distintivo(negocio, iniciales) {
  if (negocio && negocio.logo) return `<div class="sidebar__badge sidebar__badge--logo"><img src="${esc(negocio.logo)}" alt="" /></div>`;
  return `<div class="sidebar__badge">${esc(iniciales)}</div>`;
}

function renderSidebar(moduloActivo, negocio, modulosActivos) {
  const nombre = (negocio && negocio.nombre) || 'Mi Negocio';
  const iniciales = (negocio && negocio.iniciales) || 'MN';

  const items = modulosVisibles(modulosActivos).map((m) => navItem(m, moduloActivo)).join('');

  return `
    <nav class="sidebar" aria-label="Módulos">
      <div class="sidebar__brand">
        ${distintivo(negocio, iniciales)}
        <div>
          <div class="sidebar__brand-name">${esc(nombre)}</div>
          <div class="sidebar__brand-subtitle">Punto de venta</div>
        </div>
      </div>

      <div class="sidebar__nav">${items}</div>

      <div class="sidebar__footer">
        ${navItem(CONFIGURACION, moduloActivo)}
        <div class="sidebar__footer-text">
          <img class="marca-nodo marca-nodo--claro" src="../../assets/marca/nodo-logo-horizontal.svg" alt="Nodo" height="22" />
          <img class="marca-nodo marca-nodo--oscuro" src="../../assets/marca/nodo-logo-horizontal-blanco.svg" alt="Nodo" height="22" />
          <div>Sistema de facturación · ODTeam X</div>
        </div>
      </div>
    </nav>
  `;
}

window.PuntoXSidebar = { renderSidebar, modulosVisibles, MODULOS, CONFIGURACION };
