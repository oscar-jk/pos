const state = {
  info: null,
  tab: 'clientes',
  categorias: [],
  clienteCobro: null,
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

function opciones(lista, valorSel, etiquetaFn) {
  return lista.map((x) => `<option value="${x.id}" ${x.id === valorSel ? 'selected' : ''}>${etiquetaFn(x)}</option>`).join('');
}

// --- Pestañas ---

const ACCIONES_TAB = { clientes: '<button class="btn btn-primario" id="btn-nuevo-cliente" data-permiso="cxc.cliente.editar">+ Nuevo cliente</button>' };

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB[tab] || '';
  mostrarError(null);

  if (tab === 'clientes') { cargarClientes(); enlazarBtn('btn-nuevo-cliente', () => abrirFormularioCliente()); }
  if (tab === 'cobrar') cargarRecibos();
  if (tab === 'antiguedad') cargarAntiguedad();
  if (tab === 'vencidas') cargarVencidas();
  if (tab === 'gestion') cargarGestion();
  if (tab === 'empleados') cargarEmpleados();
}

function enlazarBtn(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Clientes ---

async function cargarClientes() {
  const texto = document.getElementById('buscar-clientes').value.trim();
  const clientes = await window.puntoXCxc.listarClientes({ texto });
  document.getElementById('clientes-vacio').style.display = clientes.length === 0 ? 'block' : 'none';
  document.getElementById('clientes-tbody').innerHTML = clientes.map((c) => `
    <tr>
      <td>${c.nombre}</td>
      <td>${c.categoria_nombre || '—'}</td>
      <td>${fmt(c.limite_credito)}</td>
      <td style="color:${c.saldo_pendiente > 0 ? 'var(--color-warning)' : 'inherit'};">${fmt(c.saldo_pendiente)}</td>
      <td>${c.bloqueado ? '<span class="pill-estado" style="background:var(--color-danger);">Bloqueado</span>' : '<span class="pill-estado" style="background:var(--color-success);">Activo</span>'}</td>
      <td>
        <span class="enlace-accion" data-permiso="cxc.cliente.editar" data-editar="${c.id}">Editar</span> ·
        <span class="enlace-accion" data-estado="${c.id}" data-nombre="${c.nombre}">Estado de cuenta</span>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormularioCliente(el.dataset.editar)));
  document.querySelectorAll('[data-estado]').forEach((el) => el.addEventListener('click', () => verEstadoCuenta(el.dataset.estado, el.dataset.nombre)));
}

let timeoutBuscarClientes = null;
document.getElementById('buscar-clientes').addEventListener('input', () => {
  clearTimeout(timeoutBuscarClientes);
  timeoutBuscarClientes = setTimeout(cargarClientes, 200);
});

async function abrirFormularioCliente(clienteId) {
  const esEdicion = Boolean(clienteId);
  const cliente = esEdicion ? await window.puntoXCxc.obtenerCliente({ clienteId }) : null;

  window.PuntoXModal.abrirModal(esEdicion ? 'Editar cliente' : 'Nuevo cliente', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre *</label><input id="c-nombre" value="${cliente ? cliente.nombre : ''}" /></div>
      <div class="form-field"><label>RNC / Cédula</label><input id="c-rnc" value="${cliente ? cliente.rnc_cedula || '' : ''}" /></div>
      <div class="form-field"><label>Categoría</label><select id="c-categoria"><option value="">— Sin categoría —</option>${opciones(state.categorias, cliente ? cliente.categoria_id : null, (x) => x.nombre)}</select></div>
      <div class="form-field"><label>Tipo de comprobante por defecto</label>
        <select id="c-ncf">
          <option value="consumo" ${cliente?.tipo_comprobante_default === 'consumo' ? 'selected' : ''}>Consumo</option>
          <option value="credito_fiscal" ${cliente?.tipo_comprobante_default === 'credito_fiscal' ? 'selected' : ''}>Crédito Fiscal</option>
          <option value="gubernamental" ${cliente?.tipo_comprobante_default === 'gubernamental' ? 'selected' : ''}>Gubernamental</option>
          <option value="regimen_especial" ${cliente?.tipo_comprobante_default === 'regimen_especial' ? 'selected' : ''}>Régimen Especial</option>
        </select>
      </div>
      <div class="form-field"><label>Límite de crédito</label><input id="c-limite" type="number" step="0.01" value="${cliente ? cliente.limite_credito : 0}" /></div>
      <div class="form-field"><label>Días de crédito</label><input id="c-dias" type="number" step="1" value="${cliente ? cliente.dias_credito : 30}" /></div>
      <div class="form-field"><label>Teléfono</label><input id="c-telefono" value="${cliente ? cliente.telefono || '' : ''}" /></div>
      <div class="form-field"><label>Email</label><input id="c-email" value="${cliente ? cliente.email || '' : ''}" /></div>
      <div class="form-field" style="grid-column: span 2;"><label>Dirección</label><input id="c-direccion" value="${cliente ? cliente.direccion || '' : ''}" /></div>
      <div class="form-field form-field--checkbox"><input id="c-retencion" type="checkbox" ${cliente?.es_agente_retencion ? 'checked' : ''} /><label>Es agente de retención</label></div>
      <div></div>
      <div class="form-field"><label>% Retención ISR</label><input id="c-ret-isr" type="number" step="0.01" value="${cliente ? cliente.pct_retencion_isr : 0}" /></div>
      <div class="form-field"><label>% Retención ITBIS</label><input id="c-ret-itbis" type="number" step="0.01" value="${cliente ? cliente.pct_retencion_itbis : 0}" /></div>
      <div class="form-field form-field--checkbox"><input id="c-bloqueado" type="checkbox" ${cliente?.bloqueado ? 'checked' : ''} /><label>Bloqueado manualmente</label></div>
      <div class="form-field"><label>Motivo de bloqueo</label><input id="c-motivo-bloqueo" value="${cliente ? cliente.motivo_bloqueo || '' : ''}" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="c-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="c-guardar">${esEdicion ? 'Guardar cambios' : 'Crear cliente'}</button>
    </div>
  `);

  document.getElementById('c-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('c-guardar').addEventListener('click', async () => {
    const payload = {
      nombre: document.getElementById('c-nombre').value,
      rncCedula: document.getElementById('c-rnc').value || null,
      categoriaId: document.getElementById('c-categoria').value || null,
      tipoComprobanteDefault: document.getElementById('c-ncf').value,
      limiteCredito: parseFloat(document.getElementById('c-limite').value) || 0,
      diasCredito: parseInt(document.getElementById('c-dias').value, 10) || 0,
      telefono: document.getElementById('c-telefono').value || null,
      email: document.getElementById('c-email').value || null,
      direccion: document.getElementById('c-direccion').value || null,
      esAgenteRetencion: document.getElementById('c-retencion').checked,
      pctRetencionIsr: parseFloat(document.getElementById('c-ret-isr').value) || 0,
      pctRetencionItbis: parseFloat(document.getElementById('c-ret-itbis').value) || 0,
      bloqueado: document.getElementById('c-bloqueado').checked,
      motivoBloqueo: document.getElementById('c-motivo-bloqueo').value || null,
    };
    try {
      if (esEdicion) await window.puntoXCxc.guardarCliente({ clienteId, payload });
      else await window.puntoXCxc.crearCliente(payload);
      window.PuntoXModal.cerrarModal();
      cargarClientes();
    } catch (err) { mostrarError(err.message); }
  });
}

