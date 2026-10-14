// Reportes a la medida: elegir columnas en los reportes existentes y armar reportes propios.
//
// Todo trabaja sobre las mismas fuentes de datos que ya usan los reportes (y sus permisos): una
// fuente es un reporte tabular del catálogo o un listado (productos, clientes, proveedores). Las
// columnas disponibles salen de los campos que la fuente devuelve, con nombre legible. Un reporte
// personalizado guarda solo su definición (fuente, período, columnas, condiciones, agrupación,
// orden); se calcula aquí cada vez que se abre.
//
// Usa funciones de reportes.js (renderFiltros, leerFiltros, formatearValor, mostrarError,
// CATALOGO, grupoVisible) en el momento de llamarlas; este archivo se carga antes.
(function () {
  // --- Campos: nombre legible, formato y si son numéricos --------------------------------------

  const ETIQUETAS = {
    numero: 'Número', ncf: 'NCF', encf: 'e-NCF', fecha: 'Fecha', total: 'Total', subtotal: 'Subtotal', itbis: 'ITBIS',
    descuento: 'Descuento', estado: 'Estado', codigo_interno: 'Código', descripcion: 'Descripción', nombre: 'Nombre',
    categoria_nombre: 'Categoría', precio_detalle: 'Precio detalle', precio_mayorista: 'Precio mayorista',
    precio_distribuidor: 'Precio distribuidor', costo_promedio: 'Costo promedio', existencia_total: 'Existencia',
    stock_minimo: 'Stock mínimo', stock_maximo: 'Stock máximo', rnc_cedula: 'RNC/Cédula', rnc: 'RNC', telefono: 'Teléfono',
    direccion: 'Dirección', email: 'Correo', correo: 'Correo', saldo: 'Saldo', saldo_pendiente: 'Saldo pendiente',
    saldo_a_favor: 'Saldo a favor', limite_credito: 'Límite de crédito', dias_credito: 'Días de crédito',
    cliente_nombre: 'Cliente', proveedor_nombre: 'Proveedor', vendedor_nombre: 'Vendedor', usuario_nombre: 'Usuario',
    sucursal_nombre: 'Sucursal', almacen_nombre: 'Almacén', created_at: 'Creado', updated_at: 'Última modificación',
    fecha_vencimiento: 'Vence', motivo_anulacion: 'Motivo de anulación', condicion_pago: 'Condición de pago',
    activo: 'Activo', bloqueado: 'Bloqueado', es_kit: 'Es kit', es_servicio: 'Es servicio', controla_lote: 'Controla lote',
    permite_venta_negativo: 'Venta en negativo', margen_pct: 'Margen %', num_facturas: 'Facturas', monto: 'Monto',
    cantidad: 'Cantidad', tipo: 'Tipo', modulo: 'Módulo', accion: 'Acción', detalle: 'Detalle', entidad: 'Entidad',
    dias_vencido: 'Días vencido', dias_atraso: 'Días de atraso', tipo_ncf: 'Tipo de comprobante', moneda: 'Moneda',
    tasa_cambio: 'Tasa de cambio', pct_comision: 'Comisión %', notas: 'Notas', observaciones: 'Observaciones',
  };
  const PALABRAS = {
    descripcion: 'descripción', codigo: 'código', numero: 'número', categoria: 'categoría', dias: 'días', credito: 'crédito',
    debito: 'débito', anulacion: 'anulación', telefono: 'teléfono', direccion: 'dirección', minimo: 'mínimo', maximo: 'máximo',
    ultimo: 'último', ultima: 'última', razon: 'razón', condicion: 'condición', almacen: 'almacén', emision: 'emisión',
    recepcion: 'recepción', comision: 'comisión', periodo: 'período', itbis: 'ITBIS', ncf: 'NCF', rnc: 'RNC', pct: '%',
    num: 'n.º', cedula: 'cédula', transaccion: 'transacción', conciliacion: 'conciliación', proyeccion: 'proyección',
    devolucion: 'devolución', fisico: 'físico', unico: 'único', vehiculo: 'vehículo', via: 'vía',
  };

  function etiquetaCampo(clave) {
    if (ETIQUETAS[clave]) return ETIQUETAS[clave];
    const partes = clave.replace(/_nombre$/, '').split('_').filter(Boolean).map((p) => PALABRAS[p] || p);
    const texto = partes.join(' ');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  // Campos internos que no tiene sentido mostrar en un reporte.
  const EXCLUIDO = /(^id$|_id$|^uuid$|password|hash|imagen|miniatura|logo|permisos|definicion|^__|_json$|xml|firma|certificado)/i;
  const MONEDA = /(total|monto|saldo|precio|costo|subtotal|itbis|descuento|ingreso|utilidad|pagado|pendiente|balance|importe|valor|comision|limite_credito|debito|credito|abono|cobrado|facturado|retencion|base|gasto|efectivo|tarjeta|transferencia|fondo|diferencia|sobrante|faltante)/i;
  const FECHA = /(fecha|_at$|vence|vencimiento)/i;
  const BOOLEANO = /^(es_|activo$|bloqueado$|permite_|controla_|compartido$|anulado$)/i;
  const FECHA_ISO = /^\d{4}-\d{2}-\d{2}(T|$)/;

  function inferirCampo(clave, valores) {
    const presentes = valores.filter((v) => v !== null && v !== undefined && v !== '');
    const numerico = presentes.length > 0 && presentes.every((v) => typeof v === 'number');
    let formato;
    if (BOOLEANO.test(clave) && presentes.every((v) => v === 0 || v === 1 || typeof v === 'boolean')) formato = 'booleano';
    else if (FECHA.test(clave) && presentes.every((v) => typeof v === 'string' && FECHA_ISO.test(v))) formato = 'fecha';
    else if (numerico && /(_pct$|porcentaje)/i.test(clave)) formato = 'porcentaje';
    else if (numerico && MONEDA.test(clave) && !/(dias|cantidad|num_|^num$)/i.test(clave)) formato = 'moneda';
    else if (numerico) formato = 'numero';
    return { id: clave, label: etiquetaCampo(clave), formato, alinear: numerico ? 'right' : undefined, numerico };
  }

  function camposDeFilas(filas) {
    const muestra = (filas || []).slice(0, 80);
    const claves = [];
    muestra.forEach((f) => Object.keys(f || {}).forEach((k) => { if (!claves.includes(k)) claves.push(k); }));
    return claves
      .filter((k) => !EXCLUIDO.test(k))
      .filter((k) => muestra.every((f) => f[k] === null || f[k] === undefined || ['string', 'number', 'boolean'].includes(typeof f[k])))
      .filter((k) => !muestra.some((f) => typeof f[k] === 'string' && f[k].startsWith('data:')))
      .map((k) => inferirCampo(k, muestra.map((f) => f[k])));
  }

  // Campos de una fuente: primero las columnas que ya define (con su nombre y formato; las
  // calculadas se materializan en la fila), luego el resto de lo que trae cada fila.
  function camposDeFuente(fuente, filas) {
    const campos = [];
    const calculadas = [];
    (fuente.columnas || []).forEach((c, i) => {
      if (typeof c.key === 'function') {
        const id = `calc_${i}`;
        calculadas.push([id, c.key]);
        campos.push({ id, label: c.label, formato: c.formato, alinear: c.alinear, definida: true, numerico: c.alinear === 'right' && c.formato !== 'porcentaje' });
      } else {
        const inferido = inferirCampo(c.key, (filas || []).slice(0, 80).map((f) => f[c.key]));
        campos.push({ ...inferido, id: c.key, label: c.label, formato: c.formato || inferido.formato, alinear: c.alinear || inferido.alinear, definida: true });
      }
    });
    const planas = (filas || []).map((f) => {
      const o = { ...f };
      calculadas.forEach(([id, fn]) => { try { o[id] = fn(f); } catch (e) { o[id] = null; } });
      return o;
    });
    camposDeFilas(filas).forEach((c) => { if (!campos.some((x) => x.id === c.id)) campos.push(c); });
    return { campos, filas: planas };
  }

  function formatear(v, formato) {
    if (formato === 'booleano') return v === null || v === undefined || v === '' ? '—' : (v ? 'Sí' : 'No');
    if (formato === 'numero') return v === null || v === undefined || v === '' ? '—' : esc(Number(v).toLocaleString('es-DO', { maximumFractionDigits: 2 }));
    return formatearValor(v, formato);
  }

  // Tabla con totales opcionales al pie (moneda y números).
  function tablaHtml(columnas, filas, { totales = false } = {}) {
    if (!filas || filas.length === 0) return '<div class="empty-state">Sin datos para los filtros seleccionados.</div>';
    const alin = (c) => (c.alinear ? ` style="text-align:${c.alinear};"` : '');
    const sumables = (c) => c.numerico && ['moneda', 'numero', undefined].includes(c.formato) && c.agregado !== 'promedio';
    const pie = totales && columnas.some(sumables)
      ? `<tfoot><tr class="fila-total">${columnas.map((c, i) => {
        if (sumables(c)) return `<td${alin(c)}>${formatear(Math.round(filas.reduce((a, f) => a + (Number(f[c.id]) || 0), 0) * 100) / 100, c.formato)}</td>`;
        return `<td>${i === 0 ? 'Total' : ''}</td>`;
      }).join('')}</tr></tfoot>`
      : '';
    return `
      <div class="tabla-desplazable"><table class="data-table">
        <thead><tr>${columnas.map((c) => `<th${alin(c)}>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${filas.map((f) => `<tr>${columnas.map((c) => `<td${alin(c)}>${formatear(f[c.id], c.formato)}</td>`).join('')}</tr>`).join('')}</tbody>
        ${pie}
      </table></div>`;
  }

  // --- Preferencias (columnas por reporte) -----------------------------------------------------

  const api = () => window.puntoXReportes || null;

  async function leerPreferencia(clave) {
    if (!api()) return null;
    try { return await api().obtenerPreferencia({ clave }); } catch (e) { return null; }
  }
  let guardadoPendiente = null;
  function guardarPreferencia(clave, valor) {
    if (!api()) return;
    clearTimeout(guardadoPendiente);
    guardadoPendiente = setTimeout(() => { api().guardarPreferencia({ clave, valor }).catch(() => {}); }, 400);
  }

  const predeterminadas = (campos) => campos.filter((c) => c.definida);

  async function columnasGuardadas(reporte, campos) {
    const pref = await leerPreferencia(`columnas.${reporte.clave}`);
    if (!Array.isArray(pref) || pref.length === 0) return predeterminadas(campos);
    const elegidas = pref.map((id) => campos.find((c) => c.id === id)).filter(Boolean);
    return elegidas.length ? elegidas : predeterminadas(campos);
  }

  // --- Selector de columnas (reportes existentes) ----------------------------------------------

  function cerrarSelector() {
    const abierto = document.querySelector('.selector-columnas');
    if (abierto) abierto.remove();
    document.removeEventListener('mousedown', clicFuera, true);
    document.removeEventListener('keydown', teclaEscape, true);
  }
  function clicFuera(e) { if (!e.target.closest('.selector-columnas') && !e.target.closest('[data-columnas]')) cerrarSelector(); }
  function teclaEscape(e) { if (e.key === 'Escape') { cerrarSelector(); } }

  // alCambiar(columnas) se llama con cada cambio; las elegidas se recuerdan por usuario.
  function abrirSelectorColumnas(boton, reporte, campos, actuales, alCambiar) {
    if (document.querySelector('.selector-columnas')) { cerrarSelector(); return; }
    let elegidas = actuales.map((c) => c.id);
    const panel = document.createElement('div');
    panel.className = 'selector-columnas';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Elegir columnas');
    boton.parentElement.appendChild(panel);

    const aplicar = () => {
      const cols = elegidas.map((id) => campos.find((c) => c.id === id)).filter(Boolean);
      alCambiar(cols);
      const esPredeterminado = elegidas.join('|') === predeterminadas(campos).map((c) => c.id).join('|');
      guardarPreferencia(`columnas.${reporte.clave}`, esPredeterminado ? null : elegidas);
    };

    const pintar = () => {
      const otras = campos.filter((c) => !elegidas.includes(c.id));
      const fila = (c, marcada, i) => `
        <div class="selector-columnas__fila">
          <label><input type="checkbox" data-campo="${esc(c.id)}" ${marcada ? 'checked' : ''} ${marcada && elegidas.length === 1 ? 'disabled' : ''} /> ${esc(c.label)}</label>
          ${marcada ? `<span class="selector-columnas__mover">
            <button type="button" data-subir="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(c.label)}" title="Mover a la izquierda">↑</button>
            <button type="button" data-bajar="${i}" ${i === elegidas.length - 1 ? 'disabled' : ''} aria-label="Bajar ${esc(c.label)}" title="Mover a la derecha">↓</button>
          </span>` : ''}
        </div>`;
      panel.innerHTML = `
        <div class="selector-columnas__cabeza"><strong>Columnas</strong><button type="button" class="selector-columnas__restablecer" data-restablecer>Restablecer</button></div>
        <div class="selector-columnas__lista">
          ${elegidas.map((id, i) => fila(campos.find((c) => c.id === id), true, i)).join('')}
          ${otras.length ? `<div class="selector-columnas__seccion">Más columnas disponibles</div>${otras.map((c) => fila(c, false)).join('')}` : ''}
        </div>
        <div class="selector-columnas__pie">Tu selección se recuerda para la próxima vez.</div>`;
      panel.querySelectorAll('[data-campo]').forEach((inp) => inp.addEventListener('change', () => {
        const id = inp.dataset.campo;
        elegidas = inp.checked ? [...elegidas, id] : elegidas.filter((x) => x !== id);
        pintar(); aplicar();
      }));
      panel.querySelectorAll('[data-subir]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.subir); [elegidas[i - 1], elegidas[i]] = [elegidas[i], elegidas[i - 1]]; pintar(); aplicar(); }));
      panel.querySelectorAll('[data-bajar]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.bajar); [elegidas[i + 1], elegidas[i]] = [elegidas[i], elegidas[i + 1]]; pintar(); aplicar(); }));
      panel.querySelector('[data-restablecer]').addEventListener('click', () => { elegidas = predeterminadas(campos).map((c) => c.id); pintar(); aplicar(); });
    };
    pintar();
    setTimeout(() => {
      document.addEventListener('mousedown', clicFuera, true);
      document.addEventListener('keydown', teclaEscape, true);
    }, 0);
  }

  // --- Fuentes de datos para reportes personalizados -------------------------------------------

  const FUENTES_EXTRA = [
    {
      clave: 'fuente-productos', etiqueta: 'Productos (catálogo completo)', grupo: 'Inventario', modulo: 'inventario', filtros: [],
      cargar: () => window.puntoXInventario.listarProductos({ limite: 5000, soloActivos: false }),
      columnas: [{ label: 'Código', key: 'codigo_interno' }, { label: 'Descripción', key: 'descripcion' }, { label: 'Categoría', key: 'categoria_nombre' }, { label: 'Precio detalle', key: 'precio_detalle', formato: 'moneda', alinear: 'right' }, { label: 'Existencia', key: 'existencia_total', alinear: 'right' }],
    },
    {
      clave: 'fuente-clientes', etiqueta: 'Clientes', grupo: 'Cuentas por Cobrar', modulo: 'cxc', filtros: [],
      cargar: () => window.puntoXCxc.listarClientes({ limite: 5000 }),
      columnas: [{ label: 'Cliente', key: 'nombre' }, { label: 'RNC/Cédula', key: 'rnc_cedula' }, { label: 'Teléfono', key: 'telefono' }, { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' }],
    },
    {
      clave: 'fuente-proveedores', etiqueta: 'Proveedores', grupo: 'Compras', modulo: 'compras', filtros: [],
      cargar: () => window.puntoXCompras.listarProveedores({ limite: 5000 }),
      columnas: [{ label: 'Proveedor', key: 'nombre' }, { label: 'RNC', key: 'rnc' }, { label: 'Teléfono', key: 'telefono' }, { label: 'Saldo pendiente', key: 'saldo_pendiente', formato: 'moneda', alinear: 'right' }],
    },
  ];

  // Reportes tabulares del catálogo visibles para el usuario + listados. Se dejan fuera los que
  // piden elegir un producto (no tienen sentido como base de un reporte general).
  function fuentesDisponibles() {
    const lista = [];
    CATALOGO.filter(grupoVisible).forEach((g) => g.reportes.forEach((r) => {
      if (r.personalizado || (r.disponible && !r.disponible())) return;
      if ((r.filtros || []).some((f) => f.tipo === 'producto')) return;
      lista.push({ ...r, grupo: g.grupo, modulo: g.modulo });
    }));
    FUENTES_EXTRA.forEach((f) => { if (grupoVisible(f)) lista.push(f); });
    return lista;
  }
  const fuentePorClave = (clave) => fuentesDisponibles().find((f) => f.clave === clave) || null;

  // --- Período predeterminado (para fuentes con fechas) ----------------------------------------

  const PERIODOS = [
    { value: 'hoy', label: 'Hoy' }, { value: 'ayer', label: 'Ayer' }, { value: 'semana', label: 'Últimos 7 días' },
    { value: 'este_mes', label: 'Este mes' }, { value: 'mes_pasado', label: 'Mes pasado' }, { value: 'ultimos_30', label: 'Últimos 30 días' },
    { value: 'este_anio', label: 'Este año' }, { value: '', label: 'Sin límite de fechas' },
  ];
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function rangoDePeriodo(periodo) {
    const hoy = new Date();
    const dia = (n) => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d; };
    switch (periodo) {
      case 'hoy': return { desde: iso(hoy), hasta: iso(hoy) };
      case 'ayer': return { desde: iso(dia(-1)), hasta: iso(dia(-1)) };
      case 'semana': return { desde: iso(dia(-6)), hasta: iso(hoy) };
      case 'este_mes': return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(hoy) };
      case 'mes_pasado': return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)) };
      case 'ultimos_30': return { desde: iso(dia(-29)), hasta: iso(hoy) };
      case 'este_anio': return { desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta: iso(hoy) };
      default: return { desde: '', hasta: '' };
    }
  }
  const tieneRango = (fuente) => (fuente.filtros || []).some((f) => f.tipo === 'fecha' && (f.clave === 'desde' || f.clave === 'hasta'));

  // Filtros de la fuente con los valores iniciales del reporte (período y selecciones guardadas).
  function filtrosIniciales(fuente, def) {
    const rango = rangoDePeriodo(def.periodo);
    return (fuente.filtros || []).map((f) => {
      let valor = f.valorDefault;
      if (f.tipo === 'fecha' && (f.clave === 'desde' || f.clave === 'hasta')) valor = rango[f.clave];
      if (def.filtros && def.filtros[f.clave] !== undefined) valor = def.filtros[f.clave];
      return { ...f, valorDefault: valor };
    });
  }
  // Lo mismo que leerFiltros() pero sin pantalla (para la vista previa del editor).
  function valoresDeFiltros(filtros) {
    const v = {};
    filtros.forEach((f) => {
      const valor = f.valorDefault;
      if (!valor || f.tipo === 'producto') return;
      if (f.tipo === 'fecha') v[f.clave] = f.clave === 'hasta' ? `${valor}T23:59:59.999Z` : `${valor}T00:00:00.000Z`;
      else v[f.clave] = valor;
    });
    return v;
  }

  // --- Cálculo: condiciones, agrupación, orden y límite ----------------------------------------

  const OPERADORES = {
    texto: [['contiene', 'contiene'], ['no_contiene', 'no contiene'], ['igual', 'es igual a'], ['distinto', 'es distinto de'], ['vacio', 'está vacío'], ['no_vacio', 'no está vacío']],
    numero: [['mayor_igual', 'es mayor o igual a'], ['menor_igual', 'es menor o igual a'], ['mayor', 'es mayor que'], ['menor', 'es menor que'], ['igual', 'es igual a'], ['distinto', 'es distinto de'], ['vacio', 'está vacío'], ['no_vacio', 'no está vacío']],
    fecha: [['desde', 'desde el'], ['hasta', 'hasta el'], ['igual', 'es el día'], ['vacio', 'está vacío'], ['no_vacio', 'no está vacío']],
    booleano: [['si', 'es Sí'], ['no', 'es No']],
  };
  const tipoDeCampo = (c) => (!c ? 'texto' : c.formato === 'booleano' ? 'booleano' : c.formato === 'fecha' ? 'fecha' : c.numerico ? 'numero' : 'texto');
  const sinValor = (op) => ['vacio', 'no_vacio', 'si', 'no'].includes(op);
  const normalizar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function cumple(v, campo, op, valor) {
    const vacio = v === null || v === undefined || v === '';
    if (op === 'vacio') return vacio;
    if (op === 'no_vacio') return !vacio;
    if (op === 'si') return Boolean(v) && v !== 0;
    if (op === 'no') return !v;
    const tipo = tipoDeCampo(campo);
    if (tipo === 'numero') {
      if (vacio || valor === '' || valor === null || Number.isNaN(Number(valor))) return op === 'distinto';
      const a = Number(v); const b = Number(valor);
      return { igual: a === b, distinto: a !== b, mayor: a > b, mayor_igual: a >= b, menor: a < b, menor_igual: a <= b }[op] ?? true;
    }
    if (tipo === 'fecha') {
      if (vacio) return false;
      const dia = typeof v === 'string' && v.length > 10 ? iso(new Date(v)) : String(v).slice(0, 10);
      return { desde: dia >= valor, hasta: dia <= valor, igual: dia === valor }[op] ?? true;
    }
    const a = normalizar(vacio ? '' : v); const b = normalizar(valor ?? '');
    return { contiene: a.includes(b), no_contiene: !a.includes(b), igual: a === b, distinto: a !== b }[op] ?? true;
  }

  const AGREGADOS = [['suma', 'Suma'], ['promedio', 'Promedio'], ['minimo', 'Mínimo'], ['maximo', 'Máximo']];
  function agregar(valores, tipo) {
    const n = valores.map(Number).filter((x) => !Number.isNaN(x));
    if (n.length === 0) return null;
    const r = { suma: n.reduce((a, b) => a + b, 0), promedio: n.reduce((a, b) => a + b, 0) / n.length, minimo: Math.min(...n), maximo: Math.max(...n) }[tipo || 'suma'];
    return Math.round(r * 100) / 100;
  }

  // Devuelve { columnas, filas, avisos } listos para la tabla.
  function calcular(def, campos, filas) {
    const campo = (id) => campos.find((c) => c.id === id);
    let datos = filas.filter((f) => (def.condiciones || []).every((c) => !c.campo || cumple(f[c.campo], campo(c.campo), c.op, c.valor)));
    let columnas = (def.columnas || []).map((c) => (campo(c.id) ? { ...campo(c.id), label: c.label || campo(c.id).label, agregado: c.agregado } : null)).filter(Boolean);
    const avisos = [];

    const grupo = def.agrupar && campo(def.agrupar);
    if (grupo) {
      const mapa = new Map();
      datos.forEach((f) => {
        const k = f[grupo.id] === null || f[grupo.id] === undefined || f[grupo.id] === '' ? '—' : f[grupo.id];
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(f);
      });
      const numericas = columnas.filter((c) => c.id !== grupo.id && c.numerico);
      const descartadas = columnas.filter((c) => c.id !== grupo.id && !c.numerico);
      if (descartadas.length) avisos.push(`Al agrupar por "${grupo.label}" no se muestran: ${descartadas.map((c) => c.label).join(', ')} (no son números).`);
      datos = [...mapa.entries()].map(([k, grupoFilas]) => {
        const o = { [grupo.id]: k, __registros: grupoFilas.length };
        numericas.forEach((c) => { o[c.id] = agregar(grupoFilas.map((f) => f[c.id]), c.agregado); });
        return o;
      });
      const nombreAgregado = (c) => (c.agregado && c.agregado !== 'suma' ? ` (${(AGREGADOS.find((a) => a[0] === c.agregado) || [])[1] || ''})` : '');
      columnas = [
        { ...grupo, label: (def.columnas.find((c) => c.id === grupo.id) || {}).label || grupo.label, numerico: false, alinear: undefined },
        ...numericas.map((c) => ({ ...c, label: c.label + nombreAgregado(c) })),
        { id: '__registros', label: 'Registros', formato: 'numero', alinear: 'right', numerico: true },
      ];
    }

    const orden = def.orden && def.orden.campo;
    if (orden && (columnas.some((c) => c.id === orden) || campo(orden))) {
      const dir = def.orden.dir === 'desc' ? -1 : 1;
      datos = datos.slice().sort((a, b) => {
        const x = a[orden]; const y = b[orden];
        if (x === y) return 0;
        if (x === null || x === undefined || x === '') return 1;
        if (y === null || y === undefined || y === '') return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y), 'es', { numeric: true }) * dir;
      });
    }
    if (Number(def.limite) > 0) datos = datos.slice(0, Number(def.limite));
    return { columnas, filas: datos, avisos };
  }

  // --- Ejecutar un reporte personalizado guardado ----------------------------------------------

  async function cargarFuente(fuente, valores) {
    const datos = await fuente.cargar(valores);
    return camposDeFuente(fuente, Array.isArray(datos) ? datos : []);
  }

  function resultadoHtml(def, resultado, { avisos = false } = {}) {
    return `${(avisos ? resultado.avisos : []).map((a) => `<div class="conc-aviso" style="margin:0 0 10px;">${esc(a)}</div>`).join('')}
      ${tablaHtml(resultado.columnas, resultado.filas, { totales: def.totales !== false })}
      <div class="reporte-pie">${esc(resultado.filas.length)} ${resultado.filas.length === 1 ? 'fila' : 'filas'}</div>`;
  }

  // --- Editor de reportes personalizados -------------------------------------------------------

  const LIMITES = [['', 'Todas'], ['10', '10'], ['25', '25'], ['50', '50'], ['100', '100'], ['500', '500']];

  // reporte: el guardado (para editar) o null; base: definición inicial (p. ej. desde un reporte
  // existente). alTerminar(reporteGuardado|null).
  async function abrirEditor({ reporte = null, base = null, alTerminar }) {
    const fuentes = fuentesDisponibles();
    if (fuentes.length === 0) { mostrarError('No tienes acceso a ninguna fuente de datos para armar reportes.'); return; }
    const def = JSON.parse(JSON.stringify(reporte ? reporte.definicion : base || {}));
    if (!def.fuente || !fuentes.some((f) => f.clave === def.fuente)) def.fuente = fuentes[0].clave;
    if (def.periodo === undefined) def.periodo = 'este_mes';
    def.condiciones = def.condiciones || [];
    def.orden = def.orden || { campo: '', dir: 'desc' };
    if (def.totales === undefined) def.totales = true;
    let nombre = reporte ? reporte.nombre : (base && base.nombreSugerido) || '';
    let compartido = reporte ? reporte.compartido : false;
    let campos = [];
    let filas = [];
    let cargando = null;

    document.getElementById('reportes-vacio').style.display = 'none';
    document.getElementById('reportes-contenido').style.display = 'block';
    document.getElementById('reporte-titulo').textContent = reporte ? `Editar: ${reporte.nombre}` : 'Nuevo reporte personalizado';
    document.getElementById('reporte-filtros').innerHTML = '';
    const raiz = document.getElementById('reporte-resultado');
    document.querySelectorAll('.reportes-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.clave === '__nuevo' && !reporte));

    const grupos = [...new Set(fuentes.map((f) => f.grupo))];
    raiz.innerHTML = `
      <div class="editor-reporte">
        <div class="editor-reporte__config">
          <section class="editor-paso">
            <h3><span class="editor-paso__num">1</span> Datos</h3>
            <div class="form-field"><label for="er-nombre">Nombre del reporte *</label><input id="er-nombre" class="input-normal" maxlength="80" placeholder="Ej.: Ventas del mes por cliente" value="${esc(nombre)}" /></div>
            <div class="form-field"><label for="er-fuente">¿De dónde salen los datos?</label>
              <select id="er-fuente" class="input-normal">${grupos.map((g) => `<optgroup label="${esc(g)}">${fuentes.filter((f) => f.grupo === g).map((f) => `<option value="${esc(f.clave)}" ${f.clave === def.fuente ? 'selected' : ''}>${esc(f.etiqueta)}</option>`).join('')}</optgroup>`).join('')}</select>
            </div>
            <div class="form-field" id="er-periodo-campo"><label for="er-periodo">Período al abrirlo</label>
              <select id="er-periodo" class="input-normal">${PERIODOS.map((p) => `<option value="${esc(p.value)}" ${p.value === def.periodo ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
            </div>
            <div id="er-filtros-fuente"></div>
          </section>
          <section class="editor-paso">
            <h3><span class="editor-paso__num">2</span> Columnas</h3>
            <p class="editor-paso__ayuda">Marca las que quieres ver. Usa las flechas para ordenarlas y cambia el título si quieres.</p>
            <div id="er-columnas" class="er-columnas"></div>
          </section>
          <section class="editor-paso">
            <h3><span class="editor-paso__num">3</span> Condiciones <span class="editor-paso__opcional">opcional</span></h3>
            <p class="editor-paso__ayuda">Muestra solo las filas que cumplan todas las condiciones.</p>
            <div id="er-condiciones"></div>
            <button type="button" class="btn btn-secundario btn-chico" id="er-agregar-condicion">+ Agregar condición</button>
          </section>
          <section class="editor-paso">
            <h3><span class="editor-paso__num">4</span> Agrupar y ordenar</h3>
            <div class="form-grid">
              <div class="form-field"><label for="er-agrupar">Agrupar por</label><select id="er-agrupar" class="input-normal"></select></div>
              <div class="form-field"><label for="er-orden">Ordenar por</label><select id="er-orden" class="input-normal"></select></div>
              <div class="form-field"><label for="er-dir">Dirección</label><select id="er-dir" class="input-normal"><option value="desc">De mayor a menor (Z-A)</option><option value="asc">De menor a mayor (A-Z)</option></select></div>
              <div class="form-field"><label for="er-limite">Mostrar</label><select id="er-limite" class="input-normal">${LIMITES.map(([v, l]) => `<option value="${v}" ${String(def.limite || '') === v ? 'selected' : ''}>${v ? `Las primeras ${l} filas` : 'Todas las filas'}</option>`).join('')}</select></div>
            </div>
            <div id="er-agregados"></div>
            <label class="editor-check"><input type="checkbox" id="er-totales" ${def.totales ? 'checked' : ''} /> Mostrar una fila de totales al final</label>
          </section>
          <section class="editor-paso">
            <label class="editor-check"><input type="checkbox" id="er-compartido" ${compartido ? 'checked' : ''} /> Compartir con todos los usuarios (lo verán en "Mis reportes"; solo tú lo puedes cambiar)</label>
          </section>
          <div class="editor-reporte__acciones">
            <button type="button" class="btn btn-secundario" id="er-cancelar">Cancelar</button>
            <button type="button" class="btn btn-primario" id="er-guardar">${reporte ? 'Guardar cambios' : 'Guardar reporte'}</button>
          </div>
        </div>
        <div class="editor-reporte__vista">
          <div class="editor-reporte__vista-titulo">Vista previa</div>
          <div id="er-vista" class="editor-reporte__vista-cuerpo"><div class="empty-state">Cargando datos…</div></div>
        </div>
      </div>`;

    const $ = (id) => document.getElementById(id);
    const fuenteActual = () => fuentePorClave(def.fuente);

    function opcionesCampos(seleccionado, { vacio } = {}) {
      return (vacio ? `<option value="">${esc(vacio)}</option>` : '') + campos.map((c) => `<option value="${esc(c.id)}" ${c.id === seleccionado ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    }

    function pintarColumnas() {
      const elegidas = def.columnas.filter((c) => campos.some((x) => x.id === c.id));
      const otras = campos.filter((c) => !elegidas.some((e) => e.id === c.id));
      $('er-columnas').innerHTML = `
        ${elegidas.map((c, i) => `
          <div class="er-columna er-columna--activa">
            <input type="checkbox" checked data-col="${esc(c.id)}" aria-label="Quitar ${esc(c.label || '')}" ${elegidas.length === 1 ? 'disabled' : ''} />
            <input type="text" class="er-columna__titulo" data-titulo="${esc(c.id)}" value="${esc(c.label || (campos.find((x) => x.id === c.id) || {}).label || '')}" aria-label="Título de la columna" />
            <span class="selector-columnas__mover">
              <button type="button" data-subir="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir" title="Mover arriba">↑</button>
              <button type="button" data-bajar="${i}" ${i === elegidas.length - 1 ? 'disabled' : ''} aria-label="Bajar" title="Mover abajo">↓</button>
            </span>
          </div>`).join('')}
        ${otras.length ? `<div class="selector-columnas__seccion">Agregar columna</div><div class="er-columnas__otras">${otras.map((c) => `<label class="er-chip"><input type="checkbox" data-col="${esc(c.id)}" /> ${esc(c.label)}</label>`).join('')}</div>` : ''}`;
      $('er-columnas').querySelectorAll('input[type="checkbox"][data-col]').forEach((inp) => inp.addEventListener('change', () => {
        const id = inp.dataset.col;
        if (inp.checked) def.columnas.push({ id, label: (campos.find((c) => c.id === id) || {}).label });
        else def.columnas = def.columnas.filter((c) => c.id !== id);
        pintarColumnas(); pintarAgrupacion(); previsualizar();
      }));
      $('er-columnas').querySelectorAll('[data-titulo]').forEach((inp) => inp.addEventListener('input', () => {
        const col = def.columnas.find((c) => c.id === inp.dataset.titulo);
        if (col) col.label = inp.value;
        previsualizar();
      }));
      const mover = (i, j) => { const lista = def.columnas.filter((c) => campos.some((x) => x.id === c.id)); [lista[i], lista[j]] = [lista[j], lista[i]]; def.columnas = lista; pintarColumnas(); previsualizar(); };
      $('er-columnas').querySelectorAll('[data-subir]').forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.subir), Number(b.dataset.subir) - 1)));
      $('er-columnas').querySelectorAll('[data-bajar]').forEach((b) => b.addEventListener('click', () => mover(Number(b.dataset.bajar), Number(b.dataset.bajar) + 1)));
    }

    function pintarCondiciones() {
      $('er-condiciones').innerHTML = def.condiciones.map((c, i) => {
        const campo = campos.find((x) => x.id === c.campo);
        const tipo = tipoDeCampo(campo);
        const ops = OPERADORES[tipo];
        if (!ops.some(([v]) => v === c.op)) c.op = ops[0][0];
        const tipoInput = tipo === 'fecha' ? 'date' : tipo === 'numero' ? 'number' : 'text';
        return `
          <div class="er-condicion">
            <select class="input-normal" data-cond-campo="${i}" aria-label="Campo">${opcionesCampos(c.campo)}</select>
            <select class="input-normal" data-cond-op="${i}" aria-label="Condición">${ops.map(([v, l]) => `<option value="${v}" ${v === c.op ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
            ${sinValor(c.op) ? '<span></span>' : `<input class="input-normal" type="${tipoInput}" ${tipoInput === 'number' ? 'step="any"' : ''} data-cond-valor="${i}" value="${esc(c.valor ?? '')}" aria-label="Valor" />`}
            <button type="button" class="btn btn-secundario btn-chico" data-cond-quitar="${i}" aria-label="Quitar condición">✕</button>
          </div>`;
      }).join('');
      $('er-condiciones').querySelectorAll('[data-cond-campo]').forEach((s) => s.addEventListener('change', () => { const c = def.condiciones[Number(s.dataset.condCampo)]; c.campo = s.value; c.op = ''; c.valor = ''; pintarCondiciones(); previsualizar(); }));
      $('er-condiciones').querySelectorAll('[data-cond-op]').forEach((s) => s.addEventListener('change', () => { def.condiciones[Number(s.dataset.condOp)].op = s.value; pintarCondiciones(); previsualizar(); }));
      $('er-condiciones').querySelectorAll('[data-cond-valor]').forEach((s) => s.addEventListener('input', () => { def.condiciones[Number(s.dataset.condValor)].valor = s.value; previsualizar(); }));
      $('er-condiciones').querySelectorAll('[data-cond-quitar]').forEach((b) => b.addEventListener('click', () => { def.condiciones.splice(Number(b.dataset.condQuitar), 1); pintarCondiciones(); previsualizar(); }));
    }

    function pintarAgrupacion() {
      $('er-agrupar').innerHTML = opcionesCampos(def.agrupar, { vacio: 'Sin agrupar (una fila por registro)' });
      $('er-orden').innerHTML = opcionesCampos(def.orden.campo, { vacio: 'Como vienen' }) + (def.agrupar ? `<option value="__registros" ${def.orden.campo === '__registros' ? 'selected' : ''}>Registros</option>` : '');
      $('er-dir').value = def.orden.dir || 'desc';
      const numericas = def.columnas.map((c) => campos.find((x) => x.id === c.id)).filter((c) => c && c.numerico && c.id !== def.agrupar);
      $('er-agregados').innerHTML = def.agrupar && numericas.length
        ? `<div class="er-agregados"><div class="editor-paso__ayuda">Cómo se resume cada número del grupo:</div>${numericas.map((c) => {
          const col = def.columnas.find((x) => x.id === c.id);
          return `<label class="er-agregado"><span>${esc(col.label || c.label)}</span><select class="input-normal" data-agregado="${esc(c.id)}">${AGREGADOS.map(([v, l]) => `<option value="${v}" ${(col.agregado || 'suma') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        }).join('')}</div>`
        : '';
      $('er-agregados').querySelectorAll('[data-agregado]').forEach((s) => s.addEventListener('change', () => { const col = def.columnas.find((c) => c.id === s.dataset.agregado); if (col) col.agregado = s.value; previsualizar(); }));
    }

    // Filtros propios de la fuente que no son fechas (p. ej. "Agrupar por día/mes" en Ventas por
    // Período): se guardan con el reporte.
    function pintarFiltrosFuente() {
      const fuente = fuenteActual();
      const otros = (fuente.filtros || []).filter((f) => f.tipo === 'select');
      $('er-periodo-campo').style.display = tieneRango(fuente) ? '' : 'none';
      def.filtros = def.filtros || {};
      Promise.all(otros.map(async (f) => {
        let opciones = f.opciones;
        if (typeof opciones === 'function') { try { opciones = await opciones(); } catch (e) { opciones = []; } }
        const valor = def.filtros[f.clave] !== undefined ? def.filtros[f.clave] : f.valorDefault;
        return `<div class="form-field"><label for="er-f-${esc(f.clave)}">${esc(f.label)}</label><select class="input-normal" id="er-f-${esc(f.clave)}" data-filtro="${esc(f.clave)}">${opciones.map((o) => `<option value="${esc(o.value)}" ${o.value === valor ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
      })).then((html) => {
        $('er-filtros-fuente').innerHTML = html.join('');
        $('er-filtros-fuente').querySelectorAll('[data-filtro]').forEach((s) => s.addEventListener('change', () => { def.filtros[s.dataset.filtro] = s.value; cargarDatos(); }));
      });
    }

    let temporizador = null;
    function previsualizar() {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        const vista = $('er-vista');
        if (!vista) return;
        if (!def.columnas.some((c) => campos.some((x) => x.id === c.id))) { vista.innerHTML = '<div class="empty-state">Marca al menos una columna.</div>'; return; }
        const r = calcular(def, campos, filas);
        const muestra = { ...r, filas: r.filas.slice(0, 50) };
        vista.innerHTML = resultadoHtml(def, muestra, { avisos: true }) + (r.filas.length > 50 ? `<div class="reporte-pie">Mostrando 50 de ${esc(r.filas.length)} filas en la vista previa.</div>` : '');
      }, 120);
    }

    async function cargarDatos({ reiniciarColumnas = false } = {}) {
      const fuente = fuenteActual();
      const valores = valoresDeFiltros(filtrosIniciales(fuente, def));
      const turno = {};
      cargando = turno;
      $('er-vista').innerHTML = '<div class="empty-state">Cargando datos…</div>';
      try {
        const r = await cargarFuente(fuente, valores);
        if (cargando !== turno) return;
        campos = r.campos;
        filas = r.filas;
      } catch (err) {
        if (cargando !== turno) return;
        campos = camposDeFuente(fuente, []).campos;
        filas = [];
        $('er-vista').innerHTML = `<div class="mensaje-error" style="display:block;">${esc(String(err.message || err).replace(/^Error invoking remote method '.*?': Error: /, ''))}</div>`;
      }
      if (reiniciarColumnas || !Array.isArray(def.columnas) || !def.columnas.some((c) => campos.some((x) => x.id === c.id))) {
        def.columnas = predeterminadas(campos).map((c) => ({ id: c.id, label: c.label }));
        if (def.columnas.length === 0) def.columnas = campos.slice(0, 5).map((c) => ({ id: c.id, label: c.label }));
      }
      if (def.agrupar && !campos.some((c) => c.id === def.agrupar)) def.agrupar = '';
      def.condiciones = def.condiciones.filter((c) => !c.campo || campos.some((x) => x.id === c.campo));
      pintarColumnas(); pintarCondiciones(); pintarAgrupacion(); previsualizar();
    }

    $('er-nombre').addEventListener('input', (e) => { nombre = e.target.value; });
    $('er-fuente').addEventListener('change', (e) => {
      def.fuente = e.target.value; def.filtros = {}; def.condiciones = []; def.agrupar = ''; def.orden = { campo: '', dir: 'desc' };
      pintarFiltrosFuente(); cargarDatos({ reiniciarColumnas: true });
    });
    $('er-periodo').addEventListener('change', (e) => { def.periodo = e.target.value; cargarDatos(); });
    $('er-agregar-condicion').addEventListener('click', () => { def.condiciones.push({ campo: (campos[0] || {}).id || '', op: '', valor: '' }); pintarCondiciones(); });
    $('er-agrupar').addEventListener('change', (e) => {
      def.agrupar = e.target.value;
      // Al agrupar, la columna del grupo va primero.
      if (def.agrupar && !def.columnas.some((c) => c.id === def.agrupar)) def.columnas.unshift({ id: def.agrupar, label: (campos.find((c) => c.id === def.agrupar) || {}).label });
      // Agrupado solo se resumen números: las demás columnas se quitan (se pueden volver a marcar
      // si se deja de agrupar).
      if (def.agrupar) {
        def.columnas = def.columnas.filter((c) => c.id === def.agrupar || (campos.find((x) => x.id === c.id) || {}).numerico);
        const g = def.columnas.findIndex((c) => c.id === def.agrupar);
        if (g > 0) def.columnas.unshift(...def.columnas.splice(g, 1));
      }
      if (!def.agrupar && def.orden.campo === '__registros') def.orden.campo = '';
      pintarColumnas(); pintarAgrupacion(); previsualizar();
    });
    $('er-orden').addEventListener('change', (e) => { def.orden.campo = e.target.value; previsualizar(); });
    $('er-dir').addEventListener('change', (e) => { def.orden.dir = e.target.value; previsualizar(); });
    $('er-limite').addEventListener('change', (e) => { def.limite = e.target.value ? Number(e.target.value) : null; previsualizar(); });
    $('er-totales').addEventListener('change', (e) => { def.totales = e.target.checked; previsualizar(); });
    $('er-compartido').addEventListener('change', (e) => { compartido = e.target.checked; });
    $('er-cancelar').addEventListener('click', () => alTerminar(null));
    $('er-guardar').addEventListener('click', async () => {
      mostrarError(null);
      if (!nombre.trim()) { mostrarError('Ponle un nombre al reporte.'); $('er-nombre').focus(); return; }
      const columnas = def.columnas.filter((c) => campos.some((x) => x.id === c.id)).map((c) => ({ id: c.id, label: (c.label || '').trim() || (campos.find((x) => x.id === c.id) || {}).label, ...(c.agregado ? { agregado: c.agregado } : {}) }));
      const definicion = {
        version: 1, fuente: def.fuente, periodo: tieneRango(fuenteActual()) ? def.periodo : '', filtros: def.filtros || {}, columnas,
        condiciones: def.condiciones.filter((c) => c.campo && c.op), agrupar: def.agrupar || '', orden: def.orden, limite: def.limite || null, totales: def.totales,
      };
      try {
        const guardado = await api().guardarPersonalizado({ id: reporte ? reporte.id : undefined, nombre: nombre.trim(), definicion, compartido });
        alTerminar(guardado);
      } catch (err) { mostrarError(err.message); }
    });

    pintarFiltrosFuente();
    await cargarDatos();
    $('er-nombre').focus();
  }

  window.PuntoXReportesPers = {
    camposDeFuente, columnasGuardadas, abrirSelectorColumnas, cerrarSelector, tablaHtml, calcular, fuentePorClave,
    fuentesDisponibles, filtrosIniciales, cargarFuente, resultadoHtml, abrirEditor, predeterminadas, disponible: () => Boolean(api()),
  };
})();
