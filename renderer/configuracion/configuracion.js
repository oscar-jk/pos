const state = {
  info: null,
  tab: 'negocio',
  roles: [],
  permisos: [],
  rolSeleccionadoId: null,
};

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}

function mostrarExito(msg) {
  const el = document.getElementById('mensaje-exito');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

const MODULO_ETIQUETA = { ventas: 'Ventas', inventario: 'Inventario', compras: 'Compras', cxc: 'CxC', cxp: 'CxP', caja: 'Caja', contabilidad: 'Contabilidad', configuracion: 'Configuración' };

// --- Pestañas ---

const ACCIONES_TAB = {};

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB[tab] || '';
  mostrarError(null);

  if (tab === 'negocio') cargarNegocio();
  if (tab === 'usuarios') cargarUsuarios();
  if (tab === 'roles') cargarRoles();
  if (tab === 'fiscal') cargarFiscal();
  if (tab === 'ecf' && window.PuntoXConfigEcf) window.PuntoXConfigEcf.cargar();
  if (tab === 'parametros') cargarParametros();
  if (tab === 'sucursales') cargarSucursales();
  if (tab === 'impresoras') cargarImpresoras();
  if (tab === 'modulos') cargarModulos();
  if (tab === 'monedas') cargarMonedas();
  if (tab === 'bitacora') cargarBitacora();
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Negocio ---

// --- Logo del negocio ---

function mostrarLogo(dataUrl, iniciales) {
  const vista = document.getElementById('logo-vista');
  vista.innerHTML = dataUrl ? `<img src="${esc(dataUrl)}" alt="" />` : esc(iniciales || 'MN');
  document.getElementById('btn-logo-quitar').style.display = dataUrl ? '' : 'none';
  // El distintivo del menú lateral se actualiza al momento.
  const badge = document.querySelector('.sidebar__badge');
  if (badge) {
    badge.classList.toggle('sidebar__badge--logo', Boolean(dataUrl));
    badge.innerHTML = dataUrl ? `<img src="${esc(dataUrl)}" alt="" />` : esc(iniciales || 'MN');
  }
}

function enlazarLogo() {
  const bloque = document.getElementById('bloque-logo');
  if (!window.puntoXConfig.guardarLogoNegocio) return; // la versión web de prueba no guarda logo
  bloque.style.display = 'flex';
  const archivo = document.getElementById('logo-archivo');
  document.getElementById('btn-logo-cargar').addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    const f = archivo.files[0];
    archivo.value = '';
    if (!f) return;
    try {
      const dataUrl = await window.PuntoXLogo.preparar(f);
      await window.puntoXConfig.guardarLogoNegocio({ dataUrl, usuarioId: state.info.usuario.id });
      mostrarLogo(dataUrl, document.getElementById('neg-iniciales').value);
      mostrarExito('Logo actualizado.');
    } catch (err) { mostrarError(err.message); }
  });
  document.getElementById('btn-logo-quitar').addEventListener('click', async () => {
    try {
      await window.puntoXConfig.quitarLogoNegocio({ usuarioId: state.info.usuario.id });
      mostrarLogo(null, document.getElementById('neg-iniciales').value);
      mostrarExito('Logo quitado.');
    } catch (err) { mostrarError(err.message); }
  });
}
enlazarLogo();

async function cargarNegocio() {
  const datos = await window.puntoXConfig.obtenerDatosNegocio();
  mostrarLogo(datos.negocio_logo || null, datos.negocio_iniciales);
  document.getElementById('neg-nombre').value = datos.negocio_nombre || '';
  document.getElementById('neg-iniciales').value = datos.negocio_iniciales || '';
  // El color de marca ya no se edita aquí (la identidad Nodo fija el color); se conserva el guardado.
  state.colorAcento = datos.negocio_color_acento || '#0A6B68';
  document.getElementById('neg-rnc').value = datos.negocio_rnc || '';
  document.getElementById('neg-razon-social').value = datos.negocio_razon_social || '';
  document.getElementById('neg-direccion').value = datos.negocio_direccion || '';
  document.getElementById('neg-telefono').value = datos.negocio_telefono || '';
}

document.getElementById('btn-guardar-negocio').addEventListener('click', async () => {
  try {
    await window.puntoXConfig.actualizarDatosNegocio({
      payload: {
        nombre: document.getElementById('neg-nombre').value, iniciales: document.getElementById('neg-iniciales').value,
        colorAcento: state.colorAcento || '#0A6B68',
        rnc: document.getElementById('neg-rnc').value.trim(),
        razonSocial: document.getElementById('neg-razon-social').value.trim(),
        direccion: document.getElementById('neg-direccion').value.trim(),
        telefono: document.getElementById('neg-telefono').value.trim(),
      },
      usuarioId: state.info.usuario.id,
    });
    mostrarExito('Datos del negocio actualizados. Se verán reflejados al reabrir cada pantalla.');
  } catch (err) { mostrarError(err.message); }
});

// --- Usuarios ---