async function verEstadoCuenta(clienteId, nombre) {
  const movimientos = await window.puntoXCxc.estadoCuenta({ clienteId });
  window.PuntoXModal.abrirModal(`Estado de cuenta — ${nombre}`, `
    <table class="data-table">
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Número</th><th>Monto</th><th>Saldo acumulado</th></tr></thead>
      <tbody>
        ${movimientos.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:var(--color-text-faint);">Sin movimientos</td></tr>' : ''}
        ${movimientos.map((m) => `
          <tr>
            <td>${fechaCorta(m.fecha)}</td>
            <td>${m.tipo === 'factura' ? 'Factura' : 'Recibo de cobro'}</td>
            <td>${m.numero}</td>
            <td style="color:${m.tipo === 'factura' ? 'var(--color-text)' : 'var(--color-success)'};">${m.tipo === 'factura' ? fmt(m.total) : '- ' + fmt(m.total)}</td>
            <td style="font-weight:700;">${fmt(m.saldo_acumulado)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `);
}

// --- Cobrar ---

let timeoutBuscarClienteCobro = null;
document.getElementById('cobrar-buscar-cliente').addEventListener('input', (e) => {
  clearTimeout(timeoutBuscarClienteCobro);
  const texto = e.target.value.trim();
  const resultados = document.getElementById('cobrar-resultados-cliente');
  if (!texto) { resultados.style.display = 'none'; return; }
  timeoutBuscarClienteCobro = setTimeout(async () => {
    const encontrados = await window.puntoXCxc.buscarClientes({ texto, limite: 10 });
    resultados.innerHTML = encontrados.map((c, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${c.nombre}</div><div class="buscador-resultados__meta">${c.rnc_cedula || ''}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
    resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
      state.clienteCobro = await window.puntoXCxc.obtenerCliente({ clienteId: encontrados[Number(el.dataset.i)].id });
      resultados.style.display = 'none';
      e.target.value = '';
      renderCobrar();
    }));
    resultados.style.display = 'block';
  }, 200);
});

async function renderCobrar() {
  const contenedor = document.getElementById('cobrar-contenido');
  if (!state.clienteCobro) { contenedor.innerHTML = ''; return; }

  const facturas = await window.puntoXCxc.facturasAbiertas({ clienteId: state.clienteCobro.id });
  if (facturas.length === 0) {
    contenedor.innerHTML = `<div class="empty-state">${state.clienteCobro.nombre} no tiene facturas abiertas a crédito.</div>`;
    return;
  }

  contenedor.innerHTML = `
    <div style="font-weight:700; margin-bottom:10px;">${state.clienteCobro.nombre} — saldo total: ${fmt(state.clienteCobro.saldo_pendiente)}</div>
    <table class="data-table">
      <thead><tr><th>Factura</th><th>Fecha</th><th>Total</th><th>Saldo</th><th style="width:140px;">Monto a aplicar</th></tr></thead>
      <tbody>
        ${facturas.map((f) => `
          <tr>
            <td>${f.numero}</td><td>${fechaCorta(f.fecha)}</td><td>${fmt(f.total)}</td><td>${fmt(f.saldo_pendiente)}</td>
            <td><input type="number" step="0.01" min="0" max="${f.saldo_pendiente}" value="0" class="input-aplicacion" data-id="${f.id}" data-max="${f.saldo_pendiente}" style="width:120px; padding:6px 8px; border:1px solid var(--color-border-input); border-radius:6px;" /></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="form-grid" style="margin-top:14px;">
      <div class="form-field"><label>Forma de pago</label>
        <select id="cobrar-forma-pago" class="input-normal">
          <option value="efectivo">Efectivo</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="transferencia">Transferencia</option>
          <option value="cheque">Cheque</option>
        </select>
      </div>
      <div class="form-field"><label>Referencia</label><input id="cobrar-referencia" class="input-normal" placeholder="Número de confirmación, cheque, etc." /></div>
    </div>
    ${state.clienteCobro.es_agente_retencion ? `
    <div class="form-grid" style="margin-top:6px;">
      <div class="form-field"><label>ISR retenido por el cliente</label><input id="cobrar-ret-isr" class="input-normal" type="number" step="0.01" min="0" value="0" /></div>
      <div class="form-field"><label>ITBIS retenido por el cliente</label><input id="cobrar-ret-itbis" class="input-normal" type="number" step="0.01" min="0" value="0" /></div>
    </div>
    <div style="font-size:12px; color:var(--color-text-muted);">Agente de retención: se sugiere lo retenido según las facturas elegidas. Corrígelo con lo que diga su comprobante de retención.</div>` : ''}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
      <div>
        <div style="font-size:16px; font-weight:800;">Total a cobrar: <span id="cobrar-total">RD$ 0.00</span></div>
        <div id="cobrar-desglose" style="font-size:12px; color:var(--color-text-muted);"></div>
      </div>
      <button class="btn btn-primario" id="btn-guardar-cobro" data-permiso="cxc.recibo.crear">Registrar cobro</button>
    </div>
  `;

  // Retención sugerida: la que se calculó en cada factura, en proporción a lo que se le aplica.
  const retIsr = document.getElementById('cobrar-ret-isr');
  const retItbis = document.getElementById('cobrar-ret-itbis');
  let retencionEditada = false;
  [retIsr, retItbis].filter(Boolean).forEach((inp) => inp.addEventListener('input', () => { retencionEditada = true; actualizarTotal(); }));
  function actualizarTotal() {
    let total = 0;
    let sugIsr = 0;
    let sugItbis = 0;
    document.querySelectorAll('.input-aplicacion').forEach((inp) => {
      const monto = parseFloat(inp.value) || 0;
      const f = facturas.find((x) => x.id === inp.dataset.id);
      total += monto;
      if (f && f.total > 0) { sugIsr += (f.retencion_isr || 0) * (monto / f.total); sugItbis += (f.retencion_itbis || 0) * (monto / f.total); }
    });
    if (retIsr && !retencionEditada) { retIsr.value = sugIsr.toFixed(2); retItbis.value = sugItbis.toFixed(2); }
    const retenido = retIsr ? (parseFloat(retIsr.value) || 0) + (parseFloat(retItbis.value) || 0) : 0;
    document.getElementById('cobrar-total').textContent = fmt(total - retenido);
    document.getElementById('cobrar-desglose').textContent = retenido > 0 ? `Aplicado a facturas ${fmt(total)} − retenido ${fmt(retenido)}` : '';
  }
  document.querySelectorAll('.input-aplicacion').forEach((inp) => inp.addEventListener('input', () => {
    const max = parseFloat(inp.dataset.max);
    if (parseFloat(inp.value) > max) inp.value = max;
    actualizarTotal();
  }));

  document.getElementById('btn-guardar-cobro').addEventListener('click', async () => {
    const aplicaciones = Array.from(document.querySelectorAll('.input-aplicacion'))
      .map((inp) => ({ documentoVentaId: inp.dataset.id, montoAplicado: parseFloat(inp.value) || 0 }))
      .filter((a) => a.montoAplicado > 0);
    if (aplicaciones.length === 0) { mostrarError('Ingresa al menos un monto a aplicar'); return; }
    try {
      await window.puntoXCxc.crearRecibo({
        clienteId: state.clienteCobro.id, formaPago: document.getElementById('cobrar-forma-pago').value,
        referencia: document.getElementById('cobrar-referencia').value || null, aplicaciones,
        retencionIsr: retIsr ? parseFloat(retIsr.value) || 0 : 0, retencionItbis: retItbis ? parseFloat(retItbis.value) || 0 : 0,
        cajaId: state.info.cajaId, usuarioId: state.info.usuario.id,
      });
      state.clienteCobro = await window.puntoXCxc.obtenerCliente({ clienteId: state.clienteCobro.id });
      renderCobrar();
      cargarRecibos();
      mostrarError(null);
    } catch (err) { mostrarError(err.message); }
  });
}

async function cargarRecibos() {
  const recibos = await window.puntoXCxc.listarRecibos({});
  document.getElementById('recibos-tbody').innerHTML = recibos.map((r) => `
    <tr>
      <td>${r.numero}</td><td>${r.cliente_nombre}</td><td>${r.forma_pago}</td><td>${fmt(r.monto_total)}${(r.retencion_isr || 0) + (r.retencion_itbis || 0) > 0 ? `<div style="font-size:11px; color:var(--color-text-muted);">+ retenido ${fmt((r.retencion_isr || 0) + (r.retencion_itbis || 0))}</div>` : ''}</td><td>${fechaCorta(r.fecha)}</td>
      <td><span class="pill-estado" style="background:${r.estado === 'anulado' ? 'var(--color-danger)' : 'var(--color-success)'};">${r.estado}</span></td>
      <td>${r.estado !== 'anulado' ? `<span class="enlace-accion" data-permiso="cxc.recibo.anular" data-anular="${r.id}">Anular</span>` : ''}</td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-anular]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación:');
    if (!motivo) return;
    try {
      await window.puntoXCxc.anularRecibo({ reciboId: el.dataset.anular, motivo, usuarioId: state.info.usuario.id });
      cargarRecibos();
      if (state.clienteCobro) { state.clienteCobro = await window.puntoXCxc.obtenerCliente({ clienteId: state.clienteCobro.id }); renderCobrar(); }
    } catch (err) { mostrarError(err.message); }
  }));
}

// --- Antigüedad de saldos ---

async function cargarAntiguedad() {
  const filas = await window.puntoXCxc.antiguedadSaldos();
  document.getElementById('antiguedad-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('antiguedad-tbody').innerHTML = filas.map((f) => `
    <tr>
      <td>${f.clienteNombre}</td>
      <td>${fmt(f.tramos.corriente)}</td>
      <td>${fmt(f.tramos.dias_0_30)}</td>
      <td style="color:${f.tramos.dias_31_60 > 0 ? 'var(--color-warning)' : 'inherit'};">${fmt(f.tramos.dias_31_60)}</td>
      <td style="color:${f.tramos.dias_61_90 > 0 ? 'var(--color-warning)' : 'inherit'};">${fmt(f.tramos.dias_61_90)}</td>
      <td style="color:${f.tramos.dias_90_mas > 0 ? 'var(--color-danger)' : 'inherit'};">${fmt(f.tramos.dias_90_mas)}</td>
      <td style="font-weight:700;">${fmt(f.total)}</td>
    </tr>
  `).join('');
}

// --- Facturas vencidas ---

async function cargarVencidas() {
  const filas = await window.puntoXCxc.facturasVencidas();
  document.getElementById('vencidas-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('vencidas-tbody').innerHTML = filas.map((f) => `
    <tr>
      <td>${f.cliente_nombre}</td><td>${f.cliente_telefono || '—'}</td><td>${f.numero}</td><td>${fechaCorta(f.fecha)}</td>
      <td>${fmt(f.saldo_pendiente)}</td>
      <td style="color:var(--color-danger); font-weight:700;">${f.dias_mora} días</td>
    </tr>
  `).join('');
}

// --- Gestión de cobros ---

async function cargarGestion() {
  document.getElementById('acciones-tab').innerHTML = '<button class="btn btn-primario" id="btn-nueva-gestion" data-permiso="cxc.gestion_cobro.crear">+ Nueva gestión</button>';
  document.getElementById('btn-nueva-gestion').addEventListener('click', abrirFormularioGestion);

  const filas = await window.puntoXCxc.listarGestionCobros({});
  document.getElementById('gestion-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('gestion-tbody').innerHTML = filas.map((g) => `
    <tr><td>${g.cliente_nombre}</td><td>${g.tipo_contacto}</td><td>${g.notas || '—'}</td><td>${g.resultado || '—'}</td><td>${fechaCorta(g.proxima_fecha_contacto)}</td><td>${fechaCorta(g.fecha_contacto)}</td></tr>
  `).join('');
}

async function abrirFormularioGestion() {
  let clienteSel = null;
  window.PuntoXModal.abrirModal('Nueva gestión de cobro', `
    <div class="form-field">
      <label>Cliente *</label>
      <div class="buscador-producto" style="position:relative;">
        <input id="gc-buscar" class="input-normal" type="text" placeholder="Buscar cliente..." autocomplete="off" />
        <div id="gc-resultados" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="gc-seleccionado" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
    </div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>Tipo de contacto</label>
        <select id="gc-tipo" class="input-normal"><option value="llamada">Llamada</option><option value="visita">Visita</option><option value="email">Email</option><option value="otro">Otro</option></select>
      </div>
      <div class="form-field"><label>Próximo contacto</label><input id="gc-proximo" type="date" class="input-normal" /></div>
    </div>
    <div class="form-field" style="margin-top:10px;"><label>Notas</label><input id="gc-notas" class="input-normal" /></div>
    <div class="form-field" style="margin-top:10px;"><label>Resultado</label><input id="gc-resultado" class="input-normal" placeholder="Ej: promete pagar el viernes" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="gc-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="gc-guardar">Registrar</button>
    </div>
  `);

  let timeoutBuscar = null;
  document.getElementById('gc-buscar').addEventListener('input', (e) => {
    clearTimeout(timeoutBuscar);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('gc-resultados');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutBuscar = setTimeout(async () => {
      const encontrados = await window.puntoXCxc.buscarClientes({ texto, limite: 10 });
      resultados.innerHTML = encontrados.map((c, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${c.nombre}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        clienteSel = encontrados[Number(el.dataset.i)];
        document.getElementById('gc-seleccionado').textContent = `Seleccionado: ${clienteSel.nombre}`;
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  document.getElementById('gc-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('gc-guardar').addEventListener('click', async () => {
    if (!clienteSel) { mostrarError('Selecciona un cliente'); return; }
    try {
      await window.puntoXCxc.crearGestionCobro({
        clienteId: clienteSel.id, tipoContacto: document.getElementById('gc-tipo').value,
        notas: document.getElementById('gc-notas').value || null, resultado: document.getElementById('gc-resultado').value || null,
        proximaFechaContacto: document.getElementById('gc-proximo').value || null, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarGestion();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- CxC empleados ---

async function cargarEmpleados() {
  document.getElementById('acciones-tab').innerHTML = '<button class="btn btn-primario" id="btn-nuevo-cxc-empleado">+ Nuevo préstamo/anticipo</button>';
  document.getElementById('btn-nuevo-cxc-empleado').addEventListener('click', abrirFormularioCxcEmpleado);

  const filas = await window.puntoXCxc.listarCxcEmpleados({});
  document.getElementById('empleados-vacio').style.display = filas.length === 0 ? 'block' : 'none';
  document.getElementById('empleados-tbody').innerHTML = filas.map((e) => `
    <tr>
      <td>${e.empleado_nombre}</td><td>${e.tipo}</td><td>${fmt(e.monto)}</td><td>${fmt(e.saldo_pendiente)}</td>
      <td><span class="pill-estado" style="background:${e.estado === 'pagado' ? 'var(--color-success)' : 'var(--color-warning)'};">${e.estado}</span></td>
      <td>${fechaCorta(e.fecha)}</td>
      <td>${e.estado !== 'pagado' ? `<span class="enlace-accion" data-pagar="${e.id}" data-max="${e.saldo_pendiente}">Registrar pago</span>` : ''}</td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-pagar]').forEach((el) => el.addEventListener('click', async () => {
    const monto = parseFloat(prompt(`Monto a abonar (saldo pendiente: ${el.dataset.max}):`, el.dataset.max));
    if (!monto || monto <= 0) return;
    try {
      await window.puntoXCxc.registrarPagoCxcEmpleado({ cxcEmpleadoId: el.dataset.pagar, monto, usuarioId: state.info.usuario.id });
      cargarEmpleados();
    } catch (err) { mostrarError(err.message); }
  }));
}

async function abrirFormularioCxcEmpleado() {
  const empleados = await window.puntoXVentas.listarVendedores(); // usuarios activos; suficiente para elegir el empleado
  window.PuntoXModal.abrirModal('Nuevo préstamo / anticipo / consumo', `
    <div class="form-grid">
      <div class="form-field"><label>Empleado</label><select id="ce-empleado" class="input-normal">${opciones(empleados, state.info.usuario.id, (u) => u.nombre_completo)}</select></div>
      <div class="form-field"><label>Tipo</label><select id="ce-tipo" class="input-normal"><option value="prestamo">Préstamo</option><option value="anticipo">Anticipo</option><option value="consumo">Consumo en el local</option></select></div>
      <div class="form-field"><label>Monto *</label><input id="ce-monto" class="input-normal" type="number" step="0.01" value="0" /></div>
      <div class="form-field"><label>Descuento sugerido en nómina</label><input id="ce-descuento" class="input-normal" type="number" step="0.01" value="0" /></div>
    </div>
    <div class="form-field" style="margin-top:10px;"><label>Notas</label><input id="ce-notas" class="input-normal" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="ce-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="ce-guardar">Registrar</button>
    </div>
  `);
  document.getElementById('ce-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('ce-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXCxc.crearCxcEmpleado({
        usuarioId: document.getElementById('ce-empleado').value, tipo: document.getElementById('ce-tipo').value,
        monto: parseFloat(document.getElementById('ce-monto').value) || 0,
        descuentoSugeridoNomina: parseFloat(document.getElementById('ce-descuento').value) || 0,
        notas: document.getElementById('ce-notas').value || null, usuarioRegistroId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarEmpleados();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('cxc');
  state.categorias = await window.puntoXCxc.listarCategorias();
  cambiarTab('clientes');
}

init();
