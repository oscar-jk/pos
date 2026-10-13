const state = {
  info: null,
  tab: 'productos',
  categorias: [], unidades: [], tasas: [], almacenes: [],
};

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}

function fmt(n) {
  return (n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso) {
  return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Fechas sin hora (vencimientos): new Date('2026-12-31') sería medianoche UTC y en RD
// mostraría el día anterior.
function fechaSimple(aaaammdd) {
  return aaaammdd ? aaaammdd.slice(0, 10).split('-').reverse().join('/') : '—';
}

// --- Lotes ---

async function lotesDe(productoId, almacenId) {
  return window.puntoXInventario.lotes ? window.puntoXInventario.lotes({ productoId, almacenId }) : [];
}

function selectorLote(lotes, seleccionado, atributos) {
  return `<select ${atributos}>
    <option value="">Automático (el que vence primero)</option>
    ${lotes.map((l) => `<option value="${esc(l.lote_id)}" ${l.lote_id === seleccionado ? 'selected' : ''}>${esc(l.numero_lote)}${l.fecha_vencimiento ? ` · vence ${fechaSimple(l.fecha_vencimiento)}` : ''} · ${esc(l.cantidad)} disp.</option>`).join('')}
  </select>`;
}

// --- Pestañas ---

const ACCIONES_TAB = {
  productos: '<button class="btn btn-primario" id="btn-nuevo-producto" data-permiso="inventario.producto.crear">+ Nuevo producto</button>',
  ajustes: '<button class="btn btn-primario" id="btn-nuevo-ajuste" data-permiso="inventario.ajuste.crear">+ Nuevo ajuste</button>',
  mermas: '<button class="btn btn-primario" id="btn-nueva-merma" data-permiso="inventario.merma.crear">+ Nueva merma</button>',
  transferencias: '<button class="btn btn-primario" id="btn-nueva-transferencia" data-permiso="inventario.transferencia.crear">+ Nueva transferencia</button>',
  conversiones: '<button class="btn btn-primario" id="btn-nueva-conversion" data-permiso="inventario.conversion.crear">+ Nueva conversión</button>',
};

function cambiarTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? 'block' : 'none'; });
  document.getElementById('acciones-tab').innerHTML = ACCIONES_TAB[tab] || '';
  mostrarError(null);

  if (tab === 'productos') { cargarProductos(); enlazarBtn('btn-nuevo-producto', () => abrirFormularioProducto()); }
  if (tab === 'existencias') cargarExistencias();
  if (tab === 'ajustes') { cargarAjustes(); enlazarBtn('btn-nuevo-ajuste', () => abrirFormularioAjuste()); }
  if (tab === 'mermas') { cargarMermas(); enlazarBtn('btn-nueva-merma', () => abrirFormularioMerma()); }
  if (tab === 'transferencias') { cargarTransferencias(); enlazarBtn('btn-nueva-transferencia', () => abrirFormularioTransferencia()); }
  if (tab === 'conversiones') { cargarConversiones(); enlazarBtn('btn-nueva-conversion', () => abrirFormularioConversion()); }
  if (tab === 'vencimientos') cargarVencimientos();
}

function enlazarBtn(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));

// --- Productos ---

