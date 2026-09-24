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
      </div>
    `;
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
      await window.puntoXCaja.cerrarTurno({
        turnoId: state.turnoActual.id, efectivoContado: parseFloat(inputContado.value) || 0,
      });
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
      </tr>
    `;
  }).join('');
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
    <tr><td>${g.concepto}</td><td>${g.categoria || '—'}</td><td>${fmt(g.monto)}</td><td>${g.comprobante_ruta}</td><td>${fechaHora(g.fecha)}</td><td>${g.usuario_nombre || ''}</td></tr>
  `).join('');
}

function abrirFormularioGasto() {
  window.PuntoXModal.abrirModal('Nuevo gasto de caja chica', `
    <div class="form-grid">
      <div class="form-field"><label>Concepto *</label><input id="g-concepto" class="input-normal" /></div>
      <div class="form-field"><label>Categoría</label><input id="g-categoria" class="input-normal" placeholder="Ej: transporte, suministros" /></div>
      <div class="form-field"><label>Monto *</label><input id="g-monto" class="input-normal" type="number" step="0.01" value="0" /></div>
      <div class="form-field"><label>Comprobante *</label><input id="g-comprobante" class="input-normal" placeholder="Número de recibo / descripción" /></div>
    </div>
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

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('caja');
  state.cajaActual = await window.puntoXCaja.obtenerCajaPrincipal();
  cambiarTab('turno');
}

init();