async function cargarUsuarios() {
  ACCIONES_TAB.usuarios = '<button class="btn btn-primario" id="btn-nuevo-usuario" data-permiso="configuracion.gestionar">+ Nuevo usuario</button>';
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB.usuarios;
  document.getElementById('btn-nuevo-usuario').addEventListener('click', () => abrirFormularioUsuario());

  const usuarios = await window.puntoXConfig.listarUsuarios();
  document.getElementById('usuarios-tbody').innerHTML = usuarios.map((u) => `
    <tr>
      <td>${esc(u.nombre_completo)}</td><td>${esc(u.usuario)}</td><td>${esc(u.rol_nombre)}</td><td>${esc(u.pct_comision)}%</td>
      <td>${u.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activo</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactivo</span>'}</td>
      <td><span class="enlace-accion" data-permiso="configuracion.gestionar" data-editar="${esc(u.id)}">Editar</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormularioUsuario(el.dataset.editar)));
}

function opciones(lista, valorSel, etiquetaFn) {
  return lista.map((x) => `<option value="${esc(x.id)}" ${x.id === valorSel ? 'selected' : ''}>${esc(etiquetaFn(x))}</option>`).join('');
}

async function abrirFormularioUsuario(usuarioId) {
  const esEdicion = Boolean(usuarioId);
  const usuarios = esEdicion ? await window.puntoXConfig.listarUsuarios() : [];
  const usuario = esEdicion ? usuarios.find((u) => u.id === usuarioId) : null;
  const sucursales = window.__sucursalesCache || await window.puntoXConfig.listarSucursales();
  const sucursalSel = usuario ? usuario.sucursal_id : state.info.sucursalId;

  window.PuntoXModal.abrirModal(esEdicion ? 'Editar usuario' : 'Nuevo usuario', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre completo *</label><input id="u-nombre" value="${esc(usuario ? usuario.nombre_completo : '')}" /></div>
      <div class="form-field"><label>Usuario (acceso) *</label><input id="u-usuario" value="${esc(usuario ? usuario.usuario : '')}" ${esEdicion ? 'disabled' : ''} /></div>
      <div class="form-field"><label>Rol *</label><select id="u-rol">${opciones(state.roles, usuario ? usuario.rol_id : null, (r) => r.nombre)}</select></div>
      <div class="form-field"><label>Sucursal</label><select id="u-sucursal">${opciones(sucursales, sucursalSel, (x) => x.nombre)}</select></div>
      <div class="form-field"><label>% Comisión de vendedor</label><input id="u-comision" type="number" step="0.01" value="${usuario ? usuario.pct_comision : 0}" /></div>
      <div class="form-field"><label>${esEdicion ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label><input id="u-password" type="password" placeholder="${esEdicion ? 'Dejar en blanco para no cambiarla' : 'Mínimo 8 caracteres; la persona la cambiará al entrar'}" /></div>
      ${esEdicion ? `<div class="form-field form-field--checkbox"><input id="u-activo" type="checkbox" ${usuario.activo ? 'checked' : ''} /><label>Activo</label></div>` : ''}
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="u-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="u-guardar">${esEdicion ? 'Guardar cambios' : 'Crear usuario'}</button>
    </div>
  `);

  document.getElementById('u-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('u-guardar').addEventListener('click', async () => {
    try {
      if (esEdicion) {
        await window.puntoXConfig.actualizarUsuario({
          usuarioId, usuarioEditorId: state.info.usuario.id,
          payload: {
            nombreCompleto: document.getElementById('u-nombre').value, rolId: document.getElementById('u-rol').value,
            sucursalId: document.getElementById('u-sucursal').value || null,
            pctComision: parseFloat(document.getElementById('u-comision').value) || 0,
            activo: document.getElementById('u-activo').checked, password: document.getElementById('u-password').value || null,
          },
        });
      } else {
        await window.puntoXConfig.crearUsuario({
          usuarioCreadorId: state.info.usuario.id,
          payload: {
            nombreCompleto: document.getElementById('u-nombre').value, usuario: document.getElementById('u-usuario').value,
            password: document.getElementById('u-password').value, rolId: document.getElementById('u-rol').value,
            sucursalId: document.getElementById('u-sucursal').value || null,
            pctComision: parseFloat(document.getElementById('u-comision').value) || 0,
          },
        });
      }
      window.PuntoXModal.cerrarModal();
      cargarUsuarios();
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Roles y permisos ---

async function cargarRoles() {
  if (window.puntoXConfig.crearRol) {
    document.getElementById('acciones-tab').innerHTML = '<button class="btn btn-primario" id="btn-nuevo-rol" data-permiso="configuracion.gestionar">+ Nuevo rol</button>';
    document.getElementById('btn-nuevo-rol').addEventListener('click', () => abrirFormularioRol(null));
  }
  state.roles = await window.puntoXConfig.listarRoles();
  state.permisos = await window.puntoXConfig.listarPermisos();

  document.getElementById('roles-lista').innerHTML = state.roles.map((r) => `
    <div class="rol-card ${r.id === state.rolSeleccionadoId ? 'is-active' : ''}" data-rol="${esc(r.id)}">
      <div>
        <div style="font-weight:700; font-size:13px;">${esc(r.nombre)}</div>
        <div style="font-size: 12px; color:var(--color-text-muted);">${esc(r.total_usuarios)} usuario${r.total_usuarios === 1 ? '' : 's'} · ${r.es_rol_sistema ? 'del sistema' : 'propio'}</div>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('[data-rol]').forEach((el) => el.addEventListener('click', () => {
    state.rolSeleccionadoId = el.dataset.rol;
    cargarRoles();
    renderDetalleRol();
  }));

  if (state.rolSeleccionadoId) renderDetalleRol();
}

async function renderDetalleRol() {
  const rol = state.roles.find((r) => r.id === state.rolSeleccionadoId);
  if (!rol) return;
  const permisosActivos = new Set(await window.puntoXConfig.permisosDeRol({ rolId: rol.id }));

  const porModulo = {};
  state.permisos.forEach((p) => { porModulo[p.modulo] = porModulo[p.modulo] || []; porModulo[p.modulo].push(p); });

  document.getElementById('rol-detalle').innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
      <div>
        <div style="font-weight:800; font-size:16px;">${esc(rol.nombre)}</div>
        <div style="font-size:12px; color:var(--color-text-muted);">${esc(rol.descripcion || '')}</div>
        ${window.puntoXConfig.editarRol ? `<div data-permiso="configuracion.gestionar"><div style="margin-top:8px; display:flex; gap:16px; flex-wrap:wrap;">
          <span class="enlace-accion" id="rol-editar">Editar</span>
          <span class="enlace-accion" id="rol-duplicar">Crear uno a partir de este</span>
          ${rol.es_rol_sistema ? '' : '<span class="enlace-accion" id="rol-eliminar" style="color:var(--color-danger);">Eliminar</span>'}
        </div></div>` : ''}
      </div>
      <div class="form-field" style="width:200px;">
        <label>Límite de descuento (%)</label>
        <input id="rol-limite-descuento" type="number" step="0.01" class="input-normal" value="${esc(rol.limite_descuento_pct)}" ${rol.es_rol_sistema && rol.nombre === 'Administrador/Dueño' ? 'disabled' : ''} />
      </div>
    </div>
    <div id="rol-permisos-lista">
      ${Object.entries(porModulo).map(([modulo, permisos]) => `
        <div class="permisos-modulo">
          <div class="permisos-modulo__titulo">${MODULO_ETIQUETA[modulo] || modulo}</div>
          ${permisos.map((p) => `
            <div class="permiso-item">
              <input type="checkbox" data-permiso="${esc(p.id)}" ${permisosActivos.has(p.id) ? 'checked' : ''} />
              <label>${esc(p.descripcion)}</label>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
    <button class="btn btn-primario" id="btn-guardar-permisos" data-permiso="configuracion.gestionar">Guardar permisos</button>
  `;

  const enlazar = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  enlazar('rol-editar', () => abrirFormularioRol(rol));
  enlazar('rol-duplicar', () => abrirFormularioRol(null, rol));
  enlazar('rol-eliminar', async () => {
    const ok = await window.PuntoXModal.confirmar({ titulo: `Eliminar el rol ${rol.nombre}`, mensaje: 'El rol deja de estar disponible para asignar. Los usuarios que lo tengan deben cambiarse antes.', textoConfirmar: 'Eliminar rol', peligro: true });
    if (!ok) return;
    try {
      await window.puntoXConfig.eliminarRol({ rolId: rol.id, usuarioId: state.info.usuario.id });
      state.rolSeleccionadoId = null;
      document.getElementById('rol-detalle').innerHTML = '<div class="empty-state">Selecciona un rol para ver y editar sus permisos.</div>';
      await cargarRoles();
      mostrarExito('Rol eliminado.');
    } catch (err) { mostrarError(err.message); }
  });

  document.getElementById('rol-limite-descuento').addEventListener('change', async (e) => {
    try {
      await window.puntoXConfig.actualizarLimiteDescuentoRol({ rolId: rol.id, limitePct: parseFloat(e.target.value) || 0, usuarioId: state.info.usuario.id });
      mostrarExito('Límite de descuento actualizado.');
    } catch (err) { mostrarError(err.message); }
  });

  document.getElementById('btn-guardar-permisos').addEventListener('click', async () => {
    const permisoIds = Array.from(document.querySelectorAll('#rol-permisos-lista input[type="checkbox"]:checked')).map((c) => c.dataset.permiso);
    try {
      await window.puntoXConfig.actualizarPermisosRol({ rolId: rol.id, permisoIds, usuarioId: state.info.usuario.id });
      // Si es el rol propio, los permisos ya cambiaron en la sesión: recargar para que la
      // pantalla muestre y oculte botones con los nuevos.
      if (rol.id === state.info.usuario.rolId) { window.location.hash = 'roles'; window.location.reload(); return; }
      mostrarExito('Permisos actualizados.');
    } catch (err) { mostrarError(err.message); }
  });
}

// Crear (vacío o a partir de otro rol) o editar nombre y descripción de un rol.
function abrirFormularioRol(rol, base) {
  const esEdicion = Boolean(rol);
  window.PuntoXModal.abrirModal(esEdicion ? `Editar rol` : 'Nuevo rol', `
    <div class="form-grid">
      <div class="form-field" style="grid-column: span 2;"><label for="rol-nombre">Nombre *</label><input id="rol-nombre" class="input-normal" maxlength="60" value="${esc(esEdicion ? rol.nombre : base ? `${base.nombre} (copia)` : '')}" ${esEdicion && rol.es_rol_sistema ? 'disabled' : ''} /></div>
      <div class="form-field" style="grid-column: span 2;"><label for="rol-descripcion">Descripción</label><input id="rol-descripcion" class="input-normal" maxlength="200" value="${esc(esEdicion ? rol.descripcion || '' : '')}" placeholder="Qué hace quien tiene este rol" /></div>
      ${esEdicion ? '' : `<div class="form-field" style="grid-column: span 2;"><label for="rol-base">Empezar con los permisos de</label>
        <select id="rol-base" class="input-normal"><option value="">Ninguno (sin permisos)</option>${state.roles.map((r) => `<option value="${esc(r.id)}" ${base && base.id === r.id ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select></div>`}
    </div>
    ${esEdicion && rol.es_rol_sistema ? '<p style="font-size:13px; color:var(--color-text-muted);">Los roles del sistema no se pueden renombrar. Para uno distinto, crea un rol a partir de este.</p>' : ''}
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="rol-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="rol-guardar">${esEdicion ? 'Guardar cambios' : 'Crear rol'}</button>
    </div>
  `);
  document.getElementById('rol-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('rol-guardar').addEventListener('click', async () => {
    const payload = { nombre: document.getElementById('rol-nombre').value, descripcion: document.getElementById('rol-descripcion').value };
    try {
      if (esEdicion) {
        await window.puntoXConfig.editarRol({ rolId: rol.id, payload, usuarioId: state.info.usuario.id });
      } else {
        payload.copiarDeRolId = document.getElementById('rol-base').value || null;
        state.rolSeleccionadoId = await window.puntoXConfig.crearRol({ payload, usuarioId: state.info.usuario.id });
      }
      window.PuntoXModal.cerrarModal();
      await cargarRoles();
      mostrarExito(esEdicion ? 'Rol actualizado.' : 'Rol creado. Marca sus permisos y guarda.');
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Parámetros fiscales ---

async function cargarFiscal() {
  const tasas = await window.puntoXConfig.listarTasasItbis();
  document.getElementById('tasas-tbody').innerHTML = tasas.map((t) => `
    <tr>
      <td>${esc(t.nombre)}</td><td>${(t.porcentaje * 100).toFixed(2)}%</td>
      <td>${t.es_default ? '<span class="pill-estado" style="background:var(--color-accent);">Por defecto</span>' : ''}</td>
      <td>${t.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activa</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactiva</span>'}</td>
      <td><span class="enlace-accion" data-permiso="configuracion.gestionar" data-tasa-default="${esc(t.id)}">Marcar por defecto</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-tasa-default]').forEach((el) => el.addEventListener('click', async () => {
    const tasa = tasas.find((t) => t.id === el.dataset.tasaDefault);
    try {
      await window.puntoXConfig.actualizarTasaItbis({ tasaId: tasa.id, payload: { nombre: tasa.nombre, porcentaje: tasa.porcentaje, esDefault: true, activo: true }, usuarioId: state.info.usuario.id });
      cargarFiscal();
    } catch (err) { mostrarError(err.message); }
  }));

  const tipos = await window.puntoXConfig.listarTiposNcf();
  document.getElementById('ncf-tbody').innerHTML = tipos.map((t) => `
    <tr>
      <td>${esc(t.codigo)}</td><td>${esc(t.nombre)}</td><td>${esc(t.aplica_cliente)}</td>
      <td>${esc(t.secuencia_actual)} / ${esc(t.secuencia_hasta)}</td>
      <td>${t.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activo</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactivo</span>'}</td>
      <td><span class="enlace-accion" data-permiso="configuracion.gestionar" data-ampliar="${esc(t.id)}">Ampliar rango</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-ampliar]').forEach((el) => el.addEventListener('click', async () => {
    const nuevo = parseInt(await window.PuntoXModal.pedirTexto('Nueva secuencia máxima:'), 10);
    if (!nuevo) return;
    try {
      await window.puntoXConfig.ampliarRangoNcf({ tipoNcfId: el.dataset.ampliar, nuevaSecuenciaHasta: nuevo, usuarioId: state.info.usuario.id });
      cargarFiscal();
    } catch (err) { mostrarError(err.message); }
  }));
}

document.getElementById('btn-nueva-tasa').addEventListener('click', () => {
  window.PuntoXModal.abrirModal('Nueva tasa de ITBIS', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre *</label><input id="t-nombre" /></div>
      <div class="form-field"><label>Porcentaje (ej. 0.18 = 18%) *</label><input id="t-porcentaje" type="number" step="0.0001" /></div>
    </div>
    <div class="form-field form-field--checkbox" style="margin-top:10px;"><input id="t-default" type="checkbox" /><label>Marcar como tasa por defecto</label></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="t-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="t-guardar">Crear tasa</button>
    </div>
  `);
  document.getElementById('t-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('t-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXConfig.crearTasaItbis({
        payload: { nombre: document.getElementById('t-nombre').value, porcentaje: parseFloat(document.getElementById('t-porcentaje').value) || 0, esDefault: document.getElementById('t-default').checked },
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarFiscal();
    } catch (err) { mostrarError(err.message); }
  });
});

document.getElementById('btn-nuevo-ncf').addEventListener('click', () => {
  window.PuntoXModal.abrirModal('Nuevo tipo de NCF', `
    <div class="form-grid">
      <div class="form-field"><label>Código *</label><input id="n-codigo" placeholder="Ej: B02" /></div>
      <div class="form-field"><label>Nombre *</label><input id="n-nombre" /></div>
      <div class="form-field"><label>Aplica a</label>
        <select id="n-aplica"><option value="consumo">Consumo</option><option value="credito_fiscal">Crédito Fiscal</option><option value="gubernamental">Gubernamental</option><option value="regimen_especial">Régimen Especial</option></select>
      </div>
      <div class="form-field"><label>Secuencia desde</label><input id="n-desde" type="number" value="1" /></div>
      <div class="form-field"><label>Secuencia hasta</label><input id="n-hasta" type="number" value="500" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="n-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="n-guardar">Crear tipo de NCF</button>
    </div>
  `);
  document.getElementById('n-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('n-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXConfig.crearTipoNcf({
        payload: {
          codigo: document.getElementById('n-codigo').value, nombre: document.getElementById('n-nombre').value,
          aplicaCliente: document.getElementById('n-aplica').value, secuenciaDesde: parseInt(document.getElementById('n-desde').value, 10),
          secuenciaHasta: parseInt(document.getElementById('n-hasta').value, 10),
        },
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarFiscal();
    } catch (err) { mostrarError(err.message); }
  });
});

// --- Parámetros de negocio ---

const ETIQUETA_PARAMETRO = {
  dias_credito_default: 'Días de crédito por defecto para clientes nuevos',
  ventana_alerta_vencimiento_dias: 'Días de anticipación para alertar productos próximos a vencer',
  dias_mora_bloqueo_credito: 'Días de mora para bloquear el crédito de un cliente automáticamente',
  metodo_valoracion: 'Método de valoración de inventario (para los productos que no definen uno propio)',
};

// Parámetros que no son números: se eligen de una lista.
const OPCIONES_PARAMETRO = {
  metodo_valoracion: [['promedio_ponderado', 'Promedio ponderado'], ['peps', 'PEPS (primero en entrar, primero en salir)']],
};

function campoParametro(p) {
  const opciones = OPCIONES_PARAMETRO[p.clave];
  if (!opciones) return `<input class="input-normal" type="number" data-clave="${esc(p.clave)}" value="${esc(p.valor)}" />`;
  return `<select class="input-normal" data-clave="${esc(p.clave)}">${opciones.map(([valor, etiqueta]) => `<option value="${valor}" ${p.valor === valor ? 'selected' : ''}>${etiqueta}</option>`).join('')}</select>`;
}

async function cargarParametros() {
  const parametros = await window.puntoXConfig.listarParametrosNegocio();
  document.getElementById('parametros-lista').innerHTML = parametros.map((p) => `
    <div class="form-field" style="max-width:500px; margin-bottom:14px;">
      <label>${esc(ETIQUETA_PARAMETRO[p.clave] || p.descripcion || p.clave)}</label>
      <div style="display:flex; gap:8px;">
        ${campoParametro(p)}
        <button class="btn btn-secundario btn-chico" data-permiso="configuracion.gestionar" data-guardar-parametro="${esc(p.clave)}">Guardar</button>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('[data-guardar-parametro]').forEach((btn) => btn.addEventListener('click', async () => {
    const input = document.querySelector(`[data-clave="${btn.dataset.guardarParametro}"]`);
    try {
      await window.puntoXConfig.actualizarParametro({ clave: btn.dataset.guardarParametro, valor: input.value, usuarioId: state.info.usuario.id });
      mostrarExito('Parámetro actualizado.');
    } catch (err) { mostrarError(err.message); }
  }));
}

// --- Sucursales y almacenes ---

async function cargarSucursales() {
  const sucursales = await window.puntoXConfig.listarSucursales();
  const puedeEditar = Boolean(window.puntoXConfig.actualizarSucursal);
  document.getElementById('sucursales-tbody').innerHTML = sucursales.map((s) => `<tr>
      <td>${s.imagen ? `<img class="foto-mini" style="width:52px; height:36px;" src="${esc(s.imagen)}" alt="" />` : '<span class="foto-mini" style="width:52px; height:36px; font-size:12px;">—</span>'}</td>
      <td>${esc(s.nombre)}</td><td>${esc(s.direccion || '—')}</td><td>${esc(s.telefono || '—')}</td>
      <td>${puedeEditar ? `<span class="enlace-accion" data-permiso="configuracion.gestionar" data-editar-sucursal="${esc(s.id)}" role="button" tabindex="0">Editar</span>` : ''}</td>
    </tr>`).join('');
  document.querySelectorAll('[data-editar-sucursal]').forEach((el) => el.addEventListener('click', () => abrirSucursal(sucursales.find((s) => s.id === el.dataset.editarSucursal))));

  const almacenes = await window.puntoXInventario.listarAlmacenes();
  document.getElementById('almacenes-tbody').innerHTML = almacenes.map((a) => {
    const sucursal = sucursales.find((s) => s.id === a.sucursal_id);
    return `<tr><td>${esc(a.nombre)}</td><td>${esc(sucursal ? sucursal.nombre : '—')}</td></tr>`;
  }).join('');

  if (window.puntoXCaja && window.puntoXCaja.listarCajas) {
    const cajas = await window.puntoXCaja.listarCajas();
    document.getElementById('cajas-tbody').innerHTML = cajas.map((c) => {
      const sucursal = sucursales.find((s) => s.id === c.sucursal_id);
      return `<tr><td>${esc(c.nombre)}</td><td>${esc(sucursal ? sucursal.nombre : '—')}</td></tr>`;
    }).join('');
  }

  window.__sucursalesCache = sucursales;
}

// Alta y edición de sucursal, con la foto del local (opcional).
function abrirSucursal(sucursal) {
  const esEdicion = Boolean(sucursal);
  let imagen = sucursal ? sucursal.imagen || null : null;
  let imagenCambiada = false;
  window.PuntoXModal.abrirModal(esEdicion ? 'Editar sucursal' : 'Nueva sucursal', `
    <div class="form-grid">
      <div class="form-field"><label for="s-nombre">Nombre *</label><input id="s-nombre" value="${esc(sucursal ? sucursal.nombre : '')}" /></div>
      <div class="form-field"><label for="s-telefono">Teléfono</label><input id="s-telefono" value="${esc(sucursal && sucursal.telefono ? sucursal.telefono : '')}" /></div>
      <div class="form-field" style="grid-column: 1 / -1;"><label for="s-direccion">Dirección</label><input id="s-direccion" value="${esc(sucursal && sucursal.direccion ? sucursal.direccion : '')}" /></div>
    </div>
    <div class="form-seccion">
      <div class="form-seccion__titulo">Foto del local</div>
      <div style="display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap;">
        <div class="foto-local" id="s-foto-vista"></div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="btn btn-secundario btn-chico" id="s-foto-cargar">Cargar foto</button>
          <button type="button" class="btn btn-secundario btn-chico" id="s-foto-quitar">Quitar foto</button>
        </div>
      </div>
      <input type="file" id="s-foto-archivo" accept="image/png,image/jpeg,image/webp" hidden />
      <div class="galeria__ayuda">PNG, JPG o WebP. Se reduce sola para que pese poco.</div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="s-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="s-guardar">${esEdicion ? 'Guardar cambios' : 'Crear sucursal'}</button>
    </div>
  `);
  const pintarFoto = () => {
    document.getElementById('s-foto-vista').innerHTML = imagen ? `<img src="${esc(imagen)}" alt="Foto del local" />` : 'Sin foto';
    document.getElementById('s-foto-quitar').style.display = imagen ? '' : 'none';
  };
  pintarFoto();
  const archivo = document.getElementById('s-foto-archivo');
  document.getElementById('s-foto-cargar').addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    const f = archivo.files[0];
    archivo.value = '';
    if (!f) return;
    try { imagen = await window.PuntoXImagen.fotoSucursal(f); imagenCambiada = true; pintarFoto(); } catch (err) { mostrarError(err.message); }
  });
  document.getElementById('s-foto-quitar').addEventListener('click', () => { imagen = null; imagenCambiada = true; pintarFoto(); });
  document.getElementById('s-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('s-guardar').addEventListener('click', async () => {
    const payload = {
      nombre: document.getElementById('s-nombre').value,
      telefono: document.getElementById('s-telefono').value || null,
      direccion: document.getElementById('s-direccion').value || null,
    };
    if (imagenCambiada) payload.imagen = imagen || '';
    try {
      if (esEdicion) await window.puntoXConfig.actualizarSucursal({ sucursalId: sucursal.id, payload, usuarioId: state.info.usuario.id });
      else await window.puntoXConfig.crearSucursal({ payload, usuarioId: state.info.usuario.id });
      window.PuntoXModal.cerrarModal();
      mostrarExito(esEdicion ? 'Sucursal actualizada.' : 'Sucursal creada.');
      cargarSucursales();
    } catch (err) { mostrarError(err.message); }
  });
}

document.getElementById('btn-nueva-sucursal').addEventListener('click', () => abrirSucursal(null));

document.getElementById('btn-nuevo-almacen').addEventListener('click', async () => {
  const sucursales = window.__sucursalesCache || await window.puntoXConfig.listarSucursales();
  window.PuntoXModal.abrirModal('Nuevo almacén', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre *</label><input id="al-nombre" /></div>
      <div class="form-field"><label>Sucursal</label><select id="al-sucursal">${opciones(sucursales, sucursales[0]?.id, (s) => s.nombre)}</select></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="al-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="al-guardar">Crear almacén</button>
    </div>
  `);
  document.getElementById('al-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('al-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXInventario.crearAlmacen({ sucursalId: document.getElementById('al-sucursal').value, nombre: document.getElementById('al-nombre').value });
      window.PuntoXModal.cerrarModal();
      cargarSucursales();
    } catch (err) { mostrarError(err.message); }
  });
});

document.getElementById('btn-nueva-caja').addEventListener('click', async () => {
  if (!window.puntoXCaja || !window.puntoXCaja.crearCaja) return;
  const sucursales = window.__sucursalesCache || await window.puntoXConfig.listarSucursales();
  window.PuntoXModal.abrirModal('Nueva caja', `
    <div class="form-grid">
      <div class="form-field"><label for="cj-nombre">Nombre *</label><input id="cj-nombre" class="input-normal" placeholder="Ej.: Caja 2" /></div>
      <div class="form-field"><label for="cj-sucursal">Sucursal</label><select id="cj-sucursal" class="input-normal">${opciones(sucursales, sucursales[0]?.id, (s) => s.nombre)}</select></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="cj-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="cj-guardar">Crear caja</button>
    </div>
  `);
  document.getElementById('cj-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('cj-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXCaja.crearCaja({ sucursalId: document.getElementById('cj-sucursal').value, nombre: document.getElementById('cj-nombre').value, usuarioId: state.info.usuario.id });
      window.PuntoXModal.cerrarModal();
      cargarSucursales();
      mostrarExito('Caja creada.');
    } catch (err) { mostrarError(err.message); }
  });
});