async function cargarProductos() {
  const texto = document.getElementById('buscar-productos').value.trim();
  const productos = await window.puntoXInventario.listarProductos({ texto });
  const tbody = document.getElementById('productos-tbody');
  document.getElementById('productos-vacio').style.display = productos.length === 0 ? 'block' : 'none';

  tbody.innerHTML = productos.map((p) => `
    <tr>
      <td>${esc(p.codigo_interno)}</td>
      <td>${esc(p.descripcion)}${p.es_kit ? ' <span class="pill-estado" style="background:var(--color-info);">KIT</span>' : ''}</td>
      <td>${esc(p.categoria_nombre || '—')}</td>
      <td>RD$ ${fmt(p.precio_detalle)}</td>
      <td>RD$ ${fmt(p.costo_promedio)}</td>
      <td>${esc(p.es_kit ? '—' : p.existencia_total)}${!p.es_kit && p.existencia_total <= p.stock_minimo ? ' ⚠️' : ''}</td>
      <td>
        <span class="enlace-accion" data-permiso="inventario.producto.editar" data-editar="${esc(p.id)}">Editar</span> ·
        <span class="enlace-accion" data-kardex="${esc(p.id)}" data-nombre="${esc(p.descripcion)}">Kardex</span>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-editar]').forEach((el) => el.addEventListener('click', () => abrirFormularioProducto(el.dataset.editar)));
  tbody.querySelectorAll('[data-kardex]').forEach((el) => el.addEventListener('click', () => verKardex(el.dataset.kardex, el.dataset.nombre)));
}

let timeoutBuscarProductos = null;
document.getElementById('buscar-productos').addEventListener('input', () => {
  clearTimeout(timeoutBuscarProductos);
  timeoutBuscarProductos = setTimeout(cargarProductos, 200);
});

function opciones(lista, valorSel, etiquetaFn) {
  return lista.map((x) => `<option value="${esc(x.id)}" ${x.id === valorSel ? 'selected' : ''}>${etiquetaFn(x)}</option>`).join('');
}

async function abrirFormularioProducto(productoId) {
  const esEdicion = Boolean(productoId);
  const producto = esEdicion ? await window.puntoXInventario.obtenerProductoCompleto({ productoId }) : null;

  const contenido = window.PuntoXModal.abrirModal(esEdicion ? 'Editar producto' : 'Nuevo producto', `
    <div class="form-grid">
      <div class="form-field"><label>Código interno *</label><input id="f-codigo" value="${esc(producto ? producto.codigo_interno : '')}" /></div>
      <div class="form-field"><label>Descripción *</label><input id="f-descripcion" value="${esc(producto ? producto.descripcion : '')}" /></div>
      <div class="form-field"><label>Categoría ${window.puntoXInventario.crearCategoria ? '<span id="f-nueva-categoria" style="float:right; color:var(--color-accent); font-weight:700; cursor:pointer;">+ Nueva</span>' : ''}</label><select id="f-categoria"><option value="">— Sin categoría —</option>${opciones(state.categorias, producto ? producto.categoria_id : null, (c) => c.nombre)}</select></div>
      <div class="form-field"><label>Unidad de medida base *</label><select id="f-unidad">${opciones(state.unidades, producto ? producto.unidad_medida_base_id : state.unidades[0]?.id, (u) => u.nombre)}</select></div>
      <div class="form-field"><label>Tasa de ITBIS *</label><select id="f-tasa">${opciones(state.tasas, producto ? producto.tasa_itbis_id : state.tasas.find((t) => t.es_default)?.id, (t) => `${t.nombre} (${(t.porcentaje * 100).toFixed(0)}%)`)}</select></div>
      <div class="form-field"><label>Método de valoración</label>
        <select id="f-metodo">
          <option value="heredado" ${!producto || producto.metodo_valoracion === 'heredado' ? 'selected' : ''}>Según la configuración general</option>
          <option value="promedio_ponderado" ${producto?.metodo_valoracion === 'promedio_ponderado' ? 'selected' : ''}>Promedio ponderado</option>
          <option value="peps" ${producto?.metodo_valoracion === 'peps' ? 'selected' : ''}>PEPS (primero en entrar, primero en salir)</option>
        </select>
      </div>
      <div class="form-field"><label>Precio detalle (ITBIS incluido) *</label><input id="f-precio-detalle" type="number" step="0.01" value="${esc(producto ? producto.precio_detalle : '')}" /></div>
      <div class="form-field"><label>Precio mayorista</label><input id="f-precio-mayorista" type="number" step="0.01" value="${esc(producto ? producto.precio_mayorista : '')}" /></div>
      <div class="form-field"><label>Precio distribuidor</label><input id="f-precio-distribuidor" type="number" step="0.01" value="${esc(producto ? producto.precio_distribuidor : '')}" /></div>
      ${!esEdicion ? `<div class="form-field"><label>Costo inicial</label><input id="f-costo" type="number" step="0.01" value="0" /></div>` : ''}
      <div class="form-field"><label>Stock mínimo</label><input id="f-stock-min" type="number" step="1" value="${producto ? producto.stock_minimo : 0}" /></div>
      <div class="form-field"><label>Stock máximo</label><input id="f-stock-max" type="number" step="1" value="${esc(producto && producto.stock_maximo ? producto.stock_maximo : '')}" /></div>
      ${!esEdicion ? `<div class="form-field"><label>Existencia inicial (${esc(state.almacenes[0]?.nombre || 'almacén principal')})</label><input id="f-existencia-inicial" type="number" step="1" value="0" /></div>` : ''}
      <div class="form-field form-field--checkbox"><input id="f-controla-lote" type="checkbox" ${producto?.controla_lote ? 'checked' : ''} /><label>Controla lote y vencimiento</label></div>
      <div class="form-field form-field--checkbox"><input id="f-venta-negativo" type="checkbox" ${producto?.permite_venta_negativo ? 'checked' : ''} /><label>Permite venta en negativo</label></div>
      <div class="form-field form-field--checkbox"><input id="f-es-kit" type="checkbox" ${producto?.es_kit ? 'checked' : ''} /><label>Es un kit / combo</label></div>
      <div class="form-field form-field--checkbox"><input id="f-es-servicio" type="checkbox" ${producto?.es_servicio ? 'checked' : ''} /><label>Es un servicio (no un bien) — así se reporta en el e-CF</label></div>
      ${esEdicion ? `<div class="form-field form-field--checkbox"><input id="f-activo" type="checkbox" ${producto?.activo ? 'checked' : ''} /><label>Activo</label></div>` : ''}
    </div>

    <div class="form-seccion">
      <div class="form-seccion__titulo">Códigos de barra (presentaciones)</div>
      <div id="lista-codigos-barra"></div>
      <button type="button" class="btn btn-secundario btn-chico" id="btn-agregar-codigo-barra">+ Agregar código de barra</button>
    </div>

    <div class="form-seccion">
      <div class="form-seccion__titulo">Unidades alternativas</div>
      <div id="lista-unidades-alt"></div>
      <button type="button" class="btn btn-secundario btn-chico" id="btn-agregar-unidad-alt">+ Agregar unidad alternativa</button>
    </div>

    <div class="form-seccion" id="seccion-kit" style="display:${producto?.es_kit ? 'block' : 'none'};">
      <div class="form-seccion__titulo">Componentes del kit</div>
      <div class="buscador-producto" style="position:relative; margin-bottom:10px;">
        <input id="buscar-componente" class="input-normal" type="text" placeholder="Buscar producto para agregar como componente..." autocomplete="off" />
        <div id="resultados-componente" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="lista-componentes"></div>
    </div>

    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="btn-cancelar-producto">Cancelar</button>
      <button type="button" class="btn btn-primario" id="btn-guardar-producto">${esEdicion ? 'Guardar cambios' : 'Crear producto'}</button>
    </div>
  `);

  const codigosBarra = producto ? producto.codigosBarra.map((c) => ({ codigoBarra: c.codigo_barra, presentacion: c.presentacion, factorConversion: c.factor_conversion })) : [];
  const unidadesAlt = producto ? producto.unidadesAlternativas.map((u) => ({ unidadId: u.unidad_id, factorConversion: u.factor_conversion })) : [];
  const componentes = producto && producto.componentes
    ? producto.componentes.map((c) => ({ componenteProductoId: c.componente_producto_id, descripcion: c.descripcion, cantidad: c.cantidad }))
    : [];

  function renderCodigosBarra() {
    document.getElementById('lista-codigos-barra').innerHTML = codigosBarra.map((c, i) => `
      <div class="linea-dinamica">
        <input placeholder="Código de barra" value="${esc(c.codigoBarra)}" data-i="${i}" data-campo="codigoBarra" style="flex-grow:1;" />
        <input placeholder="Presentación" value="${esc(c.presentacion)}" data-i="${i}" data-campo="presentacion" style="width:110px;" />
        <input type="number" step="0.01" placeholder="Factor" value="${esc(c.factorConversion)}" data-i="${i}" data-campo="factorConversion" style="width:70px;" />
        <span class="carrito-quitar" data-quitar-codigo="${i}">✕</span>
      </div>
    `).join('');
    contenido.querySelectorAll('#lista-codigos-barra input').forEach((inp) => inp.addEventListener('input', (e) => {
      codigosBarra[Number(e.target.dataset.i)][e.target.dataset.campo] = e.target.dataset.campo === 'factorConversion' ? parseFloat(e.target.value) || 1 : e.target.value;
    }));
    contenido.querySelectorAll('[data-quitar-codigo]').forEach((el) => el.addEventListener('click', () => { codigosBarra.splice(Number(el.dataset.quitarCodigo), 1); renderCodigosBarra(); }));
  }

  function renderUnidadesAlt() {
    document.getElementById('lista-unidades-alt').innerHTML = unidadesAlt.map((u, i) => `
      <div class="linea-dinamica">
        <select data-i="${i}" data-campo="unidadId" style="flex-grow:1;">${opciones(state.unidades, u.unidadId, (x) => x.nombre)}</select>
        <input type="number" step="0.01" placeholder="Factor (unidades base)" value="${esc(u.factorConversion)}" data-i="${i}" data-campo="factorConversion" style="width:170px;" />
        <span class="carrito-quitar" data-quitar-unidad="${i}">✕</span>
      </div>
    `).join('');
    contenido.querySelectorAll('#lista-unidades-alt select, #lista-unidades-alt input').forEach((inp) => inp.addEventListener('input', (e) => {
      unidadesAlt[Number(e.target.dataset.i)][e.target.dataset.campo] = e.target.dataset.campo === 'factorConversion' ? parseFloat(e.target.value) || 1 : e.target.value;
    }));
    contenido.querySelectorAll('[data-quitar-unidad]').forEach((el) => el.addEventListener('click', () => { unidadesAlt.splice(Number(el.dataset.quitarUnidad), 1); renderUnidadesAlt(); }));
  }

  function renderComponentes() {
    document.getElementById('lista-componentes').innerHTML = componentes.length === 0
      ? '<div class="empty-state" style="padding:10px;">Sin componentes agregados.</div>'
      : componentes.map((c, i) => `
        <div class="linea-dinamica">
          <span style="flex-grow:1; font-size:13px;">${esc(c.descripcion)}</span>
          <input type="number" step="0.01" value="${esc(c.cantidad)}" data-i="${i}" style="width:80px;" />
          <span class="carrito-quitar" data-quitar-componente="${i}">✕</span>
        </div>
      `).join('');
    contenido.querySelectorAll('#lista-componentes input').forEach((inp) => inp.addEventListener('input', (e) => {
      componentes[Number(e.target.dataset.i)].cantidad = parseFloat(e.target.value) || 1;
    }));
    contenido.querySelectorAll('[data-quitar-componente]').forEach((el) => el.addEventListener('click', () => { componentes.splice(Number(el.dataset.quitarComponente), 1); renderComponentes(); }));
  }

  renderCodigosBarra();
  renderUnidadesAlt();
  renderComponentes();

  document.getElementById('btn-agregar-codigo-barra').addEventListener('click', () => { codigosBarra.push({ codigoBarra: '', presentacion: 'unidad', factorConversion: 1 }); renderCodigosBarra(); });
  document.getElementById('btn-agregar-unidad-alt').addEventListener('click', () => { unidadesAlt.push({ unidadId: state.unidades[0]?.id, factorConversion: 1 }); renderUnidadesAlt(); });

  document.getElementById('f-es-kit').addEventListener('change', (e) => {
    document.getElementById('seccion-kit').style.display = e.target.checked ? 'block' : 'none';
  });

  let timeoutComponente = null;
  document.getElementById('buscar-componente').addEventListener('input', (e) => {
    clearTimeout(timeoutComponente);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('resultados-componente');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutComponente = setTimeout(async () => {
      const encontrados = (await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 10 }))
        .filter((p) => p.id !== productoId);
      resultados.innerHTML = encontrados.map((p, i) => `
        <div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)}</div></div>
      `).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        const p = encontrados[Number(el.dataset.i)];
        componentes.push({ componenteProductoId: p.id, descripcion: p.descripcion, cantidad: 1 });
        renderComponentes();
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  const nuevaCategoria = document.getElementById('f-nueva-categoria');
  if (nuevaCategoria) {
    nuevaCategoria.addEventListener('click', async () => {
      const nombre = await window.PuntoXModal.pedirTexto('Nombre de la nueva categoría:');
      if (!nombre || !nombre.trim()) return;
      try {
        const categoria = await window.puntoXInventario.crearCategoria({ nombre });
        if (!state.categorias.some((c) => c.id === categoria.id)) state.categorias.push(categoria);
        const select = document.getElementById('f-categoria');
        if (![...select.options].some((o) => o.value === categoria.id)) select.add(new Option(categoria.nombre, categoria.id));
        select.value = categoria.id;
      } catch (err) { mostrarError(err.message); }
    });
  }

  document.getElementById('btn-cancelar-producto').addEventListener('click', window.PuntoXModal.cerrarModal);

  document.getElementById('btn-guardar-producto').addEventListener('click', async () => {
    const payload = {
      codigoInterno: document.getElementById('f-codigo').value,
      descripcion: document.getElementById('f-descripcion').value,
      categoriaId: document.getElementById('f-categoria').value || null,
      unidadMedidaBaseId: document.getElementById('f-unidad').value,
      tasaItbisId: document.getElementById('f-tasa').value,
      metodoValoracion: document.getElementById('f-metodo').value,
      precioDetalle: parseFloat(document.getElementById('f-precio-detalle').value) || 0,
      precioMayorista: parseFloat(document.getElementById('f-precio-mayorista').value) || 0,
      precioDistribuidor: parseFloat(document.getElementById('f-precio-distribuidor').value) || 0,
      stockMinimo: parseFloat(document.getElementById('f-stock-min').value) || 0,
      stockMaximo: document.getElementById('f-stock-max').value ? parseFloat(document.getElementById('f-stock-max').value) : null,
      controlaLote: document.getElementById('f-controla-lote').checked,
      permiteVentaNegativo: document.getElementById('f-venta-negativo').checked,
      esKit: document.getElementById('f-es-kit').checked,
      esServicio: document.getElementById('f-es-servicio').checked,
      activo: esEdicion ? document.getElementById('f-activo').checked : true,
      codigosBarra, unidadesAlternativas: unidadesAlt, componentes,
    };
    if (!esEdicion) payload.costoPromedio = parseFloat(document.getElementById('f-costo').value) || 0;

    try {
      const guardado = await window.puntoXInventario.guardarProducto({ productoId: productoId || null, payload });
      if (!esEdicion) {
        const existenciaInicial = parseFloat(document.getElementById('f-existencia-inicial').value) || 0;
        if (existenciaInicial > 0 && state.almacenes[0]) {
          await window.puntoXInventario.crearAjuste({
            almacenId: state.almacenes[0].id, tipo: 'entrada', motivo: 'correccion_sistema',
            motivoDetalle: 'Existencia inicial al crear el producto',
            lineas: [{ productoId: guardado.id, cantidad: existenciaInicial, costoUnitario: payload.costoPromedio }],
            usuarioId: state.info.usuario.id,
          });
        }
      }
      window.PuntoXModal.cerrarModal();
      cargarProductos();
    } catch (err) {
      mostrarError(err.message);
    }
  });
}

// --- Kardex ---

async function verKardex(productoId, nombre) {
  const movimientos = await window.puntoXInventario.kardex({ productoId });
  window.PuntoXModal.abrirModal(`Kardex — ${nombre}`, `
    <table class="data-table">
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Almacén</th><th>Lote</th><th>Cantidad</th><th>Costo</th><th>Saldo</th></tr></thead>
      <tbody>
        ${movimientos.length === 0 ? '<tr><td colspan="7" style="text-align:center; color:var(--color-text-faint);">Sin movimientos</td></tr>' : ''}
        ${movimientos.map((m) => `
          <tr>
            <td>${new Date(m.created_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>${esc(m.tipo_movimiento)}</td>
            <td>${esc(m.almacen_nombre)}</td>
            <td>${m.numero_lote ? esc(m.numero_lote) : '—'}</td>
            <td style="color:${m.cantidad < 0 ? 'var(--color-danger)' : 'var(--color-success)'};">${m.cantidad > 0 ? '+' : ''}${esc(m.cantidad)}</td>
            <td>RD$ ${fmt(m.costo_unitario)}</td>
            <td>${esc(m.saldo_cantidad)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `);
}

