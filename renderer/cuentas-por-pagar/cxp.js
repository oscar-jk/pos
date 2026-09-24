const state = {
  info: null,
  tab: 'proveedores',
  proveedorPago: null,
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

// --- Pestañas ---

const ACCIONES_TAB = {
  proveedores: '<button class="btn btn-primario" id="btn-nuevo-proveedor">+ Nuevo proveedor</button>',
  facturas: '<button class="btn btn-primario" id="btn-nueva-factura" data-permiso="compras.factura.crear">+ Nueva factura de compra</button>',
};

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB[tab] || '';
  mostrarError(null);

  if (tab === 'proveedores') { cargarProveedores(); enlazarBtn('btn-nuevo-proveedor', () => abrirFormularioProveedor()); }
  if (tab === 'facturas') { cargarFacturas(); enlazarBtn('btn-nueva-factura', () => abrirFormularioFacturaCompra()); }
  if (tab === 'pagar') cargarPagos();
  if (tab === 'antiguedad') cargarAntiguedad();
  if (tab === 'proximas') cargarProximas();
  if (tab === 'cheques') cargarCheques();
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

// --- Facturas de compra ---

async function cargarFacturas() {
  const facturas = await window.puntoXCompras.listarFacturas({});
  document.getElementById('facturas-vacio').style.display = facturas.length === 0 ? 'block' : 'none';
  document.getElementById('facturas-tbody').innerHTML = facturas.map((f) => `
    <tr>
      <td>${f.numero}</td><td>${f.proveedor_nombre}</td><td>${fechaCorta(f.fecha)}</td><td>${f.condicion_pago}</td><td>${fmt(f.total)}</td>
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

async function abrirFormularioFacturaCompra() {
  let proveedorSel = null;
  const lineas = [];
  const contenido = window.PuntoXModal.abrirModal('Nueva factura de compra', `
    <div class="form-field">
      <label>Proveedor *</label>
      <div class="buscador-producto" style="position:relative;">
        <input id="fc-buscar-proveedor" class="input-normal" type="text" placeholder="Buscar proveedor..." autocomplete="off" />
        <div id="fc-resultados-proveedor" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="fc-proveedor-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
    </div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>NCF del proveedor</label><input id="fc-ncf" class="input-normal" /></div>
      <div class="form-field"><label>Condición de pago</label>
        <select id="fc-condicion" class="input-normal"><option value="credito">Crédito</option><option value="contado">Contado</option></select>
      </div>
    </div>

    <div class="form-seccion">
      <div class="form-seccion__titulo" style="font-weight:700; margin-bottom:10px;">Productos</div>
      <div class="buscador-producto" style="position:relative; margin-bottom:10px;">
        <input id="fc-buscar-producto" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="fc-resultados-producto" class="buscador-resultados" style="display:none;"></div>
      </div>
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
      <button type="button" class="btn btn-primario" id="fc-guardar">Registrar factura</button>
    </div>
  `);

  document.getElementById('fc-condicion').addEventListener('change', (e) => {
    document.getElementById('fc-pago-contado').style.display = e.target.value === 'contado' ? 'block' : 'none';
  });

  let timeoutProveedor = null;
  document.getElementById('fc-buscar-proveedor').addEventListener('input', (e) => {
    clearTimeout(timeoutProveedor);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('fc-resultados-proveedor');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutProveedor = setTimeout(async () => {
      const encontrados = await window.puntoXCompras.buscarProveedores({ texto, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${p.nombre}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        proveedorSel = encontrados[Number(el.dataset.i)];
        document.getElementById('fc-proveedor-sel').textContent = `Seleccionado: ${proveedorSel.nombre}`;
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  function renderLineas() {
    document.getElementById('fc-lineas').innerHTML = lineas.length === 0
      ? '<div class="empty-state" style="padding:10px;">Agrega productos con el buscador de arriba.</div>'
      : lineas.map((l, i) => `
        <div class="linea-dinamica">
          <span style="flex-grow:1; font-size:13px;">${l.descripcion}</span>
          <input type="number" step="0.01" min="0.01" value="${l.cantidad}" data-i="${i}" data-campo="cantidad" style="width:70px;" placeholder="Cant." />
          <input type="number" step="0.01" min="0" value="${l.costoUnitario}" data-i="${i}" data-campo="costoUnitario" style="width:90px;" placeholder="Costo" />
          <span class="carrito-quitar" data-quitar="${i}">✕</span>
        </div>
      `).join('');
    contenido.querySelectorAll('#fc-lineas input').forEach((inp) => inp.addEventListener('input', (e) => {
      lineas[Number(e.target.dataset.i)][e.target.dataset.campo] = parseFloat(e.target.value) || 0;
      actualizarTotal();
    }));
    contenido.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); renderLineas(); actualizarTotal(); }));
  }

  function actualizarTotal() {
    const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario * (1 + (l.tasaItbisPct || 0)), 0);
    document.getElementById('fc-total').textContent = `Total: ${fmt(total)}`;
  }
  renderLineas();

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
        lineas.push({ productoId: p.id, descripcion: p.descripcion, cantidad: 1, costoUnitario: p.costo_promedio, tasaItbisPct: p.tasa_itbis_pct });
        renderLineas();
        actualizarTotal();
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

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
        lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario })),
        pagos, cajaId: state.info.cajaId, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarFacturas();
    } catch (err) { mostrarError(err.message); }
  });
}

function redondear(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// --- Pagar ---

let timeoutBuscarProveedorPago = null;
document.getElementById('pagar-buscar-proveedor').addEventListener('input', (e) => {
  clearTimeout(timeoutBuscarProveedorPago);
  const texto = e.target.value.trim();
  const resultados = document.getElementById('pagar-resultados-proveedor');
  if (!texto) { resultados.style.display = 'none'; return; }
  timeoutBuscarProveedorPago = setTimeout(async () => {
    const encontrados = await window.puntoXCompras.buscarProveedores({ texto, limite: 10 });
    resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${p.nombre}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
    resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
      state.proveedorPago = await window.puntoXCompras.obtenerProveedor({ proveedorId: encontrados[Number(el.dataset.i)].id });
      resultados.style.display = 'none';
      e.target.value = '';
      renderPagar();
    }));
    resultados.style.display = 'block';
  }, 200);
});

async function renderPagar() {
  const contenedor = document.getElementById('pagar-contenido');
  if (!state.proveedorPago) { contenedor.innerHTML = ''; return; }

  const facturas = await window.puntoXCxp.facturasAbiertas({ proveedorId: state.proveedorPago.id });
  if (facturas.length === 0) {
    contenedor.innerHTML = `<div class="empty-state">${state.proveedorPago.nombre} no tiene facturas abiertas a crédito.</div>`;
    return;
  }

  contenedor.innerHTML = `
    <div style="font-weight:700; margin-bottom:10px;">${state.proveedorPago.nombre} — saldo total: ${fmt(state.proveedorPago.saldo_pendiente)}</div>
    <table class="data-table">
      <thead><tr><th>Factura</th><th>Vencimiento</th><th>Total</th><th>Saldo</th><th style="width:140px;">Monto a pagar</th></tr></thead>
      <tbody>
        ${facturas.map((f) => `
          <tr>
            <td>${f.numero}</td><td>${fechaCorta(f.fecha_vencimiento)}</td><td>${fmt(f.total)}</td><td>${fmt(f.saldo_pendiente)}</td>
            <td><input type="number" step="0.01" min="0" max="${f.saldo_pendiente}" value="0" class="input-aplicacion" data-id="${f.id}" data-max="${f.saldo_pendiente}" style="width:120px; padding:6px 8px; border:1px solid var(--color-border-input); border-radius:6px;" /></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="form-grid" style="margin-top:14px;">
      <div class="form-field"><label>Forma de pago</label>
        <select id="pagar-forma-pago" class="input-normal">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="cheque">Cheque</option>
        </select>
      </div>
      <div class="form-field"><label>Prioridad</label>
        <select id="pagar-prioridad" class="input-normal"><option value="normal">Normal</option><option value="alta">Alta</option><option value="baja">Baja</option></select>
      </div>
    </div>
    <div id="pagar-campos-cheque" style="display:none;" class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>Número de cheque</label><input id="pagar-numero-cheque" class="input-normal" /></div>
      <div class="form-field"><label>Banco</label><input id="pagar-banco-cheque" class="input-normal" /></div>
      <div class="form-field"><label>Fecha en que se hace efectivo</label><input id="pagar-fecha-cheque" type="date" class="input-normal" /></div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
      <div style="font-size:16px; font-weight:800;">Total a pagar: <span id="pagar-total">RD$ 0.00</span></div>
      <button class="btn btn-primario" id="btn-guardar-pago" data-permiso="cxp.pago.crear">Registrar pago</button>
    </div>
  `;

  document.getElementById('pagar-forma-pago').addEventListener('change', (e) => {
    document.getElementById('pagar-campos-cheque').style.display = e.target.value === 'cheque' ? 'grid' : 'none';
  });

  function actualizarTotal() {
    const total = Array.from(document.querySelectorAll('.input-aplicacion')).reduce((acc, inp) => acc + (parseFloat(inp.value) || 0), 0);
    document.getElementById('pagar-total').textContent = fmt(total);
  }
  document.querySelectorAll('.input-aplicacion').forEach((inp) => inp.addEventListener('input', () => {
    const max = parseFloat(inp.dataset.max);
    if (parseFloat(inp.value) > max) inp.value = max;
    actualizarTotal();
  }));

  document.getElementById('btn-guardar-pago').addEventListener('click', async () => {
    const aplicaciones = Array.from(document.querySelectorAll('.input-aplicacion'))
      .map((inp) => ({ documentoCompraId: inp.dataset.id, montoAplicado: parseFloat(inp.value) || 0 }))
      .filter((a) => a.montoAplicado > 0);
    if (aplicaciones.length === 0) { mostrarError('Ingresa al menos un monto a pagar'); return; }
    try {
      await window.puntoXCxp.crearPago({
        proveedorId: state.proveedorPago.id, formaPago: document.getElementById('pagar-forma-pago').value,
        numeroCheque: document.getElementById('pagar-numero-cheque') ? document.getElementById('pagar-numero-cheque').value || null : null,
        bancoCheque: document.getElementById('pagar-banco-cheque') ? document.getElementById('pagar-banco-cheque').value || null : null,
        fechaCheque: document.getElementById('pagar-fecha-cheque') ? document.getElementById('pagar-fecha-cheque').value || null : null,
        prioridad: document.getElementById('pagar-prioridad').value, aplicaciones,
        cajaId: state.info.cajaId, usuarioId: state.info.usuario.id,
      });
      state.proveedorPago = await window.puntoXCompras.obtenerProveedor({ proveedorId: state.proveedorPago.id });
      renderPagar();
      cargarPagos();
      mostrarError(null);
    } catch (err) { mostrarError(err.message); }
  });
}

async function cargarPagos() {
  const pagos = await window.puntoXCxp.listarPagos({});
  document.getElementById('pagos-tbody').innerHTML = pagos.map((p) => `
    <tr>
      <td>${p.numero}</td><td>${p.proveedor_nombre}</td><td>${p.forma_pago}</td><td>${fmt(p.monto_total)}</td><td>${fechaCorta(p.fecha)}</td>
      <td><span class="pill-estado" style="background:${p.estado === 'anulado' ? 'var(--color-danger)' : 'var(--color-success)'};">${p.estado}</span></td>
      <td>${p.estado !== 'anulado' ? `<span class="enlace-accion" data-permiso="cxp.pago.anular" data-anular="${p.id}">Anular</span>` : ''}</td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-anular]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación:');
    if (!motivo) return;
    try {
      await window.puntoXCxp.anularPago({ pagoId: el.dataset.anular, motivo, usuarioId: state.info.usuario.id });
      cargarPagos();
      if (state.proveedorPago) { state.proveedorPago = await window.puntoXCompras.obtenerProveedor({ proveedorId: state.proveedorPago.id }); renderPagar(); }
    } catch (err) { mostrarError(err.message); }
  }));
}

// --- Antigüedad de saldos ---

async function cargarAntiguedad() {
  const filas = await window.puntoXCxp.antiguedadSaldos();
  document.getElementById('antiguedad-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('antiguedad-tbody').innerHTML = filas.map((f) => `
    <tr>
      <td>${f.proveedorNombre}</td>
      <td>${fmt(f.tramos.corriente)}</td>
      <td>${fmt(f.tramos.dias_0_30)}</td>
      <td style="color:${f.tramos.dias_31_60 > 0 ? 'var(--color-warning)' : 'inherit'};">${fmt(f.tramos.dias_31_60)}</td>
      <td style="color:${f.tramos.dias_61_90 > 0 ? 'var(--color-warning)' : 'inherit'};">${fmt(f.tramos.dias_61_90)}</td>
      <td style="color:${f.tramos.dias_90_mas > 0 ? 'var(--color-danger)' : 'inherit'};">${fmt(f.tramos.dias_90_mas)}</td>
      <td style="font-weight:700;">${fmt(f.total)}</td>
    </tr>
  `).join('');
}

// --- Próximas a vencer ---

async function cargarProximas() {
  const filas = await window.puntoXCxp.facturasProximasAVencer();
  document.getElementById('proximas-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('proximas-tbody').innerHTML = filas.map((f) => `
    <tr>
      <td>${f.proveedor_nombre}</td><td>${f.numero}</td><td>${fechaCorta(f.fecha_vencimiento)}</td><td>${fmt(f.saldo_pendiente)}</td>
      <td style="color:${f.dias_restantes < 0 ? 'var(--color-danger)' : 'var(--color-warning)'}; font-weight:700;">${f.dias_restantes < 0 ? `Vencida (${-f.dias_restantes} días)` : `${f.dias_restantes} días`}</td>
    </tr>
  `).join('');
}

// --- Cheques posdatados ---

async function cargarCheques() {
  const cheques = await window.puntoXCxp.chequesPosdatadosPendientes();
  document.getElementById('cheques-vacio').style.display = cheques.length === 0 ? 'block' : 'none';
  document.getElementById('cheques-tbody').innerHTML = cheques.map((c) => `
    <tr>
      <td>${c.numero}</td><td>${c.proveedor_nombre}</td><td>${c.numero_cheque}</td><td>${c.banco_cheque || '—'}</td><td>${fmt(c.monto_total)}</td>
      <td>${fechaCorta(c.fecha_cheque)}</td>
      <td><span class="enlace-accion" data-cobrado="${c.id}">Marcar cobrado</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-cobrado]').forEach((el) => el.addEventListener('click', async () => {
    await window.puntoXCxp.marcarChequeCobrado({ pagoId: el.dataset.cobrado });
    cargarCheques();
  }));
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('cxp');
  cambiarTab('proveedores');
}

init();