// --- Impresoras ---

const TIPO_IMPRESORA_ETIQUETA = { factura: 'Factura (carta)', tique: 'Tique (80mm)', etiqueta: 'Etiqueta' };

async function cargarImpresoras() {
  const impresoras = await window.puntoXImpresion.listarImpresoras();
  state.impresoras = impresoras;
  document.getElementById('impresoras-vacio').style.display = impresoras.length === 0 ? 'block' : 'none';
  document.getElementById('impresoras-tbody').innerHTML = impresoras.map((i) => `
    <tr>
      <td>${esc(i.nombre)}</td>
      <td>${esc(TIPO_IMPRESORA_ETIQUETA[i.tipo] || i.tipo)}</td>
      <td>${esc(i.deviceName) || '<span style="color:var(--color-text-faint);">Predeterminada de Windows</span>'}</td>
      <td>${esc(i.copias)}</td>
      <td>${i.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activa</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactiva</span>'}</td>
      <td>
        <span class="enlace-accion" data-editar-impresora="${esc(i.id)}">Editar</span> ·
        <span class="enlace-accion" data-eliminar-impresora="${esc(i.id)}" style="color:var(--color-danger);">Quitar</span>
      </td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-editar-impresora]').forEach((el) => el.addEventListener('click', () => abrirFormularioImpresora(el.dataset.editarImpresora)));
  document.querySelectorAll('[data-eliminar-impresora]').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm('¿Quitar esta impresora de la configuración?')) return;
    try {
      await window.puntoXImpresion.eliminarImpresora({ impresoraId: el.dataset.eliminarImpresora, usuarioId: state.info.usuario.id });
      cargarImpresoras();
    } catch (err) { mostrarError(err.message); }
  }));
}

async function abrirFormularioImpresora(impresoraId) {
  const impresora = impresoraId ? (state.impresoras || []).find((i) => i.id === impresoraId) : null;
  let dispositivos = [];
  try { dispositivos = await window.puntoXImpresion.listarDispositivos(); } catch (err) { mostrarError(err.message); }

  const opcionesDispositivo = [
    `<option value="">Predeterminada de Windows</option>`,
    ...dispositivos.map((d) => `<option value="${esc(d.nombre)}" ${impresora && impresora.deviceName === d.nombre ? 'selected' : ''}>${esc(d.nombreVisible)}${d.esPredeterminada ? ' (predeterminada)' : ''}</option>`),
  ].join('');
  const opcionesTipo = Object.entries(TIPO_IMPRESORA_ETIQUETA)
    .map(([v, e]) => `<option value="${v}" ${impresora && impresora.tipo === v ? 'selected' : ''}>${e}</option>`).join('');

  window.PuntoXModal.abrirModal(impresora ? 'Editar impresora' : 'Nueva impresora', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre *</label><input id="imp-nombre" value="${impresora ? esc(impresora.nombre) : ''}" placeholder="Ej: Caja 1 — tiquera" /></div>
      <div class="form-field"><label>Tipo *</label><select id="imp-tipo">${opcionesTipo}</select></div>
      <div class="form-field" style="grid-column: span 2;"><label>Dispositivo</label><select id="imp-dispositivo">${opcionesDispositivo}</select></div>
      <div class="form-field"><label>Copias</label><input id="imp-copias" type="number" min="1" value="${impresora ? impresora.copias : 1}" /></div>
      ${impresora ? `<div class="form-field form-field--checkbox"><input id="imp-activo" type="checkbox" ${impresora.activo ? 'checked' : ''} /><label>Activa</label></div>` : ''}
    </div>
    ${dispositivos.length === 0 ? '<p style="font-size:12px; color:var(--color-text-muted); margin-top:10px;">No se detectaron impresoras instaladas en este equipo.</p>' : ''}
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="imp-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="imp-guardar">${impresora ? 'Guardar cambios' : 'Agregar impresora'}</button>
    </div>
  `);
  document.getElementById('imp-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('imp-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXImpresion.guardarImpresora({
        usuarioId: state.info.usuario.id,
        payload: {
          impresoraId: impresora ? impresora.id : null,
          sucursalId: state.info.sucursalId,
          nombre: document.getElementById('imp-nombre').value,
          tipo: document.getElementById('imp-tipo').value,
          deviceName: document.getElementById('imp-dispositivo').value || null,
          copias: parseInt(document.getElementById('imp-copias').value, 10) || 1,
          activo: impresora ? document.getElementById('imp-activo').checked : true,
        },
      });
      window.PuntoXModal.cerrarModal();
      cargarImpresoras();
    } catch (err) { mostrarError(err.message); }
  });
}

