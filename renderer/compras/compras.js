const state = {
  info: null,
  tab: 'proveedores',
  productoComparacion: null,
};

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaCorta(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

function redondear(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

const COLOR_ESTADO_ORDEN = { abierto: 'var(--color-info)', recibido_parcial: 'var(--color-warning)', recibido_total: 'var(--color-success)', anulado: 'var(--color-danger)' };
const ETIQUETA_ESTADO_ORDEN = { abierto: 'Abierta', recibido_parcial: 'Recibida parcial', recibido_total: 'Recibida total', anulado: 'Anulada' };

// --- Pestañas ---

const ACCIONES_TAB = {
  proveedores: '<button class="btn btn-primario" id="btn-nuevo-proveedor">+ Nuevo proveedor</button>',
  ordenes: '<button class="btn btn-primario" id="btn-nueva-orden" data-permiso="compras.orden.crear">+ Nueva orden de compra</button>',
  facturas: '<button class="btn btn-primario" id="btn-nueva-factura" data-permiso="compras.factura.crear">+ Nueva factura de compra</button>',
};

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB[tab] || '';
  mostrarError(null);

  if (tab === 'proveedores') { cargarProveedores(); enlazarBtn('btn-nuevo-proveedor', () => abrirFormularioProveedor()); }
  if (tab === 'ordenes') { cargarOrdenes(); enlazarBtn('btn-nueva-orden', () => abrirFormularioOrdenCompra()); }
  if (tab === 'facturas') { cargarFacturas(); enlazarBtn('btn-nueva-factura', () => abrirFormularioFacturaCompra(null)); }
  if (tab === 'comparacion') renderComparacion();
  if (tab === 'porProducto') cargarPorProducto();
}

function enlazarBtn(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Proveedores ---

async function cargarProveedores() {
  const texto = document.getElementById('buscar-proveedores').value.trim();
  const proveedores = await window.puntoXCompras.listarProveedores({ texto });
  document.getElementById('proveedores-vacio').style.display = proveedores.length === 0 ? 'block' : 'none';
  document.getElementById('proveedores-tbody').innerHTML = proveedores.map((p) => `
    <tr>
      <td>${p.nombre}</td><td>${p.rnc || '—'}</td><td>${p.dias_credito}</td>
      <td style="color:${p.saldo_pendiente > 0 ? 'var(--color-warning)' : 'inherit'};">${fmt(p.saldo_pendiente)}</td>
      <td><span class="enlace-accion" data-editar="${p.id}">Editar</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormularioProveedor(el.dataset.editar)));
}

let timeoutBuscarProveedores = null;
document.getElementById('buscar-proveedores').addEventListener('input', () => {
  clearTimeout(timeoutBuscarProveedores);
  timeoutBuscarProveedores = setTimeout(cargarProveedores, 200);
});

async function abrirFormularioProveedor(proveedorId) {
  const esEdicion = Boolean(proveedorId);
  const proveedor = esEdicion ? await window.puntoXCompras.obtenerProveedor({ proveedorId }) : null;

  window.PuntoXModal.abrirModal(esEdicion ? 'Editar proveedor' : 'Nuevo proveedor', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre *</label><input id="p-nombre" value="${proveedor ? proveedor.nombre : ''}" /></div>
      <div class="form-field"><label>RNC</label><input id="p-rnc" value="${proveedor ? proveedor.rnc || '' : ''}" /></div>
      <div class="form-field"><label>Días de crédito</label><input id="p-dias" type="number" step="1" value="${proveedor ? proveedor.dias_credito : 30}" /></div>
      <div class="form-field"><label>Teléfono</label><input id="p-telefono" value="${proveedor ? proveedor.telefono || '' : ''}" /></div>
      <div class="form-field" style="grid-column: span 2;"><label>Email</label><input id="p-email" value="${proveedor ? proveedor.email || '' : ''}" /></div>
      <div class="form-field" style="grid-column: span 2;"><label>Dirección</label><input id="p-direccion" value="${proveedor ? proveedor.direccion || '' : ''}" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="p-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="p-guardar">${esEdicion ? 'Guardar cambios' : 'Crear proveedor'}</button>
    </div>
  `);

  document.getElementById('p-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('p-guardar').addEventListener('click', async () => {
    const payload = {
      nombre: document.getElementById('p-nombre').value, rnc: document.getElementById('p-rnc').value || null,
      diasCredito: parseInt(document.getElementById('p-dias').value, 10) || 0,
      telefono: document.getElementById('p-telefono').value || null, email: document.getElementById('p-email').value || null,
      direccion: document.getElementById('p-direccion').value || null,
    };
    try {
      if (esEdicion) await window.puntoXCompras.guardarProveedor({ proveedorId, payload });
      else await window.puntoXCompras.crearProveedor(payload);
      window.PuntoXModal.cerrarModal();
      cargarProveedores();
    } catch (err) { mostrarError(err.message); }
  });
}

function buscadorProveedor(inputId, resultadosId, onSeleccionar) {
  let timeoutId = null;
  document.getElementById(inputId).addEventListener('input', (e) => {
    clearTimeout(timeoutId);
    const texto = e.target.value.trim();
    const resultados = document.getElementById(resultadosId);
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutId = setTimeout(async () => {
      const encontrados = await window.puntoXCompras.buscarProveedores({ texto, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${p.nombre}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        onSeleccionar(encontrados[Number(el.dataset.i)]);
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });
}

// --- Órdenes de compra ---

async function cargarOrdenes() {
  const ordenes = await window.puntoXCompras.listarOrdenes({});
  document.getElementById('ordenes-vacio').style.display = ordenes.length === 0 ? 'block' : 'none';
  document.getElementById('ordenes-tbody').innerHTML = ordenes.map((o) => `
    <tr>
      <td>${o.numero}</td><td>${o.proveedor_nombre}</td><td>${fechaCorta(o.fecha)}</td>
      <td><span class="barra-progreso"><span class="barra-progreso__relleno" style="width:${o.porcentaje_recibido}%;"></span></span>${o.porcentaje_recibido}%</td>
      <td><span class="pill-estado" style="background:${COLOR_ESTADO_ORDEN[o.estado]};">${ETIQUETA_ESTADO_ORDEN[o.estado]}</span></td>
      <td>
        <span class="enlace-accion" data-ver="${o.id}">Ver</span>
        ${o.estado === 'abierto' || o.estado === 'recibido_parcial' ? ` · <span class="enlace-accion" data-permiso="compras.factura.crear" data-recibir="${o.id}">Recibir mercancía</span>` : ''}
        ${o.estado === 'abierto' ? ` · <span class="enlace-accion" data-permiso="compras.orden.crear" data-anular="${o.id}">Anular</span>` : ''}
      </td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-ver]').forEach((el) => el.addEventListener('click', () => verOrdenCompra(el.dataset.ver)));
  document.querySelectorAll('[data-recibir]').forEach((el) => el.addEventListener('click', () => abrirFormularioFacturaCompra(el.dataset.recibir)));
  document.querySelectorAll('[data-anular]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación:');
    if (!motivo) return;
    try {
      await window.puntoXCompras.anularOrden({ documentoId: el.dataset.anular, motivo, usuarioId: state.info.usuario.id });
      cargarOrdenes();
    } catch (err) { mostrarError(err.message); }
  }));
}

async function verOrdenCompra(ordenId) {
  const orden = await window.puntoXCompras.obtenerOrden({ documentoId: ordenId });
  window.PuntoXModal.abrirModal(`Orden de compra ${orden.numero}`, `
    <div style="margin-bottom:10px;"><strong>${orden.proveedor_nombre}</strong> — ${fechaCorta(orden.fecha)} —
      <span class="pill-estado" style="background:${COLOR_ESTADO_ORDEN[orden.estado]};">${ETIQUETA_ESTADO_ORDEN[orden.estado]}</span>
    </div>
    <table class="data-table">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Recibido</th><th>Pendiente</th><th>Costo unitario</th></tr></thead>
      <tbody>
        ${orden.lineas.map((l) => `
          <tr><td>${l.producto_descripcion}</td><td>${l.cantidad}</td><td>${l.cantidad_recibida}</td><td>${l.pendiente}</td><td>${fmt(l.costo_unitario)}</td></tr>
        `).join('')}
      </tbody>
    </table>
    <div style="text-align:right; font-weight:800; margin-top:10px;">Total: ${fmt(orden.total)}</div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="orden-cerrar">Cerrar</button>
    </div>
  `);
  document.getElementById('orden-cerrar').addEventListener('click', window.PuntoXModal.cerrarModal);
}

async function abrirFormularioOrdenCompra() {
  let proveedorSel = null;
  const lineas = [];
  const contenido = window.PuntoXModal.abrirModal('Nueva orden de compra', `
    <div class="form-field">
      <label>Proveedor *</label>
      <div class="buscador-producto" style="position:relative;">
        <input id="oc-buscar-proveedor" class="input-normal" type="text" placeholder="Buscar proveedor..." autocomplete="off" />
        <div id="oc-resultados-proveedor" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="oc-proveedor-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
    </div>

    <div class="form-seccion">
      <div class="form-seccion__titulo" style="font-weight:700; margin-bottom:10px;">Productos a pedir</div>
      <div class="buscador-producto" style="position:relative; margin-bottom:10px;">
        <input id="oc-buscar-producto" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="oc-resultados-producto" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="oc-lineas"></div>
      <div style="text-align:right; font-weight:800; margin-top:10px;" id="oc-total">Total: RD$ 0.00</div>
    </div>

    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="oc-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="oc-guardar">Crear orden</button>
    </div>
  `);

  buscadorProveedor('oc-buscar-proveedor', 'oc-resultados-proveedor', (p) => {
    proveedorSel = p;
    document.getElementById('oc-proveedor-sel').textContent = `Seleccionado: ${proveedorSel.nombre}`;
  });

  function renderLineas() {
    document.getElementById('oc-lineas').innerHTML = lineas.length === 0
      ? '<div class="empty-state" style="padding:10px;">Agrega productos con el buscador de arriba.</div>'
      : lineas.map((l, i) => `
        <div class="linea-dinamica">
          <span style="flex-grow:1; font-size:13px;">${l.descripcion}</span>
          <input type="number" step="0.01" min="0.01" value="${l.cantidad}" data-i="${i}" data-campo="cantidad" style="width:70px;" placeholder="Cant." />
          <input type="number" step="0.01" min="0" value="${l.costoUnitario}" data-i="${i}" data-campo="costoUnitario" style="width:90px;" placeholder="Costo" />
          <span class="carrito-quitar" data-quitar="${i}">✕</span>
        </div>
      `).join('');
    contenido.querySelectorAll('#oc-lineas input').forEach((inp) => inp.addEventListener('input', (e) => {
      lineas[Number(e.target.dataset.i)][e.target.dataset.campo] = parseFloat(e.target.value) || 0;
      actualizarTotal();
    }));
    contenido.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); renderLineas(); actualizarTotal(); }));
  }

  function actualizarTotal() {
    const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario * (1 + (l.tasaItbisPct || 0)), 0);
    document.getElementById('oc-total').textContent = `Total: ${fmt(total)}`;
  }
  renderLineas();

  let timeoutProducto = null;
  document.getElementById('oc-buscar-producto').addEventListener('input', (e) => {
    clearTimeout(timeoutProducto);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('oc-resultados-producto');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutProducto = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${p.descripcion}</div><div class="buscador-resultados__meta">Costo actual: ${fmt(p.costo_promedio)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        const p = encontrados[Number(el.dataset.i)];
        lineas.push({ productoId: p.id, descripcion: p.descripcion, cantidad: 1, costoUnitario: p.costo_promedio || 0, tasaItbisPct: p.tasa_itbis_pct });
        renderLineas();
        actualizarTotal();
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  document.getElementById('oc-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('oc-guardar').addEventListener('click', async () => {
    if (!proveedorSel) { mostrarError('Selecciona un proveedor'); return; }
    if (lineas.length === 0) { mostrarError('Agrega al menos un producto'); return; }
    try {
      await window.puntoXCompras.crearOrden({
        proveedorId: proveedorSel.id,
        lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario })),
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarOrdenes();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Facturas de compra (recepción). Si ordenId viene dado, se precargan las líneas
// pendientes de esa orden en modo recepción; si no, es una compra suelta. ---

async function cargarFacturas() {
  const facturas = await window.puntoXCompras.listarFacturas({});
  document.getElementById('facturas-vacio').style.display = facturas.length === 0 ? 'block' : 'none';
  document.getElementById('facturas-tbody').innerHTML = facturas.map((f) => `
    <tr>
      <td>${f.numero}</td><td>${f.proveedor_nombre}</td><td>${fechaCorta(f.fecha)}</td><td>${f.condicion_pago}</td>
      <td>${f.documento_referencia_id ? 'Orden de compra' : 'Directa'}</td>
      <td>${fmt(f.total)}</td>
      <td><span class="pill-estado" style="background:${f.estado === 'anulado' ? 'var(--color-danger)' : 'var(--color-success)'};">${f.estado}</span></td>
      <td>${f.estado !== 'anulado' ? `<span class="enlace-accion" data-permiso="compras.factura.anular" data-anular="${f.id}">Anular</span>` : ''}</td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-anular]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación:');
    if (!motivo) return;
    try {
      await window.puntoXCompras.anularFacturaCompra({ documentoId: el.dataset.anular, motivo, usuarioId: state.info.usuario.id });
      cargarFacturas();
    } catch (err) { mostrarError(err.message); }
  }));
}

async function abrirFormularioFacturaCompra(ordenId) {
  const orden = ordenId ? await window.puntoXCompras.obtenerOrden({ documentoId: ordenId }) : null;
  let proveedorSel = orden ? { id: orden.proveedor_id, nombre: orden.proveedor_nombre } : null;
  const lineas = orden
    ? orden.lineas.filter((l) => l.pendiente > 0).map((l) => ({
        productoId: l.producto_id, descripcion: l.producto_descripcion, cantidad: l.pendiente,
        costoUnitario: l.costo_unitario, tasaItbisPct: l.tasa_itbis, ordenDetalleId: l.id, pendienteMax: l.pendiente,
      }))
    : [];

  const contenido = window.PuntoXModal.abrirModal(orden ? `Recibir mercancía — Orden ${orden.numero}` : 'Nueva factura de compra', `
    ${orden ? '' : `
    <div class="form-field">
      <label>Proveedor *</label>
      <div class="buscador-producto" style="position:relative;">
        <input id="fc-buscar-proveedor" class="input-normal" type="text" placeholder="Buscar proveedor..." autocomplete="off" />
        <div id="fc-resultados-proveedor" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="fc-proveedor-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
    </div>`}
    ${orden ? `<div style="margin-bottom:10px; font-weight:600;">Proveedor: ${orden.proveedor_nombre}</div>` : ''}
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>NCF del proveedor</label><input id="fc-ncf" class="input-normal" /></div>
      <div class="form-field"><label>Condición de pago</label>
        <select id="fc-condicion" class="input-normal"><option value="credito">Crédito</option><option value="contado">Contado</option></select>
      </div>
    </div>

    <div class="form-seccion">
      <div class="form-seccion__titulo" style="font-weight:700; margin-bottom:10px;">Productos ${orden ? 'pendientes de recibir' : ''}</div>
      ${orden ? '' : `
      <div class="buscador-producto" style="position:relative; margin-bottom:10px;">
        <input id="fc-buscar-producto" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="fc-resultados-producto" class="buscador-resultados" style="display:none;"></div>
      </div>`}
      <div id="fc-lineas"></div>
      <div style="text-align:right; font-weight:800; margin-top:10px;" id="fc-total">Total: RD$ 0.00</div>
    </div>

    <div id="fc-pago-contado" class="form-seccion" style="display:none;">
      <div class="form-field"><label>Forma de pago</label>
        <select id="fc-forma-pago" class="input-normal"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option></select>
      </div>
    </div>

    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="fc-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="fc-guardar">${orden ? 'Registrar recepción' : 'Registrar factura'}</button>
    </div>
  `);

  document.getElementById('fc-condicion').addEventListener('change', (e) => {
    document.getElementById('fc-pago-contado').style.display = e.target.value === 'contado' ? 'block' : 'none';
  });

  if (!orden) {
    buscadorProveedor('fc-buscar-proveedor', 'fc-resultados-proveedor', (p) => {
      proveedorSel = p;
      document.getElementById('fc-proveedor-sel').textContent = `Seleccionado: ${proveedorSel.nombre}`;
    });
  }

  function renderLineas() {
    document.getElementById('fc-lineas').innerHTML = lineas.length === 0
      ? '<div class="empty-state" style="padding:10px;">Agrega productos con el buscador de arriba.</div>'
      : lineas.map((l, i) => `
        <div class="linea-dinamica">
          <span style="flex-grow:1; font-size:13px;">${l.descripcion}${l.pendienteMax ? ` (pendiente: ${l.pendienteMax})` : ''}</span>
          <input type="number" step="0.01" min="0.01" ${l.pendienteMax ? `max="${l.pendienteMax}"` : ''} value="${l.cantidad}" data-i="${i}" data-campo="cantidad" style="width:70px;" placeholder="Cant." />
          <input type="number" step="0.01" min="0" value="${l.costoUnitario}" data-i="${i}" data-campo="costoUnitario" style="width:90px;" placeholder="Costo" />
          ${orden ? '' : `<span class="carrito-quitar" data-quitar="${i}">✕</span>`}
        </div>
      `).join('');
    contenido.querySelectorAll('#fc-lineas input').forEach((inp) => inp.addEventListener('input', (e) => {
      const linea = lineas[Number(e.target.dataset.i)];
      let valor = parseFloat(e.target.value) || 0;
      if (e.target.dataset.campo === 'cantidad' && linea.pendienteMax && valor > linea.pendienteMax) {
        valor = linea.pendienteMax;
        e.target.value = valor;
      }
      linea[e.target.dataset.campo] = valor;
      actualizarTotal();
    }));
    contenido.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); renderLineas(); actualizarTotal(); }));
  }

  function actualizarTotal() {
    const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario * (1 + (l.tasaItbisPct || 0)), 0);
    document.getElementById('fc-total').textContent = `Total: ${fmt(total)}`;
  }
  renderLineas();
  actualizarTotal();

  if (!orden) {
    let timeoutProducto = null;
    document.getElementById('fc-buscar-producto').addEventListener('input', (e) => {
      clearTimeout(timeoutProducto);
      const texto = e.target.value.trim();
      const resultados = document.getElementById('fc-resultados-producto');
      if (!texto) { resultados.style.display = 'none'; return; }
      timeoutProducto = setTimeout(async () => {
        const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 10 });
        resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${p.descripcion}</div><div class="buscador-resultados__meta">Costo actual: ${fmt(p.costo_promedio)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
        resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
          const p = encontrados[Number(el.dataset.i)];
          lineas.push({ productoId: p.id, descripcion: p.descripcion, cantidad: 1, costoUnitario: p.costo_promedio || 0, tasaItbisPct: p.tasa_itbis_pct });
          renderLineas();
          actualizarTotal();
          resultados.style.display = 'none';
          e.target.value = '';
        }));
        resultados.style.display = 'block';
      }, 200);
    });
  }

  document.getElementById('fc-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('fc-guardar').addEventListener('click', async () => {
    if (!proveedorSel) { mostrarError('Selecciona un proveedor'); return; }
    if (lineas.length === 0) { mostrarError('Agrega al menos un producto'); return; }
    const condicion = document.getElementById('fc-condicion').value;
    const total = redondear(lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario * (1 + (l.tasaItbisPct || 0)), 0));
    const pagos = condicion === 'credito'
      ? [{ formaPago: 'credito', monto: total }]
      : [{ formaPago: document.getElementById('fc-forma-pago').value, monto: total }];

    try {
      await window.puntoXCompras.crearFacturaCompra({
        proveedorId: proveedorSel.id, almacenId: state.info.almacenId, sucursalId: state.info.sucursalId,
        ncfProveedor: document.getElementById('fc-ncf').value || null, condicionPago: condicion,
        ordenCompraId: ordenId || null,
        lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario, ordenDetalleId: l.ordenDetalleId || null })),
        pagos, cajaId: state.info.cajaId, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarFacturas();
      if (state.tab === 'ordenes') cargarOrdenes();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Comparación de costos ---

