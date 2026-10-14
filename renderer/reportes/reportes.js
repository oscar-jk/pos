const state = { info: null, reporteActivo: null, personalizados: [] };
const Pers = () => window.PuntoXReportesPers;

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fechaCorta(iso) {
  if (!iso) return '—';
  // Una fecha sin hora (p. ej. un vencimiento) no se convierte: sería medianoche UTC, el día anterior en RD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/');
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const FORMA_PAGO_606 = { '01': 'Efectivo', '02': 'Cheque/transferencia', '03': 'Tarjeta', '04': 'Crédito', '05': 'Permuta', '06': 'Nota de crédito', '07': 'Mixto' };

function renderReporte606(r) {
  const periodoTexto = `${r.periodo.slice(4)}/${r.periodo.slice(0, 4)}`;
  return `
    ${!r.rncNegocio ? `<div class="mensaje-error" style="display:block;">Falta el RNC del negocio. Configúralo en <strong>Configuración → Negocio</strong> para poder generar el archivo TXT.</div>` : ''}
    ${renderTarjetas([
      { label: 'Registros', valor: r.totales.cantidad },
      { label: 'Monto facturado (sin ITBIS)', valor: r.totales.facturado, formato: 'moneda' },
      { label: 'ITBIS facturado', valor: r.totales.itbis, formato: 'moneda' },
      { label: 'Excluidos', valor: r.excluidos.length, color: r.excluidos.length ? 'var(--color-warning)' : undefined },
    ])}
    <div style="display:flex; gap:8px; margin:6px 0 12px; flex-wrap:wrap;">
      <button class="btn btn-primario btn-chico" data-exportar="txt" ${!r.rncNegocio || r.registros.length === 0 ? 'disabled' : ''}>Descargar TXT para la DGII</button>
      <button class="btn btn-secundario btn-chico" data-exportar="csv" ${r.registros.length === 0 ? 'disabled' : ''}>Descargar para Excel (CSV)</button>
    </div>
    <div id="aviso-606" style="display:none; font-size:12px; margin-bottom:12px; color:var(--color-success); font-weight:600;"></div>
    <p style="font-size:12px; color:var(--color-text-muted); margin:0 0 14px;">
      Periodo ${esc(periodoTexto)} · RNC informante ${esc(r.rncNegocio) || '—'}. Formato según la Norma General 07-2018.
      Facturas de compra como tipo 09; notas de crédito con forma de pago 06 y notas de débito con 04, ambas con el NCF de la factura afectada.
      <strong>Revisa el archivo con tu contador antes del primer envío.</strong>
    </p>
    ${r.excluidos.length ? `
      <div class="reportes-panel__header" style="margin-top:4px;"><h3 style="font-size:14px; margin:0;">No incluidos en el 606 (${esc(r.excluidos.length)})</h3></div>
      ${renderTabla([
        { label: 'Documento', key: (e) => `${e.origen} ${e.numero}` }, { label: 'Proveedor', key: 'proveedor' },
        { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        { label: 'Motivo', key: 'motivo' },
      ], r.excluidos)}` : ''}
    <div class="reportes-panel__header" style="margin-top:16px;"><h3 style="font-size:14px; margin:0;">Registros</h3></div>
    ${renderTabla([
      { label: 'Documento', key: (x) => `${x.origen} ${x.numero}` }, { label: 'RNC/Cédula', key: 'rnc' },
      { label: 'Tipo', key: 'tipo_bienes_servicios' }, { label: 'NCF', key: 'ncf' }, { label: 'NCF modificado', key: 'ncf_modificado' },
      { label: 'Fecha', key: (x) => `${x.fecha_comprobante.slice(6)}/${x.fecha_comprobante.slice(4, 6)}/${x.fecha_comprobante.slice(0, 4)}` },
      { label: 'Bienes', key: 'monto_bienes', formato: 'moneda', alinear: 'right' }, { label: 'Servicios', key: 'monto_servicios', formato: 'moneda', alinear: 'right' },
      { label: 'ITBIS', key: 'itbis_facturado', formato: 'moneda', alinear: 'right' }, { label: 'Forma de pago', key: (x) => `${x.forma_pago} ${FORMA_PAGO_606[x.forma_pago] || ''}` },
    ], r.registros)}
  `;
}

const fechaDMA = (s) => `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;

function avisosHtml(avisos) {
  return (avisos || []).map((a) => `<div class="conc-aviso" style="margin:6px 0;">${esc(a)}</div>`).join('');
}

function botonesExportar(r, formato) {
  return `
    <div style="display:flex; gap:8px; margin:6px 0 12px; flex-wrap:wrap;">
      <button class="btn btn-primario btn-chico" data-exportar="txt" ${!r.rncNegocio || r.registros.length === 0 ? 'disabled' : ''}>Descargar TXT para la DGII</button>
      ${formato === '607' ? `<button class="btn btn-secundario btn-chico" data-exportar="csv" ${r.registros.length === 0 ? 'disabled' : ''}>Descargar para Excel (CSV)</button>` : ''}
    </div>
    <div id="aviso-exportado" style="display:none; font-size:12px; margin-bottom:12px; color:var(--color-success); font-weight:600;"></div>`;
}

function enlazarExportacion(contenedor, formato, filtros, exportar) {
  contenedor.querySelectorAll('[data-exportar]').forEach((btn) => btn.addEventListener('click', async () => {
    mostrarError(null);
    try {
      const r = await exportar({ periodo: filtros.periodo, formato: btn.dataset.exportar });
      if (r && r.ruta) {
        const aviso = contenedor.querySelector('#aviso-exportado');
        aviso.textContent = `Archivo guardado (${r.registros} registros): ${r.ruta}`;
        aviso.style.display = 'block';
      }
    } catch (err) { mostrarError(err.message); }
  }));
}

function renderReporte607(r) {
  const c = r.resumenConsumo;
  return `
    ${!r.rncNegocio ? `<div class="mensaje-error" style="display:block;">Falta el RNC del negocio. Configúralo en <strong>Configuración → Negocio</strong> para poder generar el archivo TXT.</div>` : ''}
    ${renderTarjetas([
      { label: 'Registros detallados', valor: r.totales.cantidad },
      { label: 'Monto facturado (sin ITBIS)', valor: r.totales.facturado, formato: 'moneda' },
      { label: 'ITBIS facturado', valor: r.totales.itbis, formato: 'moneda' },
      { label: 'Excluidos', valor: r.excluidos.length, color: r.excluidos.length ? 'var(--color-warning)' : undefined },
    ])}
    ${botonesExportar(r, '607')}
    ${avisosHtml(r.avisos)}
    <p style="font-size:12px; color:var(--color-text-muted); margin:6px 0 14px;">
      Periodo ${esc(r.periodo.slice(4))}/${esc(r.periodo.slice(0, 4))} · RNC informante ${esc(r.rncNegocio) || '—'}. Solo comprobantes serie B (los e-CF ya los tiene la DGII).
      <strong>Revisa el archivo con tu contador y la herramienta de pre-validación de la DGII antes del primer envío.</strong>
    </p>
    <div class="reportes-panel__header"><h3 style="font-size:14px; margin:0;">Resumen de facturas de consumo (menores de RD$250,000)</h3></div>
    <p style="font-size:12px; color:var(--color-text-muted); margin:4px 0 8px;">No van en el archivo: se digitan en el formulario de la Oficina Virtual como "Resumen General de Facturas de Consumo".</p>
    ${renderTarjetas([
      { label: 'Cantidad de facturas', valor: c.cantidad },
      { label: 'Monto facturado', valor: c.montoFacturado, formato: 'moneda' },
      { label: 'ITBIS', valor: c.itbis, formato: 'moneda' },
      { label: 'Total', valor: c.total, formato: 'moneda' },
    ])}
    ${r.excluidos.length ? `
      <div class="reportes-panel__header" style="margin-top:4px;"><h3 style="font-size:14px; margin:0;">No incluidos en el 607 (${esc(r.excluidos.length)})</h3></div>
      ${renderTabla([
        { label: 'Documento', key: (e) => `${e.origen} ${e.numero}` }, { label: 'Cliente', key: 'cliente' },
        { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        { label: 'Motivo', key: 'motivo' },
      ], r.excluidos)}` : ''}
    <div class="reportes-panel__header" style="margin-top:16px;"><h3 style="font-size:14px; margin:0;">Registros</h3></div>
    ${renderTabla([
      { label: 'Documento', key: (x) => `${x.origen} ${x.numero}` }, { label: 'RNC/Cédula', key: 'rnc' }, { label: 'NCF', key: 'ncf' },
      { label: 'NCF modificado', key: 'ncf_modificado' }, { label: 'Fecha', key: (x) => fechaDMA(x.fecha_comprobante) },
      { label: 'Facturado', key: 'monto_facturado', formato: 'moneda', alinear: 'right' }, { label: 'ITBIS', key: 'itbis_facturado', formato: 'moneda', alinear: 'right' },
      { label: 'Efectivo', key: 'efectivo', formato: 'moneda', alinear: 'right' }, { label: 'Transf./cheque', key: 'cheque_transferencia', formato: 'moneda', alinear: 'right' },
      { label: 'Tarjeta', key: 'tarjeta', formato: 'moneda', alinear: 'right' }, { label: 'Crédito', key: 'credito', formato: 'moneda', alinear: 'right' },
    ], r.registros)}
  `;
}

function renderReporte608(r) {
  return `
    ${!r.rncNegocio ? `<div class="mensaje-error" style="display:block;">Falta el RNC del negocio. Configúralo en <strong>Configuración → Negocio</strong> para poder generar el archivo TXT.</div>` : ''}
    ${renderTarjetas([
      { label: 'Comprobantes anulados', valor: r.registros.length },
      { label: 'Excluidos', valor: r.excluidos.length, color: r.excluidos.length ? 'var(--color-warning)' : undefined },
    ])}
    ${botonesExportar(r, '608')}
    ${avisosHtml(r.avisos)}
    <p style="font-size:12px; color:var(--color-text-muted); margin:6px 0 14px;">
      Periodo ${esc(r.periodo.slice(4))}/${esc(r.periodo.slice(0, 4))} · RNC informante ${esc(r.rncNegocio) || '—'}. Tipo de anulación por defecto: 4 (corrección de la información), o 6 (devolución) en notas de crédito.
    </p>
    ${r.excluidos.length ? `
      <div class="reportes-panel__header" style="margin-top:4px;"><h3 style="font-size:14px; margin:0;">No incluidos en el 608 (${esc(r.excluidos.length)})</h3></div>
      ${renderTabla([{ label: 'Documento', key: 'numero' }, { label: 'Cliente', key: 'cliente' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' }, { label: 'Motivo', key: 'motivo' }], r.excluidos)}` : ''}
    <div class="reportes-panel__header" style="margin-top:16px;"><h3 style="font-size:14px; margin:0;">Registros</h3></div>
    ${renderTabla([
      { label: 'Documento', key: 'numero' }, { label: 'NCF', key: 'ncf' }, { label: 'Fecha comprobante', key: (x) => fechaDMA(x.fecha_comprobante) },
      { label: 'Tipo de anulación', key: (x) => `${x.tipo_anulacion} ${x.tipo_anulacion_texto}` }, { label: 'Motivo registrado', key: 'motivo_anulacion' },
    ], r.registros)}
  `;
}

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}

function valorColumna(fila, key) {
  return typeof key === 'function' ? key(fila) : fila[key];
}

function formatearValor(v, formato) {
  if (v === null || v === undefined || v === '') return '—';
  if (formato === 'booleano') return v ? 'Sí' : 'No';
  if (formato === 'numero') return esc(Number(v).toLocaleString('es-DO', { maximumFractionDigits: 2 }));
  if (formato === 'moneda') return fmt(v);
  if (formato === 'fecha') return fechaCorta(v);
  if (formato === 'fechahora') return fechaHora(v);
  if (formato === 'porcentaje') return `${v}%`;
  return esc(v);
}

function renderTabla(columnas, filas) {
  if (!filas || filas.length === 0) return '<div class="empty-state">Sin datos para los filtros seleccionados.</div>';
  return `
    <table class="data-table">
      <thead><tr>${columnas.map((c) => `<th${c.alinear ? ` style="text-align:${c.alinear};"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${filas.map((f) => `<tr>${columnas.map((c) => `<td${c.alinear ? ` style="text-align:${c.alinear};"` : ''}>${formatearValor(valorColumna(f, c.key), c.formato)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
}

function renderTarjetas(items) {
  return `<div class="reportes-resumen">${items.map((i) => `
    <div class="reportes-resumen__tarjeta">
      <div class="label">${esc(i.label)}</div>
      <div class="valor"${i.color ? ` style="color:${i.color};"` : ''}>${i.formato === 'moneda' ? fmt(i.valor) : i.valor}</div>
    </div>
  `).join('')}</div>`;
}

// --- Filtros ---

async function renderFiltros(filtros) {
  if (!filtros || filtros.length === 0) return '';
  const partes = await Promise.all(filtros.map(async (f) => {
    if (f.tipo === 'fecha') {
      return `<div class="form-field"><label>${esc(f.label)}</label><input type="date" class="input-normal" id="filtro-${esc(f.clave)}" value="${esc(f.valorDefault || '')}" /></div>`;
    }
    if (f.tipo === 'mes') {
      return `<div class="form-field"><label>${esc(f.label)}</label><input type="month" class="input-normal" id="filtro-${esc(f.clave)}" value="${esc(f.valorDefault || '')}" /></div>`;
    }
    if (f.tipo === 'select') {
      // Las opciones pueden venir de la base (vendedores, sucursales, proveedores...).
      let opciones = f.opciones;
      if (typeof opciones === 'function') { try { opciones = await opciones(); } catch (e) { opciones = [{ value: '', label: 'Todos' }]; } }
      return `<div class="form-field"><label>${esc(f.label)}</label><select class="input-normal" id="filtro-${esc(f.clave)}">${opciones.map((o) => `<option value="${esc(o.value)}" ${o.value === f.valorDefault ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
    }
    if (f.tipo === 'producto') {
      const productos = await window.puntoXInventario.listarProductos({ limite: 500 });
      const opciones = productos.map((p) => `<option value="${esc(p.id)}">${esc(p.codigo_interno)} — ${esc(p.descripcion)}</option>`).join('');
      return `<div class="form-field"><label>${esc(f.label)}</label><select class="input-normal" id="filtro-${esc(f.clave)}">${opciones || '<option value="">Sin productos</option>'}</select></div>`;
    }
    return '';
  }));
  return partes.join('') + '<button class="btn btn-primario btn-chico" id="btn-aplicar-filtros">Aplicar</button>';
}

function leerFiltros(filtros) {
  const valores = {};
  (filtros || []).forEach((f) => {
    const el = document.getElementById(`filtro-${f.clave}`);
    if (!el || !el.value) return;
    // Los <input type="date"> devuelven solo "YYYY-MM-DD", pero fecha se guarda como
    // timestamp ISO completo — comparar el texto tal cual deja "hasta" siempre por debajo
    // de cualquier fecha con hora, así que se completa al límite del día correspondiente.
    if (f.tipo === 'fecha') {
      valores[f.clave] = f.clave === 'hasta' ? `${el.value}T23:59:59.999Z` : `${el.value}T00:00:00.000Z`;
    } else {
      valores[f.clave] = el.value;
    }
  });
  return valores;
}

// Opciones de filtros que salen de la base.
async function opcionesVendedores() {
  const usuarios = window.puntoXDelivery ? await window.puntoXDelivery.repartidores() : [];
  return [{ value: '', label: 'Todos' }, ...usuarios.map((u) => ({ value: u.id, label: u.nombre_completo }))];
}
async function opcionesSucursales() {
  const sucursales = window.puntoXConfig && window.puntoXConfig.listarSucursales ? await window.puntoXConfig.listarSucursales() : [];
  return [{ value: '', label: 'Todas' }, ...sucursales.map((s) => ({ value: s.id, label: s.nombre }))];
}
async function opcionesCategoriasCliente() {
  const categorias = window.puntoXCxc.listarCategorias ? await window.puntoXCxc.listarCategorias() : [];
  return [{ value: '', label: 'Todas' }, ...categorias.map((c) => ({ value: c.id, label: c.nombre }))];
}
async function opcionesProveedores() {
  const proveedores = await window.puntoXCompras.listarProveedores({ limite: 500 });
  return [{ value: '', label: 'Todos' }, ...proveedores.map((p) => ({ value: p.id, label: p.nombre }))];
}

// Exportar lo que muestra el reporte (todas sus tablas) a un CSV que abre Excel.
function csvDeTablas(contenedor, titulo) {
  const celda = (v) => { const t = String(v).replace(/\s+/g, ' ').trim(); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lineas = [[titulo]];
  contenedor.querySelectorAll('table.data-table').forEach((tabla) => {
    const seccion = tabla.previousElementSibling && tabla.previousElementSibling.querySelector('h3');
    lineas.push([]);
    if (seccion) lineas.push([seccion.textContent]);
    tabla.querySelectorAll('tr').forEach((tr) => lineas.push([...tr.children].map((c) => c.textContent)));
  });
  return `\uFEFF${lineas.map((l) => l.map(celda).join(',')).join('\r\n')}\r\n`;
}

function descargarCsv(contenedor, reporte) {
  {
    const blob = new Blob([csvDeTablas(contenedor, reporte.etiqueta)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reporte.etiqueta.replace(/[^\p{L}\p{N}]+/gu, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Barra sobre el resultado. acciones: [{ texto, alHacer, columnas, peligro }]. "Exportar a
// Excel" va siempre que haya una tabla.
function barraHerramientas(contenedor, reporte, acciones = []) {
  const barra = document.createElement('div');
  barra.className = 'reporte-herramientas';
  const botones = [...acciones];
  if (contenedor.querySelector('table.data-table')) botones.push({ texto: 'Exportar a Excel', alHacer: () => descargarCsv(contenedor, reporte) });
  if (botones.length === 0) return;
  barra.innerHTML = botones.map((b, i) => `<button type="button" class="btn ${b.peligro ? 'btn-peligro' : 'btn-secundario'} btn-chico" data-accion="${i}"${b.columnas ? ' data-columnas aria-haspopup="dialog"' : ''}>${esc(b.texto)}</button>`).join('');
  barra.querySelectorAll('[data-accion]').forEach((btn) => btn.addEventListener('click', () => botones[Number(btn.dataset.accion)].alHacer(btn)));
  contenedor.prepend(barra);
}

function agregarExportacion(contenedor, reporte) {
  barraHerramientas(contenedor, reporte);
}

// --- Catálogo de reportes ---

const CATALOGO = [
  {
    grupo: 'Ventas', modulo: 'ventas',
    reportes: [
      {
        clave: 'ventas-periodo', etiqueta: 'Ventas por Período',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, 
          { tipo: 'select', clave: 'agrupacion', label: 'Agrupar por', valorDefault: 'dia', opciones: [{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' },
          { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        cargar: (v) => window.puntoXVentas.ventasPorPeriodo(v),
        columnas: [
          { label: 'Periodo', key: 'periodo' }, { label: 'Facturas', key: 'num_facturas', alinear: 'right' },
          { label: 'Subtotal', key: 'subtotal', formato: 'moneda', alinear: 'right' },
          { label: 'Descuento', key: 'descuento', formato: 'moneda', alinear: 'right' },
          { label: 'ITBIS', key: 'itbis', formato: 'moneda', alinear: 'right' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'ventas-sucursal', etiqueta: 'Ventas por Sucursal (consolidado)',
        disponible: () => Boolean(window.puntoXVentas.ventasPorSucursal),
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.ventasPorSucursal(v),
        columnas: [
          { label: 'Sucursal', key: 'sucursal_nombre' }, { label: 'Facturas', key: 'num_facturas', alinear: 'right' },
          { label: 'Subtotal', key: 'subtotal', formato: 'moneda', alinear: 'right' }, { label: 'Descuento', key: 'descuento', formato: 'moneda', alinear: 'right' },
          { label: 'ITBIS', key: 'itbis', formato: 'moneda', alinear: 'right' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
          { label: 'Participación', key: (x) => `${x.participacion_pct}%`, alinear: 'right' },
        ],
      },
      {
        clave: 'ventas-vendedor', etiqueta: 'Ventas por Vendedor',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.ventasPorVendedor(v),
        columnas: [
          { label: 'Vendedor', key: 'vendedor_nombre' }, { label: 'Facturas', key: 'num_facturas', alinear: 'right' },
          { label: 'Total vendido', key: 'total_vendido', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'ventas-articulo', etiqueta: 'Ventas / Productos Más y Menos Vendidos',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, 
          { tipo: 'select', clave: 'orden', label: 'Ordenar por', valorDefault: 'cantidad_desc', opciones: [
            { value: 'cantidad_desc', label: 'Más vendidos (cantidad)' }, { value: 'cantidad_asc', label: 'Menos vendidos (cantidad)' },
            { value: 'ingreso_desc', label: 'Mayor ingreso' }, { value: 'ingreso_asc', label: 'Menor ingreso' },
          ] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        cargar: (v) => window.puntoXVentas.ventasPorArticulo(v),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Cantidad vendida', key: 'cantidad_vendida', alinear: 'right' },
          { label: 'Ingreso', key: 'ingreso', formato: 'moneda', alinear: 'right' },
          { label: 'Utilidad', key: 'utilidad', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'comisiones', etiqueta: 'Comisiones por Vendedor',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.comisionesPorVendedor(v),
        columnas: [
          { label: 'Vendedor', key: 'vendedor_nombre' }, { label: 'Ventas', key: 'num_ventas', alinear: 'right' },
          { label: 'Comisión generada', key: 'comision_generada', formato: 'moneda', alinear: 'right' },
          { label: 'Pagada', key: 'comision_pagada', formato: 'moneda', alinear: 'right' },
          { label: 'Pendiente', key: 'comision_pendiente', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'margen', etiqueta: 'Margen de Beneficio por Factura',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.margenPorFactura(v),
        columnas: [
          { label: 'Factura', key: 'numero' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Cliente', key: 'cliente_nombre' },
          { label: 'Ingreso', key: 'ingreso', formato: 'moneda', alinear: 'right' }, { label: 'Costo', key: 'costo', formato: 'moneda', alinear: 'right' },
          { label: 'Utilidad', key: 'utilidad', formato: 'moneda', alinear: 'right' }, { label: 'Margen %', key: 'margen_pct', formato: 'porcentaje', alinear: 'right' },
        ],
      },
      {
        clave: 'cobros-dia', etiqueta: 'Resumen de Cobros del Día',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, { tipo: 'fecha', clave: 'fecha', label: 'Fecha', valorDefault: hoyISO() }],
        personalizado: true,
        cargar: (v) => window.puntoXVentas.resumenCobrosDelDia(v),
        render: (r) => renderTarjetas([
          { label: 'Total facturado', valor: r.totalFacturado, formato: 'moneda' },
          { label: 'Total cobrado', valor: r.totalCobrado, formato: 'moneda' },
          { label: 'Efectivo', valor: r.porForma.efectivo, formato: 'moneda' },
          { label: 'Tarjeta', valor: r.porForma.tarjeta, formato: 'moneda' },
          { label: 'Transferencia', valor: r.porForma.transferencia, formato: 'moneda' },
          { label: 'Crédito', valor: r.porForma.credito, formato: 'moneda' },
        ]),
      },
      {
        clave: 'itbis-ventas', etiqueta: 'ITBIS Generado en Ventas',
        filtros: [{ tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales }, { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.itbisGeneradoVentas(v),
        columnas: [
          { label: 'Tasa', key: (f) => `${(f.tasa_itbis * 100).toFixed(0)}%` }, { label: 'Base imponible', key: 'base_total', formato: 'moneda', alinear: 'right' },
          { label: 'ITBIS', key: 'itbis_total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'historial-facturas', etiqueta: 'Historial de Facturas y Anulaciones',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.listarFacturas({ ...v, limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'NCF', key: 'ncf' }, { label: 'Cliente', key: 'cliente_nombre' },
          { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
          { label: 'Estado', key: 'estado' }, { label: 'Motivo anulación', key: 'motivo_anulacion' }, { label: 'Anuló', key: 'usuario_anulo_nombre' },
        ],
      },
      {
        clave: 'delivery-tiempos', etiqueta: 'Tiempo de Entrega (Delivery)',
        disponible: () => Boolean(window.puntoXDelivery),
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        personalizado: true,
        cargar: (v) => window.puntoXDelivery.reporteTiempos({ desde: v.desde, hasta: v.hasta }),
        render: (r) => {
          const aTiempo = (x) => (x.pctATiempo === null ? '—' : `${x.pctATiempo}%`);
          const grupo = (etiqueta) => [{ label: etiqueta, key: 'nombre' }, { label: 'Entregas', key: 'entregas', alinear: 'right' }, { label: 'Promedio (min)', key: 'promedioMin', alinear: 'right' }, { label: 'A tiempo', key: aTiempo, alinear: 'right' }];
          return `
            ${renderTarjetas([{ label: 'Entregas', valor: r.entregas }, { label: 'Promedio (min)', valor: r.promedioMin }])}
            <div class="reportes-panel__header"><h3 style="font-size:14px; margin:0;">Por repartidor</h3></div>
            ${renderTabla(grupo('Repartidor'), r.porRepartidor)}
            <div class="reportes-panel__header" style="margin-top:16px;"><h3 style="font-size:14px; margin:0;">Por zona</h3></div>
            ${renderTabla(grupo('Zona'), r.porZona)}
            <div class="reportes-panel__header" style="margin-top:16px;"><h3 style="font-size:14px; margin:0;">Detalle</h3></div>
            ${renderTabla([{ label: 'Factura', key: 'numero' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Repartidor', key: 'repartidor_nombre' }, { label: 'Zona', key: (x) => x.zona_entrega || '—' }, { label: 'Minutos', key: 'minutos', alinear: 'right' }, { label: 'Estimado', key: (x) => x.tiempo_estimado_min || '—', alinear: 'right' }], r.filas)}`;
        },
      },
      {
        clave: 'ventas-607', etiqueta: 'Ventas 607 (DGII)',
        disponible: () => Boolean(window.puntoXFormatosVentas),
        filtros: [{ tipo: 'mes', clave: 'periodo', label: 'Mes a reportar', valorDefault: mesAnterior() }],
        personalizado: true,
        cargar: (v) => window.puntoXFormatosVentas.reporte607({ periodo: v.periodo }),
        render: renderReporte607,
        alRenderizar: (datos, contenedor, filtros) => enlazarExportacion(contenedor, '607', filtros, window.puntoXFormatosVentas.exportar607),
      },
      {
        clave: 'ventas-608', etiqueta: 'Comprobantes anulados 608 (DGII)',
        disponible: () => Boolean(window.puntoXFormatosVentas),
        filtros: [{ tipo: 'mes', clave: 'periodo', label: 'Mes a reportar', valorDefault: mesAnterior() }],
        personalizado: true,
        cargar: (v) => window.puntoXFormatosVentas.reporte608({ periodo: v.periodo }),
        render: renderReporte608,
        alRenderizar: (datos, contenedor, filtros) => enlazarExportacion(contenedor, '608', filtros, window.puntoXFormatosVentas.exportar608),
      },
    ],
  },
  {
    grupo: 'Inventario', modulo: 'inventario',
    reportes: [
      {
        clave: 'existencias', etiqueta: 'Existencia por Almacén y Consolidada',
        filtros: [],
        cargar: () => window.puntoXInventario.existencias({}),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Existencia', key: 'existencia_total', alinear: 'right' }, { label: 'Comprometida', key: 'comprometida_total', alinear: 'right' },
          { label: 'Stock mínimo', key: 'stock_minimo', alinear: 'right' },
        ],
      },
      {
        clave: 'vencimientos', etiqueta: 'Vencimientos Próximos',
        filtros: [],
        cargar: () => window.puntoXInventario.vencimientos({}),
        columnas: [
          { label: 'Producto', key: 'descripcion' }, { label: 'Lote', key: 'numero_lote' }, { label: 'Almacén', key: 'almacen_nombre' },
          { label: 'Cantidad', key: 'cantidad', alinear: 'right' }, { label: 'Vence', key: 'fecha_vencimiento', formato: 'fecha' },
          { label: 'Días restantes', key: 'dias_restantes', alinear: 'right' },
        ],
      },
      {
        clave: 'inv-valorizacion', etiqueta: 'Valorización de Inventario a Fecha',
        disponible: () => Boolean(window.puntoXReportesInv),
        filtros: [{ tipo: 'fecha', clave: 'fecha', label: 'A la fecha', valorDefault: hoyISO() }, { tipo: 'fecha', clave: 'compararCon', label: 'Comparar con (opcional)' }],
        personalizado: true,
        cargar: (v) => window.puntoXReportesInv.valorizacion({ fecha: v.fecha || undefined, compararCon: v.compararCon || undefined }),
        render: (r) => {
          const tarjetas = [{ label: `Valor al ${fechaCorta(r.fecha)}`, valor: r.total, formato: 'moneda' }];
          const columnas = [
            { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' }, { label: 'Categoría', key: 'categoria_nombre' },
            { label: 'Cantidad', key: 'cantidad', alinear: 'right' }, { label: 'Valor', key: 'valor', formato: 'moneda', alinear: 'right' },
          ];
          if (r.compararCon) {
            tarjetas.push({ label: `Valor al ${fechaCorta(r.compararCon)}`, valor: r.totalPrevio, formato: 'moneda' }, { label: 'Diferencia', valor: r.diferencia, formato: 'moneda', color: r.diferencia < 0 ? 'var(--color-danger)' : 'var(--color-success)' });
            columnas.push({ label: 'Cantidad previa', key: 'cantidad_previa', alinear: 'right' }, { label: 'Valor previo', key: 'valor_previo', formato: 'moneda', alinear: 'right' }, { label: 'Diferencia', key: 'diferencia', formato: 'moneda', alinear: 'right' });
          }
          return renderTarjetas(tarjetas) + renderTabla(columnas, r.filas);
        },
      },
      {
        clave: 'inv-reposicion', etiqueta: 'Reposición Sugerida',
        disponible: () => Boolean(window.puntoXReportesInv),
        filtros: [],
        cargar: () => window.puntoXReportesInv.reposicion(),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Existencia', key: 'existencia', alinear: 'right' }, { label: 'Mínimo', key: 'stock_minimo', alinear: 'right' },
          { label: 'Consumo diario (90 d)', key: 'consumo_diario', alinear: 'right' }, { label: 'Días de cobertura', key: 'dias_cobertura', alinear: 'right' },
          { label: 'Cantidad sugerida', key: 'cantidad_sugerida', alinear: 'right' },
        ],
      },
      {
        clave: 'inv-sobrestock', etiqueta: 'Sobre-stock',
        disponible: () => Boolean(window.puntoXReportesInv),
        filtros: [],
        cargar: () => window.puntoXReportesInv.sobreStock(),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' }, { label: 'Existencia', key: 'existencia', alinear: 'right' },
          { label: 'Máximo', key: 'stock_maximo', alinear: 'right' }, { label: 'Días de cobertura', key: 'dias_cobertura', alinear: 'right' },
          { label: 'Exceso', key: 'cantidad_exceso', alinear: 'right' }, { label: 'Valor del exceso', key: 'valor_exceso', formato: 'moneda', alinear: 'right' },
          { label: 'Motivo', key: 'motivo' },
        ],
      },
      {
        clave: 'inv-rotacion', etiqueta: 'Rotación de Inventario',
        disponible: () => Boolean(window.puntoXReportesInv),
        filtros: [
          { tipo: 'select', clave: 'agrupar', label: 'Por', valorDefault: 'producto', opciones: [{ value: 'producto', label: 'Producto' }, { value: 'categoria', label: 'Categoría' }] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        cargar: (v) => window.puntoXReportesInv.rotacion({ agrupar: v.agrupar, desde: v.desde || undefined, hasta: v.hasta || undefined }),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto / categoría', key: 'descripcion' },
          { label: 'Costo de ventas', key: 'costo_ventas', formato: 'moneda', alinear: 'right' }, { label: 'Inventario promedio', key: 'inventario_promedio', formato: 'moneda', alinear: 'right' },
          { label: 'Rotación', key: 'rotacion', alinear: 'right' }, { label: 'Días de inventario', key: 'dias_inventario', alinear: 'right' },
        ],
      },
      {
        clave: 'inv-bitacora', etiqueta: 'Bitácora de Movimientos',
        disponible: () => Boolean(window.puntoXReportesInv),
        filtros: [
          { tipo: 'select', clave: 'tipo', label: 'Tipo', valorDefault: '', opciones: [
            { value: '', label: 'Todos' }, { value: 'entrada_compra', label: 'Entradas de compra' }, { value: 'salida_venta', label: 'Salidas por venta' },
            { value: 'ajuste_entrada', label: 'Ajustes de entrada' }, { value: 'ajuste_salida', label: 'Ajustes de salida' },
            { value: 'transferencia_entrada', label: 'Transferencias (entrada)' }, { value: 'transferencia_salida', label: 'Transferencias (salida)' },
            { value: 'merma', label: 'Mermas' }, { value: 'conversion', label: 'Conversiones' },
          ] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        cargar: (v) => window.puntoXReportesInv.bitacora({ tipo: v.tipo || undefined, desde: v.desde || undefined, hasta: v.hasta || undefined }),
        columnas: [
          { label: 'Fecha', key: 'fecha', formato: 'fechahora' }, { label: 'Producto', key: 'descripcion' }, { label: 'Almacén', key: 'almacen_nombre' },
          { label: 'Tipo', key: 'tipo_movimiento' }, { label: 'Cantidad', key: 'cantidad', alinear: 'right' },
          { label: 'Costo unitario', key: 'costo_unitario', formato: 'moneda', alinear: 'right' }, { label: 'Saldo', key: 'saldo_cantidad', alinear: 'right' },
          { label: 'Usuario', key: 'usuario_nombre' },
        ],
      },
      {
        clave: 'mermas', etiqueta: 'Mermas y Averías',
        filtros: [],
        cargar: () => window.puntoXInventario.listarMermas({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Producto', key: 'producto_descripcion' }, { label: 'Almacén', key: 'almacen_nombre' },
          { label: 'Cantidad', key: 'cantidad', alinear: 'right' }, { label: 'Costo unitario', key: 'costo_unitario', formato: 'moneda', alinear: 'right' },
          { label: 'Motivo', key: 'motivo' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
        ],
      },
    ],
  },
  {
    grupo: 'Compras', modulo: 'compras',
    reportes: [
      {
        clave: 'historial-compras', etiqueta: 'Historial de Compras',
        filtros: [
          { tipo: 'select', clave: 'proveedorId', label: 'Proveedor', valorDefault: '', opciones: opcionesProveedores },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
          { tipo: 'select', clave: 'estadoPago', label: 'Estado de pago', valorDefault: '', opciones: [{ value: '', label: 'Todos' }, { value: 'pagada', label: 'Pagada' }, { value: 'parcial', label: 'Parcial' }, { value: 'pendiente', label: 'Pendiente' }, { value: 'anulada', label: 'Anulada' }] },
        ],
        cargar: (v) => (window.puntoXCompras.historialCompras ? window.puntoXCompras.historialCompras(v) : window.puntoXCompras.listarFacturas({ limite: 200 })),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
          { label: 'NCF', key: 'ncf_proveedor' }, { label: 'Condición', key: 'condicion_pago' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' }, { label: 'Pendiente', key: 'pendiente', formato: 'moneda', alinear: 'right' },
          { label: 'Estado de pago', key: (x) => ({ pagada: 'Pagada', parcial: 'Parcial', pendiente: 'Pendiente', anulada: 'Anulada' }[x.estado_pago] || x.estado) },
        ],
      },
      {
        clave: 'comparacion-costo', etiqueta: 'Comparación de Mejor Costo',
        filtros: [{ tipo: 'producto', clave: 'productoId', label: 'Producto' }],
        cargar: (v) => v.productoId ? window.puntoXCompras.comparacionMejorCosto({ productoId: v.productoId }) : Promise.resolve([]),
        columnas: [
          { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Factura', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' },
          { label: 'Costo unitario', key: 'costo_unitario', formato: 'moneda', alinear: 'right' }, { label: 'Cantidad', key: 'cantidad', alinear: 'right' },
        ],
      },
      {
        clave: 'compras-producto', etiqueta: 'Compras por Producto',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXCompras.comprasPorProducto(v),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Cantidad comprada', key: 'cantidad_total', alinear: 'right' }, { label: 'Costo total', key: 'costo_total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'ordenes-pendientes', etiqueta: 'Órdenes de Compra Pendientes de Recepción',
        filtros: [],
        cargar: () => window.puntoXCompras.listarOrdenes({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
          { label: '% Recibido', key: (f) => `${f.porcentaje_recibido}%` }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'compras-606', etiqueta: 'Compras 606 (DGII)',
        disponible: () => Boolean(window.puntoXCompras.reporte606),
        // El 606 se envía a mes vencido: por defecto, el mes anterior.
        filtros: [{ tipo: 'mes', clave: 'periodo', label: 'Mes a reportar', valorDefault: mesAnterior() }],
        personalizado: true,
        cargar: (v) => window.puntoXCompras.reporte606({ periodo: v.periodo }),
        render: renderReporte606,
        alRenderizar: (datos, contenedor, filtros) => {
          contenedor.querySelectorAll('[data-exportar]').forEach((btn) => btn.addEventListener('click', async () => {
            mostrarError(null);
            try {
              const r = await window.puntoXCompras.exportar606({ periodo: filtros.periodo, formato: btn.dataset.exportar });
              if (r && r.ruta) {
                const aviso = contenedor.querySelector('#aviso-606');
                aviso.textContent = `Archivo guardado (${r.registros} registros): ${r.ruta}`;
                aviso.style.display = 'block';
              }
            } catch (err) { mostrarError(err.message); }
          }));
        },
      },
    ],
  },
  {
    grupo: 'Cuentas por Cobrar', modulo: 'cxc',
    reportes: [
      {
        clave: 'cxc-proyeccion', etiqueta: 'Proyección de Cobros',
        disponible: () => Boolean(window.puntoXProyecciones),
        filtros: [{ tipo: 'select', clave: 'agrupar', label: 'Agrupar por', valorDefault: 'semana', opciones: [{ value: 'semana', label: 'Semana (7 días)' }, { value: 'mes', label: 'Mes (30 días)' }] }, { tipo: 'select', clave: 'periodos', label: 'Periodos', valorDefault: '8', opciones: [{ value: '4', label: '4' }, { value: '8', label: '8' }, { value: '12', label: '12' }] }],
        personalizado: true,
        cargar: (v) => window.puntoXProyecciones.cobros({ agrupar: v.agrupar, periodos: Number(v.periodos) }),
        render: (r) => renderTarjetas([{ label: 'Por cobrar', valor: r.total, formato: 'moneda' }, { label: 'Ya vencido', valor: r.vencido, formato: 'moneda', color: r.vencido > 0 ? 'var(--color-danger)' : undefined }])
          + renderTabla([
            { label: 'Periodo', key: 'etiqueta' }, { label: 'Desde', key: 'desde', formato: 'fecha' }, { label: 'Hasta', key: 'hasta', formato: 'fecha' },
            { label: 'Documentos', key: 'documentos', alinear: 'right' }, { label: 'Monto', key: 'monto', formato: 'moneda', alinear: 'right' },
          ], r.periodos),
      },
      {
        clave: 'cxc-listado', etiqueta: 'Listado de CxC',
        filtros: [
          { tipo: 'select', clave: 'vendedorId', label: 'Vendedor', valorDefault: '', opciones: opcionesVendedores },
          { tipo: 'select', clave: 'sucursalId', label: 'Sucursal', valorDefault: '', opciones: opcionesSucursales },
          { tipo: 'select', clave: 'categoriaId', label: 'Categoría', valorDefault: '', opciones: opcionesCategoriasCliente },
          { tipo: 'select', clave: 'soloConSaldo', label: 'Mostrar', valorDefault: '1', opciones: [{ value: '1', label: 'Solo con saldo' }, { value: '', label: 'Todos los clientes' }] },
        ],
        cargar: (v) => (window.puntoXCxc.listadoCxc
          ? window.puntoXCxc.listadoCxc({ ...v, soloConSaldo: v.soloConSaldo === '1' })
          : window.puntoXCxc.listarClientes({ limite: 200 })),
        columnas: [
          { label: 'Cliente', key: 'nombre' }, { label: 'Categoría', key: 'categoria_nombre' },
          { label: 'Límite de crédito', key: 'limite_credito', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' },
          { label: 'Vencido', key: 'saldo_vencido', formato: 'moneda', alinear: 'right' },
          { label: 'Crédito disponible', key: 'credito_disponible', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxc-antiguedad', etiqueta: 'Antigüedad de Saldos',
        filtros: [],
        cargar: () => window.puntoXCxc.antiguedadSaldos(),
        columnas: [
          { label: 'Cliente', key: 'clienteNombre' }, { label: 'Corriente', key: (f) => f.tramos.corriente, formato: 'moneda', alinear: 'right' },
          { label: '0-30 días', key: (f) => f.tramos.dias_0_30, formato: 'moneda', alinear: 'right' },
          { label: '31-60 días', key: (f) => f.tramos.dias_31_60, formato: 'moneda', alinear: 'right' },
          { label: '61-90 días', key: (f) => f.tramos.dias_61_90, formato: 'moneda', alinear: 'right' },
          { label: '+90 días', key: (f) => f.tramos.dias_90_mas, formato: 'moneda', alinear: 'right' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxc-vencidas', etiqueta: 'Facturas Vencidas',
        filtros: [],
        cargar: () => window.puntoXCxc.facturasVencidas(),
        columnas: [
          { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Teléfono', key: 'cliente_telefono' }, { label: 'Factura', key: 'numero' },
          { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Saldo', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' },
          { label: 'Días de mora', key: 'dias_mora', alinear: 'right' },
        ],
      },
      {
        clave: 'cxc-gestion', etiqueta: 'Gestión de Cobros',
        filtros: [],
        cargar: () => window.puntoXCxc.listarGestionCobros({ limite: 200 }),
        columnas: [
          { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Tipo de contacto', key: 'tipo_contacto' }, { label: 'Notas', key: 'notas' },
          { label: 'Resultado', key: 'resultado' }, { label: 'Próximo contacto', key: 'proxima_fecha_contacto', formato: 'fecha' },
          { label: 'Fecha', key: 'fecha_contacto', formato: 'fecha' },
        ],
      },
      {
        clave: 'cxc-cobros-vendedor', etiqueta: 'Historial de Cobros por Vendedor',
        disponible: () => Boolean(window.puntoXCxc.historialCobros),
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        personalizado: true,
        cargar: (v) => window.puntoXCxc.historialCobros({ desde: v.desde, hasta: v.hasta }),
        render: (r) => `
          ${renderTarjetas([{ label: 'Total cobrado', valor: r.total, formato: 'moneda' }, { label: 'Vendedores', valor: r.porVendedor.length }, { label: 'Cobros aplicados', valor: r.filas.length }])}
          <div class="reportes-panel__header"><h3 style="font-size:14px; margin:0;">Por vendedor de la factura</h3></div>
          ${renderTabla([
            { label: 'Vendedor', key: 'nombre' }, { label: 'Cobrado', key: 'cobrado', formato: 'moneda', alinear: 'right' },
            { label: 'Recibos', key: 'recibos', alinear: 'right' }, { label: 'Facturas cobradas', key: 'facturas', alinear: 'right' },
            { label: 'Días promedio de cobro', key: 'diasPromedio', alinear: 'right' },
          ], r.porVendedor)}
          <div class="reportes-panel__header" style="margin-top:16px;"><h3 style="font-size:14px; margin:0;">Detalle</h3></div>
          ${renderTabla([
            { label: 'Recibo', key: 'recibo_numero' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Cliente', key: 'cliente_nombre' },
            { label: 'Factura', key: 'factura_numero' }, { label: 'Vendedor', key: 'vendedor_nombre' }, { label: 'Forma de pago', key: 'forma_pago' },
            { label: 'Aplicado', key: 'monto_aplicado', formato: 'moneda', alinear: 'right' }, { label: 'Días', key: 'dias_cobro', alinear: 'right' },
          ], r.filas)}`,
      },
      {
        clave: 'cxc-pagos', etiqueta: 'Historial de Pagos',
        filtros: [],
        cargar: () => window.puntoXCxc.listarRecibos({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Forma de pago', key: 'forma_pago' },
          { label: 'Monto', key: 'monto_total', formato: 'moneda', alinear: 'right' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'cxc-notas', etiqueta: 'Notas de Crédito y Débito Emitidas',
        filtros: [{ tipo: 'select', clave: 'tipo', label: 'Tipo', valorDefault: 'nota_credito', opciones: [{ value: 'nota_credito', label: 'Notas de crédito' }, { value: 'nota_debito', label: 'Notas de débito' }] }],
        cargar: (v) => window.puntoXVentas.listarNotas({ tipo: v.tipo || 'nota_credito', limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Factura origen', key: 'factura_origen_numero' },
          { label: 'Concepto', key: 'concepto' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'cxc-empleados', etiqueta: 'CxC de Empleados',
        filtros: [],
        cargar: () => window.puntoXCxc.listarCxcEmpleados({ limite: 200 }),
        columnas: [
          { label: 'Empleado', key: 'empleado_nombre' }, { label: 'Tipo', key: 'tipo' }, { label: 'Monto', key: 'monto', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' }, { label: 'Estado', key: 'estado' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
        ],
      },
    ],
  },
  {
    grupo: 'Cuentas por Pagar', modulo: 'cxp',
    reportes: [
      {
        clave: 'cxp-proyeccion', etiqueta: 'Proyección de Pagos',
        disponible: () => Boolean(window.puntoXProyecciones),
        filtros: [{ tipo: 'select', clave: 'agrupar', label: 'Agrupar por', valorDefault: 'semana', opciones: [{ value: 'semana', label: 'Semana (7 días)' }, { value: 'mes', label: 'Mes (30 días)' }] }, { tipo: 'select', clave: 'periodos', label: 'Periodos', valorDefault: '8', opciones: [{ value: '4', label: '4' }, { value: '8', label: '8' }, { value: '12', label: '12' }] }],
        personalizado: true,
        cargar: (v) => window.puntoXProyecciones.pagos({ agrupar: v.agrupar, periodos: Number(v.periodos) }),
        render: (r) => renderTarjetas([{ label: 'Por pagar', valor: r.total, formato: 'moneda' }, { label: 'Ya vencido', valor: r.vencido, formato: 'moneda', color: r.vencido > 0 ? 'var(--color-danger)' : undefined }])
          + renderTabla([
            { label: 'Periodo', key: 'etiqueta' }, { label: 'Desde', key: 'desde', formato: 'fecha' }, { label: 'Hasta', key: 'hasta', formato: 'fecha' },
            { label: 'Documentos', key: 'documentos', alinear: 'right' }, { label: 'Monto', key: 'monto', formato: 'moneda', alinear: 'right' },
          ], r.periodos),
      },
      {
        clave: 'cxp-listado', etiqueta: 'Listado de CxP',
        filtros: [
          { tipo: 'select', clave: 'orden', label: 'Ordenar por', valorDefault: 'urgencia', opciones: [{ value: 'urgencia', label: 'Urgencia (más atrasado primero)' }, { value: 'saldo', label: 'Mayor saldo' }] },
          { tipo: 'select', clave: 'soloVencidos', label: 'Mostrar', valorDefault: '', opciones: [{ value: '', label: 'Todos con saldo' }, { value: '1', label: 'Solo con saldo vencido' }] },
        ],
        cargar: (v) => (window.puntoXCompras.listadoCxp
          ? window.puntoXCompras.listadoCxp({ orden: v.orden, soloVencidos: v.soloVencidos === '1' })
          : window.puntoXCompras.listarProveedores({ limite: 200 })),
        columnas: [
          { label: 'Proveedor', key: 'nombre' }, { label: 'RNC', key: 'rnc' },
          { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' },
          { label: 'Vencido', key: 'saldo_vencido', formato: 'moneda', alinear: 'right' },
          { label: 'Días de mora', key: 'dias_mora_max', alinear: 'right' },
          { label: 'Próximo vencimiento', key: 'proximo_vencimiento', formato: 'fecha' },
        ],
      },
      {
        clave: 'cxp-antiguedad', etiqueta: 'Antigüedad de Saldos por Pagar',
        filtros: [],
        cargar: () => window.puntoXCxp.antiguedadSaldos(),
        columnas: [
          { label: 'Proveedor', key: 'proveedorNombre' }, { label: 'Corriente', key: (f) => f.tramos.corriente, formato: 'moneda', alinear: 'right' },
          { label: '0-30 días', key: (f) => f.tramos.dias_0_30, formato: 'moneda', alinear: 'right' },
          { label: '31-60 días', key: (f) => f.tramos.dias_31_60, formato: 'moneda', alinear: 'right' },
          { label: '61-90 días', key: (f) => f.tramos.dias_61_90, formato: 'moneda', alinear: 'right' },
          { label: '+90 días', key: (f) => f.tramos.dias_90_mas, formato: 'moneda', alinear: 'right' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxp-proximas', etiqueta: 'Facturas Próximas a Vencer',
        filtros: [],
        cargar: () => window.puntoXCxp.facturasProximasAVencer(),
        columnas: [
          { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Factura', key: 'numero' }, { label: 'Vencimiento', key: 'fecha_vencimiento', formato: 'fecha' },
          { label: 'Saldo', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' }, { label: 'Días restantes', key: 'dias_restantes', alinear: 'right' },
        ],
      },
      {
        clave: 'cxp-cheques', etiqueta: 'Cheques Posdatados Pendientes',
        filtros: [],
        cargar: () => window.puntoXCxp.chequesPosdatadosPendientes(),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Cheque', key: 'numero_cheque' },
          { label: 'Banco', key: 'banco_cheque' }, { label: 'Monto', key: 'monto_total', formato: 'moneda', alinear: 'right' }, { label: 'Fecha de cobro', key: 'fecha_cheque', formato: 'fecha' },
        ],
      },
    ],
  },
  {
    grupo: 'Caja y Tesorería', modulo: 'caja',
    reportes: [
      {
        clave: 'caja-flujo', etiqueta: 'Flujo de Caja Diario/Semanal',
        disponible: () => Boolean(window.puntoXProyecciones),
        filtros: [
          { tipo: 'select', clave: 'agrupar', label: 'Agrupar por', valorDefault: 'dia', opciones: [{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        personalizado: true,
        cargar: (v) => window.puntoXProyecciones.flujoCaja({ agrupar: v.agrupar, desde: v.desde || undefined, hasta: v.hasta || undefined }),
        render: (r) => renderTarjetas([
          { label: 'Entradas', valor: r.entradas, formato: 'moneda', color: 'var(--color-success)' }, { label: 'Salidas', valor: r.salidas, formato: 'moneda', color: 'var(--color-danger)' }, { label: 'Neto', valor: r.neto, formato: 'moneda' },
        ]) + renderTabla([
          { label: r.agrupar === 'semana' ? 'Semana desde' : 'Día', key: 'periodo', formato: 'fecha' }, { label: 'Entradas', key: 'entradas', formato: 'moneda', alinear: 'right' },
          { label: 'Salidas', key: 'salidas', formato: 'moneda', alinear: 'right' }, { label: 'Neto', key: 'neto', formato: 'moneda', alinear: 'right' },
          { label: 'Acumulado', key: 'acumulado', formato: 'moneda', alinear: 'right' }, { label: 'Ventas en efectivo', key: 'ventas_efectivo', formato: 'moneda', alinear: 'right' },
        ], r.filas),
      },
      {
        clave: 'caja-arqueo', etiqueta: 'Arqueo de Caja por Turno',
        filtros: [],
        cargar: () => window.puntoXCaja.listarTurnos({ limite: 200 }),
        columnas: [
          { label: 'Caja', key: 'caja_nombre' }, { label: 'Apertura', key: 'fecha_apertura', formato: 'fechahora' }, { label: 'Cierre', key: 'fecha_cierre', formato: 'fechahora' },
          { label: 'Fondo inicial', key: 'fondo_inicial', formato: 'moneda', alinear: 'right' }, { label: 'Esperado', key: 'efectivo_esperado', formato: 'moneda', alinear: 'right' },
          { label: 'Contado', key: 'efectivo_contado', formato: 'moneda', alinear: 'right' }, { label: 'Diferencia', key: 'diferencia', formato: 'moneda', alinear: 'right' },
          { label: 'Responsable', key: 'usuario_nombre' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'caja-sobrantes', etiqueta: 'Historial de Sobrantes/Faltantes',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXCaja.historialSobrantesFaltantes(v),
        columnas: [
          { label: 'Usuario', key: 'usuario_nombre' }, { label: 'Caja', key: 'caja_nombre' }, { label: 'Turnos', key: 'num_turnos', alinear: 'right' },
          { label: 'Total sobrante', key: 'total_sobrante', formato: 'moneda', alinear: 'right' }, { label: 'Total faltante', key: 'total_faltante', formato: 'moneda', alinear: 'right' },
          { label: 'Diferencia neta', key: 'diferencia_neta', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'caja-chica', etiqueta: 'Movimientos de Caja Chica',
        filtros: [],
        cargar: () => window.puntoXCaja.listarGastosCajaChica({ limite: 200 }),
        columnas: [
          { label: 'Concepto', key: 'concepto' }, { label: 'Categoría', key: 'categoria' }, { label: 'Monto', key: 'monto', formato: 'moneda', alinear: 'right' },
          { label: 'Comprobante', key: 'comprobante_ruta' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Usuario', key: 'usuario_nombre' },
        ],
      },
      {
        clave: 'caja-conciliacion', etiqueta: 'Conciliación Bancaria',
        // Solo existe en la app de escritorio.
        disponible: () => Boolean(window.puntoXCaja.listarConciliaciones),
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXCaja.listarConciliaciones(v),
        columnas: [
          { label: 'Cuenta', key: (c) => `${c.cuenta_nombre} — ${c.banco}` },
          { label: 'Desde', key: (c) => `${c.periodo_desde}T12:00:00`, formato: 'fecha' }, { label: 'Hasta', key: (c) => `${c.periodo_hasta}T12:00:00`, formato: 'fecha' },
          { label: 'Saldo banco', key: 'saldoEstadoCuenta', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo en libros', key: 'saldoLibros', formato: 'moneda', alinear: 'right' },
          { label: 'Partidas conciliadas', key: 'partidasConciliadas', alinear: 'right' },
          { label: 'Partidas del banco pendientes', key: 'partidasPendientes', alinear: 'right' },
          { label: 'En tránsito (sistema)', key: 'movimientosPendientes', alinear: 'right' },
          { label: 'Diferencia', key: 'diferencia', formato: 'moneda', alinear: 'right' },
          { label: 'Estado', key: (c) => (c.estado === 'conciliada' ? 'Conciliada' : 'En proceso') },
        ],
      },
    ],
  },
  {
    grupo: 'Contabilidad', modulo: 'contabilidad',
    reportes: [
      {
        clave: 'balance-comprobacion', etiqueta: 'Balance de Comprobación',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXContabilidad.balanceComprobacion(v),
        columnas: [
          { label: 'Código', key: 'codigo' }, { label: 'Cuenta', key: 'nombre' }, { label: 'Tipo', key: 'tipo' },
          { label: 'Total debe', key: 'total_debe', formato: 'moneda', alinear: 'right' }, { label: 'Total haber', key: 'total_haber', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'estado-resultados', etiqueta: 'Estado de Resultados',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        personalizado: true,
        cargar: (v) => window.puntoXContabilidad.estadoResultados(v),
        render: (r) => `
          ${renderTarjetas([
            { label: 'Ingresos', valor: r.totalIngresos, formato: 'moneda' },
            { label: 'Costos', valor: r.totalCostos, formato: 'moneda' },
            { label: 'Gastos', valor: r.totalGastos, formato: 'moneda' },
            { label: 'Utilidad bruta', valor: r.utilidadBruta, formato: 'moneda', color: r.utilidadBruta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
            { label: 'Utilidad neta', valor: r.utilidadNeta, formato: 'moneda', color: r.utilidadNeta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
          ])}
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Ingresos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.ingresos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Costos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.costos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Gastos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.gastos)}</div>
        `,
      },
      {
        clave: 'balance-general', etiqueta: 'Balance General',
        filtros: [{ tipo: 'fecha', clave: 'hasta', label: 'A fecha', valorDefault: hoyISO() }],
        personalizado: true,
        cargar: (v) => window.puntoXContabilidad.balanceGeneral(v),
        render: (r) => `
          ${renderTarjetas([
            { label: 'Total activo', valor: r.totalActivo, formato: 'moneda' },
            { label: 'Total pasivo', valor: r.totalPasivo, formato: 'moneda' },
            { label: 'Total patrimonio', valor: r.totalPatrimonio, formato: 'moneda' },
            { label: 'Cuadra', valor: r.cuadra ? 'Sí' : 'No', color: r.cuadra ? 'var(--color-success)' : 'var(--color-danger)' },
          ])}
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Activos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.activos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Pasivos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.pasivos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Patrimonio</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.patrimonio)}</div>
        `,
      },
    ],
  },
  {
    grupo: 'Configuración', modulo: 'configuracion',
    reportes: [
      {
        clave: 'bitacora', etiqueta: 'Bitácora de Auditoría',
        filtros: [],
        cargar: () => window.puntoXConfig.listarBitacora({ limite: 200 }),
        columnas: [
          { label: 'Fecha', key: 'created_at', formato: 'fechahora' }, { label: 'Usuario', key: 'usuario_nombre' }, { label: 'Módulo', key: 'modulo' },
          { label: 'Entidad', key: 'entidad' }, { label: 'Acción', key: 'accion' },
        ],
      },
    ],
  },
];

// --- Navegación y render ---

function reporteBusca(clave) {
  for (const g of CATALOGO) {
    const r = g.reportes.find((x) => x.clave === clave);
    if (r) return r;
  }
  return null;
}

// Grupo de reportes visible si el usuario tiene algún permiso de ese módulo.
const ACCESO_GRUPO = {
  ventas: ['ventas.'], inventario: ['inventario.'], compras: ['compras.'], cxc: ['cxc.'], cxp: ['cxp.', 'compras.pago.aprobar'],
  caja: ['caja.'], contabilidad: ['contabilidad.'], configuracion: ['configuracion.'],
};
function grupoVisible(g) {
  const permisos = (state.info && state.info.usuario && state.info.usuario.permisos) || [];
  const prefijos = ACCESO_GRUPO[g.modulo];
  return !prefijos || permisos.includes('*') || permisos.some((p) => prefijos.some((pre) => p.startsWith(pre)));
}

function renderNav() {
  const nav = document.getElementById('reportes-nav');
  const puedeCrear = Pers() && Pers().disponible();
  const mios = puedeCrear ? `
    <div class="reportes-nav__grupo reportes-nav__grupo--propios">
      <div class="reportes-nav__titulo">Mis reportes</div>
      ${state.personalizados.map((r) => `<button class="reportes-nav__item" data-clave="pers:${esc(r.id)}">${esc(r.nombre)}${!r.propio ? ` <span class="reportes-nav__marca">de ${esc((r.autor_nombre || '').split(' ')[0])}</span>` : r.compartido ? ' <span class="reportes-nav__marca">compartido</span>' : ''}</button>`).join('')}
      <button class="reportes-nav__item reportes-nav__crear" data-clave="__nuevo">+ Crear reporte</button>
    </div>` : '';
  nav.innerHTML = mios + CATALOGO.filter(grupoVisible).map((g) => `
    <div class="reportes-nav__grupo">
      <div class="reportes-nav__titulo">${esc(g.grupo)}</div>
      ${g.reportes.filter((r) => !r.disponible || r.disponible()).map((r) => `<button class="reportes-nav__item" data-clave="${esc(r.clave)}">${esc(r.etiqueta)}</button>`).join('')}
    </div>
  `).join('');
  nav.querySelectorAll('[data-clave]').forEach((btn) => btn.addEventListener('click', () => seleccionarReporte(btn.dataset.clave)));
}

async function cargarPersonalizados() {
  if (!window.puntoXReportes) return;
  try { state.personalizados = await window.puntoXReportes.listarPersonalizados(); } catch (e) { state.personalizados = []; }
}

// Abre el editor de reportes personalizados; al guardar, se recarga la lista y se abre el reporte.
function abrirEditorReporte(opciones = {}) {
  mostrarError(null);
  state.reporteActivo = '__editor';
  Pers().abrirEditor({
    ...opciones,
    alTerminar: async (guardado) => {
      await cargarPersonalizados();
      renderNav();
      if (guardado) seleccionarReporte(`pers:${guardado.id}`);
      else if (opciones.volverA) seleccionarReporte(opciones.volverA);
      else { document.getElementById('reportes-contenido').style.display = 'none'; document.getElementById('reportes-vacio').style.display = ''; }
    },
  });
}

async function seleccionarPersonalizado(id) {
  const reporte = state.personalizados.find((r) => r.id === id);
  if (!reporte) return;
  const clave = `pers:${id}`;
  state.reporteActivo = clave;
  mostrarError(null);
  document.querySelectorAll('.reportes-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.clave === clave));
  document.getElementById('reportes-vacio').style.display = 'none';
  document.getElementById('reportes-contenido').style.display = 'block';
  document.getElementById('reporte-titulo').textContent = reporte.nombre;
  const contenedor = document.getElementById('reporte-resultado');
  const fuente = Pers().fuentePorClave(reporte.definicion.fuente);
  if (!fuente) {
    document.getElementById('reporte-filtros').innerHTML = '';
    contenedor.innerHTML = '<div class="empty-state">No tienes acceso a los datos de este reporte.</div>';
    return;
  }
  const filtros = Pers().filtrosIniciales(fuente, reporte.definicion);
  document.getElementById('reporte-filtros').innerHTML = await renderFiltros(filtros);
  const ejecutar = async () => {
    contenedor.innerHTML = '<div class="empty-state">Cargando...</div>';
    try {
      const { campos, filas } = await Pers().cargarFuente(fuente, leerFiltros(filtros));
      const resultado = Pers().calcular(reporte.definicion, campos, filas);
      contenedor.innerHTML = Pers().resultadoHtml(reporte.definicion, resultado);
      const puedeCambiar = reporte.propio || (state.info.usuario.permisos || []).some((p) => p === '*' || p === 'configuracion.gestionar');
      barraHerramientas(contenedor, reporte.nombre ? { etiqueta: reporte.nombre } : reporte, [
        ...(puedeCambiar ? [{ texto: 'Editar', alHacer: () => abrirEditorReporte({ reporte, volverA: clave }) }] : []),
        { texto: 'Duplicar', alHacer: () => abrirEditorReporte({ base: { ...reporte.definicion, nombreSugerido: `${reporte.nombre} (copia)` }, volverA: clave }) },
        ...(puedeCambiar ? [{ texto: 'Eliminar', peligro: true, alHacer: async () => {
          const ok = await window.PuntoXModal.confirmar({ titulo: 'Eliminar reporte', mensaje: `¿Eliminar "${reporte.nombre}"? ${reporte.compartido ? 'Deja de verse para todos los usuarios.' : ''}`, textoConfirmar: 'Eliminar', peligro: true });
          if (!ok) return;
          try {
            await window.puntoXReportes.eliminarPersonalizado({ id: reporte.id });
            await cargarPersonalizados();
            renderNav();
            document.getElementById('reportes-contenido').style.display = 'none';
            document.getElementById('reportes-vacio').style.display = '';
          } catch (err) { mostrarError(err.message); }
        } }] : []),
      ]);
      if (reporte.definicion.descripcion) contenedor.insertAdjacentHTML('afterbegin', `<p class="reporte-descripcion">${esc(reporte.definicion.descripcion)}</p>`);
    } catch (err) {
      contenedor.innerHTML = '';
      mostrarError(err.message);
    }
  };
  const btnAplicar = document.getElementById('btn-aplicar-filtros');
  if (btnAplicar) btnAplicar.addEventListener('click', ejecutar);
  await ejecutar();
}

async function seleccionarReporte(clave) {
  if (Pers()) Pers().cerrarSelector();
  if (clave === '__nuevo') { abrirEditorReporte(); return; }
  if (clave.startsWith('pers:')) { await seleccionarPersonalizado(clave.slice(5)); return; }
  const reporte = reporteBusca(clave);
  if (!reporte) return;
  state.reporteActivo = clave;
  mostrarError(null);

  document.querySelectorAll('.reportes-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.clave === clave));
  document.getElementById('reportes-vacio').style.display = 'none';
  document.getElementById('reportes-contenido').style.display = 'block';
  document.getElementById('reporte-titulo').textContent = reporte.etiqueta;
  document.getElementById('reporte-filtros').innerHTML = await renderFiltros(reporte.filtros);
  document.getElementById('reporte-resultado').innerHTML = '';

  const btnAplicar = document.getElementById('btn-aplicar-filtros');
  if (btnAplicar) btnAplicar.addEventListener('click', () => ejecutarReporte(reporte));

  await ejecutarReporte(reporte);
}

async function ejecutarReporte(reporte) {
  const contenedor = document.getElementById('reporte-resultado');
  contenedor.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    const filtros = leerFiltros(reporte.filtros);
    const datos = await reporte.cargar(filtros);
    if (reporte.personalizado || !Pers()) {
      contenedor.innerHTML = reporte.personalizado ? reporte.render(datos) : renderTabla(reporte.columnas, datos);
      if (reporte.alRenderizar) reporte.alRenderizar(datos, contenedor, filtros);
      agregarExportacion(contenedor, reporte);
      return;
    }
    // Reporte tabular: el usuario elige qué columnas ver (incluidas las que el reporte trae
    // pero no muestra) y en qué orden; se recuerda por usuario.
    const { campos, filas } = Pers().camposDeFuente(reporte, datos);
    let columnas = await Pers().columnasGuardadas(reporte, campos);
    if (state.reporteActivo !== reporte.clave) return;
    const tabla = document.createElement('div');
    const pintar = () => { tabla.innerHTML = Pers().tablaHtml(columnas, filas); };
    contenedor.innerHTML = '';
    contenedor.appendChild(tabla);
    pintar();
    if (reporte.alRenderizar) reporte.alRenderizar(datos, contenedor, filtros);
    const acciones = [{
      texto: 'Columnas', columnas: true,
      alHacer: (btn) => Pers().abrirSelectorColumnas(btn, reporte, campos, columnas, (nuevas) => { columnas = nuevas; pintar(); }),
    }];
    if (Pers().disponible()) {
      acciones.push({
        texto: 'Guardar como reporte propio',
        alHacer: () => abrirEditorReporte({
          base: { fuente: reporte.clave, nombreSugerido: reporte.etiqueta, periodo: 'este_mes', columnas: columnas.map((c) => ({ id: c.id, label: c.label })) },
          volverA: reporte.clave,
        }),
      });
    }
    barraHerramientas(contenedor, reporte, acciones);
    if (filas.length === 0) contenedor.querySelector('.reporte-herramientas [data-columnas]')?.setAttribute('disabled', '');
  } catch (err) {
    contenedor.innerHTML = '';
    mostrarError(err.message);
  }
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('reportes');
  if (!state.info) return; // sin sesión o con la contraseña pendiente: el shell ya redirigió al login
  await cargarPersonalizados();
  renderNav();
}

init();