document.getElementById('btn-nueva-impresora').addEventListener('click', () => abrirFormularioImpresora());

// --- Módulos opcionales ---

async function cargarMonedas() {
  const monedas = (await window.puntoXConfig.listarMonedas()).filter((m) => !m.es_local);
  const fechaSimple = (f) => f.split('-').reverse().join('/');
  document.getElementById('monedas-lista').innerHTML = monedas.map((m) => `
    <div class="card" style="margin-bottom:14px; max-width:640px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;">${esc(m.nombre)} (${esc(m.codigo)})</div>
          <div style="font-size:12px; color:${m.tasa_hoy ? 'var(--color-text-muted)' : 'var(--color-danger)'};">${m.tasa_hoy ? `Tasa de hoy: RD$ ${m.tasa_hoy}` : 'Sin tasa registrada hoy'}</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input class="input-normal" type="number" step="0.0001" min="0" data-tasa-moneda="${esc(m.id)}" value="${esc(m.tasa_hoy || '')}" placeholder="RD$ por 1 ${esc(m.codigo)}" style="width:170px;" />
          <button class="btn btn-primario btn-chico" data-guardar-tasa="${esc(m.id)}">Guardar tasa de hoy</button>
        </div>
      </div>
      ${m.historial.length ? `<div style="font-size:12px; color:var(--color-text-muted); margin-top:10px;">Últimas: ${m.historial.map((h) => `${fechaSimple(h.fecha)} RD$ ${h.tasa}`).join(' · ')}</div>` : ''}
    </div>`).join('') || '<div class="empty-state">No hay monedas extranjeras.</div>';
  document.querySelectorAll('[data-guardar-tasa]').forEach((btn) => btn.addEventListener('click', async () => {
    const input = document.querySelector(`[data-tasa-moneda="${btn.dataset.guardarTasa}"]`);
    try {
      await window.puntoXConfig.guardarTasaCambio({ monedaId: btn.dataset.guardarTasa, tasa: parseFloat(input.value), usuarioId: state.info.usuario.id });
      mostrarExito('Tasa de cambio guardada.');
      cargarMonedas();
    } catch (err) { mostrarError(err.message); }
  }));
}

