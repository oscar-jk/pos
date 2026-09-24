const state = { info: null, reporteActivo: null };

function fmt(n) {
  return `RD$ ${(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fechaCorta(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
function fechaHora(iso) {
  return iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function mostrarError(msg) {
  const el = document.getElementById('mensaje-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
  window.scrollTo(0, 0);
}

function valorColumna(fila, key) {
  return typeof key === 'function' ? key(fila) : fila[key];
}

function formatearValor(v, formato) {
  if (v === null || v === undefined || v === '') return '—';
  if (formato === 'moneda') return fmt(v);
  if (formato === 'fecha') return fechaCorta(v);
  if (formato === 'fechahora') return fechaHora(v);
  if (formato === 'porcentaje') return `${v}%`;
  return String(v);
}

function renderTabla(columnas, filas) {
  if (!filas || filas.length === 0) return '<div class="empty-state">Sin datos para los filtros seleccionados.</div>';
  return `
    <table class="data-table">
      <thead><tr>${columnas.map((c) => `<th${c.alinear ? ` style="text-align:${c.alinear};"` : ''}>${c.label}</th>`).join('')}</tr></thead>
      <tbody>
        ${filas.map((f) => `<tr>${columnas.map((c) => `<td${c.alinear ? ` style="text-align:${c.alinear};"` : ''}>${formatearValor(valorColumna(f, c.key), c.formato)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
}

function renderTarjetas(items) {
  return `<div class="reportes-resumen">${items.map((i) => `
    <div class="reportes-resumen__tarjeta">
      <div class="label">${i.label}</div>
      <div class="valor"${i.color ? ` style="color:${i.color};"` : ''}>${i.formato === 'moneda' ? fmt(i.valor) : i.valor}</div>
    </div>
  `).join('')}</div>`;
}

// --- Filtros ---

async function renderFiltros(filtros) {
  if (!filtros || filtros.length === 0) return '';
  const partes = await Promise.all(filtros.map(async (f) => {
    if (f.tipo === 'fecha') {
      return `<div class="form-field"><label>${f.label}</label><input type="date" class="input-normal" id="filtro-${f.clave}" value="${f.valorDefault || ''}" /></div>`;
    }
    if (f.tipo === 'select') {
      return `<div class="form-field"><label>${f.label}</label><select class="input-normal" id="filtro-${f.clave}">${f.opciones.map((o) => `<option value="${o.value}" ${o.value === f.valorDefault ? 'selected' : ''}>${o.label}</option>`).join('')}</select></div>`;
    }
    if (f.tipo === 'producto') {
      const productos = await window.puntoXInventario.listarProductos({ limite: 500 });
      const opciones = productos.map((p) => `<option value="${p.id}">${p.codigo_interno} — ${p.descripcion}</option>`).join('');
      return `<div class="form-field"><label>${f.label}</label><select class="input-normal" id="filtro-${f.clave}">${opciones || '<option value="">Sin productos</option>'}</select></div>`;
    }
    return '';
  }));
  return partes.join('') + '<button class="btn btn-primario btn-chico" id="btn-aplicar-filtros">Aplicar</button>';
}

function leerFiltros(filtros) {
  const valores = {};
  (filtros || []).forEach((f) => {
    const el = document.getElementById(`filtro-${f.clave}`);
    if (!el || !el.value) return;
    // Los <input type="date"> devuelven solo "YYYY-MM-DD", pero fecha se guarda como
    // timestamp ISO completo — comparar el texto tal cual deja "hasta" siempre por debajo
    // de cualquier fecha con hora, así que se completa al límite del día correspondiente.
    if (f.tipo === 'fecha') {
      valores[f.clave] = f.clave === 'hasta' ? `${el.value}T23:59:59.999Z` : `${el.value}T00:00:00.000Z`;
    } else {
      valores[f.clave] = el.value;
    }
  });
  return valores;
}

// --- Catálogo de reportes ---

const CATALOGO = [
  {
    grupo: 'Ventas', modulo: 'ventas',
    reportes: [
      {
        clave: 'ventas-periodo', etiqueta: 'Ventas por Período',
        filtros: [
          { tipo: 'select', clave: 'agrupacion', label: 'Agrupar por', valorDefault: 'dia', opciones: [{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' },
          { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        cargar: (v) => window.puntoXVentas.ventasPorPeriodo(v),
        columnas: [
          { label: 'Periodo', key: 'periodo' }, { label: 'Facturas', key: 'num_facturas', alinear: 'right' },
          { label: 'Subtotal', key: 'subtotal', formato: 'moneda', alinear: 'right' },
          { label: 'Descuento', key: 'descuento', formato: 'moneda', alinear: 'right' },
          { label: 'ITBIS', key: 'itbis', formato: 'moneda', alinear: 'right' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'ventas-vendedor', etiqueta: 'Ventas por Vendedor',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.ventasPorVendedor(v),
        columnas: [
          { label: 'Vendedor', key: 'vendedor_nombre' }, { label: 'Facturas', key: 'num_facturas', alinear: 'right' },
          { label: 'Total vendido', key: 'total_vendido', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'ventas-articulo', etiqueta: 'Ventas / Productos Más y Menos Vendidos',
        filtros: [
          { tipo: 'select', clave: 'orden', label: 'Ordenar por', valorDefault: 'cantidad_desc', opciones: [
            { value: 'cantidad_desc', label: 'Más vendidos (cantidad)' }, { value: 'cantidad_asc', label: 'Menos vendidos (cantidad)' },
            { value: 'ingreso_desc', label: 'Mayor ingreso' }, { value: 'ingreso_asc', label: 'Menor ingreso' },
          ] },
          { tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' },
        ],
        cargar: (v) => window.puntoXVentas.ventasPorArticulo(v),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Cantidad vendida', key: 'cantidad_vendida', alinear: 'right' },
          { label: 'Ingreso', key: 'ingreso', formato: 'moneda', alinear: 'right' },
          { label: 'Utilidad', key: 'utilidad', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'comisiones', etiqueta: 'Comisiones por Vendedor',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.comisionesPorVendedor(v),
        columnas: [
          { label: 'Vendedor', key: 'vendedor_nombre' }, { label: 'Ventas', key: 'num_ventas', alinear: 'right' },
          { label: 'Comisión generada', key: 'comision_generada', formato: 'moneda', alinear: 'right' },
          { label: 'Pagada', key: 'comision_pagada', formato: 'moneda', alinear: 'right' },
          { label: 'Pendiente', key: 'comision_pendiente', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'margen', etiqueta: 'Margen de Beneficio por Factura',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.margenPorFactura(v),
        columnas: [
          { label: 'Factura', key: 'numero' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Cliente', key: 'cliente_nombre' },
          { label: 'Ingreso', key: 'ingreso', formato: 'moneda', alinear: 'right' }, { label: 'Costo', key: 'costo', formato: 'moneda', alinear: 'right' },
          { label: 'Utilidad', key: 'utilidad', formato: 'moneda', alinear: 'right' }, { label: 'Margen %', key: 'margen_pct', formato: 'porcentaje', alinear: 'right' },
        ],
      },
      {
        clave: 'cobros-dia', etiqueta: 'Resumen de Cobros del Día',
        filtros: [{ tipo: 'fecha', clave: 'fecha', label: 'Fecha', valorDefault: hoyISO() }],
        personalizado: true,
        cargar: (v) => window.puntoXVentas.resumenCobrosDelDia(v),
        render: (r) => renderTarjetas([
          { label: 'Total facturado', valor: r.totalFacturado, formato: 'moneda' },
          { label: 'Total cobrado', valor: r.totalCobrado, formato: 'moneda' },
          { label: 'Efectivo', valor: r.porForma.efectivo, formato: 'moneda' },
          { label: 'Tarjeta', valor: r.porForma.tarjeta, formato: 'moneda' },
          { label: 'Transferencia', valor: r.porForma.transferencia, formato: 'moneda' },
          { label: 'Crédito', valor: r.porForma.credito, formato: 'moneda' },
        ]),
      },
      {
        clave: 'itbis-ventas', etiqueta: 'ITBIS Generado en Ventas',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.itbisGeneradoVentas(v),
        columnas: [
          { label: 'Tasa', key: (f) => `${(f.tasa_itbis * 100).toFixed(0)}%` }, { label: 'Base imponible', key: 'base_total', formato: 'moneda', alinear: 'right' },
          { label: 'ITBIS', key: 'itbis_total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'historial-facturas', etiqueta: 'Historial de Facturas y Anulaciones',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXVentas.listarFacturas({ ...v, limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'NCF', key: 'ncf' }, { label: 'Cliente', key: 'cliente_nombre' },
          { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
          { label: 'Estado', key: 'estado' }, { label: 'Motivo anulación', key: 'motivo_anulacion' }, { label: 'Anuló', key: 'usuario_anulo_nombre' },
        ],
      },
    ],
  },
  {
    grupo: 'Inventario', modulo: 'inventario',
    reportes: [
      {
        clave: 'existencias', etiqueta: 'Existencia por Almacén y Consolidada',
        filtros: [],
        cargar: () => window.puntoXInventario.existencias({}),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Existencia', key: 'existencia_total', alinear: 'right' }, { label: 'Comprometida', key: 'comprometida_total', alinear: 'right' },
          { label: 'Stock mínimo', key: 'stock_minimo', alinear: 'right' },
        ],
      },
      {
        clave: 'vencimientos', etiqueta: 'Vencimientos Próximos',
        filtros: [],
        cargar: () => window.puntoXInventario.vencimientos({}),
        columnas: [
          { label: 'Producto', key: 'descripcion' }, { label: 'Lote', key: 'numero_lote' }, { label: 'Almacén', key: 'almacen_nombre' },
          { label: 'Cantidad', key: 'cantidad', alinear: 'right' }, { label: 'Vence', key: 'fecha_vencimiento', formato: 'fecha' },
          { label: 'Días restantes', key: 'dias_restantes', alinear: 'right' },
        ],
      },
      {
        clave: 'mermas', etiqueta: 'Mermas y Averías',
        filtros: [],
        cargar: () => window.puntoXInventario.listarMermas({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Producto', key: 'producto_descripcion' }, { label: 'Almacén', key: 'almacen_nombre' },
          { label: 'Cantidad', key: 'cantidad', alinear: 'right' }, { label: 'Costo unitario', key: 'costo_unitario', formato: 'moneda', alinear: 'right' },
          { label: 'Motivo', key: 'motivo' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
        ],
      },
    ],
  },
  {
    grupo: 'Compras', modulo: 'compras',
    reportes: [
      {
        clave: 'historial-compras', etiqueta: 'Historial de Compras',
        filtros: [],
        cargar: () => window.puntoXCompras.listarFacturas({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
          { label: 'Condición', key: 'condicion_pago' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'comparacion-costo', etiqueta: 'Comparación de Mejor Costo',
        filtros: [{ tipo: 'producto', clave: 'productoId', label: 'Producto' }],
        cargar: (v) => v.productoId ? window.puntoXCompras.comparacionMejorCosto({ productoId: v.productoId }) : Promise.resolve([]),
        columnas: [
          { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Factura', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' },
          { label: 'Costo unitario', key: 'costo_unitario', formato: 'moneda', alinear: 'right' }, { label: 'Cantidad', key: 'cantidad', alinear: 'right' },
        ],
      },
      {
        clave: 'compras-producto', etiqueta: 'Compras por Producto',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXCompras.comprasPorProducto(v),
        columnas: [
          { label: 'Código', key: 'codigo_interno' }, { label: 'Producto', key: 'descripcion' },
          { label: 'Cantidad comprada', key: 'cantidad_total', alinear: 'right' }, { label: 'Costo total', key: 'costo_total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'ordenes-pendientes', etiqueta: 'Órdenes de Compra Pendientes de Recepción',
        filtros: [],
        cargar: () => window.puntoXCompras.listarOrdenes({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
          { label: '% Recibido', key: (f) => `${f.porcentaje_recibido}%` }, { label: 'Estado', key: 'estado' },
        ],
      },
    ],
  },
  {
    grupo: 'Cuentas por Cobrar', modulo: 'cxc',
    reportes: [
      {
        clave: 'cxc-listado', etiqueta: 'Listado de CxC',
        filtros: [],
        cargar: () => window.puntoXCxc.listarClientes({ limite: 200 }),
        columnas: [
          { label: 'Cliente', key: 'nombre' }, { label: 'Categoría', key: 'categoria_nombre' },
          { label: 'Límite de crédito', key: 'limite_credito', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxc-antiguedad', etiqueta: 'Antigüedad de Saldos',
        filtros: [],
        cargar: () => window.puntoXCxc.antiguedadSaldos(),
        columnas: [
          { label: 'Cliente', key: 'clienteNombre' }, { label: 'Corriente', key: (f) => f.tramos.corriente, formato: 'moneda', alinear: 'right' },
          { label: '0-30 días', key: (f) => f.tramos.dias_0_30, formato: 'moneda', alinear: 'right' },
          { label: '31-60 días', key: (f) => f.tramos.dias_31_60, formato: 'moneda', alinear: 'right' },
          { label: '61-90 días', key: (f) => f.tramos.dias_61_90, formato: 'moneda', alinear: 'right' },
          { label: '+90 días', key: (f) => f.tramos.dias_90_mas, formato: 'moneda', alinear: 'right' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxc-vencidas', etiqueta: 'Facturas Vencidas',
        filtros: [],
        cargar: () => window.puntoXCxc.facturasVencidas(),
        columnas: [
          { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Teléfono', key: 'cliente_telefono' }, { label: 'Factura', key: 'numero' },
          { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Saldo', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' },
          { label: 'Días de mora', key: 'dias_mora', alinear: 'right' },
        ],
      },
      {
        clave: 'cxc-gestion', etiqueta: 'Gestión de Cobros',
        filtros: [],
        cargar: () => window.puntoXCxc.listarGestionCobros({ limite: 200 }),
        columnas: [
          { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Tipo de contacto', key: 'tipo_contacto' }, { label: 'Notas', key: 'notas' },
          { label: 'Resultado', key: 'resultado' }, { label: 'Próximo contacto', key: 'proxima_fecha_contacto', formato: 'fecha' },
          { label: 'Fecha', key: 'fecha_contacto', formato: 'fecha' },
        ],
      },
      {
        clave: 'cxc-pagos', etiqueta: 'Historial de Pagos',
        filtros: [],
        cargar: () => window.puntoXCxc.listarRecibos({ limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Forma de pago', key: 'forma_pago' },
          { label: 'Monto', key: 'monto_total', formato: 'moneda', alinear: 'right' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'cxc-notas', etiqueta: 'Notas de Crédito y Débito Emitidas',
        filtros: [{ tipo: 'select', clave: 'tipo', label: 'Tipo', valorDefault: 'nota_credito', opciones: [{ value: 'nota_credito', label: 'Notas de crédito' }, { value: 'nota_debito', label: 'Notas de débito' }] }],
        cargar: (v) => window.puntoXVentas.listarNotas({ tipo: v.tipo || 'nota_credito', limite: 200 }),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Cliente', key: 'cliente_nombre' }, { label: 'Factura origen', key: 'factura_origen_numero' },
          { label: 'Concepto', key: 'concepto' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'cxc-empleados', etiqueta: 'CxC de Empleados',
        filtros: [],
        cargar: () => window.puntoXCxc.listarCxcEmpleados({ limite: 200 }),
        columnas: [
          { label: 'Empleado', key: 'empleado_nombre' }, { label: 'Tipo', key: 'tipo' }, { label: 'Monto', key: 'monto', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' }, { label: 'Estado', key: 'estado' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' },
        ],
      },
    ],
  },
  {
    grupo: 'Cuentas por Pagar', modulo: 'cxp',
    reportes: [
      {
        clave: 'cxp-listado', etiqueta: 'Listado de CxP',
        filtros: [],
        cargar: () => window.puntoXCompras.listarProveedores({ limite: 200 }),
        columnas: [
          { label: 'Proveedor', key: 'nombre' }, { label: 'RNC', key: 'rnc' }, { label: 'Días de crédito', key: 'dias_credito', alinear: 'right' },
          { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxp-antiguedad', etiqueta: 'Antigüedad de Saldos por Pagar',
        filtros: [],
        cargar: () => window.puntoXCxp.antiguedadSaldos(),
        columnas: [
          { label: 'Proveedor', key: 'proveedorNombre' }, { label: 'Corriente', key: (f) => f.tramos.corriente, formato: 'moneda', alinear: 'right' },
          { label: '0-30 días', key: (f) => f.tramos.dias_0_30, formato: 'moneda', alinear: 'right' },
          { label: '31-60 días', key: (f) => f.tramos.dias_31_60, formato: 'moneda', alinear: 'right' },
          { label: '61-90 días', key: (f) => f.tramos.dias_61_90, formato: 'moneda', alinear: 'right' },
          { label: '+90 días', key: (f) => f.tramos.dias_90_mas, formato: 'moneda', alinear: 'right' },
          { label: 'Total', key: 'total', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'cxp-proximas', etiqueta: 'Facturas Próximas a Vencer',
        filtros: [],
        cargar: () => window.puntoXCxp.facturasProximasAVencer(),
        columnas: [
          { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Factura', key: 'numero' }, { label: 'Vencimiento', key: 'fecha_vencimiento', formato: 'fecha' },
          { label: 'Saldo', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' }, { label: 'Días restantes', key: 'dias_restantes', alinear: 'right' },
        ],
      },
      {
        clave: 'cxp-cheques', etiqueta: 'Cheques Posdatados Pendientes',
        filtros: [],
        cargar: () => window.puntoXCxp.chequesPosdatadosPendientes(),
        columnas: [
          { label: 'Número', key: 'numero' }, { label: 'Proveedor', key: 'proveedor_nombre' }, { label: 'Cheque', key: 'numero_cheque' },
          { label: 'Banco', key: 'banco_cheque' }, { label: 'Monto', key: 'monto_total', formato: 'moneda', alinear: 'right' }, { label: 'Fecha de cobro', key: 'fecha_cheque', formato: 'fecha' },
        ],
      },
    ],
  },
  {
    grupo: 'Caja y Tesorería', modulo: 'caja',
    reportes: [
      {
        clave: 'caja-arqueo', etiqueta: 'Arqueo de Caja por Turno',
        filtros: [],
        cargar: () => window.puntoXCaja.listarTurnos({ limite: 200 }),
        columnas: [
          { label: 'Caja', key: 'caja_nombre' }, { label: 'Apertura', key: 'fecha_apertura', formato: 'fechahora' }, { label: 'Cierre', key: 'fecha_cierre', formato: 'fechahora' },
          { label: 'Fondo inicial', key: 'fondo_inicial', formato: 'moneda', alinear: 'right' }, { label: 'Esperado', key: 'efectivo_esperado', formato: 'moneda', alinear: 'right' },
          { label: 'Contado', key: 'efectivo_contado', formato: 'moneda', alinear: 'right' }, { label: 'Diferencia', key: 'diferencia', formato: 'moneda', alinear: 'right' },
          { label: 'Responsable', key: 'usuario_nombre' }, { label: 'Estado', key: 'estado' },
        ],
      },
      {
        clave: 'caja-sobrantes', etiqueta: 'Historial de Sobrantes/Faltantes',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXCaja.historialSobrantesFaltantes(v),
        columnas: [
          { label: 'Usuario', key: 'usuario_nombre' }, { label: 'Caja', key: 'caja_nombre' }, { label: 'Turnos', key: 'num_turnos', alinear: 'right' },
          { label: 'Total sobrante', key: 'total_sobrante', formato: 'moneda', alinear: 'right' }, { label: 'Total faltante', key: 'total_faltante', formato: 'moneda', alinear: 'right' },
          { label: 'Diferencia neta', key: 'diferencia_neta', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'caja-chica', etiqueta: 'Movimientos de Caja Chica',
        filtros: [],
        cargar: () => window.puntoXCaja.listarGastosCajaChica({ limite: 200 }),
        columnas: [
          { label: 'Concepto', key: 'concepto' }, { label: 'Categoría', key: 'categoria' }, { label: 'Monto', key: 'monto', formato: 'moneda', alinear: 'right' },
          { label: 'Comprobante', key: 'comprobante_ruta' }, { label: 'Fecha', key: 'fecha', formato: 'fecha' }, { label: 'Usuario', key: 'usuario_nombre' },
        ],
      },
    ],
  },
  {
    grupo: 'Contabilidad', modulo: 'contabilidad',
    reportes: [
      {
        clave: 'balance-comprobacion', etiqueta: 'Balance de Comprobación',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        cargar: (v) => window.puntoXContabilidad.balanceComprobacion(v),
        columnas: [
          { label: 'Código', key: 'codigo' }, { label: 'Cuenta', key: 'nombre' }, { label: 'Tipo', key: 'tipo' },
          { label: 'Total debe', key: 'total_debe', formato: 'moneda', alinear: 'right' }, { label: 'Total haber', key: 'total_haber', formato: 'moneda', alinear: 'right' },
          { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' },
        ],
      },
      {
        clave: 'estado-resultados', etiqueta: 'Estado de Resultados',
        filtros: [{ tipo: 'fecha', clave: 'desde', label: 'Desde' }, { tipo: 'fecha', clave: 'hasta', label: 'Hasta' }],
        personalizado: true,
        cargar: (v) => window.puntoXContabilidad.estadoResultados(v),
        render: (r) => `
          ${renderTarjetas([
            { label: 'Ingresos', valor: r.totalIngresos, formato: 'moneda' },
            { label: 'Costos', valor: r.totalCostos, formato: 'moneda' },
            { label: 'Gastos', valor: r.totalGastos, formato: 'moneda' },
            { label: 'Utilidad bruta', valor: r.utilidadBruta, formato: 'moneda', color: r.utilidadBruta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
            { label: 'Utilidad neta', valor: r.utilidadNeta, formato: 'moneda', color: r.utilidadNeta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
          ])}
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Ingresos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.ingresos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Costos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.costos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Gastos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.gastos)}</div>
        `,
      },
      {
        clave: 'balance-general', etiqueta: 'Balance General',
        filtros: [{ tipo: 'fecha', clave: 'hasta', label: 'A fecha', valorDefault: hoyISO() }],
        personalizado: true,
        cargar: (v) => window.puntoXContabilidad.balanceGeneral(v),
        render: (r) => `
          ${renderTarjetas([
            { label: 'Total activo', valor: r.totalActivo, formato: 'moneda' },
            { label: 'Total pasivo', valor: r.totalPasivo, formato: 'moneda' },
            { label: 'Total patrimonio', valor: r.totalPatrimonio, formato: 'moneda' },
            { label: 'Cuadra', valor: r.cuadra ? 'Sí' : 'No', color: r.cuadra ? 'var(--color-success)' : 'var(--color-danger)' },
          ])}
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Activos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.activos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Pasivos</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.pasivos)}</div>
          <div class="reportes-seccion"><div class="reportes-seccion__titulo">Patrimonio</div>${renderTabla([{ label: 'Cuenta', key: 'nombre' }, { label: 'Saldo', key: 'saldo', formato: 'moneda', alinear: 'right' }], r.patrimonio)}</div>
        `,
      },
    ],
  },
  {
    grupo: 'Configuración', modulo: 'configuracion',
    reportes: [
      {
        clave: 'bitacora', etiqueta: 'Bitácora de Auditoría',
        filtros: [],
        cargar: () => window.puntoXConfig.listarBitacora({ limite: 200 }),
        columnas: [
          { label: 'Fecha', key: 'created_at', formato: 'fechahora' }, { label: 'Usuario', key: 'usuario_nombre' }, { label: 'Módulo', key: 'modulo' },
          { label: 'Entidad', key: 'entidad' }, { label: 'Acción', key: 'accion' },
        ],
      },
    ],
  },
];

// --- Navegación y render ---

function reporteBusca(clave) {
  for (const g of CATALOGO) {
    const r = g.reportes.find((x) => x.clave === clave);
    if (r) return r;
  }
  return null;
}

function renderNav() {
  const nav = document.getElementById('reportes-nav');
  nav.innerHTML = CATALOGO.map((g) => `
    <div class="reportes-nav__grupo">
      <div class="reportes-nav__titulo">${g.grupo}</div>
      ${g.reportes.map((r) => `<button class="reportes-nav__item" data-clave="${r.clave}">${r.etiqueta}</button>`).join('')}
    </div>
  `).join('');
  nav.querySelectorAll('[data-clave]').forEach((btn) => btn.addEventListener('click', () => seleccionarReporte(btn.dataset.clave)));
}

async function seleccionarReporte(clave) {
  const reporte = reporteBusca(clave);
  if (!reporte) return;
  state.reporteActivo = clave;
  mostrarError(null);

  document.querySelectorAll('.reportes-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.clave === clave));
  document.getElementById('reportes-vacio').style.display = 'none';
  document.getElementById('reportes-contenido').style.display = 'block';
  document.getElementById('reporte-titulo').textContent = reporte.etiqueta;
  document.getElementById('reporte-filtros').innerHTML = await renderFiltros(reporte.filtros);
  document.getElementById('reporte-resultado').innerHTML = '';

  const btnAplicar = document.getElementById('btn-aplicar-filtros');
  if (btnAplicar) btnAplicar.addEventListener('click', () => ejecutarReporte(reporte));

  await ejecutarReporte(reporte);
}

async function ejecutarReporte(reporte) {
  const contenedor = document.getElementById('reporte-resultado');
  contenedor.innerHTML = '<div class="empty-state">Cargando...</div>';
  try {
    const filtros = leerFiltros(reporte.filtros);
    const datos = await reporte.cargar(filtros);
    contenedor.innerHTML = reporte.personalizado ? reporte.render(datos) : renderTabla(reporte.columnas, datos);
  } catch (err) {
    contenedor.innerHTML = '';
    mostrarError(err.message);
  }
}

// --- Inicialización ---

async function init() {
  state.info = await window.PuntoXShell.initPuntoXShell('reportes');
  renderNav();
}

init();
