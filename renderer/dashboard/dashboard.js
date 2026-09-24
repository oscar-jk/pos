function saludoPorHora() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function fechaLarga() {
  const formato = new Intl.DateTimeFormat('es-DO', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
  return formato.charAt(0).toUpperCase() + formato.slice(1);
}

function primerNombre(nombreCompleto) {
  if (!nombreCompleto) return '';
  return nombreCompleto.trim().split(/\s+/)[0];
}

const MODULOS_CONSTRUIDOS = new Set(['ventas', 'inventario', 'caja', 'cxc', 'cxp', 'compras', 'contabilidad', 'configuracion', 'reportes']);

function renderModuleGrid() {
  const contenedor = document.getElementById('module-grid');
  const modulos = window.PuntoXSidebar.MODULOS.filter((m) => m.clave !== 'dashboard');

  contenedor.innerHTML = modulos.map(({ clave, etiqueta, ruta, icono }) => `
    <a class="module-card" href="${ruta}">
      <div class="module-card__icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icono}</svg>
      </div>
      <div class="module-card__title">${etiqueta}</div>
      <div class="module-card__sub">${MODULOS_CONSTRUIDOS.has(clave) ? 'Disponible' : 'En construcción'}</div>
    </a>
  `).join('');
}

async function cargarAlertas() {
  const [stockBajo, vencimientos, facturasVencidas, empleadosDeuda, facturasPorPagar] = await Promise.all([
    window.puntoXInventario.existencias({ soloBajoMinimo: true }),
    window.puntoXInventario.vencimientos(),
    window.puntoXCxc.facturasVencidas(),
    window.puntoXCxc.listarCxcEmpleados({}),
    window.puntoXCxp.facturasProximasAVencer(),
  ]);
  const empleadosConSaldo = empleadosDeuda.filter((e) => e.saldo_pendiente > 0);
  const facturasPorPagarUrgentes = facturasPorPagar.filter((f) => f.dias_restantes <= 7);

  const alertas = [
    ...stockBajo.map((p) => ({
      tag: 'Stock bajo', color: 'var(--color-danger)',
      texto: `${p.descripcion} — quedan ${p.existencia_total}, mínimo ${p.stock_minimo}`,
    })),
    ...vencimientos.map((l) => ({
      tag: l.dias_restantes < 0 ? 'Vencido' : 'Por vencer', color: 'var(--color-warning)',
      texto: `${l.descripcion} (lote ${l.numero_lote}) — ${l.dias_restantes < 0 ? 'vencido' : `vence en ${l.dias_restantes} días`}, ${l.cantidad} en ${l.almacen_nombre}`,
    })),
    ...facturasVencidas.map((f) => ({
      tag: 'Cliente atrasado', color: 'var(--color-danger)',
      texto: `${f.cliente_nombre} — ${f.dias_mora} días de mora, ${fmt(f.saldo_pendiente)} pendientes`,
    })),
    ...facturasPorPagarUrgentes.map((f) => ({
      tag: 'Por pagar', color: 'var(--color-warning)',
      texto: `${f.proveedor_nombre} — factura ${f.numero} ${f.dias_restantes < 0 ? `vencida hace ${-f.dias_restantes} días` : `vence en ${f.dias_restantes} días`}, ${fmt(f.saldo_pendiente)}`,
    })),
  ];

  const contenedor = document.getElementById('lista-alertas');
  if (alertas.length === 0) {
    contenedor.innerHTML = '<div class="empty-state">Sin alertas por ahora.</div>';
  } else {
    contenedor.innerHTML = `<div class="alert-list">${alertas.slice(0, 8).map((a) => `
      <div class="alert-item">
        <span class="alert-item__bar" style="background:${a.color};"></span>
        <span class="alert-item__tag" style="color:${a.color};">${a.tag}</span>
        <span class="alert-item__text">${a.texto}</span>
      </div>
    `).join('')}</div>`;
  }

  document.getElementById('resumen-vencer').textContent = vencimientos.length;
  document.getElementById('resumen-stock-bajo').textContent = stockBajo.length;
  document.getElementById('resumen-clientes-atrasados').textContent = facturasVencidas.length;
  document.getElementById('resumen-facturas-pagar').textContent = facturasPorPagarUrgentes.length;
  document.getElementById('resumen-empleados-deuda').textContent = empleadosConSaldo.length;
}

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function cargarVentasYCaja() {
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);

  const facturasHoy = await window.puntoXVentas.listarFacturas({ desde: inicioHoy.toISOString(), limite: 200 });
  const facturasValidas = facturasHoy.filter((f) => f.estado !== 'anulado');
  const totalHoy = facturasValidas.reduce((acc, f) => acc + f.total, 0);
  document.getElementById('kpi-ventas-hoy').textContent = fmt(totalHoy);
  document.getElementById('kpi-ventas-hoy-sub').textContent = `${facturasValidas.length} factura${facturasValidas.length === 1 ? '' : 's'} hoy`;
  document.getElementById('caja-dia-total').textContent = fmt(totalHoy);

  const cajaPrincipal = await window.puntoXCaja.obtenerCajaPrincipal();
  if (cajaPrincipal) {
    const turno = await window.puntoXCaja.obtenerTurnoAbierto({ cajaId: cajaPrincipal.id });
    if (turno) {
      const esperado = await window.puntoXCaja.efectivoEsperado({ turnoId: turno.id });
      document.getElementById('kpi-caja-actual').textContent = fmt(esperado);
      document.getElementById('kpi-caja-actual-sub').textContent = `Turno abierto desde ${new Date(turno.fecha_apertura).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`;
      document.getElementById('caja-dia-estado').outerHTML = `<p style="font-size:12px; color:var(--color-success); margin: 0 0 16px;" id="caja-dia-estado">Turno abierto — efectivo esperado ${fmt(esperado)}</p>`;
    }
  }

  const aging = await window.puntoXCxc.antiguedadSaldos();
  const totalCxc = aging.reduce((acc, f) => acc + f.total, 0);
  document.getElementById('kpi-cxc-pendiente').textContent = fmt(totalCxc);
  document.getElementById('kpi-cxc-pendiente-sub').textContent = `${aging.length} cliente${aging.length === 1 ? '' : 's'} con saldo`;

  const agingCxp = await window.puntoXCxp.antiguedadSaldos();
  const totalCxp = agingCxp.reduce((acc, f) => acc + f.total, 0);
  document.getElementById('kpi-cxp-pendiente').textContent = fmt(totalCxp);
  document.getElementById('kpi-cxp-pendiente-sub').textContent = `${agingCxp.length} proveedor${agingCxp.length === 1 ? '' : 'es'} con saldo`;

  const recientes = await window.puntoXVentas.listarFacturas({ limite: 5 });
  if (recientes.length > 0) {
    document.getElementById('facturas-recientes').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Cliente</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead>
        <tbody>
          ${recientes.map((f) => `
            <tr>
              <td>${f.cliente_nombre}</td><td style="font-weight:700;">${fmt(f.total)}</td>
              <td><span class="status-pill" style="background:${f.estado === 'anulado' ? 'var(--color-danger)' : 'var(--color-success)'};">${f.estado}</span></td>
              <td>${new Date(f.fecha).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}

async function init() {
  const info = await window.PuntoXShell.initPuntoXShell('dashboard');

  const nombre = primerNombre(info.usuario && info.usuario.nombreCompleto);
  document.getElementById('saludo').textContent = nombre ? `${saludoPorHora()}, ${nombre}` : saludoPorHora();

  const sucursal = info.sucursal ? ` · ${info.sucursal}` : '';
  document.getElementById('fecha-turno').textContent = `${fechaLarga()}${sucursal}`;

  renderModuleGrid();
  cargarAlertas();
  cargarVentasYCaja();
}

init();
