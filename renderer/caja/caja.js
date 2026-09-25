const state = {
  info: null,
  tab: 'turno',
  cajaActual: null,
  turnoActual: null,
  monedas: [],
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

function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

// --- Pestañas ---

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = '';
  mostrarError(null);

  if (tab === 'turno') renderTurno();
  if (tab === 'historial') cargarHistorial();
  if (tab === 'cajachica') cargarCajaChica();
  if (tab === 'banco') { cargarBanco(); document.getElementById('acciones-tab').innerHTML = '<button class="btn btn-primario" id="btn-nueva-transferencia" data-permiso="caja.movimiento.crear">+ Nueva transferencia</button>'; document.getElementById('btn-nueva-transferencia').addEventListener('click', abrirFormularioTransferencia); }
  if (tab === 'conciliacion') { state.conciliacionId = null; cargarConciliaciones(); }
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Turno actual ---

async function refrescarTurno() {
  state.turnoActual = await window.puntoXCaja.obtenerTurnoAbierto({ cajaId: state.cajaActual.id });
}

async function renderTurno() {
  await refrescarTurno();
  const panel = document.getElementById('tab-turno');

  if (!state.turnoActual) {
    panel.innerHTML = `
      <div class="empty-state empty-state--panel">
        <p style="margin-bottom:14px; color:var(--color-text);">No hay un turno de caja abierto para <strong>${state.cajaActual.nombre}</strong>. Ábrelo antes de facturar ventas al contado en efectivo.</p>
        <div class="form-field" style="max-width:240px; margin:0 auto 14px;">
          <label>Fondo inicial</label>
          <input id="fondo-inicial" class="input-normal" type="number" step="0.01" value="0" />
        </div>
        <button class="btn btn-primario" id="btn-abrir-turno" data-permiso="caja.apertura">Abrir turno</button>
        ${state.ultimoTurnoCerradoId && window.puntoXImpresion ? `
          <p style="margin-top:18px; font-size:13px;">Turno cerrado correctamente.
            <button class="btn btn-secundario btn-chico" id="btn-imprimir-ultimo-arqueo" data-permiso="caja.tique.imprimir">Imprimir arqueo</button>
          </p>` : ''}
      </div>
    `;
    const btnArqueo = document.getElementById('btn-imprimir-ultimo-arqueo');
    if (btnArqueo) btnArqueo.addEventListener('click', () => imprimirArqueo(state.ultimoTurnoCerradoId));
    document.getElementById('btn-abrir-turno').addEventListener('click', async () => {
      try {
        await window.puntoXCaja.abrirTurno({
          cajaId: state.cajaActual.id, fondoInicial: parseFloat(document.getElementById('fondo-inicial').value) || 0,
          usuarioId: state.info.usuario.id,
        });
        renderTurno();
      } catch (err) { mostrarError(err.message); }
    });
    return;
  }

  const esperado = await window.puntoXCaja.efectivoEsperado({ turnoId: state.turnoActual.id });
  const movimientos = await window.puntoXCaja.movimientosDeTurno({ turnoId: state.turnoActual.id });

  panel.innerHTML = `
    <div class="resumen-turno">
      <div class="resumen-turno__item"><div class="resumen-turno__label">Fondo inicial</div><div class="resumen-turno__valor">${fmt(state.turnoActual.fondo_inicial)}</div></div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">Efectivo esperado</div><div class="resumen-turno__valor">${fmt(esperado)}</div></div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">Abierto desde</div><div class="resumen-turno__valor" style="font-size:14px;">${fechaHora(state.turnoActual.fecha_apertura)}</div></div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">Estado</div><div class="resumen-turno__valor"><span class="pill-estado" style="background:var(--color-success);">Abierto</span></div></div>
    </div>
    <div style="display:flex; gap:10px; margin-bottom:16px;">
      <button class="btn btn-secundario" id="btn-movimiento-manual" data-permiso="caja.movimiento.crear">+ Movimiento manual</button>
      <button class="btn btn-peligro" id="btn-cerrar-turno" data-permiso="caja.cierre">Cerrar turno</button>
    </div>
    <table class="data-table">
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Usuario</th></tr></thead>
      <tbody>
        ${movimientos.length === 0 ? '<tr><td colspan="5" style="text-align:center; color:var(--color-text-faint);">Sin movimientos todavía</td></tr>' : ''}
        ${movimientos.map((m) => `
          <tr>
            <td>${fechaHora(m.created_at)}</td>
            <td>${m.tipo}</td>
            <td>${m.concepto}</td>
            <td style="color:${m.monto < 0 ? 'var(--color-danger)' : 'var(--color-success)'};">${m.monto > 0 ? '+' : ''}${fmt(m.monto)}</td>
            <td>${m.usuario_nombre || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('btn-movimiento-manual').addEventListener('click', abrirFormularioMovimientoManual);
  document.getElementById('btn-cerrar-turno').addEventListener('click', () => abrirFormularioCierre(esperado));
}

function abrirFormularioMovimientoManual() {
  window.PuntoXModal.abrirModal('Movimiento manual de caja', `
    <div class="form-field"><label>Tipo *</label>
      <select id="mm-tipo" class="input-normal">
        <option value="entrada_manual">Entrada</option>
        <option value="salida_manual">Salida</option>
      </select>
    </div>
    <div class="form-field" style="margin-top:10px;"><label>Concepto *</label><input id="mm-concepto" class="input-normal" placeholder="Ej: pago de flete, retiro del dueño..." /></div>
    <div class="form-field" style="margin-top:10px;"><label>Monto *</label><input id="mm-monto" class="input-normal" type="number" step="0.01" value="0" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="mm-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="mm-guardar">Registrar</button>
    </div>
  `);
  document.getElementById('mm-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('mm-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXCaja.registrarMovimientoManual({
        turnoCajaId: state.turnoActual.id, tipo: document.getElementById('mm-tipo').value,
        concepto: document.getElementById('mm-concepto').value,
        monto: parseFloat(document.getElementById('mm-monto').value) || 0,
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      renderTurno();
    } catch (err) { mostrarError(err.message); }
  });
}

function abrirFormularioCierre(esperado) {
  const contenido = window.PuntoXModal.abrirModal('Cerrar turno — arqueo de caja', `
    <p style="font-size:13px; color:var(--color-text-muted); margin-bottom:14px;">Efectivo esperado según el sistema: <strong>${fmt(esperado)}</strong></p>
    <div class="form-field"><label>Efectivo contado físicamente *</label><input id="cierre-contado" class="input-normal" type="number" step="0.01" value="${esperado.toFixed(2)}" /></div>
    <div class="form-field" style="margin-top:10px;"><label>Diferencia</label><div id="cierre-diferencia" style="font-size:20px; font-weight:800;">${fmt(0)}</div></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="cierre-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="cierre-confirmar">Confirmar cierre</button>
    </div>
  `);
  const inputContado = document.getElementById('cierre-contado');
  const diferenciaEl = document.getElementById('cierre-diferencia');
  function actualizarDiferencia() {
    const contado = parseFloat(inputContado.value) || 0;
    const diferencia = Math.round((contado - esperado + Number.EPSILON) * 100) / 100;
    diferenciaEl.textContent = fmt(diferencia);
    diferenciaEl.style.color = diferencia === 0 ? 'var(--color-success)' : (diferencia > 0 ? 'var(--color-info)' : 'var(--color-danger)');
  }
  inputContado.addEventListener('input', actualizarDiferencia);
  actualizarDiferencia();

  document.getElementById('cierre-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('cierre-confirmar').addEventListener('click', async () => {
    try {
      const cerrado = await window.puntoXCaja.cerrarTurno({
        turnoId: state.turnoActual.id, efectivoContado: parseFloat(inputContado.value) || 0,
      });
      state.ultimoTurnoCerradoId = cerrado.id;
      window.PuntoXModal.cerrarModal();
      renderTurno();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Historial de turnos ---

async function cargarHistorial() {
  const turnos = await window.puntoXCaja.listarTurnos({});
  document.getElementById('historial-tbody').innerHTML = turnos.map((t) => {
    const diffColor = t.diferencia === null ? '' : (t.diferencia === 0 ? 'var(--color-success)' : (t.diferencia > 0 ? 'var(--color-info)' : 'var(--color-danger)'));
    return `
      <tr>
        <td>${t.caja_nombre}</td>
        <td>${fechaHora(t.fecha_apertura)}</td>
        <td>${fechaHora(t.fecha_cierre)}</td>
        <td>${fmt(t.fondo_inicial)}</td>
        <td>${t.efectivo_esperado !== null ? fmt(t.efectivo_esperado) : '—'}</td>
        <td>${t.efectivo_contado !== null ? fmt(t.efectivo_contado) : '—'}</td>
        <td style="color:${diffColor};">${t.diferencia !== null ? fmt(t.diferencia) : '—'}</td>
        <td><span class="pill-estado" style="background:${t.estado === 'abierto' ? 'var(--color-success)' : 'var(--color-text-faint)'};">${t.estado}</span></td>
        <td>${t.estado === 'cerrado' && window.puntoXImpresion ? `<a href="#" class="btn-imprimir-arqueo" data-permiso="caja.tique.imprimir" data-id="${t.id}" style="color:var(--color-accent); font-size:12px; font-weight:700;">Imprimir arqueo</a>` : ''}</td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('#historial-tbody .btn-imprimir-arqueo').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); imprimirArqueo(a.dataset.id); });
  });
}

async function imprimirArqueo(turnoId) {
  try {
    await window.puntoXImpresion.imprimirArqueo({ turnoId });
  } catch (err) { mostrarError(err.message); }
}

// --- Caja chica ---

async function cargarCajaChica() {
  const cc = await window.puntoXCaja.obtenerCajaChica({ cajaId: state.cajaActual.id, fondoAsignado: 2000 });
  state.cajaChica = cc;
  document.getElementById('acciones-tab').innerHTML = '<button class="btn btn-primario" id="btn-nuevo-gasto" data-permiso="caja.movimiento.crear">+ Nuevo gasto</button>';
  document.getElementById('btn-nuevo-gasto').addEventListener('click', abrirFormularioGasto);

  const gastos = await window.puntoXCaja.listarGastosCajaChica({ cajaChicaId: cc.id });
  const totalGastado = gastos.reduce((acc, g) => acc + g.monto, 0);
  document.getElementById('cc-fondo').textContent = fmt(cc.fondo_asignado);
  document.getElementById('cc-gastado').textContent = fmt(totalGastado);

  document.getElementById('cajachica-vacio').style.display = gastos.length === 0 ? 'block' : 'none';
  document.getElementById('cajachica-tbody').innerHTML = gastos.map((g) => `
    <tr><td>${esc(g.concepto)}</td><td>${esc(g.categoria) || '—'}</td><td>${fmt(g.monto)}</td><td>${esc(g.comprobante_ruta)}${g.ncf ? ` · NCF ${esc(g.ncf)}` : ''}</td><td>${fechaHora(g.fecha)}</td><td>${esc(g.usuario_nombre)}</td></tr>
  `).join('');
}

const TIPOS_BIENES_SERVICIOS_606 = [
  ['01', 'Gastos de personal'], ['02', 'Gastos por trabajos, suministros y servicios'], ['03', 'Arrendamientos'],
  ['04', 'Gastos de activos fijos'], ['05', 'Gastos de representación'], ['06', 'Otras deducciones admitidas'],
  ['07', 'Gastos financieros'], ['08', 'Gastos extraordinarios'], ['09', 'Compras y gastos que formarán parte del costo de venta'],
  ['10', 'Adquisiciones de activos'], ['11', 'Gastos de seguros'],
];

function abrirFormularioGasto() {
  // Los datos fiscales solo sirven para el Formato 606, que existe en la app de escritorio.
  const conDatosFiscales = Boolean(window.puntoXCompras && window.puntoXCompras.reporte606);
  window.PuntoXModal.abrirModal('Nuevo gasto de caja chica', `
    <div class="form-grid">
      <div class="form-field"><label>Concepto *</label><input id="g-concepto" class="input-normal" /></div>
      <div class="form-field"><label>Categoría</label><input id="g-categoria" class="input-normal" placeholder="Ej: transporte, suministros" /></div>
      <div class="form-field"><label>Monto total (ITBIS incluido) *</label><input id="g-monto" class="input-normal" type="number" step="0.01" value="0" /></div>
      <div class="form-field"><label>Comprobante *</label><input id="g-comprobante" class="input-normal" placeholder="Número de recibo / descripción" /></div>
    </div>
    ${conDatosFiscales ? `
    <div class="form-seccion">
      <div style="font-weight:700; font-size:13px; margin-bottom:4px;">Datos fiscales (para el Formato 606)</div>
      <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:10px;">Llénalos si el suplidor te dio factura con NCF. Sin NCF el gasto no se reporta en el 606.</div>
      <div class="form-grid">
        <div class="form-field"><label>RNC o cédula del suplidor</label><input id="g-rnc" class="input-normal" placeholder="9 u 11 dígitos" /></div>
        <div class="form-field"><label>NCF</label><input id="g-ncf" class="input-normal" placeholder="Ej: B0100000123" /></div>
        <div class="form-field" style="grid-column: span 2;"><label>Tipo de gasto (DGII)</label>
          <select id="g-tipo" class="input-normal">${TIPOS_BIENES_SERVICIOS_606.map(([c, e]) => `<option value="${c}" ${c === '02' ? 'selected' : ''}>${c} — ${e}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Es un pago por</label>
          <select id="g-clase" class="input-normal"><option value="bienes">Bienes</option><option value="servicios">Servicios</option></select>
        </div>
        <div class="form-field"><label>ITBIS con derecho a crédito fiscal</label><input id="g-itbis" class="input-normal" type="number" step="0.01" min="0" value="0" /></div>
      </div>
    </div>` : ''}
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="g-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="g-guardar">Registrar gasto</button>
    </div>
  `);
  document.getElementById('g-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('g-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXCaja.crearGastoCajaChica({
        cajaChicaId: state.cajaChica.id, turnoCajaId: state.turnoActual ? state.turnoActual.id : null,
        concepto: document.getElementById('g-concepto').value, categoria: document.getElementById('g-categoria').value || null,
        monto: parseFloat(document.getElementById('g-monto').value) || 0,
        comprobanteRuta: document.getElementById('g-comprobante').value, usuarioId: state.info.usuario.id,
        ...(conDatosFiscales ? {
          rncSuplidor: document.getElementById('g-rnc').value || null, ncf: document.getElementById('g-ncf').value || null,
          tipoBienesServicios: document.getElementById('g-tipo').value, claseMonto: document.getElementById('g-clase').value,
          itbisFacturado: parseFloat(document.getElementById('g-itbis').value) || 0,
        } : {}),
      });
      window.PuntoXModal.cerrarModal();
      cargarCajaChica();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Transferencias a banco ---

async function cargarBanco() {
  const transferencias = await window.puntoXCaja.listarTransferenciasBanco({});
  document.getElementById('banco-vacio').style.display = transferencias.length === 0 ? 'block' : 'none';
  document.getElementById('banco-tbody').innerHTML = transferencias.map((t) => `
    <tr>
      <td><span class="pill-estado" style="background:${t.tipo === 'deposito' ? 'var(--color-success)' : 'var(--color-warning)'};">${t.tipo}</span></td>
      <td>${t.cuenta_nombre}</td><td>${t.banco}</td><td>${fmt(t.monto)}</td><td>${fechaHora(t.fecha)}</td><td>${t.usuario_nombre || ''}</td>
    </tr>
  `).join('');
}

async function abrirFormularioTransferencia() {
  const cuentas = await window.puntoXCaja.listarCuentasBancarias();
  const contenido = window.PuntoXModal.abrirModal('Nueva transferencia caja-banco', `
    <div class="form-field"><label>Cuenta bancaria</label>
      <select id="tb-cuenta" class="input-normal">
        ${cuentas.map((c) => `<option value="${c.id}">${c.nombre} — ${c.banco}</option>`).join('')}
        <option value="__nueva__">+ Nueva cuenta bancaria...</option>
      </select>
    </div>
    <div id="tb-nueva-cuenta" style="display:none; margin-top:10px;" class="form-grid">
      <div class="form-field"><label>Nombre</label><input id="tb-nc-nombre" class="input-normal" /></div>
      <div class="form-field"><label>Banco</label><input id="tb-nc-banco" class="input-normal" /></div>
      <div class="form-field"><label>Número de cuenta</label><input id="tb-nc-numero" class="input-normal" /></div>
    </div>
    <div class="form-field" style="margin-top:10px;"><label>Tipo</label>
      <select id="tb-tipo" class="input-normal"><option value="deposito">Depósito (de caja a banco)</option><option value="retiro">Retiro (de banco a caja)</option></select>
    </div>
    <div class="form-field" style="margin-top:10px;"><label>Monto *</label><input id="tb-monto" class="input-normal" type="number" step="0.01" value="0" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="tb-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="tb-guardar">Registrar transferencia</button>
    </div>
  `);

  document.getElementById('tb-cuenta').addEventListener('change', (e) => {
    document.getElementById('tb-nueva-cuenta').style.display = e.target.value === '__nueva__' ? 'grid' : 'none';
  });
  document.getElementById('tb-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('tb-guardar').addEventListener('click', async () => {
    try {
      let cuentaBancariaId = document.getElementById('tb-cuenta').value;
      if (cuentaBancariaId === '__nueva__') {
        const nueva = await window.puntoXCaja.crearCuentaBancaria({
          nombre: document.getElementById('tb-nc-nombre').value, banco: document.getElementById('tb-nc-banco').value,
          numeroCuenta: document.getElementById('tb-nc-numero').value, monedaId: state.info.monedaId,
        });
        cuentaBancariaId = nueva.id;
      }
      await window.puntoXCaja.crearTransferenciaBanco({
        cajaId: state.cajaActual.id, turnoCajaId: state.turnoActual ? state.turnoActual.id : null,
        cuentaBancariaId, tipo: document.getElementById('tb-tipo').value,
        monto: parseFloat(document.getElementById('tb-monto').value) || 0, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarBanco();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Conciliación bancaria ---

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fechaCorta(iso) {
  if (!iso) return '—';
  // Las partidas del banco son fechas puras (YYYY-MM-DD): se muestran sin convertir zona horaria.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function montoCelda(n) {
  return `<td class="conc-monto ${n < 0 ? 'conc-monto--neg' : ''}">${n < 0 ? '−' : ''}${fmt(Math.abs(n)).replace('RD$ ', '')}</td>`;
}

function puedeGestionarConciliacion() {
  return state.info.tienePermiso('caja.conciliacion.gestionar');
}

async function ejecutarConciliacion(fn) {
  mostrarError(null);
  try {
    const resultado = await fn();
    await renderDetalleConciliacion();
    return resultado;
  } catch (err) { mostrarError(err.message); return undefined; }
}

async function cargarConciliaciones() {
  const panel = document.getElementById('tab-conciliacion');
  document.getElementById('acciones-tab').innerHTML = '<button class="btn btn-primario" id="btn-nueva-conciliacion" data-permiso="caja.conciliacion.gestionar">+ Nueva conciliación</button>';
  document.getElementById('btn-nueva-conciliacion').addEventListener('click', abrirFormularioConciliacion);

  let lista = [];
  try { lista = await window.puntoXCaja.listarConciliaciones({}); } catch (err) { mostrarError(err.message); }
  panel.innerHTML = `
    <p style="font-size:13px; color:var(--color-text-muted); margin:0 0 14px; max-width:760px;">
      Compara el estado de cuenta del banco contra los movimientos de la cuenta contable <strong>Bancos</strong>:
      ventas y cobros con tarjeta, transferencia o cheque, pagos a proveedores y depósitos de caja.
    </p>
    ${lista.length === 0 ? '<div class="empty-state">Aún no hay conciliaciones. Crea la primera con el estado de cuenta del mes.</div>' : `
    <table class="data-table">
      <thead><tr><th>Cuenta</th><th>Periodo</th><th>Saldo banco</th><th>Saldo en libros</th><th>Pendientes</th><th>Diferencia</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${lista.map((c) => `
          <tr>
            <td>${esc(c.cuenta_nombre)} — ${esc(c.banco)}</td>
            <td>${fechaCorta(c.periodo_desde)} al ${fechaCorta(c.periodo_hasta)}</td>
            <td>${fmt(c.saldoEstadoCuenta)}</td>
            <td>${fmt(c.saldoLibros)}</td>
            <td>${c.partidasPendientes} del banco · ${c.movimientosPendientes} del sistema</td>
            <td style="color:${Math.abs(c.diferencia) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)'}; font-weight:700;">${fmt(c.diferencia)}</td>
            <td><span class="pill-estado" style="background:${c.estado === 'conciliada' ? 'var(--color-success)' : 'var(--color-warning)'};">${c.estado === 'conciliada' ? 'Conciliada' : 'En proceso'}</span></td>
            <td><span class="enlace-accion" data-abrir-conciliacion="${c.id}">Abrir</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`}
  `;
  panel.querySelectorAll('[data-abrir-conciliacion]').forEach((el) => el.addEventListener('click', () => {
    state.conciliacionId = el.dataset.abrirConciliacion;
    state.partidaSeleccionada = null;
    renderDetalleConciliacion();
  }));
}

async function abrirFormularioConciliacion() {
  const cuentas = await window.puntoXCaja.listarCuentasBancarias();
  const hoy = new Date();
  const primeroMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  window.PuntoXModal.abrirModal('Nueva conciliación bancaria', `
    <div class="form-field"><label>Cuenta bancaria *</label>
      <select id="nc-cuenta" class="input-normal">
        ${cuentas.map((c) => `<option value="${c.id}">${esc(c.nombre)} — ${esc(c.banco)}${c.numero_cuenta ? ` (${esc(c.numero_cuenta)})` : ''}</option>`).join('')}
        <option value="__nueva__" ${cuentas.length === 0 ? 'selected' : ''}>+ Nueva cuenta bancaria...</option>
      </select>
    </div>
    <div id="nc-nueva-cuenta" style="display:${cuentas.length === 0 ? 'grid' : 'none'}; margin-top:10px;" class="form-grid">
      <div class="form-field"><label>Nombre</label><input id="nc-nc-nombre" class="input-normal" placeholder="Ej: Cuenta corriente" /></div>
      <div class="form-field"><label>Banco</label><input id="nc-nc-banco" class="input-normal" placeholder="Ej: Banco Popular" /></div>
      <div class="form-field"><label>Número de cuenta</label><input id="nc-nc-numero" class="input-normal" /></div>
    </div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>Periodo desde *</label><input id="nc-desde" type="date" class="input-normal" value="${iso(primeroMes)}" /></div>
      <div class="form-field"><label>Periodo hasta (fecha de corte) *</label><input id="nc-hasta" type="date" class="input-normal" value="${iso(hoy)}" /></div>
      <div class="form-field" style="grid-column: span 2;"><label>Saldo final según el estado de cuenta *</label><input id="nc-saldo" type="number" step="0.01" class="input-normal" placeholder="0.00" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="nc-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="nc-guardar">Crear conciliación</button>
    </div>
  `);
  document.getElementById('nc-cuenta').addEventListener('change', (e) => {
    document.getElementById('nc-nueva-cuenta').style.display = e.target.value === '__nueva__' ? 'grid' : 'none';
  });
  document.getElementById('nc-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('nc-guardar').addEventListener('click', async () => {
    try {
      let cuentaBancariaId = document.getElementById('nc-cuenta').value;
      if (cuentaBancariaId === '__nueva__') {
        const nueva = await window.puntoXCaja.crearCuentaBancaria({
          nombre: document.getElementById('nc-nc-nombre').value, banco: document.getElementById('nc-nc-banco').value,
          numeroCuenta: document.getElementById('nc-nc-numero').value, monedaId: state.info.monedaId,
        });
        cuentaBancariaId = nueva.id;
      }
      const saldo = document.getElementById('nc-saldo').value;
      state.conciliacionId = await window.puntoXCaja.crearConciliacion({
        cuentaBancariaId, periodoDesde: document.getElementById('nc-desde').value, periodoHasta: document.getElementById('nc-hasta').value,
        saldoEstadoCuenta: saldo === '' ? null : parseFloat(saldo), usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      state.partidaSeleccionada = null;
      renderDetalleConciliacion();
    } catch (err) {
      window.PuntoXModal.cerrarModal();
      mostrarError(err.message);
    }
  });
}

const ESTADO_PARTIDA = {
  pendiente: ['Pendiente', 'var(--color-warning)'],
  conciliada: ['Conciliada', 'var(--color-success)'],
  registrada: ['Registrada', 'var(--color-info)'],
};

async function renderDetalleConciliacion() {
  const panel = document.getElementById('tab-conciliacion');
  document.getElementById('acciones-tab').innerHTML = '';
  let datos;
  try { datos = await window.puntoXCaja.obtenerConciliacion({ conciliacionId: state.conciliacionId }); } catch (err) { mostrarError(err.message); return; }
  const { conciliacion: c, partidas, movimientos, resumen: r } = datos;
  const editable = c.estado === 'en_proceso' && puedeGestionarConciliacion();
  const seleccion = partidas.find((p) => p.id === state.partidaSeleccionada && !p.conciliado) || null;
  if (!seleccion) state.partidaSeleccionada = null;

  const partidaPorLinea = Object.fromEntries(partidas.filter((p) => p.asiento_detalle_id).map((p) => [p.asiento_detalle_id, p]));
  const cuadraDiferencia = Math.abs(r.diferencia) < 0.01;

  panel.innerHTML = `
    <span class="conc-volver" id="conc-volver">← Todas las conciliaciones</span>
    <div class="conc-encabezado">
      <div>
        <div class="conc-encabezado__titulo">${esc(c.cuenta_nombre)} — ${esc(c.banco)}</div>
        <div class="conc-encabezado__sub">Periodo ${fechaCorta(c.periodo_desde)} al ${fechaCorta(c.periodo_hasta)}
          ${c.estado === 'conciliada' ? ` · Conciliada el ${fechaHora(c.fecha_conciliada)}` : ''}</div>
      </div>
      <span class="pill-estado" style="background:${c.estado === 'conciliada' ? 'var(--color-success)' : 'var(--color-warning)'};">${c.estado === 'conciliada' ? 'Conciliada' : 'En proceso'}</span>
    </div>

    <div class="conc-resumen">
      <div class="resumen-turno__item"><div class="resumen-turno__label">Saldo estado de cuenta</div>
        <div class="resumen-turno__valor">${fmt(r.saldoEstadoCuenta)}</div>
        ${editable ? '<span class="enlace-accion" id="conc-editar-saldo" style="font-size:11px;">Cambiar</span>' : ''}</div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">+ Depósitos en tránsito</div><div class="resumen-turno__valor">${fmt(r.depositosEnTransito)}</div></div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">− Cheques en tránsito</div><div class="resumen-turno__valor">${fmt(r.chequesEnTransito)}</div></div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">Saldo en libros (Bancos)</div><div class="resumen-turno__valor">${fmt(r.saldoLibros)}</div></div>
      <div class="resumen-turno__item"><div class="resumen-turno__label">+ Partidas del banco pendientes</div><div class="resumen-turno__valor">${fmt(r.partidasBancoPendientes)}</div></div>
      <div class="resumen-turno__item ${cuadraDiferencia ? 'conc-resumen__item--cuadra' : 'conc-resumen__item--diferencia'}"><div class="resumen-turno__label">Diferencia</div>
        <div class="resumen-turno__valor" style="color:${cuadraDiferencia ? 'var(--color-success)' : 'var(--color-danger)'};">${fmt(r.diferencia)}</div></div>
    </div>
    <div class="conc-formula">
      Banco ajustado ${fmt(r.saldoBancoAjustado)} vs. libros ajustados ${fmt(r.saldoLibrosAjustado)}.
      ${r.cuadra ? `<strong style="color:var(--color-success);">${c.estado === 'conciliada' ? 'Cuadra.' : 'Cuadra: lista para cerrar.'}</strong>`
        : (r.partidasPendientes > 0 ? `Faltan ${r.partidasPendientes} partida(s) del banco por conciliar o registrar.`
          : 'Si la diferencia no se explica, revisa el saldo del estado de cuenta; si es la primera conciliación, puede faltar el saldo inicial del banco en Contabilidad.')}
    </div>

    <div class="conc-acciones">
      ${editable ? `
        <button class="btn btn-secundario btn-chico" id="conc-agregar">+ Agregar partida</button>
        <button class="btn btn-secundario btn-chico" id="conc-pegar">Pegar desde el banco</button>
        <button class="btn btn-secundario btn-chico" id="conc-auto">Conciliar automáticamente</button>
        <button class="btn btn-primario btn-chico" id="conc-cerrar" ${r.cuadra ? '' : 'disabled title="Concilia o registra todas las partidas del banco y deja la diferencia en cero"'}>Cerrar conciliación</button>` : ''}
      ${c.estado === 'conciliada' && puedeGestionarConciliacion() ? '<button class="btn btn-secundario btn-chico" id="conc-reabrir">Reabrir</button>' : ''}
    </div>

    ${seleccion ? `<div class="conc-aviso">
      Partida seleccionada: <strong>${esc(seleccion.descripcion)}</strong> (${fmt(seleccion.monto)}). Elige a la derecha el movimiento del sistema que le corresponde.
      <span class="enlace-accion" id="conc-cancelar-seleccion" style="margin-left:8px;">Cancelar</span></div>` : ''}

    <div class="conc-columnas">
      <div class="conc-columna">
        <div class="conc-columna__titulo">Estado de cuenta del banco</div>
        <div class="conc-columna__sub">${partidas.length} partida(s) · ${r.partidasConciliadas} conciliada(s)</div>
        ${partidas.length === 0 ? '<div class="empty-state">Agrega las partidas del estado de cuenta, o pégalas desde el archivo del banco.</div>' : `
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Descripción</th><th class="conc-monto">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${partidas.map((p) => {
              const estado = !p.conciliado ? 'pendiente' : (p.asiento_id ? 'registrada' : 'conciliada');
              const [etiqueta, color] = ESTADO_PARTIDA[estado];
              const acciones = !editable ? '' : (estado === 'pendiente'
                ? `<span class="enlace-accion" data-seleccionar="${p.id}">Emparejar</span> ·
                   <span class="enlace-accion" data-registrar="${p.id}" title="${p.monto < 0 ? 'Gasto bancario: Gastos Operativos contra Bancos' : 'Crédito del banco: Bancos contra Gastos Operativos'}">Registrar</span> ·
                   <span class="enlace-accion" data-quitar="${p.id}" style="color:var(--color-danger);">Quitar</span>`
                : `<span class="enlace-accion" data-deshacer="${p.id}">Deshacer</span>`);
              return `<tr class="${p.id === state.partidaSeleccionada ? 'conc-fila--seleccionada' : ''} ${p.conciliado ? 'conc-fila--conciliada' : ''}">
                <td>${fechaCorta(p.fecha)}</td><td>${esc(p.descripcion)}</td>${montoCelda(p.monto)}
                <td><span class="conc-estado" style="background:${color};">${etiqueta}</span></td><td style="white-space:nowrap;">${acciones}</td></tr>`;
            }).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="conc-columna">
        <div class="conc-columna__titulo">Movimientos del sistema (cuenta Bancos)</div>
        <div class="conc-columna__sub">Hasta el ${fechaCorta(c.periodo_hasta)}, incluidos los que quedaron en tránsito de periodos anteriores</div>
        ${movimientos.length === 0 ? '<div class="empty-state">No hay movimientos bancarios en el sistema hasta la fecha de corte.</div>' : `
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Concepto</th><th class="conc-monto">Monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${movimientos.map((m) => {
              const candidata = seleccion && m.disponible && Math.abs(m.monto - seleccion.monto) < 0.009;
              const pareja = partidaPorLinea[m.asiento_detalle_id];
              const estado = m.conciliado
                ? `<span class="conc-estado" style="background:var(--color-success);" title="${pareja ? esc(pareja.descripcion) : ''}">Conciliado</span>`
                : `<span class="conc-estado" style="background:var(--color-warning);">${m.disponible ? 'En tránsito' : 'Conciliado después'}</span>`;
              return `<tr class="${candidata ? 'conc-fila--candidata' : ''} ${m.conciliado ? 'conc-fila--conciliada' : ''}">
                <td>${fechaCorta(m.fecha)}</td><td>${esc(m.concepto)}</td>${montoCelda(m.monto)}<td>${estado}</td>
                <td>${candidata ? `<span class="enlace-accion" data-emparejar="${m.asiento_detalle_id}">Emparejar</span>` : ''}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        ${seleccion && !movimientos.some((m) => m.disponible && Math.abs(m.monto - seleccion.monto) < 0.009)
          ? '<p style="font-size:12px; color:var(--color-text-muted);">Ningún movimiento pendiente del sistema tiene ese monto. Si es un cargo o crédito del banco, usa "Registrar".</p>' : ''}`}
      </div>
    </div>
  `;

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const usuarioId = state.info.usuario.id;
  on('conc-volver', () => { state.conciliacionId = null; mostrarError(null); cargarConciliaciones(); });
  on('conc-agregar', abrirFormularioPartida);
  on('conc-pegar', abrirFormularioPegarPartidas);
  on('conc-auto', async () => {
    const n = await ejecutarConciliacion(() => window.puntoXCaja.conciliarAutomaticamente({ conciliacionId: c.id, usuarioId }));
    if (n !== undefined && n === 0) mostrarError('No se encontraron parejas automáticas (mismo monto y fecha a ±7 días). Empareja manualmente o registra las partidas.');
  });
  on('conc-cerrar', () => {
    if (!confirm('¿Cerrar la conciliación? Quedará bloqueada; para cambiarla habrá que reabrirla.')) return;
    ejecutarConciliacion(() => window.puntoXCaja.cerrarConciliacion({ conciliacionId: c.id, usuarioId }));
  });
  on('conc-reabrir', () => ejecutarConciliacion(() => window.puntoXCaja.reabrirConciliacion({ conciliacionId: c.id, usuarioId })));
  on('conc-cancelar-seleccion', () => { state.partidaSeleccionada = null; renderDetalleConciliacion(); });
  on('conc-editar-saldo', () => {
    const valor = prompt('Saldo final según el estado de cuenta:', r.saldoEstadoCuenta);
    if (valor === null || valor.trim() === '') return;
    ejecutarConciliacion(() => window.puntoXCaja.actualizarSaldoEstadoCuenta({ conciliacionId: c.id, saldoEstadoCuenta: parseFloat(valor), usuarioId }));
  });

  panel.querySelectorAll('[data-seleccionar]').forEach((el) => el.addEventListener('click', () => { state.partidaSeleccionada = el.dataset.seleccionar; renderDetalleConciliacion(); }));
  panel.querySelectorAll('[data-emparejar]').forEach((el) => el.addEventListener('click', () => {
    const partidaId = state.partidaSeleccionada;
    state.partidaSeleccionada = null;
    ejecutarConciliacion(() => window.puntoXCaja.conciliarPareja({ partidaId, asientoDetalleId: el.dataset.emparejar, usuarioId }));
  }));
  panel.querySelectorAll('[data-registrar]').forEach((el) => el.addEventListener('click', () => {
    const p = partidas.find((x) => x.id === el.dataset.registrar);
    const texto = p.monto < 0
      ? `¿Registrar "${p.descripcion}" (${fmt(-p.monto)}) como gasto bancario?\n\nAsiento: Gastos Operativos al debe, Bancos al haber.`
      : `¿Registrar "${p.descripcion}" (${fmt(p.monto)}) como crédito del banco?\n\nAsiento: Bancos al debe, Gastos Operativos al haber.`;
    if (!confirm(texto)) return;
    ejecutarConciliacion(() => window.puntoXCaja.registrarPartidaEnContabilidad({ partidaId: p.id, usuarioId }));
  }));
  panel.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => {
    if (!confirm('¿Quitar esta partida del estado de cuenta?')) return;
    ejecutarConciliacion(() => window.puntoXCaja.eliminarPartidaConciliacion({ partidaId: el.dataset.quitar, usuarioId }));
  }));
  panel.querySelectorAll('[data-deshacer]').forEach((el) => el.addEventListener('click', () => {
    const p = partidas.find((x) => x.id === el.dataset.deshacer);
    if (p.asiento_id && !confirm('Esta partida se registró en contabilidad. Deshacerla revierte ese asiento con uno de reversión. ¿Continuar?')) return;
    ejecutarConciliacion(() => window.puntoXCaja.deshacerConciliacionPartida({ partidaId: p.id, usuarioId }));
  }));
}

function abrirFormularioPartida() {
  window.PuntoXModal.abrirModal('Agregar partida del estado de cuenta', `
    <div class="form-grid">
      <div class="form-field"><label>Fecha *</label><input id="pa-fecha" type="date" class="input-normal" value="${new Date().toISOString().slice(0, 10)}" /></div>
      <div class="form-field"><label>Tipo *</label>
        <select id="pa-tipo" class="input-normal">
          <option value="credito">Crédito (depósito, transferencia recibida)</option>
          <option value="debito">Débito (cheque cobrado, pago, cargo)</option>
        </select>
      </div>
      <div class="form-field" style="grid-column: span 2;"><label>Descripción *</label><input id="pa-descripcion" class="input-normal" placeholder="Como aparece en el estado de cuenta" /></div>
      <div class="form-field"><label>Monto *</label><input id="pa-monto" type="number" step="0.01" min="0" class="input-normal" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="pa-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="pa-guardar">Agregar</button>
    </div>
  `);
  document.getElementById('pa-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('pa-guardar').addEventListener('click', async () => {
    const monto = Math.abs(parseFloat(document.getElementById('pa-monto').value) || 0);
    const partida = {
      fecha: document.getElementById('pa-fecha').value, descripcion: document.getElementById('pa-descripcion').value,
      monto: document.getElementById('pa-tipo').value === 'debito' ? -monto : monto,
    };
    window.PuntoXModal.cerrarModal();
    await ejecutarConciliacion(() => window.puntoXCaja.agregarPartidasConciliacion({ conciliacionId: state.conciliacionId, partidas: [partida], usuarioId: state.info.usuario.id }));
  });
}

// Líneas copiadas del Excel/CSV del banco, una por renglón, separadas por tabulador o punto y
// coma: "fecha; descripción; monto" o "fecha; descripción; débito; crédito". Los renglones que
// no empiezan con una fecha (encabezados, totales) se ignoran.
function interpretarMonto(texto) {
  let t = String(texto || '').replace(/RD\$|\$|\s/g, '');
  if (!t) return 0;
  const negativo = /^\(.*\)$/.test(t) || t.startsWith('-') || t.endsWith('-');
  t = t.replace(/[()\-]/g, '');
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else t = t.replace(/,/g, '');                                                           // 1,234.56
  const n = parseFloat(t);
  return Number.isNaN(n) ? NaN : (negativo ? -n : n);
}

function interpretarFecha(texto) {
  const t = String(texto || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function interpretarPegado(texto) {
  const partidas = [];
  let ignoradas = 0;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const cols = linea.split(/\t|;/).map((c) => c.trim());
    const fecha = interpretarFecha(cols[0]);
    if (!fecha || cols.length < 3) { ignoradas += 1; continue; }
    let monto;
    if (cols.length >= 4) monto = (interpretarMonto(cols[3]) || 0) - Math.abs(interpretarMonto(cols[2]) || 0);
    else monto = interpretarMonto(cols[2]);
    if (!monto || Number.isNaN(monto) || !cols[1]) { ignoradas += 1; continue; }
    partidas.push({ fecha, descripcion: cols[1], monto: Math.round(monto * 100) / 100 });
  }
  return { partidas, ignoradas };
}

function abrirFormularioPegarPartidas() {
  window.PuntoXModal.abrirModal('Pegar partidas del estado de cuenta', `
    <p style="font-size:12px; color:var(--color-text-muted); margin:0 0 10px;">
      Copia las filas del estado de cuenta (Excel o CSV del banco) y pégalas aquí. Formatos aceptados, separados por tabulador o punto y coma:<br/>
      <code>fecha; descripción; monto</code> (débitos en negativo) o <code>fecha; descripción; débito; crédito</code>.
      Fechas como 15/09/2026 o 2026-09-15. Se ignoran encabezados y totales.
    </p>
    <div class="form-field"><textarea id="pp-texto" rows="10" style="font-family:monospace; font-size:12px;" placeholder="15/09/2026&#9;DEPOSITO EN EFECTIVO&#9;&#9;4,000.00&#10;16/09/2026&#9;COMISION MANEJO CUENTA&#9;150.00&#9;"></textarea></div>
    <div id="pp-vista" style="font-size:12px; margin-top:8px; color:var(--color-text-muted);">Pega las filas para ver cuántas se reconocen.</div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="pp-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="pp-guardar" disabled>Agregar partidas</button>
    </div>
  `);
  const textarea = document.getElementById('pp-texto');
  const vista = document.getElementById('pp-vista');
  const boton = document.getElementById('pp-guardar');
  let resultado = { partidas: [], ignoradas: 0 };
  textarea.addEventListener('input', () => {
    resultado = interpretarPegado(textarea.value);
    const total = resultado.partidas.reduce((a, p) => a + p.monto, 0);
    vista.innerHTML = resultado.partidas.length === 0
      ? `No se reconoció ninguna partida${resultado.ignoradas ? ` (${resultado.ignoradas} línea(s) ignorada(s))` : ''}.`
      : `<strong>${resultado.partidas.length}</strong> partida(s) reconocida(s), neto ${fmt(total)}${resultado.ignoradas ? ` · ${resultado.ignoradas} línea(s) ignorada(s)` : ''}.`;
    boton.disabled = resultado.partidas.length === 0;
  });
  document.getElementById('pp-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  boton.addEventListener('click', async () => {
    window.PuntoXModal.cerrarModal();
    await ejecutarConciliacion(() => window.puntoXCaja.agregarPartidasConciliacion({ conciliacionId: state.conciliacionId, partidas: resultado.partidas, usuarioId: state.info.usuario.id }));
  });
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('caja');
  // La conciliación bancaria solo existe en la app de escritorio.
  if (!window.puntoXCaja.listarConciliaciones) document.querySelector('.tab-btn[data-tab="conciliacion"]').remove();
  state.cajaActual = await window.puntoXCaja.obtenerCajaPrincipal();
  cambiarTab('turno');
}

init();
