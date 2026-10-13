// Asistente de configuración inicial: un recorrido corto que deja el negocio listo para vender.
// Cada paso guarda al avanzar; se puede volver atrás, omitir y retomar desde Configuración.
const PASOS = ['Bienvenida', 'Tu negocio', 'Comprobantes', 'Sucursal y módulos', 'Equipo', 'Listo'];

const state = {
  paso: 0,
  datos: null,
  usuarioId: null,
  facturacion: 'ncf', // ncf | ecf
  usuariosAgregados: 0,
};

const icono = (n, t) => (window.PuntoXIconos ? window.PuntoXIconos.icono(n, t || 20) : '');
const el = (id) => document.getElementById(id);
const valor = (id) => (el(id) ? el(id).value : '');

function mostrarError(msg) {
  const e = el('mensaje-error');
  if (!msg) { e.style.display = 'none'; return; }
  e.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  e.style.display = 'block';
  window.scrollTo(0, 0);
}

function iniciales(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return (p.length > 1 ? p.slice(0, 2).map((x) => x[0]) : [...(p[0] || 'MN')].slice(0, 2)).join('').toUpperCase();
}

// --- Pasos ----------------------------------------------------------------------------------

function pasoBienvenida() {
  return `
    <h1 class="onb__titulo">Bienvenido a Nodo</h1>
    <p class="onb__texto">Vamos a dejar tu negocio listo para vender. Toma unos cinco minutos y puedes cambiar todo después desde Configuración.</p>
    <ul class="onb__lista">
      <li>${icono('cliente')}<span><strong>Tu negocio:</strong> nombre, RNC, dirección y logo para tus facturas.</span></li>
      <li>${icono('factura')}<span><strong>Comprobantes:</strong> los rangos de NCF que te autorizó la DGII, o los pasos para facturar en electrónico.</span></li>
      <li>${icono('ajustes')}<span><strong>Sucursal y módulos:</strong> el nombre de tu local y las funciones que quieres usar.</span></li>
      <li>${icono('clientes')}<span><strong>Equipo:</strong> los usuarios que van a cobrar en caja.</span></li>
    </ul>`;
}

function pasoNegocio() {
  const n = state.datos.negocio;
  return `
    <h1 class="onb__titulo">Tu negocio</h1>
    <p class="onb__texto">Estos datos salen en el encabezado de tus facturas.</p>
    <div class="onb__logo">
      <div class="onb__logo-vista" id="onb-logo-vista" aria-hidden="true"></div>
      <div>
        <div style="font-weight:700; font-size:14px;">Logo del negocio</div>
        <p class="onb__texto" style="margin:2px 0 8px; font-size:13px;">Opcional. PNG, JPG o WebP; se reduce solo.</p>
        <button type="button" class="btn btn-secundario btn-chico" id="onb-logo-cargar">Cargar logo</button>
        <button type="button" class="btn btn-peligro btn-chico" id="onb-logo-quitar" style="display:none;">Quitar</button>
        <input type="file" id="onb-logo-archivo" accept="image/png,image/jpeg,image/webp" hidden />
      </div>
    </div>
    <div class="onb__rejilla">
      <div class="form-field ancho"><label for="o-nombre">Nombre del negocio *</label><input id="o-nombre" class="input-normal" value="${esc(n.negocio_nombre === 'Mi Negocio' ? '' : n.negocio_nombre)}" maxlength="80" autocomplete="off" /></div>
      <div class="form-field"><label for="o-rnc">RNC o cédula</label><input id="o-rnc" class="input-normal" value="${esc(n.negocio_rnc || '')}" inputmode="numeric" placeholder="9 u 11 dígitos" /></div>
      <div class="form-field"><label for="o-telefono">Teléfono</label><input id="o-telefono" class="input-normal" value="${esc(n.negocio_telefono || '')}" /></div>
      <div class="form-field ancho"><label for="o-razon">Razón social (como aparece en la DGII)</label><input id="o-razon" class="input-normal" value="${esc(n.negocio_razon_social || '')}" maxlength="150" /></div>
      <div class="form-field ancho"><label for="o-direccion">Dirección</label><input id="o-direccion" class="input-normal" value="${esc(n.negocio_direccion || '')}" /></div>
    </div>`;
}