// --- Existencias ---

async function cargarExistencias() {
  const filas = await window.puntoXInventario.existencias({});
  document.getElementById('existencias-tbody').innerHTML = filas.map((p) => {
    const bajo = p.existencia_total <= p.stock_minimo;
    const excedido = p.stock_maximo && p.existencia_total > p.stock_maximo;
    let estado = '<span class="pill-estado" style="background:var(--color-success);">Normal</span>';
    if (bajo) estado = '<span class="pill-estado" style="background:var(--color-danger);">Bajo mínimo</span>';
    else if (excedido) estado = '<span class="pill-estado" style="background:var(--color-warning);">Sobre-stock</span>';
    return `<tr><td>${esc(p.codigo_interno)}</td><td>${esc(p.descripcion)}</td><td>${esc(p.existencia_total)}</td><td>${esc(p.comprometida_total)}</td><td>${esc(p.stock_minimo)}</td><td>${estado}</td></tr>`;
  }).join('');
}

// --- Ajustes ---

async function cargarAjustes() {
  const ajustes = await window.puntoXInventario.listarAjustes({});
  document.getElementById('ajustes-vacio').style.display = ajustes.length === 0 ? 'block' : 'none';
  document.getElementById('ajustes-tbody').innerHTML = ajustes.map((a) => `
    <tr>
      <td>${esc(a.numero)}</td>
      <td><span class="pill-estado" style="background:${a.tipo === 'entrada' ? 'var(--color-success)' : 'var(--color-danger)'};">${esc(a.tipo)}</span></td>
      <td>${esc(a.almacen_nombre)}</td>
      <td>${esc(a.motivo)}${a.motivo_detalle ? ' — ' + a.motivo_detalle : ''}</td>
      <td>${fechaCorta(a.fecha)}</td>
      <td>${esc(a.usuario_nombre || '')}</td>
    </tr>
  `).join('');
}

