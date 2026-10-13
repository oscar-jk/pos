// Inventario > Listas de precio: administración de las listas (el backend aplica la regla
// categoría del cliente > sucursal > nivel de precio al vender).
(function () {
  let sucursales = [];
  let categorias = [];
  const usuarioId = () => state.info.usuario.id;

  async function cargar() {
    const boton = document.getElementById('btn-nueva-lista');
    if (boton && !boton.dataset.enlazado) { boton.dataset.enlazado = '1'; boton.addEventListener('click', () => abrir(null)); }
    try {
      [sucursales, categorias] = await Promise.all([window.puntoXConfig.listarSucursales(), window.puntoXCxc.listarCategorias()]);
      const listas = await window.puntoXInventario.listarListasPrecio();
      document.getElementById('listas-vacio').style.display = listas.length ? 'none' : 'block';
      document.getElementById('listas-tbody').innerHTML = listas.map((l) => `
        <tr>
          <td><strong>${esc(l.nombre)}</strong></td>
          <td>${esc(l.categoria_cliente_nombre || '—')}</td>
          <td>${esc(l.sucursal_nombre || '—')}</td>
          <td>${l.porcentaje_sobre_detalle === null || l.porcentaje_sobre_detalle === undefined ? '—' : `${esc(l.porcentaje_sobre_detalle)}%`}</td>
          <td>${esc(l.productos)}</td>
          <td><span class="pill-estado" style="background:${l.activo ? 'var(--color-success)' : 'var(--color-text-faint)'};">${l.activo ? 'Activa' : 'Desactivada'}</span></td>
          <td style="white-space:nowrap;">${l.activo ? `<span class="enlace-accion" data-editar-lista="${esc(l.id)}">Editar</span> · <span class="enlace-accion" data-desactivar-lista="${esc(l.id)}" style="color:var(--color-danger);">Desactivar</span>` : ''}</td>
        </tr>`).join('');
      document.querySelectorAll('[data-editar-lista]').forEach((el) => el.addEventListener('click', () => abrir(el.dataset.editarLista)));
      document.querySelectorAll('[data-desactivar-lista]').forEach((el) => el.addEventListener('click', () => desactivar(el.dataset.desactivarLista, listas)));
    } catch (err) { mostrarError(err.message); }
  }

  async function desactivar(id, listas) {
    const lista = listas.find((l) => l.id === id) || {};
    const ok = await window.PuntoXModal.confirmarAnulacion({
      documento: 'Lista de precio', numero: lista.nombre, total: null,
      revierte: ['Las ventas nuevas dejan de usar esta lista y vuelven al nivel de precio', 'Las facturas ya emitidas no cambian'], aviso: 'La lista no se puede reactivar: cree una nueva.',
    });
    if (!ok) return;
    try { await window.puntoXInventario.desactivarListaPrecio({ listaId: id, usuarioId: usuarioId() }); cargar(); } catch (err) { mostrarError(err.message); }
  }

  const opciones = (lista, sel, vacio) => `<option value="">${vacio}</option>${lista.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}`;

  async function abrir(listaId) {
    const lista = listaId ? await window.puntoXInventario.obtenerListaPrecio({ listaId }) : null;
    const lineas = lista ? lista.lineas.map((l) => ({ productoId: l.producto_id, descripcion: l.descripcion, codigo: l.codigo_interno, detalle: l.precio_detalle, precio: l.precio })) : [];

    window.PuntoXModal.abrirModal(lista ? 'Editar lista de precio' : 'Nueva lista de precio', `
      <div class="form-grid">
        <div class="form-field" style="grid-column: span 2;"><label>Nombre *</label><input id="lp-nombre" value="${esc(lista ? lista.nombre : '')}" /></div>
        <div class="form-field"><label>Categoría de cliente</label><select id="lp-categoria">${opciones(categorias, lista && lista.categoria_cliente_id, 'Ninguna')}</select></div>
        <div class="form-field"><label>Sucursal</label><select id="lp-sucursal">${opciones(sucursales, lista && lista.sucursal_id, 'Ninguna')}</select></div>
        <div class="form-field" style="grid-column: span 2;"><label>% sobre el precio de detalle (para productos que no estén en la lista; negativo = descuento)</label>
          <input id="lp-pct" type="number" step="0.01" value="${lista && lista.porcentaje_sobre_detalle !== null && lista.porcentaje_sobre_detalle !== undefined ? esc(lista.porcentaje_sobre_detalle) : ''}" placeholder="Vacío: solo los productos listados" /></div>
      </div>
      <div class="form-seccion">
        <label style="font-weight:700; font-size:12px;">Precios fijos (ITBIS incluido)</label>
        <input id="lp-buscar" class="input-normal" placeholder="Buscar producto para agregar..." autocomplete="off" style="margin:6px 0;" />
        <div id="lp-resultados"></div>
        <table class="data-table"><thead><tr><th>Producto</th><th>Detalle</th><th>Precio en la lista</th><th></th></tr></thead><tbody id="lp-lineas"></tbody></table>
      </div>
      <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secundario" id="lp-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primario" id="lp-guardar">${lista ? 'Guardar cambios' : 'Crear lista'}</button>
      </div>`);

    const pintarLineas = () => {
      document.getElementById('lp-lineas').innerHTML = lineas.map((l, i) => `
        <tr><td>${esc(l.descripcion)} <small style="color:var(--color-text-muted);">${esc(l.codigo)}</small></td><td>${esc(fmt(l.detalle))}</td>
        <td><input type="number" min="0.01" step="0.01" value="${esc(l.precio)}" data-i="${i}" class="lp-precio" style="width:110px;" /></td>
        <td><span class="enlace-accion" data-quitar="${i}" style="color:var(--color-danger);">Quitar</span></td></tr>`).join('');
      document.querySelectorAll('.lp-precio').forEach((el) => el.addEventListener('input', () => { lineas[Number(el.dataset.i)].precio = parseFloat(el.value) || 0; }));
      document.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); pintarLineas(); }));
    };
    pintarLineas();

    let espera = null;
    document.getElementById('lp-buscar').addEventListener('input', (e) => {
      clearTimeout(espera);
      const texto = e.target.value.trim();
      const caja = document.getElementById('lp-resultados');
      if (!texto) { caja.innerHTML = ''; return; }
      espera = setTimeout(async () => {
        const productos = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 6 });
        caja.innerHTML = productos.map((p, i) => `<div class="buscador-resultados__item" data-p="${i}" style="cursor:pointer; padding:6px 8px; border:1px solid var(--color-border); margin-bottom:2px; border-radius:6px;">${esc(p.descripcion)} <small>${esc(p.codigo_interno)} · ${esc(fmt(p.precio_detalle))}</small></div>`).join('');
        caja.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('click', () => {
          const p = productos[Number(el.dataset.p)];
          if (!lineas.some((l) => l.productoId === p.id)) lineas.push({ productoId: p.id, descripcion: p.descripcion, codigo: p.codigo_interno, detalle: p.precio_detalle, precio: p.precio_detalle });
          caja.innerHTML = '';
          document.getElementById('lp-buscar').value = '';
          pintarLineas();
        }));
      }, 200);
    });

    document.getElementById('lp-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
    document.getElementById('lp-guardar').addEventListener('click', async () => {
      try {
        await window.puntoXInventario.guardarListaPrecio({
          listaId: listaId || undefined, nombre: document.getElementById('lp-nombre').value,
          categoriaClienteId: document.getElementById('lp-categoria').value || null, sucursalId: document.getElementById('lp-sucursal').value || null,
          porcentajeSobreDetalle: document.getElementById('lp-pct').value, lineas: lineas.map((l) => ({ productoId: l.productoId, precio: l.precio })), usuarioId: usuarioId(),
        });
        window.PuntoXModal.cerrarModal();
        cargar();
      } catch (err) { window.PuntoXModal.cerrarModal(); mostrarError(err.message); }
    });
  }

  window.PuntoXListasPrecio = { cargar };
}());