function filaNcf(t) {
  const bloqueado = t.emitidos ? 'disabled' : '';
  return `
    <tr data-tipo="${esc(t.id)}">
      <td><strong>${esc(t.codigo)}</strong></td><td>${esc(t.nombre)}</td>
      <td><input type="checkbox" data-campo="activo" ${t.activo ? 'checked' : ''} ${bloqueado} aria-label="Usar ${esc(t.codigo)}" /></td>
      <td><input type="number" class="input-normal" min="1" data-campo="desde" value="${esc(t.secuencia_desde)}" ${bloqueado} aria-label="Desde ${esc(t.codigo)}" /></td>
      <td><input type="number" class="input-normal" min="1" data-campo="hasta" value="${esc(t.secuencia_hasta)}" ${bloqueado} aria-label="Hasta ${esc(t.codigo)}" /></td>
    </tr>`;
}

function pasoComprobantes() {
  const ncf = state.facturacion === 'ncf';
  return `
    <h1 class="onb__titulo">Comprobantes</h1>
    <p class="onb__texto">Elige cómo vas a facturar. Puedes cambiarlo cuando quieras en Configuración.</p>
    <div class="onb__opciones" role="radiogroup" aria-label="Tipo de facturación">
      <label class="onb__opcion"><input type="radio" name="o-fact" value="ncf" ${ncf ? 'checked' : ''} /><span class="onb__opcion-titulo">Comprobantes fiscales (NCF)</span><span class="onb__opcion-texto">Serie B con los rangos que te autorizó la DGII. Lo más simple para empezar.</span></label>
      <label class="onb__opcion"><input type="radio" name="o-fact" value="ecf" ${ncf ? '' : 'checked'} /><span class="onb__opcion-titulo">Facturación electrónica (e-CF)</span><span class="onb__opcion-texto">Requiere certificado digital y habilitación en la DGII.</span></label>
    </div>
    ${ncf ? `
      <div class="onb__nota onb__nota--aviso">Los rangos que ves son de ejemplo. Escribe los que te asignó la DGII: usar números que no son tuyos invalida tus facturas.</div>
      <table class="data-table onb__tabla">
        <thead><tr><th>Código</th><th>Comprobante</th><th>Usar</th><th>Desde</th><th>Hasta</th></tr></thead>
        <tbody>${state.datos.tiposNcf.map(filaNcf).join('')}</tbody>
      </table>
      ${state.datos.tiposNcf.some((t) => t.emitidos) ? '<p class="onb__nota">Los comprobantes que ya emitiste no se pueden cambiar aquí. Para ampliar su rango usa Configuración → Parámetros fiscales.</p>' : ''}
    ` : `
      <ol class="onb__lista" style="margin-top:14px;">
        <li>${icono('permisos')}<span><strong>1. Certificado digital (.p12):</strong> lo emite una entidad certificadora autorizada.</span></li>
        <li>${icono('factura')}<span><strong>2. Secuencias e-CF:</strong> las solicitas en la Oficina Virtual de la DGII.</span></li>
        <li>${icono('confirmar')}<span><strong>3. Pruebas y certificación:</strong> primero en el ambiente de pruebas (TesteCF).</span></li>
      </ol>
      <p class="onb__nota">Mientras tanto Nodo factura con NCF tradicional. Cuando tengas el certificado, actívalo en Configuración → Facturación electrónica.</p>
    `}`;
}