async function abrirFormularioAjuste() {
  const lineas = [];
  const contenido = window.PuntoXModal.abrirModal('Nuevo ajuste de inventario', `
    <div class="form-grid">
      <div class="form-field"><label>Almacén</label><select id="fa-almacen">${opciones(state.almacenes, state.almacenes[0]?.id, (a) => a.nombre)}</select></div>
      <div class="form-field"><label>Tipo</label><select id="fa-tipo"><option value="entrada">Entrada</option><option value="salida">Salida</option></select></div>
      <div class="form-field"><label>Motivo *</label>
        <select id="fa-motivo">
          <option value="conteo_fisico">Conteo físico</option>
          <option value="correccion_sistema">Corrección de sistema</option>
          <option value="otro">Otro</option>
        </select>
      </div>
      <div class="form-field"><label>Detalle del motivo</label><input id="fa-motivo-detalle" /></div>
    </div>
    <div class="form-seccion">
      <div class="form-seccion__titulo">Productos</div>
      <div class="buscador-producto" style="position:relative; margin-bottom:10px;">
        <input id="fa-buscar" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="fa-resultados" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="fa-lineas"></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="fa-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="fa-guardar">Guardar ajuste</button>
    </div>
  `);

  // Productos con lote: en una entrada se indica el lote (y su vencimiento); en una salida se
  // puede elegir de qué lote sale.
  function campoLote(l, i) {
    if (!l.controlaLote) return '';
    if (document.getElementById('fa-tipo').value === 'entrada') {
      return `<input placeholder="Lote *" data-lote="${i}" value="${esc(l.numeroLote || '')}" style="width:110px;" />
        <input type="date" data-vence="${i}" value="${esc(l.fechaVencimiento || '')}" title="Vencimiento" style="width:140px;" />`;
    }
    return selectorLote(l.lotes || [], l.loteId, `data-lote-sel="${i}" style="width:230px;"`);
  }
  function renderLineas() {
    document.getElementById('fa-lineas').innerHTML = lineas.length === 0
      ? '<div class="empty-state" style="padding:10px;">Agrega productos con el buscador de arriba.</div>'
      : lineas.map((l, i) => `
        <div class="linea-dinamica">
          <span style="flex-grow:1; font-size:13px;">${esc(l.descripcion)}</span>
          ${campoLote(l, i)}
          <input type="number" step="0.01" value="${esc(l.cantidad)}" data-i="${i}" style="width:80px;" />
          <span class="carrito-quitar" data-quitar="${i}">✕</span>
        </div>
      `).join('');
    contenido.querySelectorAll('#fa-lineas input[data-i]').forEach((inp) => inp.addEventListener('input', (e) => { lineas[Number(e.target.dataset.i)].cantidad = parseFloat(e.target.value) || 1; }));
    contenido.querySelectorAll('#fa-lineas [data-lote]').forEach((inp) => inp.addEventListener('input', (e) => { lineas[Number(e.target.dataset.lote)].numeroLote = e.target.value; }));
    contenido.querySelectorAll('#fa-lineas [data-vence]').forEach((inp) => inp.addEventListener('input', (e) => { lineas[Number(e.target.dataset.vence)].fechaVencimiento = e.target.value; }));
    contenido.querySelectorAll('#fa-lineas [data-lote-sel]').forEach((sel) => sel.addEventListener('change', (e) => { lineas[Number(e.target.dataset.loteSel)].loteId = e.target.value || null; }));
    contenido.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); renderLineas(); }));
  }
  async function recargarLotes() {
    const almacenId = document.getElementById('fa-almacen').value;
    for (const l of lineas.filter((x) => x.controlaLote)) { l.lotes = await lotesDe(l.productoId, almacenId); l.loteId = null; }
    renderLineas();
  }
  document.getElementById('fa-tipo').addEventListener('change', renderLineas);
  document.getElementById('fa-almacen').addEventListener('change', recargarLotes);
  renderLineas();

  let timeoutBuscar = null;
  document.getElementById('fa-buscar').addEventListener('input', (e) => {
    clearTimeout(timeoutBuscar);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('fa-resultados');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutBuscar = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: document.getElementById('fa-almacen').value, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)} · Disp: ${esc(p.cantidad_disponible)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
        const p = encontrados[Number(el.dataset.i)];
        const lotes = p.controla_lote ? await lotesDe(p.id, document.getElementById('fa-almacen').value) : [];
        lineas.push({ productoId: p.id, descripcion: p.descripcion, cantidad: 1, costoUnitario: p.costo_promedio, controlaLote: Boolean(p.controla_lote), lotes });
        renderLineas();
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  document.getElementById('fa-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('fa-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXInventario.crearAjuste({
        almacenId: document.getElementById('fa-almacen').value,
        tipo: document.getElementById('fa-tipo').value,
        motivo: document.getElementById('fa-motivo').value,
        motivoDetalle: document.getElementById('fa-motivo-detalle').value || null,
        lineas: lineas.map((l) => ({
          productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario,
          numeroLote: l.numeroLote || null, fechaVencimiento: l.fechaVencimiento || null, loteId: l.loteId || null,
        })),
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarAjustes();
    } catch (err) {
      mostrarError(err.message);
    }
  });
}

