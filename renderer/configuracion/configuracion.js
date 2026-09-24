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
  if (tab === 'parametros') cargarParametros();
  if (tab === 'sucursales') cargarSucursales();
  if (tab === 'bitacora') cargarBitacora();
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Negocio ---

async function cargarNegocio() {
  const datos = await window.puntoXConfig.obtenerDatosNegocio();
  document.getElementById('neg-nombre').value = datos.negocio_nombre || '';
  document.getElementById('neg-iniciales').value = datos.negocio_iniciales || '';
  document.getElementById('neg-color').value = datos.negocio_color_acento || '#146356';
}

document.getElementById('btn-guardar-negocio').addEventListener('click', async () => {
  try {
    await window.puntoXConfig.actualizarDatosNegocio({
      payload: {
        nombre: document.getElementById('neg-nombre').value, iniciales: document.getElementById('neg-iniciales').value,
        colorAcento: document.getElementById('neg-color').value,
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
      <td>${u.nombre_completo}</td><td>${u.usuario}</td><td>${u.rol_nombre}</td><td>${u.pct_comision}%</td>
      <td>${u.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activo</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactivo</span>'}</td>
      <td><span class="enlace-accion" data-permiso="configuracion.gestionar" data-editar="${u.id}">Editar</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormularioUsuario(el.dataset.editar)));
}

function opciones(lista, valorSel, etiquetaFn) {
  return lista.map((x) => `<option value="${x.id}" ${x.id === valorSel ? 'selected' : ''}>${etiquetaFn(x)}</option>`).join('');
}

async function abrirFormularioUsuario(usuarioId) {
  const esEdicion = Boolean(usuarioId);
  const usuarios = esEdicion ? await window.puntoXConfig.listarUsuarios() : [];
  const usuario = esEdicion ? usuarios.find((u) => u.id === usuarioId) : null;

  window.PuntoXModal.abrirModal(esEdicion ? 'Editar usuario' : 'Nuevo usuario', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre completo *</label><input id="u-nombre" value="${usuario ? usuario.nombre_completo : ''}" /></div>
      <div class="form-field"><label>Usuario (acceso) *</label><input id="u-usuario" value="${usuario ? usuario.usuario : ''}" ${esEdicion ? 'disabled' : ''} /></div>
      <div class="form-field"><label>Rol *</label><select id="u-rol">${opciones(state.roles, usuario ? usuario.rol_id : null, (r) => r.nombre)}</select></div>
      <div class="form-field"><label>% Comisión de vendedor</label><input id="u-comision" type="number" step="0.01" value="${usuario ? usuario.pct_comision : 0}" /></div>
      <div class="form-field"><label>${esEdicion ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label><input id="u-password" type="password" placeholder="${esEdicion ? 'Dejar en blanco para no cambiarla' : 'Mínimo 6 caracteres'}" /></div>
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
  state.roles = await window.puntoXConfig.listarRoles();
  state.permisos = await window.puntoXConfig.listarPermisos();

  document.getElementById('roles-lista').innerHTML = state.roles.map((r) => `
    <div class="rol-card ${r.id === state.rolSeleccionadoId ? 'is-active' : ''}" data-rol="${r.id}">
      <div>
        <div style="font-weight:700; font-size:13px;">${r.nombre}</div>
        <div style="font-size:11px; color:var(--color-text-muted);">${r.total_usuarios} usuario${r.total_usuarios === 1 ? '' : 's'}</div>
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
        <div style="font-weight:800; font-size:16px;">${rol.nombre}</div>
        <div style="font-size:12px; color:var(--color-text-muted);">${rol.descripcion}</div>
      </div>
      <div class="form-field" style="width:200px;">
        <label>Límite de descuento (%)</label>
        <input id="rol-limite-descuento" type="number" step="0.01" class="input-normal" value="${rol.limite_descuento_pct}" ${rol.es_rol_sistema && rol.nombre === 'Administrador/Dueño' ? 'disabled' : ''} />
      </div>
    </div>
    <div id="rol-permisos-lista">
      ${Object.entries(porModulo).map(([modulo, permisos]) => `
        <div class="permisos-modulo">
          <div class="permisos-modulo__titulo">${MODULO_ETIQUETA[modulo] || modulo}</div>
          ${permisos.map((p) => `
            <div class="permiso-item">
              <input type="checkbox" data-permiso="${p.id}" ${permisosActivos.has(p.id) ? 'checked' : ''} />
              <label>${p.descripcion}</label>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
    <button class="btn btn-primario" id="btn-guardar-permisos" data-permiso="configuracion.gestionar">Guardar permisos</button>
  `;

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
      mostrarExito('Permisos actualizados.');
    } catch (err) { mostrarError(err.message); }
  });
}

// --- Parámetros fiscales ---

async function cargarFiscal() {
  const tasas = await window.puntoXConfig.listarTasasItbis();
  document.getElementById('tasas-tbody').innerHTML = tasas.map((t) => `
    <tr>
      <td>${t.nombre}</td><td>${(t.porcentaje * 100).toFixed(2)}%</td>
      <td>${t.es_default ? '<span class="pill-estado" style="background:var(--color-accent);">Por defecto</span>' : ''}</td>
      <td>${t.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activa</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactiva</span>'}</td>
      <td><span class="enlace-accion" data-permiso="configuracion.gestionar" data-tasa-default="${t.id}">Marcar por defecto</span></td>
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
      <td>${t.codigo}</td><td>${t.nombre}</td><td>${t.aplica_cliente}</td>
      <td>${t.secuencia_actual} / ${t.secuencia_hasta}</td>
      <td>${t.activo ? '<span class="pill-estado" style="background:var(--color-success);">Activo</span>' : '<span class="pill-estado" style="background:var(--color-text-faint);">Inactivo</span>'}</td>
      <td><span class="enlace-accion" data-permiso="configuracion.gestionar" data-ampliar="${t.id}">Ampliar rango</span></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-ampliar]').forEach((el) => el.addEventListener('click', async () => {
    const nuevo = parseInt(prompt('Nueva secuencia máxima:'), 10);
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
};

async function cargarParametros() {
  const parametros = await window.puntoXConfig.listarParametrosNegocio();
  document.getElementById('parametros-lista').innerHTML = parametros.map((p) => `
    <div class="form-field" style="max-width:500px; margin-bottom:14px;">
      <label>${ETIQUETA_PARAMETRO[p.clave] || p.descripcion || p.clave}</label>
      <div style="display:flex; gap:8px;">
        <input class="input-normal" type="number" data-clave="${p.clave}" value="${p.valor}" />
        <button class="btn btn-secundario btn-chico" data-permiso="configuracion.gestionar" data-guardar-parametro="${p.clave}">Guardar</button>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('[data-guardar-parametro]').forEach((btn) => btn.addEventListener('click', async () => {
    const input = document.querySelector(`input[data-clave="${btn.dataset.guardarParametro}"]`);
    try {
      await window.puntoXConfig.actualizarParametro({ clave: btn.dataset.guardarParametro, valor: input.value, usuarioId: state.info.usuario.id });
      mostrarExito('Parámetro actualizado.');
    } catch (err) { mostrarError(err.message); }
  }));
}

// --- Sucursales y almacenes ---

async function cargarSucursales() {
  const sucursales = await window.puntoXConfig.listarSucursales();
  document.getElementById('sucursales-tbody').innerHTML = sucursales.map((s) => `<tr><td>${s.nombre}</td><td>${s.direccion || '—'}</td><td>${s.telefono || '—'}</td></tr>`).join('');

  const almacenes = await window.puntoXInventario.listarAlmacenes();
  document.getElementById('almacenes-tbody').innerHTML = almacenes.map((a) => {
    const sucursal = sucursales.find((s) => s.id === a.sucursal_id);
    return `<tr><td>${a.nombre}</td><td>${sucursal ? sucursal.nombre : '—'}</td></tr>`;
  }).join('');

  window.__sucursalesCache = sucursales;
}

document.getElementById('btn-nueva-sucursal').addEventListener('click', () => {
  window.PuntoXModal.abrirModal('Nueva sucursal', `
    <div class="form-grid">
      <div class="form-field"><label>Nombre *</label><input id="s-nombre" /></div>
      <div class="form-field"><label>Teléfono</label><input id="s-telefono" /></div>
      <div class="form-field" style="grid-column: span 2;"><label>Dirección</label><input id="s-direccion" /></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="s-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="s-guardar">Crear sucursal</button>
    </div>
  `);
  document.getElementById('s-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('s-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXConfig.crearSucursal({
        payload: { nombre: document.getElementById('s-nombre').value, telefono: document.getElementById('s-telefono').value || null, direccion: document.getElementById('s-direccion').value || null },
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarSucursales();
    } catch (err) { mostrarError(err.message); }
  });
});

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
      <td>${fechaHora(e.created_at)}</td><td>${e.usuario_nombre || '—'}</td><td>${MODULO_ETIQUETA[e.modulo] || e.modulo}</td>
      <td>${e.entidad}</td><td>${e.accion}</td><td style="font-size:11px; color:var(--color-text-muted);">${e.detalle || ''}</td>
    </tr>
  `).join('');
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('configuracion');
  state.roles = await window.puntoXConfig.listarRoles();
  cambiarTab('negocio');
}

init();
