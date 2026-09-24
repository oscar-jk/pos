const state = {
  info: null,
  tab: 'cuentas',
  cuentas: [],
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

const TIPO_ETIQUETA = { activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio', ingreso: 'Ingreso', costo: 'Costo', gasto: 'Gasto' };

// --- Pestañas ---

const ACCIONES_TAB = {
  cuentas: '<button class="btn btn-primario" id="btn-nueva-cuenta">+ Nueva cuenta</button>',
  diario: '<button class="btn btn-primario" id="btn-nuevo-asiento" data-permiso="contabilidad.asiento_manual.crear">+ Nuevo asiento manual</button>',
};

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB[tab] || '';
  mostrarError(null);

  if (tab === 'cuentas') { cargarCuentas(); enlazarBtn('btn-nueva-cuenta', () => abrirFormularioCuenta()); }
  if (tab === 'diario') { cargarDiario(); enlazarBtn('btn-nuevo-asiento', abrirFormularioAsientoManual); }
  if (tab === 'mayor') cargarMayor();
  if (tab === 'comprobacion') cargarComprobacion();
  if (tab === 'financieros') cargarFinancieros();
  if (tab === 'periodos') cargarPeriodos();
}

function enlazarBtn(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Catálogo de cuentas ---

async function cargarCuentas() {
  state.cuentas = await window.puntoXContabilidad.listarCuentas();
  const porPadre = {};
  state.cuentas.forEach((c) => { porPadre[c.cuenta_padre_id || 'raiz'] = porPadre[c.cuenta_padre_id || 'raiz'] || []; porPadre[c.cuenta_padre_id || 'raiz'].push(c); });

  const filas = [];
  function agregar(padreId, nivel) {
    (porPadre[padreId || 'raiz'] || []).forEach((c) => {
      filas.push({ ...c, nivel });
      agregar(c.id, nivel + 1);
    });
  }
  agregar(null, 0);

  document.getElementById('cuentas-tbody').innerHTML = filas.map((c) => `
    <tr>
      <td class="${c.nivel === 0 ? 'cuenta-nivel-1' : 'cuenta-nivel-2'}">${c.codigo}</td>
      <td class="${c.nivel === 0 ? 'cuenta-nivel-1' : ''}">${c.nombre}</td>
      <td>${TIPO_ETIQUETA[c.tipo] || c.tipo}</td>
      <td>${c.es_movimiento ? 'Sí' : 'Agrupación'}</td>
      <td>${c.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activa</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactiva</span>'}</td>
      <td><span class="enlace-accion" data-editar="${c.id}">Editar</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormularioCuenta(el.dataset.editar)));
}

function opciones(lista, valorSel, etiquetaFn) {
  return lista.map((x) => `<option value="${x.id}" ${x.id === valorSel ? 'selected' : ''}>${etiquetaFn(x)}</option>`).join('');
}

async function abrirFormularioCuenta(cuentaId) {
  const esEdicion = Boolean(cuentaId);
  const cuenta = esEdicion ? state.cuentas.find((c) => c.id === cuentaId) : null;

  window.PuntoXModal.abrirModal(esEdicion ? 'Editar cuenta contable' : 'Nueva cuenta contable', `
    <div class="form-grid">
      <div class="form-field"><label>Código *</label><input id="cc-codigo" value="${cuenta ? cuenta.codigo : ''}" ${esEdicion ? 'disabled' : ''} /></div>
      <div class="form-field"><label>Nombre *</label><input id="cc-nombre" value="${cuenta ? cuenta.nombre : ''}" /></div>
      <div class="form-field"><label>Tipo</label>
        <select id="cc-tipo" ${esEdicion ? 'disabled' : ''}>
          ${Object.entries(TIPO_ETIQUETA).map(([v, e]) => `<option value="${v}" ${cuenta?.tipo === v ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </div>
      <div class="form-field"><label>Cuenta padre</label><select id="cc-padre"><option value="">— Ninguna (cuenta raíz) —</option>${opciones(state.cuentas.filter((c) => c.id !== cuentaId), cuenta ? cuenta.cuenta_padre_id : null, (c) => `${c.codigo} — ${c.nombre}`)}</select></div>
      <div class="form-field form-field--checkbox"><input id="cc-movimiento" type="checkbox" ${!cuenta || cuenta.es_movimiento ? 'checked' : ''} /><label>Recibe movimientos directos</label></div>
      ${esEdicion ? `<div class="form-field form-field--checkbox"><input id="cc-activo" type="checkbox" ${cuenta.activo ? 'checked' : ''} /><label>Activa</label></div>` : ''}
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="cc-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="cc-guardar">${esEdicion ? 'Guardar cambios' : 'Crear cuenta'}</button>
    </div>
  `);

  document.getElementById('cc-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('cc-guardar').addEventListener('click', async () => {
    try {
      if (esEdicion) {
        await window.puntoXContabilidad.actualizarCuenta({
          cuentaId, payload: {
            nombre: document.getElementById('cc-nombre').value, cuentaPadreId: document.getElementById('cc-padre').value || null,
            esMovimiento: document.getElementById('cc-movimiento').checked, activo: document.getElementById('cc-activo').checked,
          },
        });
      } else {
        await window.puntoXContabilidad.crearCuenta({
          codigo: document.getElementById('cc-codigo').value, nombre: document.getElementById('cc-nombre').value,
          tipo: document.getElementById('cc-tipo').value, cuentaPadreId: document.getElementById('cc-padre').value || null,
          esMovimiento: document.getElementById('cc-movimiento').checked,
        });
      }
      window.PuntoXModal.cerrarModal();
      cargarCuentas();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Libro diario ---

async function cargarDiario() {
  const asientos = await window.puntoXContabilidad.listarAsientos({});
  const contenedor = document.getElementById('diario-lista');
  if (asientos.length === 0) {
    contenedor.innerHTML = '<div class="empty-state">Aún no hay asientos contables.</div>';
    return;
  }
  contenedor.innerHTML = asientos.map((a) => `
    <div class="card" style="margin-bottom:12px;">
      <div class="card__header">
        <span class="card__title">${a.numero} — ${a.concepto}</span>
        <span>
          ${a.es_manual ? '<span class="pill-estado" style="background:var(--color-info); margin-right:6px;">Manual</span>' : ''}
          ${a.estado === 'anulado' ? '<span class="pill-estado" style="background:var(--color-danger); margin-right:6px;">Anulado</span>' : ''}
          <span style="font-size:12px; color:var(--color-text-muted);">${fechaCorta(a.fecha)} · ${a.origen_modulo}</span>
          ${a.es_manual && a.estado !== 'anulado' ? ` · <span class="enlace-accion" data-permiso="contabilidad.asiento_manual.crear" data-anular="${a.id}">Anular</span>` : ''}
        </span>
      </div>
      <table class="data-table">
        <thead><tr><th>Cuenta</th><th>Descripción</th><th style="text-align:right;">Debe</th><th style="text-align:right;">Haber</th></tr></thead>
        <tbody>
          ${a.lineas.map((l) => `<tr><td>${l.cuenta_codigo} — ${l.cuenta_nombre}</td><td>${l.descripcion || ''}</td><td style="text-align:right;">${l.debe > 0 ? fmt(l.debe) : ''}</td><td style="text-align:right;">${l.haber > 0 ? fmt(l.haber) : ''}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  document.querySelectorAll('[data-anular]').forEach((el) => el.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la anulación:');
    if (!motivo) return;
    try {
      await window.puntoXContabilidad.anularAsiento({ asientoId: el.dataset.anular, motivo, usuarioId: state.info.usuario.id });
      cargarDiario();
    } catch (err) { mostrarError(err.message); }
  }));
}

function abrirFormularioAsientoManual() {
  const lineas = [{ cuentaCodigo: '', debe: 0, haber: 0, descripcion: '' }, { cuentaCodigo: '', debe: 0, haber: 0, descripcion: '' }];
  const contenido = window.PuntoXModal.abrirModal('Nuevo asiento manual', `
    <div class="form-field"><label>Concepto *</label><input id="am-concepto" class="input-normal" placeholder="Ej: depreciación de mobiliario de septiembre" /></div>
    <div class="form-seccion">
      <div id="am-lineas"></div>
      <button type="button" class="btn btn-secundario btn-chico" id="am-agregar-linea">+ Agregar línea</button>
      <div style="margin-top:10px; font-size:13px;"><span id="am-total-debe">Debe: RD$ 0.00</span> · <span id="am-total-haber">Haber: RD$ 0.00</span></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="am-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="am-guardar">Registrar asiento</button>
    </div>
  `);

  function renderLineas() {
    document.getElementById('am-lineas').innerHTML = lineas.map((l, i) => `
      <div class="linea-dinamica">
        <select data-i="${i}" data-campo="cuentaCodigo" style="flex-grow:1;">
          <option value="">— Selecciona cuenta —</option>
          ${state.cuentas.filter((c) => c.es_movimiento).map((c) => `<option value="${c.codigo}" ${l.cuentaCodigo === c.codigo ? 'selected' : ''}>${c.codigo} — ${c.nombre}</option>`).join('')}
        </select>
        <input type="text" placeholder="Descripción" value="${l.descripcion}" data-i="${i}" data-campo="descripcion" style="width:140px;" />
        <input type="number" step="0.01" placeholder="Debe" value="${l.debe || ''}" data-i="${i}" data-campo="debe" style="width:90px;" />
        <input type="number" step="0.01" placeholder="Haber" value="${l.haber || ''}" data-i="${i}" data-campo="haber" style="width:90px;" />
        <span class="carrito-quitar" data-quitar="${i}">✕</span>
      </div>
    `).join('');
    contenido.querySelectorAll('#am-lineas select, #am-lineas input').forEach((el) => el.addEventListener('input', (e) => {
      const i = Number(e.target.dataset.i);
      const campo = e.target.dataset.campo;
      lineas[i][campo] = campo === 'debe' || campo === 'haber' ? parseFloat(e.target.value) || 0 : e.target.value;
      actualizarTotales();
    }));
    contenido.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); renderLineas(); actualizarTotales(); }));
  }

  function actualizarTotales() {
    const totalDebe = lineas.reduce((acc, l) => acc + (l.debe || 0), 0);
    const totalHaber = lineas.reduce((acc, l) => acc + (l.haber || 0), 0);
    document.getElementById('am-total-debe').textContent = `Debe: ${fmt(totalDebe)}`;
    document.getElementById('am-total-haber').textContent = `Haber: ${fmt(totalHaber)}`;
    document.getElementById('am-total-haber').style.color = Math.abs(totalDebe - totalHaber) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)';
  }
  renderLineas();
  actualizarTotales();

  document.getElementById('am-agregar-linea').addEventListener('click', () => { lineas.push({ cuentaCodigo: '', debe: 0, haber: 0, descripcion: '' }); renderLineas(); });
  document.getElementById('am-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('am-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXContabilidad.crearAsientoManual({
        fecha: new Date().toISOString(), concepto: document.getElementById('am-concepto').value, origenModulo: 'contabilidad',
        usuarioId: state.info.usuario.id, lineas: lineas.filter((l) => l.cuentaCodigo && (l.debe || l.haber)),
      });
      window.PuntoXModal.cerrarModal();
      cargarDiario();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Libro mayor ---

async function cargarMayor() {
  const select = document.getElementById('mayor-cuenta');
  if (select.options.length === 0) {
    select.innerHTML = opciones(state.cuentas.filter((c) => c.es_movimiento), null, (c) => `${c.codigo} — ${c.nombre}`);
    select.addEventListener('change', renderMayor);
  }
  renderMayor();
}

async function renderMayor() {
  const cuentaId = document.getElementById('mayor-cuenta').value;
  if (!cuentaId) return;
  const { cuenta, movimientos, saldoFinal } = await window.puntoXContabilidad.libroMayor({ cuentaId });
  document.getElementById('mayor-contenido').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th style="text-align:right;">Debe</th><th style="text-align:right;">Haber</th><th style="text-align:right;">Saldo</th></tr></thead>
      <tbody>
        ${movimientos.length === 0 ? '<tr><td colspan="6" style="text-align:center; color:var(--color-text-faint);">Sin movimientos</td></tr>' : ''}
        ${movimientos.map((m) => `<tr><td>${fechaCorta(m.fecha)}</td><td>${m.numero}</td><td>${m.concepto}</td><td style="text-align:right;">${m.debe > 0 ? fmt(m.debe) : ''}</td><td style="text-align:right;">${m.haber > 0 ? fmt(m.haber) : ''}</td><td style="text-align:right; font-weight:700;">${fmt(m.saldo_acumulado)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px; text-align:right; font-weight:800;">Saldo final de ${cuenta.codigo} — ${cuenta.nombre}: ${fmt(saldoFinal)}</div>
  `;
}

// --- Balance de comprobación ---

async function cargarComprobacion() {
  const filas = await window.puntoXContabilidad.balanceComprobacion({});
  document.getElementById('comprobacion-tbody').innerHTML = filas.length === 0
    ? '<tr><td colspan="6" style="text-align:center; color:var(--color-text-faint);">Sin movimientos registrados</td></tr>'
    : filas.map((f) => `<tr><td>${f.codigo}</td><td>${f.nombre}</td><td>${TIPO_ETIQUETA[f.tipo] || f.tipo}</td><td>${fmt(f.total_debe)}</td><td>${fmt(f.total_haber)}</td><td style="font-weight:700;">${fmt(f.saldo)}</td></tr>`).join('');

  const totalDebe = filas.reduce((acc, f) => acc + f.total_debe, 0);
  const totalHaber = filas.reduce((acc, f) => acc + f.total_haber, 0);
  document.getElementById('comprobacion-totales').textContent = `Total debe: ${fmt(totalDebe)}  ·  Total haber: ${fmt(totalHaber)}`;
}

// --- Estados financieros ---

async function cargarFinancieros() {
  const [resultados, balance] = await Promise.all([
    window.puntoXContabilidad.estadoResultados({}),
    window.puntoXContabilidad.balanceGeneral({}),
  ]);

  document.getElementById('estado-resultados').innerHTML = `
    <table class="data-table">
      <tbody>
        <tr><td colspan="2" style="font-weight:700;">Ingresos</td></tr>
        ${resultados.ingresos.map((c) => `<tr><td style="padding-left:20px;">${c.nombre}</td><td style="text-align:right;">${fmt(c.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:20px; color:var(--color-text-faint);">Sin movimientos</td><td></td></tr>'}
        <tr><td colspan="2" style="font-weight:700; padding-top:14px;">Costo de ventas</td></tr>
        ${resultados.costos.map((c) => `<tr><td style="padding-left:20px;">${c.nombre}</td><td style="text-align:right;">${fmt(c.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:20px; color:var(--color-text-faint);">Sin movimientos</td><td></td></tr>'}
        <tr class="reporte-total-row"><td>Utilidad bruta</td><td style="text-align:right;">${fmt(resultados.utilidadBruta)}</td></tr>
        <tr><td colspan="2" style="font-weight:700; padding-top:14px;">Gastos operativos</td></tr>
        ${resultados.gastos.map((c) => `<tr><td style="padding-left:20px;">${c.nombre}</td><td style="text-align:right;">${fmt(c.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:20px; color:var(--color-text-faint);">Sin movimientos</td><td></td></tr>'}
        <tr class="reporte-total-row"><td>Utilidad neta</td><td style="text-align:right;">${fmt(resultados.utilidadNeta)}</td></tr>
      </tbody>
    </table>
  `;

  document.getElementById('balance-general').innerHTML = `
    <table class="data-table">
      <tbody>
        <tr><td colspan="2" style="font-weight:700;">Activo</td></tr>
        ${balance.activos.map((c) => `<tr><td style="padding-left:20px;">${c.nombre}</td><td style="text-align:right;">${fmt(c.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:20px; color:var(--color-text-faint);">Sin movimientos</td><td></td></tr>'}
        <tr class="reporte-total-row"><td>Total activo</td><td style="text-align:right;">${fmt(balance.totalActivo)}</td></tr>
        <tr><td colspan="2" style="font-weight:700; padding-top:14px;">Pasivo</td></tr>
        ${balance.pasivos.map((c) => `<tr><td style="padding-left:20px;">${c.nombre}</td><td style="text-align:right;">${fmt(c.saldo)}</td></tr>`).join('') || '<tr><td style="padding-left:20px; color:var(--color-text-faint);">Sin movimientos</td><td></td></tr>'}
        <tr><td colspan="2" style="font-weight:700; padding-top:14px;">Patrimonio</td></tr>
        ${balance.patrimonio.map((c) => `<tr><td style="padding-left:20px;">${c.nombre}</td><td style="text-align:right;">${fmt(c.saldo)}</td></tr>`).join('')}
        <tr><td style="padding-left:20px;">Utilidad del periodo</td><td style="text-align:right;">${fmt(balance.utilidadDelPeriodo)}</td></tr>
        <tr class="reporte-total-row"><td>Total pasivo + patrimonio</td><td style="text-align:right;">${fmt(balance.totalPasivo + balance.totalPatrimonio)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:10px; font-size:12px; color:${balance.cuadra ? 'var(--color-success)' : 'var(--color-danger)'}; font-weight:700;">
      ${balance.cuadra ? '✓ El balance cuadra (Activo = Pasivo + Patrimonio)' : '⚠ El balance no cuadra — revisa los asientos'}
    </div>
  `;
}

// --- Periodos ---

async function cargarPeriodos() {
  const periodos = await window.puntoXContabilidad.listarPeriodos();
  document.getElementById('periodos-tbody').innerHTML = periodos.map((p) => `
    <tr>
      <td>${p.nombre}</td><td>${fechaCorta(p.fecha_inicio)}</td><td>${fechaCorta(p.fecha_fin)}</td>
      <td><span class="pill-estado" style="background:${p.estado === 'abierto' ? 'var(--color-success)' : 'var(--color-text-faint)'};">${p.estado}</span></td>
      <td>${fechaCorta(p.fecha_cierre)}</td>
      <td>
        ${p.estado === 'abierto'
          ? `<span class="enlace-accion" data-permiso="contabilidad.periodo.cerrar" data-cerrar="${p.id}">Cerrar periodo</span>`
          : `<span class="enlace-accion" data-permiso="contabilidad.periodo.reabrir" data-reabrir="${p.id}" style="color:var(--color-warning);">Reabrir</span>`}
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-cerrar]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm('¿Cerrar este periodo? No se podrán registrar nuevas operaciones con fecha dentro de él hasta que se reabra.')) return;
    try {
      await window.puntoXContabilidad.cerrarPeriodo({ periodoId: el.dataset.cerrar, usuarioId: state.info.usuario.id });
      cargarPeriodos();
    } catch (err) { mostrarError(err.message); }
  }));
  document.querySelectorAll('[data-reabrir]').forEach((el) => el.addEventListener('click', async () => {
    try {
      await window.puntoXContabilidad.reabrirPeriodo({ periodoId: el.dataset.reabrir, usuarioId: state.info.usuario.id });
      cargarPeriodos();
    } catch (err) { mostrarError(err.message); }
  }));
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('contabilidad');
  state.cuentas = await window.puntoXContabilidad.listarCuentas();
  cambiarTab('cuentas');
}

init();