// --- Mermas ---

async function cargarMermas() {
  const mermas = await window.puntoXInventario.listarMermas({});
  document.getElementById('mermas-vacio').style.display = mermas.length === 0 ? 'block' : 'none';
  document.getElementById('mermas-tbody').innerHTML = mermas.map((m) => `
    <tr><td>${esc(m.numero)}</td><td>${esc(m.producto_descripcion)}${m.numero_lote ? ` <span style="color:var(--color-text-muted);">· lote ${esc(m.numero_lote)}</span>` : ''}</td><td>${esc(m.almacen_nombre)}</td><td>${esc(m.cantidad)}</td><td>${esc(m.motivo)}</td><td>${fechaCorta(m.fecha)}</td></tr>
  `).join('');
}

async function abrirFormularioMerma() {
  let productoSel = null;
  const contenido = window.PuntoXModal.abrirModal('Nueva merma / avería', `
    <div class="form-grid">
      <div class="form-field"><label>Almacén</label><select id="fm-almacen">${opciones(state.almacenes, state.almacenes[0]?.id, (a) => a.nombre)}</select></div>
      <div class="form-field"><label>Cantidad *</label><input id="fm-cantidad" type="number" step="0.01" value="1" /></div>
    </div>
    <div class="form-field" style="margin-top:10px;">
      <label>Producto *</label>
      <div class="buscador-producto" style="position:relative;">
        <input id="fm-buscar" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="fm-resultados" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="fm-seleccionado" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
    </div>
    <div class="form-field" id="fm-campo-lote" style="margin-top:10px; display:none;"><label>Lote</label><div id="fm-lote"></div></div>
    <div class="form-field" style="margin-top:10px;"><label>Motivo *</label><input id="fm-motivo" placeholder="Ej: caja dañada en almacén" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="fm-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="fm-guardar">Registrar merma</button>
    </div>
  `);

  let timeoutBuscar = null;
  document.getElementById('fm-buscar').addEventListener('input', (e) => {
    clearTimeout(timeoutBuscar);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('fm-resultados');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutBuscar = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: document.getElementById('fm-almacen').value, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)} · Disp: ${esc(p.cantidad_disponible)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        productoSel = encontrados[Number(el.dataset.i)];
        document.getElementById('fm-seleccionado').textContent = `Seleccionado: ${productoSel.descripcion}`;
        resultados.style.display = 'none';
        e.target.value = '';
        mostrarLotesMerma();
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  // Con lote: se elige cuál se daña o vence (p. ej. el lote vencido que se descarta).
  async function mostrarLotesMerma() {
    const campo = document.getElementById('fm-campo-lote');
    campo.style.display = productoSel && productoSel.controla_lote ? 'block' : 'none';
    if (!productoSel || !productoSel.controla_lote) return;
    const lotes = await lotesDe(productoSel.id, document.getElementById('fm-almacen').value);
    document.getElementById('fm-lote').innerHTML = selectorLote(lotes, null, 'id="fm-lote-sel" class="input-normal"');
  }
  document.getElementById('fm-almacen').addEventListener('change', mostrarLotesMerma);

  document.getElementById('fm-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('fm-guardar').addEventListener('click', async () => {
    if (!productoSel) { mostrarError('Selecciona un producto'); return; }
    try {
      await window.puntoXInventario.crearMerma({
        almacenId: document.getElementById('fm-almacen').value,
        productoId: productoSel.id,
        loteId: document.getElementById('fm-lote-sel')?.value || null,
        cantidad: parseFloat(document.getElementById('fm-cantidad').value) || 1,
        costoUnitario: productoSel.costo_promedio,
        motivo: document.getElementById('fm-motivo').value,
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarMermas();
    } catch (err) {
      mostrarError(err.message);
    }
  });
}

// --- Transferencias ---

async function cargarTransferencias() {
  const transferencias = await window.puntoXInventario.listarTransferencias({});
  document.getElementById('transferencias-vacio').style.display = transferencias.length === 0 ? 'block' : 'none';
  document.getElementById('transferencias-tbody').innerHTML = transferencias.map((t) => `
    <tr><td>${esc(t.numero)}</td><td>${esc(t.almacen_origen_nombre)}</td><td>${esc(t.almacen_destino_nombre)}</td><td>${fechaCorta(t.fecha)}</td><td>${esc(t.usuario_nombre || '')}</td></tr>
  `).join('');
}

async function abrirFormularioTransferencia() {
  const lineas = [];
  window.PuntoXModal.abrirModal('Nueva transferencia entre almacenes', `
    <div class="form-grid">
      <div class="form-field"><label>Almacén origen</label><select id="ft-origen">${opciones(state.almacenes, state.almacenes[0]?.id, (a) => a.nombre)}</select></div>
      <div class="form-field"><label>Almacén destino</label><select id="ft-destino">${opciones(state.almacenes, state.almacenes[1]?.id || state.almacenes[0]?.id, (a) => a.nombre)}</select></div>
    </div>
    <div class="form-seccion">
      <div class="form-seccion__titulo">Productos</div>
      <div class="buscador-producto" style="position:relative; margin-bottom:10px;">
        <input id="ft-buscar" class="input-normal" type="text" placeholder="Buscar producto..." autocomplete="off" />
        <div id="ft-resultados" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="ft-lineas"></div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="ft-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="ft-guardar">Guardar transferencia</button>
    </div>
  `);

  const contenido = document.getElementById('modal-contenido');
  function renderLineas() {
    document.getElementById('ft-lineas').innerHTML = lineas.length === 0
      ? '<div class="empty-state" style="padding:10px;">Agrega productos con el buscador de arriba.</div>'
      : lineas.map((l, i) => `
        <div class="linea-dinamica">
          <span style="flex-grow:1; font-size:13px;">${esc(l.descripcion)}</span>
          ${l.controlaLote ? selectorLote(l.lotes || [], l.loteId, `data-lote-sel="${i}" style="width:230px;"`) : ''}
          <input type="number" step="0.01" value="${esc(l.cantidad)}" data-i="${i}" style="width:80px;" />
          <span class="carrito-quitar" data-quitar="${i}">✕</span>
        </div>
      `).join('');
    contenido.querySelectorAll('#ft-lineas input[data-i]').forEach((inp) => inp.addEventListener('input', (e) => { lineas[Number(e.target.dataset.i)].cantidad = parseFloat(e.target.value) || 1; }));
    contenido.querySelectorAll('#ft-lineas [data-lote-sel]').forEach((sel) => sel.addEventListener('change', (e) => { lineas[Number(e.target.dataset.loteSel)].loteId = e.target.value || null; }));
    contenido.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); renderLineas(); }));
  }
  document.getElementById('ft-origen').addEventListener('change', async () => {
    const almacenId = document.getElementById('ft-origen').value;
    for (const l of lineas.filter((x) => x.controlaLote)) { l.lotes = await lotesDe(l.productoId, almacenId); l.loteId = null; }
    renderLineas();
  });
  renderLineas();

  let timeoutBuscar = null;
  document.getElementById('ft-buscar').addEventListener('input', (e) => {
    clearTimeout(timeoutBuscar);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('ft-resultados');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutBuscar = setTimeout(async () => {
      const encontrados = await window.puntoXInventario.buscarProductos({ texto, almacenId: document.getElementById('ft-origen').value, limite: 10 });
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)} · Disp: ${esc(p.cantidad_disponible)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
        const p = encontrados[Number(el.dataset.i)];
        const lotes = p.controla_lote ? await lotesDe(p.id, document.getElementById('ft-origen').value) : [];
        lineas.push({ productoId: p.id, descripcion: p.descripcion, cantidad: 1, controlaLote: Boolean(p.controla_lote), lotes });
        renderLineas();
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  document.getElementById('ft-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('ft-guardar').addEventListener('click', async () => {
    try {
      await window.puntoXInventario.crearTransferencia({
        almacenOrigenId: document.getElementById('ft-origen').value,
        almacenDestinoId: document.getElementById('ft-destino').value,
        lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, loteId: l.loteId || null })),
        usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarTransferencias();
    } catch (err) {
      mostrarError(err.message);
    }
  });
}

