const state = { info: null, categorias: [], promociones: [] };

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fechaSimple(aaaammdd) {
  return aaaammdd ? aaaammdd.split('-').reverse().join('/') : '—';
}
function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

const ESTADOS = {
  vigente: ['Vigente', 'var(--color-success)'],
  programada: ['Programada', 'var(--color-info)'],
  vencida: ['Vencida', 'var(--color-text-faint)'],
  desactivada: ['Desactivada', 'var(--color-danger)'],
};

function textoDescuento(p) {
  return p.tipo_descuento === 'porcentaje' ? `${p.valor}%` : `${fmt(p.valor)} por unidad`;
}

async function cargarPromociones() {
  const lista = await ejecutar(() => window.puntoXVentas.listarPromociones());
  if (!lista) return;
  state.promociones = lista;
  document.getElementById('promociones-vacio').style.display = lista.length === 0 ? 'block' : 'none';
  document.getElementById('promociones-tbody').innerHTML = lista.map((p) => {
    const [etiqueta, color] = ESTADOS[p.estado];
    const aplicaA = p.producto_id ? `${esc(p.producto_descripcion)} <span style="color:var(--color-text-muted);">(${esc(p.codigo_interno)})</span>` : `Categoría: ${esc(p.categoria_nombre)}`;
    return `
      <tr>
        <td style="font-weight:700;">${esc(p.nombre || '—')}</td><td>${aplicaA}</td><td>${textoDescuento(p)}</td>
        <td>${fechaSimple(p.fecha_inicio)}</td><td>${fechaSimple(p.fecha_fin)}</td>
        <td><span class="pill-estado" style="background:${color};">${etiqueta}</span></td>
        <td style="white-space:nowrap;">
          ${p.activo ? `<span class="enlace-accion" data-editar="${p.id}">Editar</span> · <span class="enlace-accion" data-desactivar="${p.id}" style="color:var(--color-danger);">Desactivar</span>` : ''}
        </td>
      </tr>`;
  }).join('');
  document.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormulario(state.promociones.find((p) => p.id === el.dataset.editar))));
  document.querySelectorAll('[data-desactivar]').forEach((el) => el.addEventListener('click', async () => {
    const promo = state.promociones.find((p) => p.id === el.dataset.desactivar);
    if (!confirm(`¿Desactivar la promoción "${promo.nombre}"? Deja de aplicarse desde ya.`)) return;
    const r = await ejecutar(() => window.puntoXVentas.desactivarPromocion({ promocionId: promo.id, usuarioId: state.info.usuario.id }));
    if (r !== null) cargarPromociones();
  }));
}

function abrirFormulario(promo) {
  let productoSel = promo && promo.producto_id ? { id: promo.producto_id, descripcion: promo.producto_descripcion, precio_detalle: promo.precio_detalle } : null;
  const hoy = hoyLocal();
  const contenido = window.PuntoXModal.abrirModal(promo ? 'Editar promoción' : 'Nueva promoción', `
    <div class="form-field"><label>Nombre *</label><input id="pr-nombre" value="${esc(promo ? promo.nombre : '')}" placeholder="Ej: Semana del yogurt" /></div>
    <div class="form-field" style="margin-top:10px;">
      <label>Aplica a *</label>
      <div class="aplica-a">
        <label><input type="radio" name="pr-aplica" value="producto" ${!promo || promo.producto_id ? 'checked' : ''} /> Un producto</label>
        <label><input type="radio" name="pr-aplica" value="categoria" ${promo && promo.categoria_id ? 'checked' : ''} /> Una categoría</label>
      </div>
      <div id="pr-campo-producto" class="buscador-producto" style="position:relative;">
        <input id="pr-buscar" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="pr-resultados" class="buscador-resultados" style="display:none;"></div>
        <div id="pr-producto-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
      </div>
      <select id="pr-categoria" class="input-normal" style="display:none;">
        ${state.categorias.map((c) => `<option value="${c.id}" ${promo && promo.categoria_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
      </select>
    </div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>Tipo de descuento</label>
        <select id="pr-tipo">
          <option value="porcentaje" ${!promo || promo.tipo_descuento === 'porcentaje' ? 'selected' : ''}>Porcentaje (%)</option>
          <option value="monto" ${promo && promo.tipo_descuento === 'monto' ? 'selected' : ''}>Monto por unidad (RD$)</option>
        </select>
      </div>
      <div class="form-field"><label>Descuento *</label><input id="pr-valor" type="number" min="0" step="0.01" value="${promo ? promo.valor : ''}" /></div>
      <div class="form-field"><label>Desde *</label><input id="pr-desde" type="date" value="${promo ? promo.fecha_inicio : hoy}" /></div>
      <div class="form-field"><label>Hasta *</label><input id="pr-hasta" type="date" value="${promo ? promo.fecha_fin : ''}" /></div>
    </div>
    <div style="font-size:12px; color:var(--color-text-muted); margin-top:8px;">Si el cajero pone un descuento mayor en la línea, se usa el mayor; no se suman.</div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="pr-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="pr-guardar">Guardar promoción</button>
    </div>
  `);

  const mostrarProducto = () => {
    document.getElementById('pr-producto-sel').textContent = productoSel ? `Producto: ${productoSel.descripcion} (precio ${fmt(productoSel.precio_detalle)})` : '';
  };
  const actualizarAplica = () => {
    const categoria = contenido.querySelector('input[name="pr-aplica"]:checked').value === 'categoria';
    document.getElementById('pr-campo-producto').style.display = categoria ? 'none' : 'block';
    document.getElementById('pr-categoria').style.display = categoria ? 'block' : 'none';
  };
  contenido.querySelectorAll('input[name="pr-aplica"]').forEach((r) => r.addEventListener('change', actualizarAplica));
  actualizarAplica();
  mostrarProducto();

  let timeoutBuscar = null;
  document.getElementById('pr-buscar').addEventListener('input', (e) => {
    clearTimeout(timeoutBuscar);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('pr-resultados');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutBuscar = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)} · ${fmt(p.precio_detalle)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        productoSel = encontrados[Number(el.dataset.i)];
        mostrarProducto();
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  document.getElementById('pr-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('pr-guardar').addEventListener('click', async () => {
    const categoria = contenido.querySelector('input[name="pr-aplica"]:checked').value === 'categoria';
    const r = await ejecutar(() => window.puntoXVentas.guardarPromocion({
      promocionId: promo ? promo.id : null,
      nombre: document.getElementById('pr-nombre').value,
      productoId: categoria ? null : (productoSel && productoSel.id),
      categoriaId: categoria ? document.getElementById('pr-categoria').value : null,
      tipoDescuento: document.getElementById('pr-tipo').value,
      valor: parseFloat(document.getElementById('pr-valor').value) || 0,
      fechaInicio: document.getElementById('pr-desde').value,
      fechaFin: document.getElementById('pr-hasta').value,
      usuarioId: state.info.usuario.id,
    }));
    if (r) { window.PuntoXModal.cerrarModal(); cargarPromociones(); }
  });
}

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('ventas');
  if (!state.info) return;
  if (!window.puntoXVentas.listarPromociones) {
    document.getElementById('panel-promociones').remove();
    document.getElementById('acciones-pagina').remove();
    mostrarError('Las promociones están disponibles en la aplicación de escritorio.');
    return;
  }
  state.categorias = await window.puntoXInventario.listarCategorias();
  document.getElementById('btn-nueva-promocion').addEventListener('click', () => abrirFormulario(null));
  cargarPromociones();
}

init();
