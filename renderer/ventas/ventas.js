const state = {
  info: null,
  modoVenta: 'rapida',
  documento: 'factura', // factura | cotizacion | conduce
  origen: null, // { tipo: 'cuenta' | 'cotizacion' | 'conduces', ids, ... } al facturar desde otro documento
  cliente: null,
  nivelPrecio: 'detalle',
  carrito: [], // { producto, cantidad, descuentoPct, descuentoMonto, modoDescuento: 'pct' | 'monto', precioFijo? }
};

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function redondear(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function precioPorNivel(producto, nivel) {
  if (nivel === 'mayorista') return producto.precio_mayorista || producto.precio_detalle;
  if (nivel === 'distribuidor') return producto.precio_distribuidor || producto.precio_detalle;
  return producto.precio_detalle;
}

// Una línea que viene de una cotización o un conduce conserva el precio de ese documento.
function precioLinea(linea) {
  return linea.precioFijo ?? precioPorNivel(linea.producto, state.nivelPrecio);
}

// Réplica de main/ipc/ventas.js (descuentoLinea + calcularLinea) para previsualizar en vivo:
// el descuento de la línea es el mayor entre la promoción vigente y el manual (en % o en RD$).
function calcularLinea(linea) {
  const precioUnitario = precioLinea(linea);
  const bruto = redondear(precioUnitario * linea.cantidad);
  const manual = linea.modoDescuento === 'monto'
    ? redondear(linea.descuentoMonto || 0)
    : redondear(bruto * ((linea.descuentoPct || 0) / 100));
  const p = linea.producto.promocion;
  const promo = !p ? 0 : redondear(p.tipo_descuento === 'porcentaje' ? bruto * (p.valor / 100) : Math.min(bruto, p.valor * linea.cantidad));
  const descuento = promo > manual ? promo : manual;
  const totalLinea = redondear(bruto - descuento);
  const baseImponible = redondear(totalLinea / (1 + linea.producto.tasa_itbis_pct));
  const itbisMonto = redondear(totalLinea - baseImponible);
  return {
    precioUnitario, bruto, manual, descuento, promocion: promo > manual ? p : null,
    totalLinea, baseImponible, itbisMonto,
  };
}

// Lo que se envía al guardar: el descuento manual tal como se escribió (el servidor aplica la promoción).
function descuentoManual(l) {
  return l.modoDescuento === 'monto' ? { descuentoPct: 0, descuentoMonto: l.descuentoMonto || 0 } : { descuentoPct: l.descuentoPct || 0 };
}

function textoPromocion(p) {
  return p.tipo_descuento === 'porcentaje' ? `${p.valor}%` : `${fmt(p.valor)} c/u`;
}

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

function ocultarExito() {
  document.getElementById('factura-exito').style.display = 'none';
}

// --- Búsqueda de producto ---

let timeoutBusqueda = null;
document.getElementById('input-buscar-producto').addEventListener('input', (e) => {
  clearTimeout(timeoutBusqueda);
  const texto = e.target.value.trim();
  const contenedor = document.getElementById('resultados-producto');
  if (!texto) { contenedor.style.display = 'none'; return; }
  timeoutBusqueda = setTimeout(async () => {
    const resultados = await window.puntoXInventario.buscarProductos({ texto, almacenId: state.info.almacenId, limite: 15 });
    renderResultadosProducto(resultados);
  }, 200);
});

function renderResultadosProducto(resultados) {
  const contenedor = document.getElementById('resultados-producto');
  if (resultados.length === 0) {
    contenedor.innerHTML = '<div class="buscador-resultados__vacio">Sin resultados</div>';
  } else {
    contenedor.innerHTML = resultados.map((p, i) => `
      <div class="buscador-resultados__item" data-index="${i}">
        <div>
          <div class="buscador-resultados__nombre">${p.descripcion}</div>
          <div class="buscador-resultados__meta">${p.codigo_interno} · Disp: ${p.cantidad_disponible}${p.promocion ? ` · <span style="color:var(--color-success); font-weight:700;">Promoción ${textoPromocion(p.promocion)}</span>` : ""}</div>
        </div>
        <div class="buscador-resultados__precio">${fmt(precioPorNivel(p, state.nivelPrecio))}</div>
      </div>
    `).join('');
    contenedor.querySelectorAll('.buscador-resultados__item').forEach((el) => {
      el.addEventListener('click', () => {
        agregarAlCarrito(resultados[Number(el.dataset.index)]);
        contenedor.style.display = 'none';
        const input = document.getElementById('input-buscar-producto');
        input.value = '';
        input.focus();
      });
    });
  }
  contenedor.style.display = 'block';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.buscador-producto')) {
    document.getElementById('resultados-producto').style.display = 'none';
    document.getElementById('resultados-cliente').style.display = 'none';
  }
});

function agregarAlCarrito(producto) {
  const existente = state.carrito.find((l) => l.producto.id === producto.id);
  if (existente) {
    existente.cantidad += 1;
  } else {
    state.carrito.push({ producto, cantidad: 1, descuentoPct: 0, descuentoMonto: 0, modoDescuento: 'pct' });
  }
  renderCarrito();
}