// --- Conversiones ---

async function cargarConversiones() {
  const lista = await window.puntoXInventario.listarConversiones({});
  document.getElementById('conversiones-vacio').style.display = lista.length === 0 ? 'block' : 'none';
  document.getElementById('conversiones-tbody').innerHTML = lista.map((c) => `
    <tr>
      <td>${esc(c.numero)}</td>
      <td>${esc(c.cantidad_origen)} × ${esc(c.origen_descripcion)}</td>
      <td>${esc(c.cantidad_destino)} × ${esc(c.destino_descripcion)}</td>
      <td>${esc(c.almacen_nombre)}</td>
      <td style="text-align:right;">${c.costo_total === null ? '—' : 'RD$ ' + fmt(c.costo_total)}</td>
      <td>${fechaCorta(c.fecha)}</td>
      <td><span class="pill-estado" style="background:${c.estado === 'anulada' ? 'var(--color-danger)' : 'var(--color-success)'};">${c.estado === 'anulada' ? 'Anulada' : 'Confirmada'}</span></td>
      <td>${c.estado !== 'anulada' ? `<span class="enlace-accion" data-permiso="inventario.conversion.anular" data-anular-conversion="${esc(c.id)}" style="color:var(--color-danger); cursor:pointer; font-weight:700; font-size:12px;">Anular</span>` : ''}</td>
    </tr>`).join('');
  document.querySelectorAll('[data-anular-conversion]').forEach((el) => el.addEventListener('click', async () => {
    const doc = lista.find((x) => x.id === el.dataset.anularConversion) || {};
    const motivo = await window.PuntoXModal.confirmarAnulacion({ documento: 'Conversión', numero: doc.numero, total: doc.costo_total, revierte: ['Inventario: el producto convertido sale y el original vuelve a su lote y costo'] });
    if (!motivo) return;
    try {
      await window.puntoXInventario.anularConversion({ conversionId: el.dataset.anularConversion, motivo, usuarioId: state.info.usuario.id });
      cargarConversiones();
    } catch (err) { mostrarError(err.message); }
  }));
}