function pasoSucursal() {
  const s = state.datos.sucursal;
  return `
    <h1 class="onb__titulo">Sucursal y módulos</h1>
    <p class="onb__texto">Dale nombre a tu local principal y activa solo lo que vas a usar.</p>
    <div class="form-field" style="max-width:420px;"><label for="o-sucursal">Nombre de la sucursal principal</label><input id="o-sucursal" class="input-normal" value="${esc(s ? s.nombre : '')}" maxlength="80" /></div>
    <h2 style="font-size:15px; margin:22px 0 4px;">Módulos opcionales</h2>
    ${state.datos.modulos.map((m) => `
      <label class="onb__modulo"><input type="checkbox" data-modulo="${esc(m.clave)}" ${m.activo ? 'checked' : ''} /><div><strong>${esc(m.nombre)}</strong><span>${esc(m.descripcion)}</span></div></label>`).join('')}`;
}

function pasoEquipo() {
  const cajero = state.datos.roles.find((r) => /cajero/i.test(r.nombre));
  return `
    <h1 class="onb__titulo">Equipo</h1>
    <p class="onb__texto">Crea los usuarios que van a cobrar. Cada uno cambia su contraseña la primera vez que entra. Puedes saltar este paso y hacerlo después.</p>
    <ul class="onb__equipo">
      ${state.datos.usuarios.map((u) => `<li><span>${esc(u.nombre_completo)} <small>@${esc(u.usuario)}</small></span><small>${esc(u.rol_nombre)}</small></li>`).join('')}
    </ul>
    <div class="onb__rejilla">
      <div class="form-field"><label for="o-u-nombre">Nombre completo</label><input id="o-u-nombre" class="input-normal" autocomplete="off" /></div>
      <div class="form-field"><label for="o-u-usuario">Usuario de acceso</label><input id="o-u-usuario" class="input-normal" autocomplete="off" /></div>
      <div class="form-field"><label for="o-u-rol">Rol</label><select id="o-u-rol" class="input-normal">${state.datos.roles.map((r) => `<option value="${esc(r.id)}" ${cajero && r.id === cajero.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div>
      <div class="form-field"><label for="o-u-clave">Contraseña temporal (mínimo 8 caracteres)</label><input id="o-u-clave" class="input-normal" type="text" autocomplete="off" /></div>
    </div>
    <button type="button" class="btn btn-secundario" id="o-u-agregar" style="margin-top:14px;">Agregar usuario</button>`;
}

function pasoListo() {
  const n = state.datos.negocio;
  const hecho = (ok, texto) => `<li><span class="${ok ? 'onb__marca-ok' : 'onb__marca-pendiente'}">${icono(ok ? 'confirmar' : 'alerta')}</span><span>${texto}</span></li>`;
  const ncfActivos = state.datos.tiposNcf.filter((t) => t.activo).map((t) => t.codigo).join(', ');
  return `
    <h1 class="onb__titulo">Todo listo</h1>
    <p class="onb__texto">Esto es lo que quedó configurado y lo que sigue.</p>
    <ul class="onb__resumen">
      ${hecho(n.negocio_nombre && n.negocio_nombre !== 'Mi Negocio', `Negocio: <strong>${esc(n.negocio_nombre)}</strong>${n.negocio_rnc ? ` · RNC ${esc(n.negocio_rnc)}` : ' · sin RNC (agrégalo para imprimir facturas válidas)'}`)}
      ${hecho(Boolean(n.negocio_logo), n.negocio_logo ? 'Logo cargado' : 'Sin logo (opcional)')}
      ${hecho(state.facturacion === 'ncf', state.facturacion === 'ncf' ? `Comprobantes activos: <strong>${esc(ncfActivos || 'ninguno')}</strong>` : 'Facturación electrónica: falta certificado y secuencias; mientras tanto se factura con NCF')}
      ${hecho(state.datos.usuarios.length > 1, `${esc(state.datos.usuarios.length)} usuario(s) en el sistema`)}
    </ul>
    <h2 style="font-size:15px; margin:0 0 8px;">Siguientes pasos</h2>
    <ul class="onb__lista">
      <li>${icono('producto')}<span>Registra tus productos y su existencia en <strong>Inventario</strong>.</span></li>
      <li>${icono('efectivo')}<span>Abre el turno con el fondo inicial en <strong>Caja y Tesorería</strong>.</span></li>
      <li>${icono('caja-registradora')}<span>Haz tu primera venta en <strong>Ventas y Facturación</strong>.</span></li>
    </ul>`;
}

const RENDER = [pasoBienvenida, pasoNegocio, pasoComprobantes, pasoSucursal, pasoEquipo, pasoListo];

// --- Guardado por paso -----------------------------------------------------------------------

async function guardarPaso() {
  const api = window.puntoXOnboarding;
  if (state.paso === 1) {
    state.datos = await api.guardarNegocio({
      nombre: valor('o-nombre'), iniciales: iniciales(valor('o-nombre')), rnc: valor('o-rnc'),
      razonSocial: valor('o-razon'), direccion: valor('o-direccion'), telefono: valor('o-telefono'), usuarioId: state.usuarioId,
    });
  } else if (state.paso === 2 && state.facturacion === 'ncf') {
    for (const fila of document.querySelectorAll('#onb-contenido tr[data-tipo]')) {
      const entrada = (c) => fila.querySelector(`[data-campo="${c}"]`);
      if (entrada('desde').disabled) continue; // ya emitió comprobantes de este tipo
      state.datos = await api.configurarNcf({
        tipoNcfId: fila.dataset.tipo, desde: entrada('desde').value, hasta: entrada('hasta').value, activo: entrada('activo').checked, usuarioId: state.usuarioId,
      });
    }
  } else if (state.paso === 3) {
    state.datos = await api.guardarSucursal({ nombre: valor('o-sucursal'), usuarioId: state.usuarioId });
    for (const caja of document.querySelectorAll('#onb-contenido [data-modulo]')) {
      const actual = state.datos.modulos.find((m) => m.clave === caja.dataset.modulo);
      if (actual && actual.activo !== caja.checked) await window.puntoXConfig.actualizarModulo({ clave: caja.dataset.modulo, activo: caja.checked, usuarioId: state.usuarioId });
    }
    state.datos = await api.datos();
  }
}

// --- Navegación ------------------------------------------------------------------------------

function pintarPasos() {
  el('onb-pasos').innerHTML = PASOS.map((nombre, i) => `
    <li class="onb__paso ${i < state.paso ? 'onb__paso--hecho' : ''} ${i === state.paso ? 'onb__paso--actual' : ''}" ${i === state.paso ? 'aria-current="step"' : ''}>
      <div class="onb__paso-barra"></div><div class="onb__paso-nombre">${i + 1}. ${esc(nombre)}</div>
    </li>`).join('');
}

function mostrarLogo(dataUrl) {
  const vista = el('onb-logo-vista');
  if (!vista) return;
  vista.innerHTML = dataUrl ? `<img src="${esc(dataUrl)}" alt="" />` : esc(iniciales(valor('o-nombre')));
  el('onb-logo-quitar').style.display = dataUrl ? '' : 'none';
}

function enlazarPaso() {
  if (state.paso === 1) {
    mostrarLogo(state.datos.negocio.negocio_logo || null);
    el('o-nombre').addEventListener('input', () => { if (!state.datos.negocio.negocio_logo) mostrarLogo(null); });
    const archivo = el('onb-logo-archivo');
    el('onb-logo-cargar').addEventListener('click', () => archivo.click());
    archivo.addEventListener('change', async () => {
      const f = archivo.files[0];
      archivo.value = '';
      if (!f) return;
      mostrarError(null);
      try {
        const dataUrl = await window.PuntoXLogo.preparar(f);
        await window.puntoXConfig.guardarLogoNegocio({ dataUrl, usuarioId: state.usuarioId });
        state.datos.negocio.negocio_logo = dataUrl;
        mostrarLogo(dataUrl);
      } catch (err) { mostrarError(err.message); }
    });
    el('onb-logo-quitar').addEventListener('click', async () => {
      mostrarError(null);
      try {
        await window.puntoXConfig.quitarLogoNegocio({ usuarioId: state.usuarioId });
        state.datos.negocio.negocio_logo = '';
        mostrarLogo(null);
      } catch (err) { mostrarError(err.message); }
    });
  }
  if (state.paso === 2) {
    document.querySelectorAll('input[name="o-fact"]').forEach((r) => r.addEventListener('change', () => { state.facturacion = r.value; pintar(); }));
  }
  if (state.paso === 4) {
    el('o-u-agregar').addEventListener('click', async () => {
      mostrarError(null);
      try {
        await window.puntoXConfig.crearUsuario({
          payload: { nombreCompleto: valor('o-u-nombre').trim(), usuario: valor('o-u-usuario').trim(), password: valor('o-u-clave'), rolId: valor('o-u-rol'), sucursalId: state.datos.sucursal ? state.datos.sucursal.id : null },
          usuarioCreadorId: state.usuarioId,
        });
        state.datos = await window.puntoXOnboarding.datos();
        state.usuariosAgregados += 1;
        pintar();
      } catch (err) { mostrarError(err.message); }
    });
  }
}

function pintar() {
  pintarPasos();
  el('onb-contenido').innerHTML = RENDER[state.paso]();
  el('btn-atras').style.visibility = state.paso === 0 ? 'hidden' : 'visible';
  const ultimo = state.paso === PASOS.length - 1;
  el('btn-siguiente').textContent = ultimo ? 'Empezar a usar Nodo' : state.paso === 0 ? 'Comenzar' : 'Siguiente';
  enlazarPaso();
  const primero = el('onb-contenido').querySelector('input:not([type=hidden]):not([type=radio]):not([disabled]), select');
  if (primero && state.paso !== 0) primero.focus();
}

async function siguiente() {
  mostrarError(null);
  const boton = el('btn-siguiente');
  boton.disabled = true;
  try {
    if (state.paso === PASOS.length - 1) {
      await window.puntoXOnboarding.finalizar({ omitido: false, usuarioId: state.usuarioId });
      window.location.href = '../dashboard/index.html';
      return;
    }
    await guardarPaso();
    state.paso += 1;
    pintar();
    window.scrollTo(0, 0);
  } catch (err) { mostrarError(err.message); }
  boton.disabled = false;
}

async function omitir() {
  try {
    await window.puntoXOnboarding.finalizar({ omitido: true, usuarioId: state.usuarioId });
    window.location.href = '../dashboard/index.html';
  } catch (err) { mostrarError(err.message); }
}

async function iniciar() {
  const info = await window.puntoX.getAppInfo();
  const permisos = (info.usuario && info.usuario.permisos) || [];
  if (!info.usuario || info.usuario.debeCambiarPassword) { window.location.href = '../login/index.html'; return; }
  if (!permisos.includes('*') && !permisos.includes('configuracion.gestionar')) { window.location.href = '../dashboard/index.html'; return; }
  state.usuarioId = info.usuario.id;
  if (window.PuntoXTema) window.PuntoXTema.aplicarColorMarca(info.negocio && info.negocio.colorAcento);
  try {
    state.datos = await window.puntoXOnboarding.datos();
  } catch (err) { mostrarError(err.message); return; }
  // Cuando ya terminó el asistente solo se abre a propósito (desde Configuración); no se redirige.
  state.facturacion = state.datos.facturacionElectronica === 'electronico' ? 'ecf' : 'ncf';
  el('btn-atras').addEventListener('click', () => { mostrarError(null); state.paso = Math.max(0, state.paso - 1); pintar(); });
  el('btn-siguiente').addEventListener('click', siguiente);
  el('btn-omitir').addEventListener('click', omitir);
  pintar();
}

iniciar();