function renderCarrito() {
  const tbody = document.getElementById('carrito-tbody');
  const vacio = document.getElementById('carrito-vacio');
  vacio.style.display = state.carrito.length === 0 ? 'block' : 'none';

  const bloqueado = Boolean(state.origen);
  const descuentoBloqueado = state.origen && state.origen.tipo === 'cotizacion';
  tbody.innerHTML = state.carrito.map((linea, i) => {
    const calc = calcularLinea(linea);
    const precioUnitario = calc.precioUnitario;
    // El descuento manual se escribe en % o en RD$; el otro campo muestra su equivalente.
    const pctManual = linea.modoDescuento === 'monto' ? (calc.bruto > 0 ? redondear((calc.manual / calc.bruto) * 100) : 0) : linea.descuentoPct;
    const montoManual = linea.modoDescuento === 'monto' ? linea.descuentoMonto : calc.manual;
    return `
      <tr data-index="${i}">
        <td>${linea.producto.descripcion}${calc.promocion ? `<div class="linea-promo" title="${escHtml(calc.promocion.nombre || '')}">Promoción −${textoPromocion(calc.promocion)}</div>` : ''}</td>
        <td style="text-align:center;"><input type="number" min="0.01" step="0.01" value="${linea.cantidad}" class="cant-input" ${bloqueado ? 'disabled' : ''} /></td>
        <td style="text-align:center; white-space:nowrap;">
          <input type="number" min="0" max="100" step="0.01" value="${pctManual}" class="desc-input" title="Descuento en %" ${descuentoBloqueado ? 'disabled' : ''} />
          <input type="number" min="0" step="0.01" value="${montoManual}" class="desc-monto" title="Descuento en RD$" ${descuentoBloqueado ? 'disabled' : ''} />
        </td>
        <td style="text-align:right;">${fmt(precioUnitario)}</td>
        <td style="text-align:right; font-weight:700;">${fmt(calc.totalLinea)}</td>
        <td class="carrito-quitar" style="${bloqueado ? 'visibility:hidden;' : ''}">✕</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    const i = Number(tr.dataset.index);
    tr.querySelector('.cant-input').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      state.carrito[i].cantidad = v > 0 ? v : 1;
      renderCarrito();
    });
    tr.querySelector('.desc-input').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      Object.assign(state.carrito[i], { descuentoPct: v >= 0 ? v : 0, modoDescuento: 'pct' });
      renderCarrito();
    });
    tr.querySelector('.desc-monto').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      Object.assign(state.carrito[i], { descuentoMonto: v >= 0 ? v : 0, modoDescuento: 'monto' });
      renderCarrito();
    });
    tr.querySelector('.carrito-quitar').addEventListener('click', () => {
      if (state.origen) return;
      state.carrito.splice(i, 1);
      renderCarrito();
    });
  });

  renderTotales();
}

// --- Totales y pagos ---

function calcularTotalesCarrito() {
  let subtotalLineas = 0;
  let itbisLineas = 0;
  for (const linea of state.carrito) {
    const calc = calcularLinea(linea);
    subtotalLineas += calc.baseImponible;
    itbisLineas += calc.itbisMonto;
  }
  subtotalLineas = redondear(subtotalLineas);
  itbisLineas = redondear(itbisLineas);
  const totalLineas = redondear(subtotalLineas + itbisLineas);

  const descuentoGlobalPct = parseFloat(document.getElementById('input-descuento-global').value) || 0;
  const descuentoGlobalMonto = redondear(totalLineas * (descuentoGlobalPct / 100));
  const factor = totalLineas > 0 ? (totalLineas - descuentoGlobalMonto) / totalLineas : 1;
  const subtotal = redondear(subtotalLineas * factor);
  const itbisTotal = redondear(itbisLineas * factor);
  const total = redondear(subtotal + itbisTotal);

  return { subtotal, itbisTotal, total, descuentoGlobalMonto };
}

function renderTotales() {
  const { subtotal, itbisTotal, total, descuentoGlobalMonto } = calcularTotalesCarrito();
  document.getElementById('total-subtotal').textContent = fmt(subtotal);
  document.getElementById('total-descuento').textContent = `— ${fmt(descuentoGlobalMonto)}`;
  document.getElementById('total-itbis').textContent = fmt(itbisTotal);
  document.getElementById('total-total').textContent = fmt(total);

  actualizarPagoCredito(total);
  const etiqueta = { factura: 'Cobrar', cotizacion: 'Guardar cotización', conduce: 'Registrar conduce' }[state.documento];
  document.getElementById('btn-cobrar').textContent = `${etiqueta} ${fmt(total)}`;
}

function actualizarPagoCredito(total) {
  const efectivo = parseFloat(document.getElementById('pago-efectivo').value) || 0;
  const tarjeta = parseFloat(document.getElementById('pago-tarjeta').value) || 0;
  const transferencia = parseFloat(document.getElementById('pago-transferencia').value) || 0;
  const credito = redondear(Math.max(0, total - efectivo - tarjeta - transferencia));
  document.getElementById('pago-credito').value = credito.toFixed(2);

  const btn = document.getElementById('btn-cobrar');
  const requisito = {
    factura: credito === 0 || Boolean(state.cliente),
    cotizacion: true,
    conduce: Boolean(state.cliente),
  }[state.documento];
  btn.disabled = !(state.carrito.length > 0 && requisito);
}

['input-descuento-global'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderTotales);
});
['pago-efectivo', 'pago-tarjeta', 'pago-transferencia'].forEach((id) => {
  document.getElementById(id).addEventListener('input', () => {
    const { total } = calcularTotalesCarrito();
    actualizarPagoCredito(total);
  });
});

document.getElementById('select-nivel-precio').addEventListener('change', (e) => {
  state.nivelPrecio = e.target.value;
  renderCarrito();
});

// --- Modo de venta ---

function setModoVenta(modo) {
  if (modo === 'rapida' && (state.documento === 'conduce' || state.origen)) return; // requieren el cliente ya elegido
  state.modoVenta = modo;
  document.getElementById('btn-modo-rapida').classList.toggle('is-active', modo === 'rapida');
  document.getElementById('btn-modo-completa').classList.toggle('is-active', modo === 'completa');
  document.getElementById('bloque-cliente').style.display = modo === 'completa' ? 'block' : 'none';
  if (modo === 'rapida') {
    state.cliente = null;
    document.getElementById('cliente-nombre').textContent = 'Consumidor final';
  }
  actualizarSubtitulo();
}

document.getElementById('btn-modo-rapida').addEventListener('click', () => setModoVenta('rapida'));
document.getElementById('btn-modo-completa').addEventListener('click', () => setModoVenta('completa'));

function actualizarSubtitulo() {
  const vendedor = state.info.usuario ? state.info.usuario.nombreCompleto : '';
  const modoTexto = state.modoVenta === 'rapida' ? 'Venta rápida (mostrador)' : 'Venta completa';
  document.getElementById('subtitulo-venta').textContent = `${modoTexto} — vendedor: ${vendedor}`;
}

// --- Búsqueda de cliente ---

document.getElementById('cliente-cambiar').addEventListener('click', (e) => {
  e.preventDefault();
  const input = document.getElementById('input-buscar-cliente');
  input.style.display = 'block';
  input.value = '';
  input.focus();
});

let timeoutCliente = null;
document.getElementById('input-buscar-cliente').addEventListener('input', (e) => {
  clearTimeout(timeoutCliente);
  const texto = e.target.value.trim();
  const contenedor = document.getElementById('resultados-cliente');
  if (!texto) { contenedor.style.display = 'none'; return; }
  timeoutCliente = setTimeout(async () => {
    const resultados = await window.puntoXCxc.buscarClientes({ texto, limite: 10 });
    renderResultadosCliente(resultados);
  }, 200);
});

function renderResultadosCliente(resultados) {
  const contenedor = document.getElementById('resultados-cliente');
  const items = resultados.map((c, i) => `
    <div class="buscador-resultados__item" data-index="${i}">
      <div>
        <div class="buscador-resultados__nombre">${c.nombre}</div>
        <div class="buscador-resultados__meta">${c.rnc_cedula || 'Sin RNC/cédula'}${c.bloqueado ? ' · BLOQUEADO' : ''}</div>
      </div>
    </div>
  `).join('');
  contenedor.innerHTML = items || '<div class="buscador-resultados__vacio">Sin resultados. Créalo desde Cuentas por Cobrar.</div>';
  contenedor.querySelectorAll('.buscador-resultados__item').forEach((el) => {
    el.addEventListener('click', async () => {
      const cliente = await window.puntoXCxc.obtenerCliente({ clienteId: resultados[Number(el.dataset.index)].id });
      seleccionarCliente(cliente);
      contenedor.style.display = 'none';
      document.getElementById('input-buscar-cliente').style.display = 'none';
    });
  });
  contenedor.style.display = 'block';
}

function seleccionarCliente(cliente) {
  state.cliente = cliente;
  document.getElementById('cliente-nombre').textContent = cliente.nombre;
  if (cliente.categoria_id) {
    const categoria = state.categorias.find((c) => c.id === cliente.categoria_id);
    if (categoria) {
      state.nivelPrecio = categoria.nivel_precio;
      document.getElementById('select-nivel-precio').value = categoria.nivel_precio;
    }
  }
  if (cliente.tipo_comprobante_default) {
    document.getElementById('select-ncf').value = cliente.tipo_comprobante_default;
  }
  renderCarrito();
}

// --- Cobrar ---

document.getElementById('btn-cobrar').addEventListener('click', async () => {
  mostrarError(null);
  ocultarExito();
  const btn = document.getElementById('btn-cobrar');
  btn.disabled = true;

  const efectivo = parseFloat(document.getElementById('pago-efectivo').value) || 0;
  const tarjeta = parseFloat(document.getElementById('pago-tarjeta').value) || 0;
  const transferencia = parseFloat(document.getElementById('pago-transferencia').value) || 0;
  const credito = parseFloat(document.getElementById('pago-credito').value) || 0;

  const condicionPago = credito > 0 ? (efectivo + tarjeta + transferencia > 0 ? 'mixto' : 'credito') : 'contado';
  const origen = state.origen;

  const base = {
    modoVenta: state.modoVenta,
    sucursalId: state.info.sucursalId,
    almacenId: state.info.almacenId,
    clienteId: state.cliente ? state.cliente.id : null,
    vendedorId: state.info.usuario ? state.info.usuario.id : null,
    usuarioId: state.info.usuario ? state.info.usuario.id : null,
    nivelPrecio: state.nivelPrecio,
    descuentoGlobalPct: parseFloat(document.getElementById('input-descuento-global').value) || 0,
    lineas: state.carrito.map((l) => ({
      productoId: l.producto.id, cantidad: l.cantidad, precioUnitario: precioLinea(l), ...descuentoManual(l),
    })),
  };
  const concepto = document.getElementById('input-concepto').value.trim() || null;

  try {
    let documento;
    if (state.documento === 'cotizacion') {
      documento = await window.puntoXVentas.crearCotizacion({ ...base, concepto, diasValidez: parseInt(document.getElementById('input-validez').value, 10) || 15 });
    } else if (state.documento === 'conduce') {
      documento = await window.puntoXVentas.crearConduce({ ...base, concepto });
    } else {
      documento = await window.puntoXVentas.crearFactura({
        ...base,
        cajaId: state.info.cajaId,
        condicionPago,
        tipoNcfCodigo: document.getElementById('select-ncf').value,
        monedaId: state.info.monedaId,
        tasaCambio: 1,
        pagos: [
          { formaPago: 'efectivo', monto: efectivo },
          { formaPago: 'tarjeta', monto: tarjeta },
          { formaPago: 'transferencia', monto: transferencia },
          { formaPago: 'credito', monto: credito },
        ].filter((p) => p.monto > 0),
        cuentaAbiertaId: origen && origen.tipo === 'cuenta' ? origen.id : null,
        cotizacionId: origen && origen.tipo === 'cotizacion' ? origen.id : null,
        conduceIds: origen && origen.tipo === 'conduces' ? origen.ids : null,
      });
    }
    mostrarExitoDocumento(documento);
    if (state.origen) terminarOrigen();
    state.carrito = [];
    state.cliente = null;
    document.getElementById('cliente-nombre').textContent = 'Consumidor final';
    document.getElementById('pago-efectivo').value = 0;
    document.getElementById('pago-tarjeta').value = 0;
    document.getElementById('pago-transferencia').value = 0;
    document.getElementById('input-descuento-global').value = 0;
    document.getElementById('input-concepto').value = '';
    renderCarrito();
    cargarHistorial();
  } catch (err) {
    mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
    btn.disabled = state.carrito.length === 0;
  }
});

// --- Historial ---

async function cargarHistorial() {
  const facturas = await window.puntoXVentas.listarFacturas({ limite: 20 });
  const tbody = document.getElementById('historial-tbody');
  const vacio = document.getElementById('historial-vacio');
  vacio.style.display = facturas.length === 0 ? 'block' : 'none';

  tbody.innerHTML = facturas.map((f) => {
    const colorEstado = f.estado === 'anulado' ? 'var(--color-danger)' : 'var(--color-success)';
    const fecha = new Date(f.fecha).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
    return `
      <tr>
        <td>${f.numero}</td>
        <td>${f.ncf}</td>
        <td>${f.cliente_nombre}</td>
        <td>${fecha}</td>
        <td>${fmt(f.total)}</td>
        <td><span class="status-pill" style="background:${colorEstado};">${f.estado}</span></td>
        <td>
          ${f.estado !== 'anulado' ? `<a href="#" class="btn-anular" data-permiso="ventas.factura.anular" data-id="${f.id}" style="color:var(--color-danger); font-size:12px; font-weight:700;">Anular</a>` : ''}
          ${f.estado !== 'anulado' ? ` · <a href="#" class="btn-devolver" data-permiso="ventas.devolucion.crear" data-id="${f.id}" style="color:var(--color-accent); font-size:12px; font-weight:700;">Devolver</a>` : ''}
          ${window.puntoXImpresion ? ` · <a href="#" class="btn-reimprimir" data-permiso="ventas.factura.imprimir" data-id="${f.id}" style="color:var(--color-accent); font-size:12px; font-weight:700;">Imprimir</a>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-anular').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const motivo = prompt('Motivo de la anulación:');
      if (!motivo) return;
      try {
        await window.puntoXVentas.anularFactura({
          documentoId: btn.dataset.id, motivo, usuarioId: state.info.usuario.id,
        });
        cargarHistorial();
      } catch (err) {
        mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
      }
    });
  });

  tbody.querySelectorAll('.btn-devolver').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      abrirFormularioDevolucion(btn.dataset.id);
    });
  });

  tbody.querySelectorAll('.btn-reimprimir').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      imprimirFactura(btn.dataset.id, 'factura');
    });
  });
}

async function imprimirFactura(documentoId, formato) {
  try {
    await window.puntoXImpresion.imprimirFactura({ documentoId, formato });
  } catch (err) {
    mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
  }
}

// --- Devolución (nota de crédito) ---

async function abrirFormularioDevolucion(facturaId) {
  mostrarError(null);
  const factura = await window.puntoXVentas.obtenerFactura({ documentoId: facturaId });
  const lineasPendientes = factura.lineas.filter((l) => redondear(l.cantidad - l.cantidad_devuelta) > 0.001);
  if (lineasPendientes.length === 0) { mostrarError('Esta factura no tiene líneas pendientes de devolver.'); return; }

  const contenido = window.PuntoXModal.abrirModal(`Devolución — Factura ${factura.numero}`, `
    <p style="font-size:13px; color:var(--color-text-muted); margin-bottom:12px;">Cliente: ${factura.cliente_nombre}</p>
    <table class="data-table">
      <thead><tr><th>Producto</th><th>Vendido</th><th>Ya devuelto</th><th style="width:120px;">Cantidad a devolver</th></tr></thead>
      <tbody>
        ${lineasPendientes.map((l) => `
          <tr>
            <td>${l.producto_descripcion}</td><td>${l.cantidad}</td><td>${l.cantidad_devuelta}</td>
            <td><input type="number" min="0" max="${redondear(l.cantidad - l.cantidad_devuelta)}" step="0.01" value="0"
              class="input-devolver" data-detalle-id="${l.id}" data-max="${redondear(l.cantidad - l.cantidad_devuelta)}"
              style="width:90px; padding:6px 8px; border:1px solid var(--color-border-input); border-radius:6px;" /></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="form-field" style="margin-top:14px;"><label>Motivo de la devolución *</label><input id="dev-motivo" class="input-normal" /></div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:14px; border-top:1px solid var(--color-border);">
      <button type="button" class="btn btn-secundario" id="dev-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="dev-guardar">Registrar devolución</button>
    </div>
  `);

  contenido.querySelectorAll('.input-devolver').forEach((inp) => inp.addEventListener('input', () => {
    const max = parseFloat(inp.dataset.max);
    if (parseFloat(inp.value) > max) inp.value = max;
    if (parseFloat(inp.value) < 0) inp.value = 0;
  }));

  document.getElementById('dev-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('dev-guardar').addEventListener('click', async () => {
    const lineas = Array.from(contenido.querySelectorAll('.input-devolver'))
      .map((inp) => ({ detalleId: inp.dataset.detalleId, cantidad: parseFloat(inp.value) || 0 }))
      .filter((l) => l.cantidad > 0);
    if (lineas.length === 0) { mostrarError('Ingresa al menos una cantidad a devolver'); return; }
    const motivo = document.getElementById('dev-motivo').value;
    if (!motivo.trim()) { mostrarError('El motivo de la devolución es obligatorio'); return; }
    try {
      await window.puntoXVentas.crearNotaCredito({
        facturaOrigenId: facturaId, lineas, motivo, cajaId: state.info.cajaId, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarHistorial();
      cargarNotas();
    } catch (err) {
      mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
    }
  });
}

// --- Nota de débito ---

document.getElementById('btn-nueva-nota-debito').addEventListener('click', abrirFormularioNotaDebito);

async function abrirFormularioNotaDebito() {
  mostrarError(null);
  let clienteSel = null;
  const tasas = await window.puntoXInventario.listarTasasItbis();

  const contenido = window.PuntoXModal.abrirModal('Nueva nota de débito', `
    <div class="form-field">
      <label>Cliente *</label>
      <div class="buscador-producto" style="position:relative;">
        <input id="nd-buscar-cliente" class="input-normal" type="text" placeholder="Buscar cliente..." autocomplete="off" />
        <div id="nd-resultados-cliente" class="buscador-resultados" style="display:none;"></div>
      </div>
      <div id="nd-cliente-sel" style="margin-top:6px; font-size:13px; font-weight:600;"></div>
    </div>
    <div class="form-field" style="margin-top:10px;">
      <label>Factura de referencia (opcional)</label>
      <select id="nd-factura" class="input-normal" disabled><option value="">Selecciona primero un cliente...</option></select>
    </div>
    <div class="form-grid" style="margin-top:10px;">
      <div class="form-field"><label>Concepto *</label><input id="nd-concepto" class="input-normal" placeholder="Ej: flete, interés por mora, ajuste de precio..." /></div>
      <div class="form-field"><label>Monto (ITBIS incluido) *</label><input id="nd-monto" class="input-normal" type="number" step="0.01" min="0.01" /></div>
      <div class="form-field"><label>Tasa de ITBIS</label>
        <select id="nd-tasa" class="input-normal">${tasas.map((t) => `<option value="${t.id}" ${t.es_default ? 'selected' : ''}>${t.nombre} (${(t.porcentaje * 100).toFixed(0)}%)</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:14px; border-top:1px solid var(--color-border);">
      <button type="button" class="btn btn-secundario" id="nd-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primario" id="nd-guardar">Registrar nota de débito</button>
    </div>
  `);

  let timeoutCliente = null;
  document.getElementById('nd-buscar-cliente').addEventListener('input', (e) => {
    clearTimeout(timeoutCliente);
    const texto = e.target.value.trim();
    const resultados = document.getElementById('nd-resultados-cliente');
    if (!texto) { resultados.style.display = 'none'; return; }
    timeoutCliente = setTimeout(async () => {
      const encontrados = await window.puntoXCxc.buscarClientes({ texto, limite: 10 });
      resultados.innerHTML = encontrados.map((c, i) => `<div class="buscador-resultados__item" data-i="${i}"><div class="buscador-resultados__nombre">${c.nombre}</div></div>`).join('') || '<div class="buscador-resultados__vacio">Sin resultados</div>';
      resultados.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', async () => {
        clienteSel = encontrados[Number(el.dataset.i)];
        document.getElementById('nd-cliente-sel').textContent = `Seleccionado: ${clienteSel.nombre}`;
        resultados.style.display = 'none';
        e.target.value = '';

        const facturasCliente = await window.puntoXVentas.listarFacturas({ clienteId: clienteSel.id, limite: 50 });
        const select = document.getElementById('nd-factura');
        select.disabled = false;
        select.innerHTML = '<option value="">— Ninguna (cargo general a la cuenta) —</option>'
          + facturasCliente.filter((f) => f.estado !== 'anulado').map((f) => `<option value="${f.id}">${f.numero} — ${fmt(f.total)}</option>`).join('');
      }));
      resultados.style.display = 'block';
    }, 200);
  });

  document.getElementById('nd-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
  document.getElementById('nd-guardar').addEventListener('click', async () => {
    if (!clienteSel) { mostrarError('Selecciona un cliente'); return; }
    const concepto = document.getElementById('nd-concepto').value;
    if (!concepto.trim()) { mostrarError('El concepto es obligatorio'); return; }
    const monto = parseFloat(document.getElementById('nd-monto').value) || 0;
    if (monto <= 0) { mostrarError('El monto debe ser mayor a cero'); return; }
    try {
      await window.puntoXVentas.crearNotaDebito({
        clienteId: clienteSel.id, facturaOrigenId: document.getElementById('nd-factura').value || null,
        sucursalId: state.info.sucursalId, almacenId: state.info.almacenId, monedaId: state.info.monedaId,
        concepto, monto, tasaItbisId: document.getElementById('nd-tasa').value, usuarioId: state.info.usuario.id,
      });
      window.PuntoXModal.cerrarModal();
      cargarNotas();
    } catch (err) {
      mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
    }
  });
}

// --- Listado de notas de crédito/débito ---

async function cargarNotas() {
  const [notasCredito, notasDebito] = await Promise.all([
    window.puntoXVentas.listarNotas({ tipo: 'nota_credito', limite: 15 }),
    window.puntoXVentas.listarNotas({ tipo: 'nota_debito', limite: 15 }),
  ]);
  const notas = [...notasCredito, ...notasDebito].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const tbody = document.getElementById('notas-tbody');
  document.getElementById('notas-vacio').style.display = notas.length === 0 ? 'block' : 'none';

  tbody.innerHTML = notas.map((n) => {
    const esCredito = n.tipo === 'nota_credito';
    const colorEstado = n.estado === 'anulado' ? 'var(--color-danger)' : 'var(--color-success)';
    const fecha = new Date(n.fecha).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
    const permisoAnular = esCredito ? 'ventas.devolucion.crear' : 'ventas.nota_debito.crear';
    return `
      <tr>
        <td>${n.numero}</td>
        <td><span class="status-pill" style="background:${esCredito ? 'var(--color-info)' : 'var(--color-warning)'};">${esCredito ? 'Crédito' : 'Débito'}</span></td>
        <td>${n.cliente_nombre || 'Consumidor final'}</td>
        <td>${n.factura_origen_numero || '—'}</td>
        <td>${n.concepto || '—'}</td>
        <td>${fecha}</td>
        <td>${fmt(n.total)}</td>
        <td><span class="status-pill" style="background:${colorEstado};">${n.estado}</span></td>
        <td>${n.estado !== 'anulado' ? `<a href="#" class="btn-anular-nota" data-permiso="${permisoAnular}" data-id="${n.id}" data-tipo="${n.tipo}" style="color:var(--color-danger); font-size:12px; font-weight:700;">Anular</a>` : ''}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-anular-nota').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const motivo = prompt('Motivo de la anulación:');
      if (!motivo) return;
      try {
        const metodo = btn.dataset.tipo === 'nota_credito' ? 'anularNotaCredito' : 'anularNotaDebito';
        await window.puntoXVentas[metodo]({ documentoId: btn.dataset.id, motivo, usuarioId: state.info.usuario.id });
        cargarNotas();
        cargarHistorial();
      } catch (err) {
        mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
      }
    });
  });
}

// --- Inicialización ---

function escHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mostrarExitoDocumento(doc) {
  const exito = document.getElementById('factura-exito');
  const titulo = { factura: 'Factura', cotizacion: 'Cotización', conduce: 'Conduce' }[doc.tipo];
  const detalle = doc.tipo === 'factura' ? ` (NCF ${doc.ncf}) guardada`
    : doc.tipo === 'cotizacion' ? ` guardada, válida hasta el ${doc.valida_hasta.split('-').reverse().join('/')}` : ' registrado, pendiente de facturar';
  exito.style.display = 'block';
  exito.innerHTML = `${titulo} <strong>${doc.numero}</strong>${detalle}. Total ${fmt(doc.total)}.` +
    (window.puntoXImpresion ? `
      <span data-permiso="ventas.factura.imprimir" style="margin-left:10px;">
        <button type="button" class="btn btn-secundario btn-chico" data-imprimir="factura">Imprimir ${titulo.toLowerCase()}</button>
        ${doc.tipo === 'factura' ? '<button type="button" class="btn btn-secundario btn-chico" data-imprimir="tique">Imprimir tique</button>' : ''}
      </span>` : '');
  exito.querySelectorAll('[data-imprimir]').forEach((b) => b.addEventListener('click', () => imprimirFactura(doc.id, b.dataset.imprimir)));
}

// --- Tipo de documento: factura, cotización o conduce ---

function configurarSelectorDocumento() {
  const select = document.getElementById('select-documento');
  if (!window.puntoXVentas.crearCotizacion) return; // versión web de prueba: solo facturas
  if (state.info.tienePermiso('ventas.cotizacion.crear')) select.insertAdjacentHTML('beforeend', '<option value="cotizacion">Cotización</option>');
  if (state.info.tienePermiso('ventas.conduce.crear')) select.insertAdjacentHTML('beforeend', '<option value="conduce">Conduce (entregar sin facturar)</option>');
  if (select.options.length > 1) document.getElementById('bloque-documento').style.display = 'block';
  select.addEventListener('change', (e) => setDocumento(e.target.value));
}

function setDocumento(tipo) {
  state.documento = tipo;
  document.getElementById('select-documento').value = tipo;
  const esFactura = tipo === 'factura';
  document.getElementById('bloque-ncf').style.display = esFactura ? '' : 'none';
  document.getElementById('bloque-pagos').style.display = esFactura ? '' : 'none';
  document.getElementById('bloque-extra-documento').style.display = esFactura ? 'none' : 'block';
  document.getElementById('campo-validez').style.display = tipo === 'cotizacion' ? 'block' : 'none';
  document.getElementById('label-concepto').textContent = tipo === 'conduce' ? 'Entrega / observaciones' : 'Nota (opcional)';
  document.getElementById('input-concepto').placeholder = tipo === 'conduce' ? 'Dirección de entrega, quién recibe...' : '';
  if (tipo === 'conduce' && state.modoVenta !== 'completa') setModoVenta('completa'); // el conduce siempre es a un cliente
  document.querySelector('.page-header h1').textContent = { factura: 'Nueva factura', cotizacion: 'Nueva cotización', conduce: 'Nuevo conduce' }[tipo];
  renderTotales();
}

// --- Facturar desde otro documento (cuenta abierta, cotización o conduces) ---
// El carrito se llena con lo del documento y queda bloqueado; el servidor también verifica
// que la factura coincida con el documento de origen.

async function productoParaCarrito(productoId) {
  return window.puntoXInventario.obtenerProducto({ productoId, almacenId: state.info.almacenId });
}

function mostrarAvisoOrigen(html) {
  const aviso = document.getElementById('aviso-origen');
  aviso.innerHTML = html;
  aviso.style.display = 'block';
}

function aplicarOrigen(origen, carrito) {
  state.origen = origen;
  state.carrito = carrito;
  setDocumento('factura');
  document.getElementById('bloque-documento').style.display = 'none';
  document.getElementById('input-buscar-producto').disabled = true;
  renderCarrito();
}

async function cargarCuentaParaCobro(cuentaId) {
  const cuenta = await window.puntoXCuentas.obtener({ cuentaId });
  if (!cuenta || cuenta.estado !== 'abierta') throw new Error('La cuenta ya no está abierta.');
  const porProducto = new Map();
  for (const l of cuenta.lineas) {
    const actual = porProducto.get(l.producto_id);
    if (actual) actual.cantidad = redondear(actual.cantidad + l.cantidad);
    else porProducto.set(l.producto_id, { producto: l.producto, cantidad: l.cantidad, descuentoPct: 0 });
  }
  aplicarOrigen({ tipo: 'cuenta', id: cuenta.id }, [...porProducto.values()]);
  mostrarAvisoOrigen(`Cobrando la cuenta <strong>${escHtml(cuenta.nombre)}</strong> (${cuenta.lineas.length} línea(s)). Los productos se cambian en la cuenta. <a href="./cuentas-abiertas.html?cuenta=${encodeURIComponent(cuenta.id)}" style="font-weight:700; color:var(--color-accent);">Volver a la cuenta</a>`);
}

async function seleccionarClientePorId(clienteId) {
  setModoVenta('completa');
  seleccionarCliente(await window.puntoXCxc.obtenerCliente({ clienteId }));
}

async function cargarCotizacionParaFacturar(cotizacionId) {
  const cot = await window.puntoXVentas.obtenerFactura({ documentoId: cotizacionId });
  if (!cot || cot.tipo !== 'cotizacion' || cot.estado !== 'abierto') throw new Error('La cotización ya no está abierta.');
  const carrito = await Promise.all(cot.lineas.map(async (l) => ({
    producto: await productoParaCarrito(l.producto_id), cantidad: l.cantidad, precioFijo: l.precio_unitario,
    descuentoPct: 0, descuentoMonto: l.descuento_monto || 0, modoDescuento: 'monto',
  })));
  if (cot.cliente_id) await seleccionarClientePorId(cot.cliente_id);
  const brutoLineas = cot.lineas.reduce((a, l) => a + l.total_linea, 0);
  document.getElementById('input-descuento-global').value = brutoLineas > 0 ? redondear((cot.descuento_total / brutoLineas) * 100) : 0;
  aplicarOrigen({ tipo: 'cotizacion', id: cot.id }, carrito);
  mostrarAvisoOrigen(`Facturando la cotización <strong>${cot.numero}</strong> con sus precios. Para cambiar productos o precios, haz una nueva cotización. <a href="./documentos.html" style="font-weight:700; color:var(--color-accent);">Volver</a>`);
}

async function cargarConducesParaFacturar(ids) {
  const conduces = await Promise.all(ids.map((id) => window.puntoXVentas.obtenerFactura({ documentoId: id })));
  if (conduces.some((c) => !c || c.tipo !== 'conduce' || c.estado !== 'entregado')) throw new Error('Algún conduce ya no está pendiente de facturar.');
  if (new Set(conduces.map((c) => c.cliente_id)).size !== 1) throw new Error('Los conduces seleccionados son de clientes distintos.');
  const porProducto = new Map();
  for (const c of conduces) {
    for (const l of c.lineas) {
      const actual = porProducto.get(l.producto_id);
      // Se conserva el descuento con que salió cada conduce (sumado en RD$ por producto).
      if (actual) Object.assign(actual, { cantidad: redondear(actual.cantidad + l.cantidad), descuentoMonto: redondear(actual.descuentoMonto + (l.descuento_monto || 0)) });
      else porProducto.set(l.producto_id, { productoId: l.producto_id, cantidad: l.cantidad, descuentoPct: 0, descuentoMonto: l.descuento_monto || 0, modoDescuento: 'monto', precioFijo: l.precio_unitario });
    }
  }
  const brutoLineas = conduces.reduce((a, c) => a + c.lineas.reduce((b, l) => b + l.total_linea, 0), 0);
  const descuentoGlobal = conduces.reduce((a, c) => a + (c.descuento_total || 0), 0);
  document.getElementById('input-descuento-global').value = brutoLineas > 0 ? redondear((descuentoGlobal / brutoLineas) * 100) : 0;
  const carrito = await Promise.all([...porProducto.values()].map(async (l) => ({ ...l, producto: await productoParaCarrito(l.productoId) })));
  await seleccionarClientePorId(conduces[0].cliente_id);
  aplicarOrigen({ tipo: 'conduces', ids: conduces.map((c) => c.id) }, carrito);
  mostrarAvisoOrigen(`Facturando ${conduces.length === 1 ? 'el conduce' : `${conduces.length} conduces`} <strong>${conduces.map((c) => c.numero).join(', ')}</strong> de ${escHtml(conduces[0].cliente_nombre)}. La mercancía ya se entregó. <a href="./documentos.html#conduces" style="font-weight:700; color:var(--color-accent);">Volver</a>`);
}

function terminarOrigen() {
  state.origen = null;
  document.getElementById('input-buscar-producto').disabled = false;
  document.getElementById('aviso-origen').style.display = 'none';
  if (document.getElementById('select-documento').options.length > 1) document.getElementById('bloque-documento').style.display = 'block';
  window.history.replaceState(null, '', window.location.pathname);
}

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('ventas');
  state.categorias = await window.puntoXCxc.listarCategorias();
  actualizarSubtitulo();
  configurarSelectorDocumento();
  renderCarrito();
  cargarHistorial();
  cargarNotas();
  const params = new URLSearchParams(window.location.search);
  try {
    if (params.get('cuenta') && window.puntoXCuentas) await cargarCuentaParaCobro(params.get('cuenta'));
    else if (params.get('cotizacion')) await cargarCotizacionParaFacturar(params.get('cotizacion'));
    else if (params.get('conduces')) await cargarConducesParaFacturar(params.get('conduces').split(',').filter(Boolean));
    else if ([...document.getElementById('select-documento').options].some((o) => o.value === params.get('documento'))) setDocumento(params.get('documento'));
  } catch (err) {
    mostrarError(err.message.replace(/^Error invoking remote method '.*?': Error: /, ''));
  }
}

init();