function buscadorEnFormulario(inputId, resultadosId, almacenFn, alElegir) {
  let espera = null;
  document.getElementById(inputId).addEventListener('input', (e) => {
    clearTimeout(espera);
    const texto = e.target.value.trim();
    const resultados = document.getElementById(resultadosId);
    if (!texto) { resultados.style.display = 'none'; return; }
    espera = setTimeout(async () => {
      const encontrados = (await window.puntoXInventario.buscarProductos({ texto, almacenId: almacenFn(), limite: 10 })).filter((p) => !p.es_kit);
      resultados.innerHTML = encontrados.map((p, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${esc(p.descripcion)}</div><div class="buscador-resultados__meta">${esc(p.codigo_interno)} · Disp: ${esc(p.cantidad_disponible)}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
        alElegir(encontrados[Number(el.dataset.i)]);
        resultados.style.display = 'none';
        e.target.value = '';
      }));
      resultados.style.display = 'block';
    }, 200);
  });
}

function abrirFormularioConversion() {
  let origen = null;
  let destino = null;
  const contenido = window.PuntoXModal.abrirModal('Nueva conversión de producto', `
    <div class="form-field"><label>Almacén</label><select id="fc-almacen">${opciones(state.almacenes, state.almacenes[0]?.id, (a) => a.nombre)}</select></div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field">
        <label>Sale (origen) *</label>
        <div class="buscador-producto" style="position:relative;">
          <input id="fc-buscar-origen" class="input-normal" type="text" placeholder="Ej.: Arroz saco 50 kg" autocomplete="off" />
          <div id="fc-resultados-origen" class="buscador-resultados" style="display:none;"></div>
        </div>
        <div id="fc-origen-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
        <div id="fc-campo-lote-origen" style="display:none; margin-top:6px;"></div>
        <input id="fc-cantidad-origen" type="number" step="0.01" min="0" value="1" style="margin-top:6px;" title="Cantidad que sale" />
      </div>
      <div class="form-field">
        <label>Entra (destino) *</label>
        <div class="buscador-producto" style="position:relative;">
          <input id="fc-buscar-destino" class="input-normal" type="text" placeholder="Ej.: Arroz por libra" autocomplete="off" />
          <div id="fc-resultados-destino" class="buscador-resultados" style="display:none;"></div>
        </div>
        <div id="fc-destino-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
        <div id="fc-campo-lote-destino" style="display:none; margin-top:6px;">
          <input id="fc-lote" placeholder="Lote (vacío = el del origen)" style="width:48%;" />
          <input id="fc-vence" type="date" title="Vencimiento (vacío = el del origen)" style="width:48%;" />
        </div>
        <input id="fc-cantidad-destino" type="number" step="0.01" min="0" value="1" style="margin-top:6px;" title="Cantidad que entra" />
      </div>
    </div>
    <div class="form-field" style="margin-top:10px;"><label>Nota</label><input id="fc-concepto" placeholder="Ej.: saco abierto para venta al detalle" /></div>
    <div id="fc-resumen" style="font-size:12px; color:var(--color-text-muted); margin-top:8px;"></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
      <button type="button" class="btn btn-secundario" id="fc-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="fc-guardar">Convertir</button>
    </div>
  `);
  const almacen = () => document.getElementById('fc-almacen').value;
  const resumen = () => {
    const qo = parseFloat(document.getElementById('fc-cantidad-origen').value) || 0;
    const qd = parseFloat(document.getElementById('fc-cantidad-destino').value) || 0;
    document.getElementById('fc-resumen').textContent = origen && destino && qo > 0 && qd > 0
      ? `Salen ${qo} de "${origen.descripcion}" y entran ${qd} de "${destino.descripcion}" (${(qd / qo).toLocaleString('es-DO', { maximumFractionDigits: 4 })} por cada uno). El costo del origen pasa completo al destino.` : '';
  };
  const lotesOrigen = async () => {
    const campo = document.getElementById('fc-campo-lote-origen');
    campo.style.display = origen && origen.controla_lote ? 'block' : 'none';
    if (origen && origen.controla_lote) campo.innerHTML = selectorLote(await lotesDe(origen.id, almacen()), null, 'id="fc-lote-origen" class="input-normal"');
  };
  buscadorEnFormulario('fc-buscar-origen', 'fc-resultados-origen', almacen, (p) => { origen = p; document.getElementById('fc-origen-sel').textContent = p.descripcion; lotesOrigen(); resumen(); });
  buscadorEnFormulario('fc-buscar-destino', 'fc-resultados-destino', almacen, (p) => {
    destino = p;
    document.getElementById('fc-destino-sel').textContent = p.descripcion;
    document.getElementById('fc-campo-lote-destino').style.display = p.controla_lote ? 'block' : 'none';
    resumen();
  });
  document.getElementById('fc-almacen').addEventListener('change', lotesOrigen);
  ['fc-cantidad-origen', 'fc-cantidad-destino'].forEach((id) => document.getElementById(id).addEventListener('input', resumen));
  document.getElementById('fc-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('fc-guardar').addEventListener('click', async () => {
    if (!origen || !destino) { mostrarError('Elige el producto de origen y el de destino'); return; }
    try {
      await window.puntoXInventario.crearConversion({
        almacenId: almacen(), productoOrigenId: origen.id, productoDestinoId: destino.id,
        cantidadOrigen: parseFloat(document.getElementById('fc-cantidad-origen').value) || 0,
        cantidadDestino: parseFloat(document.getElementById('fc-cantidad-destino').value) || 0,
        loteOrigenId: document.getElementById('fc-lote-origen')?.value || null,
        numeroLote: document.getElementById('fc-lote').value || null, fechaVencimiento: document.getElementById('fc-vence').value || null,
        concepto: document.getElementById('fc-concepto').value || null, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarConversiones();
    } catch (err) { mostrarError(err.message); }
  });
  void contenido;
}

// --- Vencimientos ---

function diasRestantes(l) {
  if (!l.fecha_vencimiento) return '<span style="color:var(--color-text-faint);">No vence</span>';
  if (l.dias_restantes < 0) return `<span style="color:var(--color-danger); font-weight:700;">Vencido hace ${-l.dias_restantes} días</span>`;
  if (l.dias_restantes === 0) return '<span style="color:var(--color-danger); font-weight:700;">Vence hoy</span>';
  return `<span style="color:${l.dias_restantes <= 30 ? 'var(--color-warning)' : 'inherit'};">${esc(l.dias_restantes)} días</span>`;
}

async function cargarVencimientos() {
  const vista = document.getElementById('lotes-vista').value;
  const filtro = document.getElementById('lotes-buscar').value.trim().toLowerCase();
  const todos = vista === 'todos' && window.puntoXInventario.lotes
    ? await window.puntoXInventario.lotes({})
    : await window.puntoXInventario.vencimientos();
  const lotes = todos.filter((l) => !filtro || `${l.descripcion} ${l.codigo_interno || ''} ${l.numero_lote}`.toLowerCase().includes(filtro));
  const vacio = document.getElementById('vencimientos-vacio');
  vacio.textContent = vista === 'todos' ? 'No hay lotes con existencia.' : 'No hay productos próximos a vencer.';
  vacio.style.display = lotes.length === 0 ? 'block' : 'none';
  document.getElementById('vencimientos-tbody').innerHTML = lotes.map((l) => `
    <tr>
      <td>${esc(l.descripcion)}</td><td>${esc(l.numero_lote)}</td><td>${esc(l.almacen_nombre)}</td><td>${esc(l.cantidad)}</td>
      <td>${fechaSimple(l.fecha_vencimiento)}</td>
      <td>${diasRestantes(l)}</td>
    </tr>
  `).join('');
}
document.getElementById('lotes-vista').addEventListener('change', cargarVencimientos);
document.getElementById('lotes-buscar').addEventListener('input', cargarVencimientos);

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('inventario');
  if (!state.info) return; // sin sesión o con la contraseña pendiente: el shell ya redirigió al login
  const [categorias, unidades, tasas, almacenes] = await Promise.all([
    window.puntoXInventario.listarCategorias(),
    window.puntoXInventario.listarUnidadesMedida(),
    window.puntoXInventario.listarTasasItbis(),
    window.puntoXInventario.listarAlmacenes(),
  ]);
  state.categorias = categorias; state.unidades = unidades; state.tasas = tasas; state.almacenes = almacenes;
  cambiarTab('productos');
}

init();
