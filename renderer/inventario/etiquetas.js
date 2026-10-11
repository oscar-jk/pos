// Inventario > Productos > Imprimir etiquetas: código de barras y precio, individual o en lote,
// para anaquel (hoja con 3 columnas) o para caja (una etiqueta de 50 × 30 mm por página).
(function () {
  function abrir() {
    if (!window.puntoXImpresion || !window.puntoXImpresion.imprimirEtiquetas) {
      mostrarError('La impresión de etiquetas está disponible en la aplicación de escritorio.');
      return;
    }
    const lineas = [];
    window.PuntoXModal.abrirModal('Imprimir etiquetas', `
      <div class="form-grid">
        <div class="form-field"><label>Formato</label>
          <select id="et-formato"><option value="anaquel">Anaquel (hoja carta, 3 columnas)</option><option value="caja">Caja (50 × 30 mm, una por página)</option></select></div>
      </div>
      <div class="form-seccion">
        <input id="et-buscar" class="input-normal" placeholder="Buscar producto por código, código de barras o descripción..." autocomplete="off" />
        <div id="et-resultados" style="margin-top:4px;"></div>
        <table class="data-table" style="margin-top:8px;"><thead><tr><th>Producto</th><th>Precio</th><th>Copias</th><th></th></tr></thead><tbody id="et-lineas"></tbody></table>
        <div id="et-total" style="font-size:12px; color:var(--color-text-muted); margin-top:6px;"></div>
      </div>
      <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secundario" id="et-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primario" id="et-imprimir">Imprimir</button>
      </div>`);

    const pintar = () => {
      document.getElementById('et-lineas').innerHTML = lineas.map((l, i) => `
        <tr><td>${esc(l.descripcion)} <small style="color:var(--color-text-muted);">${esc(l.codigo)}</small></td><td>${esc(fmt(l.precio))}</td>
        <td><input type="number" min="1" max="500" step="1" value="${esc(l.copias)}" data-i="${i}" class="et-copias" style="width:70px;" /></td>
        <td><span class="enlace-accion" data-quitar="${i}" style="color:var(--color-danger);">Quitar</span></td></tr>`).join('');
      document.getElementById('et-total').textContent = lineas.length ? `${lineas.reduce((a, l) => a + (l.copias || 1), 0)} etiquetas` : 'Agregue productos con el buscador.';
      document.querySelectorAll('.et-copias').forEach((el) => el.addEventListener('input', () => {
        lineas[Number(el.dataset.i)].copias = Math.max(1, Math.min(500, parseInt(el.value, 10) || 1));
        document.getElementById('et-total').textContent = `${lineas.reduce((a, l) => a + l.copias, 0)} etiquetas`;
      }));
      document.querySelectorAll('[data-quitar]').forEach((el) => el.addEventListener('click', () => { lineas.splice(Number(el.dataset.quitar), 1); pintar(); }));
    };
    pintar();

    let espera = null;
    document.getElementById('et-buscar').addEventListener('input', (e) => {
      clearTimeout(espera);
      const texto = e.target.value.trim();
      const caja = document.getElementById('et-resultados');
      if (!texto) { caja.innerHTML = ''; return; }
      espera = setTimeout(async () => {
        const productos = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 6 });
        caja.innerHTML = productos.map((p, i) => `<div data-p="${i}" style="cursor:pointer; padding:6px 8px; border:1px solid var(--color-border); margin-bottom:2px; border-radius:6px;">${esc(p.descripcion)} <small>${esc(p.codigo_interno)} · ${esc(fmt(p.precio_detalle))}</small></div>`).join('');
        caja.querySelectorAll('[data-p]').forEach((el) => el.addEventListener('click', () => {
          const p = productos[Number(el.dataset.p)];
          const existente = lineas.find((l) => l.productoId === p.id);
          if (existente) existente.copias = Math.min(500, existente.copias + 1);
          else lineas.push({ productoId: p.id, descripcion: p.descripcion, codigo: p.codigo_interno, precio: p.precio_detalle, copias: 1 });
          caja.innerHTML = '';
          document.getElementById('et-buscar').value = '';
          pintar();
        }));
      }, 200);
    });

    document.getElementById('et-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
    document.getElementById('et-imprimir').addEventListener('click', async () => {
      if (lineas.length === 0) { mostrarError('Agregue al menos un producto.'); return; }
      const formato = document.getElementById('et-formato').value;
      try {
        await window.puntoXImpresion.imprimirEtiquetas({ formato, items: lineas.map((l) => ({ productoId: l.productoId, copias: l.copias })) });
        window.PuntoXModal.cerrarModal();
      } catch (err) {
        window.PuntoXModal.cerrarModal();
        mostrarError(err.message);
      }
    });
  }

  window.PuntoXEtiquetas = { abrir };
}());