function renderComparacion() {
  document.getElementById('cmp-producto-sel').textContent = '';
  document.getElementById('comparacion-tbody').innerHTML = '';
  document.getElementById('comparacion-vacio').style.display = 'block';
  document.getElementById('comparacion-vacio').textContent = 'Busca un producto para ver el historial de costos por proveedor.';

  let timeoutProducto = null;
  document.getElementById('cmp-buscar-producto').addEventListener('input', (e) => {
    clearTimeout(timeoutProducto);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('cmp-resultados-producto');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutProducto = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${p.descripcion}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
        const p = encontrados[Number(el.dataset.i)];
        document.getElementById('cmp-producto-sel').textContent = p.descripcion;
        resultados.style.display = 'none';
        e.target.value = '';
        const filas = await window.puntoXCompras.comparacionMejorCosto({ productoId: p.id });
        document.getElementById('comparacion-vacio').style.display = filas.length === 0 ? 'block' : 'none';
        document.getElementById('comparacion-vacio').textContent = 'Este producto no tiene compras registradas todavía.';
        document.getElementById('comparacion-tbody').innerHTML = filas.map((f, i) => `
          <tr style="${i === 0 ? 'font-weight:700;' : ''}">
            <td>${fechaCorta(f.fecha)}</td><td>${f.numero}</td><td>${f.proveedor_nombre}</td>
            <td style="color:${i === 0 ? 'var(--color-success)' : 'inherit'};">${fmt(f.costo_unitario)}</td>
            <td>${f.cantidad}</td>
          </tr>
        `).join('');
      }));
      resultados.style.display = 'block';
    }, 200);
  });
}

// --- Compras por producto ---

async function cargarPorProducto() {
  const desde = document.getElementById('pp-desde').value || null;
  const hasta = document.getElementById('pp-hasta').value || null;
  const filas = await window.puntoXCompras.comprasPorProducto({ desde, hasta });
  document.getElementById('porProducto-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('porProducto-tbody').innerHTML = filas.map((f) => `
    <tr><td>${f.codigo_interno}</td><td>${f.descripcion}</td><td>${f.cantidad_total}</td><td>${fmt(f.costo_total)}</td></tr>
  `).join('');
}

document.getElementById('pp-desde').addEventListener('change', cargarPorProducto);
document.getElementById('pp-hasta').addEventListener('change', cargarPorProducto);

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('compras');
  cambiarTab('proveedores');
}

init();