async function cargarModulos() {
  const modulos = await window.puntoXConfig.listarModulos();
  document.getElementById('modulos-lista').innerHTML = modulos.map((m) => `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:14px 16px; border:1px solid var(--color-border); border-radius:var(--radius-md); margin-bottom:10px; max-width:760px;">
      <div>
        <div style="font-weight:700; font-size:14px;">${esc(m.nombre)}</div>
        <div style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">${esc(m.descripcion)}</div>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; white-space:nowrap; cursor:pointer;">
        <input type="checkbox" data-modulo="${esc(m.clave)}" ${m.activo ? 'checked' : ''} style="width:18px; height:18px;" />
        ${m.activo ? 'Activado' : 'Desactivado'}
      </label>
    </div>
  `).join('');
  document.querySelectorAll('[data-modulo]').forEach((chk) => chk.addEventListener('change', async () => {
    try {
      await window.puntoXConfig.actualizarModulo({ clave: chk.dataset.modulo, activo: chk.checked, usuarioId: state.info.usuario.id });
      // Recarga para que el menú lateral refleje el cambio, volviendo a esta pestaña.
      window.location.hash = 'modulos';
      window.location.reload();
    } catch (err) { mostrarError(err.message); chk.checked = !chk.checked; }
  }));
}

// --- Bitácora de auditoría ---

