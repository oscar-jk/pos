// Monitor de comprobantes electrónicos: estado de cada e-CF ante la DGII, mensajes de
// validación, reintentos, XML firmado y anulación de secuencias (ANECF).
const state = { info: null, estado: null, lista: [], temporizador: null };

const TIPOS = { 31: 'Crédito fiscal', 32: 'Consumo', 33: 'Nota de débito', 34: 'Nota de crédito', 41: 'Compras', 43: 'Gastos menores', 44: 'Regímenes especiales', 45: 'Gubernamental' };
const ESTADOS = {
  pendiente: ['Pendiente de envío', 'var(--color-warning)'],
  en_proceso: ['En proceso', 'var(--color-info)'],
  aceptado: ['Aceptado', 'var(--color-success)'],
  aceptado_condicional: ['Aceptado condicional', 'var(--color-success)'],
  rechazado: ['Rechazado', 'var(--color-danger)'],
  anulado: ['Anulado', 'var(--color-text-faint)'],
};
// Entrega al comprador electrónico (paso 3 del modelo emisor-receptor).
const ENTREGA = {
  entregado: 'Entregado al comprador electrónico (acuse recibido)',
  no_recibido: 'El comprador electrónico no lo recibió',
  no_electronico: 'El comprador no es receptor electrónico: entréguele la representación impresa',
  pendiente: 'Entrega al comprador pendiente',
};
const ESTADOS_ANULACION = { pendiente: ['Pendiente', 'var(--color-warning)'], aceptada: ['Aceptada', 'var(--color-success)'], rechazada: ['Rechazada', 'var(--color-danger)'] };
const DOCUMENTOS = { factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };
const COLOR_ALERTA = { error: 'var(--color-danger)', aviso: 'var(--color-warning)' };

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}
function mostrarExito(msg) {
  const el = document.getElementById('mensaje-exito');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
async function ejecutar(fn) {
  mostrarError(null);
  try { return await fn(); } catch (err) { mostrarError(err.message); return null; }
}
const tienePermiso = (codigo) => Boolean(state.info && state.info.usuario && state.info.usuario.permisos.includes(codigo));

function pintarResumen(e) {
  const ambiente = { TesteCF: 'pruebas (TesteCF)', CerteCF: 'certificación (CerteCF)', eCF: 'producción' }[e.ambiente] || e.ambiente;
  document.getElementById('subtitulo-ecf').textContent = e.modo === 'electronico'
    ? `Emitiendo e-CF en el ambiente de ${ambiente}${e.contingenciaDesde ? ' · contingencia activa (NCF serie B)' : ''}.`
    : 'El negocio emite NCF tradicionales (serie B). Active los e-CF en Configuración > Facturación electrónica.';
  document.getElementById('alertas-ecf').innerHTML = e.alertas.length ? `
    <div class="card" style="margin-bottom:16px;"><div class="alert-list">
      ${e.alertas.map((a) => `
        <div class="alert-item">
          <span class="alert-item__bar" style="background:${esc(COLOR_ALERTA[a.nivel] || 'var(--color-info)')};"></span>
          <span class="alert-item__text">${esc(a.texto)}</span>
        </div>`).join('')}
    </div></div>` : '';
  const c = e.conteos || {};
  const tarjeta = (titulo, valor, color, sub) => `
    <div class="kpi-card">
      <div class="kpi-card__label"><span class="kpi-card__dot" style="background:${esc(color)}"></span><span>${esc(titulo)}</span></div>
      <div class="kpi-card__value">${esc(valor)}</div>
      <div class="kpi-card__sub">${esc(sub)}</div>
    </div>`;
  document.getElementById('kpis-ecf').innerHTML = [
    tarjeta('Pendientes de envío', c.pendiente || 0, 'var(--color-warning)', 'Se envían solos cuando hay conexión'),
    tarjeta('En proceso', c.en_proceso || 0, 'var(--color-info)', 'Esperando el resultado de la DGII'),
    tarjeta('Aceptados', (c.aceptado || 0) + (c.aceptado_condicional || 0), 'var(--color-success)', `${c.aceptado_condicional || 0} condicionales`),
    tarjeta('Rechazados', c.rechazado || 0, 'var(--color-danger)', 'Anúlelos y emítalos de nuevo'),
  ].join('');
}

function celdaEstado(d) {
  const [texto, color] = ESTADOS[d.estado] || [d.estado, 'var(--color-text-faint)'];
  const detalle = [];
  if (d.estado === 'pendiente' && d.ultimo_error) detalle.push(`Último intento: ${d.ultimo_error}`);
  if (d.estado === 'pendiente' && d.contingencia) detalle.push('Emitido sin conexión (contingencia)');
  for (const m of d.mensajes || []) detalle.push(`${m.codigo ? `${m.codigo}: ` : ''}${m.valor}`);
  if (d.entrega_estado) detalle.push(ENTREGA[d.entrega_estado] + (d.entrega_estado === 'pendiente' && d.entrega_error ? ` (${d.entrega_error})` : ''));
  if (d.aprobacion_estado) detalle.push(`Cliente: ${d.aprobacion_estado === 1 ? 'aprobación comercial' : 'rechazo comercial'}${d.aprobacion_motivo ? ` — ${d.aprobacion_motivo}` : ''}`);
  return `<span class="pill-estado" style="background:${esc(color)};">${esc(texto)}</span>
    ${detalle.map((t) => `<div class="mensaje-dgii">${esc(t)}</div>`).join('')}`;
}

function pintarLista() {
  const lista = state.lista;
  document.getElementById('ecf-vacio').style.display = lista.length ? 'none' : 'block';
  document.getElementById('ecf-tbody').innerHTML = lista.map((d) => `
    <tr>
      <td><strong>${esc(d.encf)}</strong><div class="mensaje-dgii">${esc(TIPOS[d.tipo_ecf] || '')}${d.via === 'rfce' ? ' · resumen RFCE' : ''}</div></td>
      <td>${esc(DOCUMENTOS[d.documento_tipo] || d.documento_tipo || '—')} ${esc(d.documento_numero || '')}${d.documento_estado === 'anulado' ? '<div class="mensaje-dgii">Documento anulado</div>' : ''}</td>
      <td>${esc(d.cliente_nombre)}</td>
      <td>${esc(d.fecha_firma)}</td>
      <td>${esc(fmt(d.monto_total))}</td>
      <td>${celdaEstado(d)}</td>
      <td style="white-space:nowrap;">
        ${['pendiente', 'en_proceso'].includes(d.estado) && tienePermiso('ventas.ecf.gestionar') ? `<span class="enlace-accion" data-reintentar="${esc(d.id)}">Reintentar</span> · ` : ''}
        <span class="enlace-accion" data-ver-xml="${esc(d.id)}">XML</span> ·
        <span class="enlace-accion" data-guardar-xml="${esc(d.id)}">Guardar</span>
      </td>
    </tr>`).join('');
  document.querySelectorAll('[data-reintentar]').forEach((el) => el.addEventListener('click', () => reintentar(el.dataset.reintentar, el)));
  document.querySelectorAll('[data-ver-xml]').forEach((el) => el.addEventListener('click', () => verXml(el.dataset.verXml)));
  document.querySelectorAll('[data-guardar-xml]').forEach((el) => el.addEventListener('click', async () => {
    const r = await ejecutar(() => window.puntoXEcf.exportarXml({ id: el.dataset.guardarXml }));
    if (r && r.guardado) mostrarExito(`XML guardado en ${r.ruta}`);
  }));
}

function filtros() {
  return {
    estado: document.getElementById('f-estado').value || undefined,
    tipoEcf: document.getElementById('f-tipo').value || undefined,
    desde: document.getElementById('f-desde').value || undefined,
    hasta: document.getElementById('f-hasta').value || undefined,
    texto: document.getElementById('f-texto').value.trim() || undefined,
  };
}

async function cargar() {
  const [estado, lista, anulaciones] = await Promise.all([
    ejecutar(() => window.puntoXEcf.estado()),
    ejecutar(() => window.puntoXEcf.listar(filtros())),
    ejecutar(() => window.puntoXEcf.listarAnulaciones()),
  ]);
  if (estado) { state.estado = estado; pintarResumen(estado); }
  if (lista) { state.lista = lista; pintarLista(); }
  if (anulaciones) pintarAnulaciones(anulaciones);
}

function pintarAnulaciones(lista) {
  document.getElementById('anulaciones-vacio').style.display = lista.length ? 'none' : 'block';
  document.getElementById('anulaciones-tbody').innerHTML = lista.map((a) => {
    const [texto, color] = ESTADOS_ANULACION[a.estado] || [a.estado, 'var(--color-text-faint)'];
    const detalle = a.estado === 'pendiente' && a.ultimo_error ? a.ultimo_error : [].concat((a.respuesta && a.respuesta.mensajes) || []).join('; ');
    return `
      <tr>
        <td>${esc(a.encf_desde)}</td><td>${esc(a.encf_hasta)}</td><td>${esc(a.cantidad)}</td><td>${esc(a.motivo)}</td>
        <td>${esc(a.usuario_nombre || '—')}</td><td>${esc(fechaHora(a.created_at))}</td>
        <td><span class="pill-estado" style="background:${esc(color)};">${esc(texto)}</span>${detalle ? `<div class="mensaje-dgii">${esc(detalle)}</div>` : ''}</td>
      </tr>`;
  }).join('');
}

async function reintentar(id, el) {
  el.textContent = 'Enviando…';
  const r = await ejecutar(() => window.puntoXEcf.reintentar({ id }));
  if (r) mostrarExito(`e-CF ${r.encf}: ${(ESTADOS[r.estado] || [r.estado])[0]}`);
  cargar();
}

async function verXml(id) {
  const r = await ejecutar(() => window.puntoXEcf.obtenerXml({ id }));
  if (!r) return;
  window.PuntoXModal.abrirModal(`e-CF ${r.encf}`, `
    <div class="xml-vista" id="xml-contenido"></div>
    ${r.xml_rfce ? '<p style="font-size:12px; color:var(--color-text-muted);">Consumo menor a RD$250,000: a la DGII se envió el resumen (RFCE); este e-CF completo se conserva en el sistema.</p>' : ''}`);
  // textContent: el XML se muestra tal cual, sin interpretarse como HTML.
  document.getElementById('xml-contenido').textContent = r.xml.replace(/></g, '>\n<');
}

async function anularSecuencias() {
  const secuencias = (state.estado ? state.estado.secuencias : []).filter((s) => s.activo && s.disponibles > 0);
  if (!secuencias.length) { mostrarError('No hay secuencias e-NCF con números disponibles.'); return; }
  window.PuntoXModal.abrirModal('Anular secuencias no usadas', `
    <p style="font-size:13px; color:var(--color-text-muted); margin-top:0;">
      Se anulan ante la DGII desde el próximo número disponible hasta el que indique (por ejemplo, el resto de un rango que venció).
      Esos números ya no se podrán usar. Para anular una factura use la anulación de la factura.
    </p>
    <div class="form-grid">
      <div class="form-field" style="grid-column: span 2;"><label>Secuencia *</label>
        <select id="an-secuencia">${secuencias.map((s) => `<option value="${esc(s.id)}">${esc(s.codigo)} — próximo ${esc(String(s.secuencia_actual))}, hasta ${esc(String(s.secuencia_hasta))}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Anular hasta el número *</label><input id="an-hasta" type="number" min="1" step="1" /></div>
      <div class="form-field"><label>Motivo *</label><input id="an-motivo" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="an-cancelar">Cancelar</button>
      <button type="button" class="btn btn-peligro" id="an-confirmar">Anular ante la DGII</button>
    </div>`);
  const select = document.getElementById('an-secuencia');
  const hasta = document.getElementById('an-hasta');
  const sugerir = () => { const s = secuencias.find((x) => x.id === select.value); hasta.value = s ? s.secuencia_hasta : ''; };
  select.addEventListener('change', sugerir);
  sugerir();
  document.getElementById('an-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('an-confirmar').addEventListener('click', async () => {
    const s = secuencias.find((x) => x.id === select.value);
    const r = await ejecutar(() => window.puntoXEcf.anularSecuencias({
      tipoEcf: s.tipo_ecf, hasta: Number(hasta.value), motivo: document.getElementById('an-motivo').value, usuarioId: state.info.usuario.id,
    }));
    if (!r) return;
    window.PuntoXModal.cerrarModal();
    mostrarExito(`Se anularán ${r.cantidad} números (${r.desde} a ${r.hasta}) ante la DGII.`);
    cargar();
  });
}

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('ventas');
  if (!state.info) return;
  if (!window.puntoXEcf) {
    ['panel-ecf', 'panel-anulaciones', 'acciones-pagina', 'kpis-ecf'].forEach((id) => document.getElementById(id).remove());
    mostrarError('La facturación electrónica está disponible en la aplicación de escritorio.');
    return;
  }
  ['f-estado', 'f-tipo', 'f-desde', 'f-hasta'].forEach((id) => document.getElementById(id).addEventListener('change', cargar));
  let espera = null;
  document.getElementById('f-texto').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(cargar, 300); });
  document.getElementById('btn-enviar-pendientes').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const r = await ejecutar(() => window.puntoXEcf.enviarPendientes());
    ev.target.disabled = false;
    if (r) mostrarExito(`Enviados: ${r.enviados} · aceptados: ${r.aceptados} · rechazados: ${r.rechazados} · con error: ${r.errores}`);
    cargar();
  });
  document.getElementById('btn-anular-secuencias').addEventListener('click', anularSecuencias);
  await cargar();
  // La cola trabaja en segundo plano: la lista se refresca sola.
  state.temporizador = setInterval(cargar, 30000);
}

init();
