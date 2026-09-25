const state = { info: null, cuentas: [], seleccionadaId: null };

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

function tiempoAbierta(iso) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
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

// --- Lista de cuentas ---

async function cargarCuentas() {
  const cuentas = await ejecutar(() => window.puntoXCuentas.listar({}));
  if (!cuentas) return;
  state.cuentas = cuentas;
  if (state.seleccionadaId && !cuentas.some((c) => c.id === state.seleccionadaId)) state.seleccionadaId = null;
  if (!state.seleccionadaId && cuentas.length > 0) state.seleccionadaId = cuentas[0].id;
  render();
}

function render() {
  document.getElementById('contenido').innerHTML = `
    <div class="cuentas-layout">
      <div>
        ${state.cuentas.length === 0
          ? '<div class="empty-state empty-state--panel">No hay cuentas abiertas. Abre una con "+ Abrir cuenta".</div>'
          : `<div class="cuentas-grid">${state.cuentas.map((c) => `
            <button type="button" class="cuenta-card ${c.id === state.seleccionadaId ? 'is-active' : ''}" data-cuenta="${c.id}">
              <div class="cuenta-card__nombre">${esc(c.nombre)}</div>
              <div class="cuenta-card__meta">${c.cantidad_productos} producto(s) · ${tiempoAbierta(c.created_at)}</div>
              <div class="cuenta-card__total">${fmt(c.total)}</div>
            </button>`).join('')}</div>`}
      </div>
      <div id="cuenta-detalle"></div>
    </div>
  `;
  document.querySelectorAll('[data-cuenta]').forEach((el) => el.addEventListener('click', () => {
    state.seleccionadaId = el.dataset.cuenta;
    render();
  }));
  renderDetalle();
}

// --- Detalle de la cuenta seleccionada ---

function renderDetalle() {
  const contenedor = document.getElementById('cuenta-detalle');
  const c = state.cuentas.find((x) => x.id === state.seleccionadaId);
  if (!c) { contenedor.innerHTML = ''; return; }

  contenedor.innerHTML = `
    <div class="cuenta-detalle">
      <div class="cuenta-detalle__encabezado">
        <div>
          <div class="cuenta-detalle__titulo">${esc(c.nombre)}</div>
          <div class="cuenta-detalle__sub">Cuenta ${c.numero} · abierta a las ${hora(c.created_at)} por ${esc(c.usuario_nombre)} · ${tiempoAbierta(c.created_at)}</div>
        </div>
      </div>

      <div class="cuenta-agregar" data-permiso="ventas.cuenta_abierta.gestionar">
        <div class="buscador-producto">
          <input id="cuenta-buscar" type="text" placeholder="Agregar producto: código o descripción..." autocomplete="off" class="input-normal" />
          <div id="cuenta-resultados" class="buscador-resultados" style="display:none;"></div>
        </div>
        <input id="cuenta-cantidad" type="number" min="0.01" step="0.01" value="1" class="input-normal" title="Cantidad" />
        <input id="cuenta-nota" type="text" placeholder="Nota (opcional)" class="input-normal" />
      </div>

      ${c.lineas.length === 0 ? '<div class="empty-state">La cuenta todavía no tiene productos.</div>' : `
      <table class="carrito-tabla">
        <thead><tr><th>Producto</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Precio</th><th style="text-align:right;">Subtotal</th><th>Agregado</th><th></th></tr></thead>
        <tbody>
          ${c.lineas.map((l) => `
            <tr>
              <td>${esc(l.producto.descripcion)}${l.nota ? `<div style="font-size:11px; color:var(--color-text-muted);">${esc(l.nota)}</div>` : ''}</td>
              <td style="text-align:center;">${l.cantidad}</td>
              <td style="text-align:right;">${fmt(l.precio_unitario)}</td>
              <td style="text-align:right; font-weight:700;">${fmt(l.subtotal)}</td>
              <td style="font-size:11px; color:var(--color-text-muted);">${hora(l.created_at)} · ${esc(l.usuario_nombre)}</td>
              <td class="carrito-quitar" data-permiso="ventas.cuenta_abierta.anular" data-quitar="${l.id}" title="Quitar">✕</td>
            </tr>`).join('')}
        </tbody>
      </table>`}

      <div class="cuenta-total"><span>Total</span><span>${fmt(c.total)}</span></div>

      <div class="cuenta-acciones">
        <button class="btn btn-primario" id="cuenta-cobrar" data-permiso="ventas.factura.crear" ${c.lineas.length === 0 ? 'disabled' : ''}>Cobrar ${fmt(c.total)}</button>
        ${window.puntoXImpresion ? `<button class="btn btn-secundario" id="cuenta-precuenta" ${c.lineas.length === 0 ? 'disabled' : ''}>Imprimir precuenta</button>` : ''}
        <button class="btn btn-peligro" id="cuenta-anular" data-permiso="ventas.cuenta_abierta.anular">Anular cuenta</button>
      </div>
    </div>
  `;

  enlazarBuscador(c);
  contenedor.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('¿Por qué se quita este producto de la cuenta?');
    if (!motivo) return;
    const r = await ejecutar(() => window.puntoXCuentas.quitarLinea({ lineaId: el.dataset.quitar, motivo, usuarioId: state.info.usuario.id }));
    if (r) cargarCuentas();
  }));
  document.getElementById('cuenta-cobrar').addEventListener('click', () => {
    window.location.href = `./index.html?cuenta=${encodeURIComponent(c.id)}`;
  });
  const precuenta = document.getElementById('cuenta-precuenta');
  if (precuenta) precuenta.addEventListener('click', () => ejecutar(() => window.puntoXImpresion.imprimirPrecuenta({ cuentaId: c.id })));
  document.getElementById('cuenta-anular').addEventListener('click', async () => {
    const motivo = prompt(`¿Por qué se anula la cuenta "${c.nombre}"? (lo consumido no se cobrará)`);
    if (!motivo) return;
    const r = await ejecutar(() => window.puntoXCuentas.anular({ cuentaId: c.id, motivo, usuarioId: state.info.usuario.id }));
    if (r) { state.seleccionadaId = null; cargarCuentas(); }
  });
}

