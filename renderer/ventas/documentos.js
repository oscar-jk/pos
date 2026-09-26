const state = { info: null, tab: 'cotizaciones', conduces: [], seleccionados: new Set() };

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fechaCorta(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
function fechaPura(aaaammdd) {
  return aaaammdd ? aaaammdd.split('-').reverse().join('/') : '—';
}
function pill(texto, color) {
  return `<span class="pill-estado" style="background:${color};">${texto}</span>`;
}
function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}
async function ejecutar(fn) {
  mostrarError(null);
  try { return await fn(); } catch (err) { mostrarError(err.message); return null; }
}
function imprimir(documentoId) {
  return ejecutar(() => window.puntoXImpresion.imprimirFactura({ documentoId, formato: 'factura' }));
}

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  mostrarError(null);
  if (tab === 'cotizaciones') cargarCotizaciones(); else cargarConduces();
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Cotizaciones ---

function estadoCotizacion(c) {
  if (c.estado === 'anulado') return pill('Anulada', 'var(--color-danger)');
  if (c.estado === 'facturado') return pill(`Facturada · ${esc(c.factura_numero)}`, 'var(--color-success)');
  if (c.vencida) return pill('Vencida', 'var(--color-text-faint)');
  return pill('Vigente', 'var(--color-info)');
}

async function cargarCotizaciones() {
  const lista = await ejecutar(() => window.puntoXVentas.listarDocumentos({ tipo: 'cotizacion' }));
  if (!lista) return;
  document.getElementById('cotizaciones-vacio').style.display = lista.length === 0 ? 'block' : 'none';
  document.getElementById('cotizaciones-tbody').innerHTML = lista.map((c) => {
    const vigente = c.estado === 'abierto' && !c.vencida;
    return `
      <tr>
        <td>${c.numero}</td><td>${esc(c.cliente_nombre)}</td><td>${fechaCorta(c.fecha)}</td><td>${fechaPura(c.valida_hasta)}</td>
        <td style="text-align:right;">${fmt(c.total)}</td><td>${estadoCotizacion(c)}</td>
        <td style="white-space:nowrap;">
          ${window.puntoXImpresion ? `<span class="enlace-accion" data-imprimir="${c.id}">Imprimir</span>` : ''}
          ${vigente ? ` · <a class="enlace-accion" data-permiso="ventas.factura.crear" href="./index.html?cotizacion=${encodeURIComponent(c.id)}">Facturar</a>` : ''}
          ${c.estado === 'abierto' ? ` · <span class="enlace-accion" data-permiso="ventas.cotizacion.crear" data-anular-cotizacion="${c.id}" style="color:var(--color-danger);">Anular</span>` : ''}
        </td>
      </tr>`;
  }).join('');
  document.querySelectorAll('#cotizaciones-tbody [data-imprimir]').forEach((el) => el.addEventListener('click', () => imprimir(el.dataset.imprimir)));
  document.querySelectorAll('[data-anular-cotizacion]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación:');
    if (!motivo) return;
    const r = await ejecutar(() => window.puntoXVentas.anularCotizacion({ documentoId: el.dataset.anularCotizacion, motivo, usuarioId: state.info.usuario.id }));
    if (r) cargarCotizaciones();
  }));
}

// --- Conduces ---

function estadoConduce(c) {
  if (c.estado === 'anulado') return pill('Anulado', 'var(--color-danger)');
  if (c.estado === 'facturado') return pill(`Facturado · ${esc(c.factura_numero)}`, 'var(--color-success)');
  return pill('Pendiente de facturar', 'var(--color-warning)');
}

async function cargarConduces() {
  const lista = await ejecutar(() => window.puntoXVentas.listarDocumentos({ tipo: 'conduce' }));
  if (!lista) return;
  state.conduces = lista;
  state.seleccionados = new Set([...state.seleccionados].filter((id) => lista.some((c) => c.id === id && c.estado === 'entregado')));
  document.getElementById('conduces-vacio').style.display = lista.length === 0 ? 'block' : 'none';
  document.getElementById('conduces-tbody').innerHTML = lista.map((c) => `
    <tr>
      <td>${c.estado === 'entregado' ? `<input type="checkbox" data-seleccionar="${c.id}" ${state.seleccionados.has(c.id) ? 'checked' : ''} />` : ''}</td>
      <td>${c.numero}</td><td>${esc(c.cliente_nombre)}</td><td>${fechaCorta(c.fecha)}</td><td>${esc(c.concepto) || '—'}</td>
      <td style="text-align:right;">${fmt(c.total)}</td><td>${estadoConduce(c)}</td>
      <td style="white-space:nowrap;">
        ${window.puntoXImpresion ? `<span class="enlace-accion" data-imprimir="${c.id}">Imprimir</span>` : ''}
        ${c.estado === 'entregado' ? ` · <span class="enlace-accion" data-permiso="ventas.factura.anular" data-anular-conduce="${c.id}" style="color:var(--color-danger);">Anular</span>` : ''}
      </td>
    </tr>`).join('');
  document.querySelectorAll('#conduces-tbody [data-imprimir]').forEach((el) => el.addEventListener('click', () => imprimir(el.dataset.imprimir)));
  document.querySelectorAll('[data-seleccionar]').forEach((chk) => chk.addEventListener('change', () => {
    if (chk.checked) state.seleccionados.add(chk.dataset.seleccionar); else state.seleccionados.delete(chk.dataset.seleccionar);
    actualizarBotonFacturar();
  }));
  document.querySelectorAll('[data-anular-conduce]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación (la mercancía vuelve al inventario):');
    if (!motivo) return;
    const r = await ejecutar(() => window.puntoXVentas.anularConduce({ documentoId: el.dataset.anularConduce, motivo, usuarioId: state.info.usuario.id }));
    if (r) cargarConduces();
  }));
  actualizarBotonFacturar();
}

function actualizarBotonFacturar() {
  const btn = document.getElementById('btn-facturar-conduces');
  const elegidos = state.conduces.filter((c) => state.seleccionados.has(c.id));
  const clientes = new Set(elegidos.map((c) => c.cliente_id));
  btn.disabled = elegidos.length === 0 || clientes.size > 1;
  btn.title = clientes.size > 1 ? 'Solo se pueden facturar juntos conduces del mismo cliente' : '';
  btn.textContent = elegidos.length > 1 ? `Facturar ${elegidos.length} conduces` : 'Facturar seleccionados';
  if (clientes.size > 1) mostrarError('Los conduces marcados son de clientes distintos: solo se facturan juntos los de un mismo cliente.');
  else if (document.getElementById('mensaje-error').textContent.startsWith('Los conduces marcados')) mostrarError(null);
}

document.getElementById('btn-facturar-conduces').addEventListener('click', () => {
  window.location.href = `./index.html?conduces=${[...state.seleccionados].map(encodeURIComponent).join(',')}`;
});

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('ventas');
  if (!state.info) return;
  if (!window.puntoXVentas.listarDocumentos) {
    document.querySelector('.tabs').remove();
    document.querySelectorAll('.tab-panel').forEach((p) => p.remove());
    document.getElementById('acciones-pagina').remove();
    mostrarError('Las cotizaciones y los conduces están disponibles en la aplicación de escritorio.');
    return;
  }
  cambiarTab(window.location.hash === '#conduces' ? 'conduces' : 'cotizaciones');
}

init();