async function cargarBitacora() {
  const select = document.getElementById('bitacora-filtro-modulo');
  if (select.options.length === 1) {
    Object.entries(MODULO_ETIQUETA).forEach(([v, e]) => { select.innerHTML += `<option value="${v}">${e}</option>`; });
    select.addEventListener('change', cargarBitacora);
  }

  const entradas = await window.puntoXConfig.listarBitacora({ modulo: select.value || undefined });
  document.getElementById('bitacora-vacio').style.display = entradas.length === 0 ? 'block' : 'none';
  document.getElementById('bitacora-tbody').innerHTML = entradas.map((e) => `
    <tr>
      <td>${fechaHora(e.created_at)}</td><td>${esc(e.usuario_nombre || '—')}</td><td>${esc(MODULO_ETIQUETA[e.modulo] || e.modulo)}</td>
      <td>${esc(e.entidad)}</td><td>${esc(e.accion)}</td><td style="font-size: 12px; color:var(--color-text-muted);">${esc(e.detalle || '')}</td>
    </tr>
  `).join('');
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('configuracion');
  if (!state.info) return; // sin sesión o con la contraseña pendiente: el shell ya redirigió al login
  // La impresión solo existe en la app de escritorio; la versión web de prueba no la expone.
  if (!window.puntoXImpresion) document.querySelector('.tab-btn[data-tab="impresoras"]').remove();
  if (!window.puntoXConfig.listarModulos) document.querySelector('.tab-btn[data-tab="modulos"]').remove();
  if (!window.puntoXConfig.listarMonedas) document.querySelector('.tab-btn[data-tab="monedas"]').remove();
  state.roles = await window.puntoXConfig.listarRoles();
  const tabInicial = window.location.hash.slice(1);
  const existe = [...document.querySelectorAll('.tab-btn')].some((b) => b.dataset.tab === tabInicial);
  cambiarTab(existe ? tabInicial : 'negocio');
}

init();