function enlazarBuscador(cuenta) {
  const input = document.getElementById('cuenta-buscar');
  const resultados = document.getElementById('cuenta-resultados');
  let timeoutId = null;
  input.addEventListener('input', () => {
    clearTimeout(timeoutId);
    const texto = input.value.trim();
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutId = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: cuenta.almacen_id, limite: 12 });
      resultados.innerHTML = encontrados.map((p, i) => `
        <div class="buscador-resultados__item" data-i="${i}">
          <div><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)} · Disp: ${p.cantidad_disponible}</div></div>
          <div class="buscador-resultados__precio">${fmt(p.precio_detalle)}</div>
        </div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
        const producto = encontrados[Number(el.dataset.i)];
        resultados.style.display = 'none';
        const cantidad = parseFloat(document.getElementById('cuenta-cantidad').value) || 1;
        const nota = document.getElementById('cuenta-nota').value;
        const r = await ejecutar(() => window.puntoXCuentas.agregarProducto({ cuentaId: cuenta.id, productoId: producto.id, cantidad, nota, usuarioId: state.info.usuario.id }));
        if (r) {
          await cargarCuentas();
          const nuevo = document.getElementById('cuenta-buscar');
          if (nuevo) nuevo.focus();
        }
      }));
      resultados.style.display = 'block';
    }, 200);
  });
}

function abrirFormularioCuenta() {
  window.PuntoXModal.abrirModal('Abrir cuenta', `
    <div class="form-field"><label>Mesa o nombre *</label><input id="ac-nombre" class="input-normal" placeholder="Ej: Mesa 4, Barra, Juan" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="ac-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="ac-guardar">Abrir cuenta</button>
    </div>
  `);
  const input = document.getElementById('ac-nombre');
  input.focus();
  const guardar = async () => {
    const cuenta = await ejecutar(() => window.puntoXCuentas.abrir({
      nombre: input.value, sucursalId: state.info.sucursalId, almacenId: state.info.almacenId, usuarioId: state.info.usuario.id,
    }));
    window.PuntoXModal.cerrarModal();
    if (cuenta) { state.seleccionadaId = cuenta.id; cargarCuentas(); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
  document.getElementById('ac-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('ac-guardar').addEventListener('click', guardar);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.buscador-producto')) {
    const r = document.getElementById('cuenta-resultados');
    if (r) r.style.display = 'none';
  }
});

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('cuentas_abiertas');
  if (!state.info) return;
  if (!window.puntoXCuentas || !state.info.modulos.cuentas_abiertas) {
    document.getElementById('contenido').innerHTML =
      '<div class="empty-state empty-state--panel">El módulo de cuentas abiertas no está activado. Un administrador puede activarlo en Configuración → Módulos.</div>';
    return;
  }
  document.getElementById('acciones-pagina').innerHTML = '<button class="btn btn-primario" id="btn-abrir-cuenta" data-permiso="ventas.cuenta_abierta.gestionar">+ Abrir cuenta</button>';
  document.getElementById('btn-abrir-cuenta').addEventListener('click', abrirFormularioCuenta);
  const params = new URLSearchParams(window.location.search);
  if (params.get('cuenta')) state.seleccionadaId = params.get('cuenta');
  cargarCuentas();
}

init();
