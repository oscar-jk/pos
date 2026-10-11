// Reportes de inventario del Módulo 2: valorización a fecha (comparable entre dos fechas),
// reposición sugerida, sobre-stock, rotación y bitácora de movimientos. Todos leen el kardex y
// las existencias; ninguno modifica datos. Los días son locales (UTC-4) y el kardex está en UTC.
const session = require('../auth/session');

const DIAS_CONSUMO = 90; // ventana de consumo histórico
const DIAS_COBERTURA_REPOSICION = 30; // lo que se quiere cubrir al reponer si el producto no tiene máximo
const DIAS_COBERTURA_EXCESO = 180; // más cobertura que esto es exceso si no hay máximo

// Los filtros de la pantalla llegan como instante ISO ("2026-10-01T00:00:00.000Z"): se usa el día.
const dia = (f) => (f ? String(f).slice(0, 10) : undefined);

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Fin del día local (RD, UTC-4) como instante UTC ISO, para comparar con created_at.
function finDelDiaUtc(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw new Error('La fecha no es válida');
  return new Date(Date.parse(`${fecha}T23:59:59.999-04:00`)).toISOString();
}

function hoyLocal() {
  const d = new Date(Date.now() - 4 * 3600000);
  return d.toISOString().slice(0, 10);
}

function sumarDias(fecha, dias) {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

// Saldo de cada producto a una fecha: último movimiento de cada almacén hasta ese día.
function saldosAFecha(db, fecha, { productoId } = {}) {
  const limite = finDelDiaUtc(fecha);
  const filas = db
    .prepare(
      `SELECT p.id AS producto_id, p.codigo_interno, p.descripcion, p.categoria_id, c.nombre AS categoria_nombre,
              COALESCE(SUM(u.saldo_cantidad), 0) AS cantidad, COALESCE(SUM(u.saldo_cantidad * u.saldo_costo), 0) AS valor
       FROM productos p
       LEFT JOIN categorias_producto c ON c.id = p.categoria_id
       LEFT JOIN (
         SELECT k.producto_id, k.saldo_cantidad, k.saldo_costo FROM kardex_movimientos k
         WHERE k.deleted_at IS NULL AND k.created_at <= ?
           AND k.rowid = (SELECT k2.rowid FROM kardex_movimientos k2
                          WHERE k2.producto_id = k.producto_id AND k2.almacen_id = k.almacen_id AND k2.deleted_at IS NULL AND k2.created_at <= ?
                          ORDER BY k2.created_at DESC, k2.rowid DESC LIMIT 1)
       ) u ON u.producto_id = p.id
       WHERE p.deleted_at IS NULL AND p.es_kit = 0 ${productoId ? 'AND p.id = ?' : ''}
       GROUP BY p.id ORDER BY p.descripcion`
    )
    .all(...[limite, limite, productoId].filter((v) => v !== undefined));
  return filas.map((f) => ({ ...f, cantidad: Math.round(f.cantidad * 1000) / 1000, valor: redondear(f.valor) }));
}

// Valorización a una fecha, comparable con otra: costo vigente tras el último movimiento de
// cada producto en cada almacén (saldo × costo del kardex).
function valorizacionAFecha(db, { fecha, compararCon } = {}) {
  session.requerirPermiso('inventario.costos.ver');
  const f1 = dia(fecha) || hoyLocal();
  compararCon = dia(compararCon);
  const actual = saldosAFecha(db, f1);
  const previo = compararCon ? new Map(saldosAFecha(db, compararCon).map((x) => [x.producto_id, x])) : null;
  const filas = actual
    .filter((x) => x.cantidad !== 0 || x.valor !== 0 || (previo && (previo.get(x.producto_id) || {}).cantidad))
    .map((x) => {
      const fila = { codigo_interno: x.codigo_interno, descripcion: x.descripcion, categoria_nombre: x.categoria_nombre, cantidad: x.cantidad, valor: x.valor };
      if (previo) {
        const p = previo.get(x.producto_id) || { cantidad: 0, valor: 0 };
        Object.assign(fila, { cantidad_previa: p.cantidad, valor_previo: p.valor, diferencia: redondear(x.valor - p.valor) });
      }
      return fila;
    });
  const total = redondear(filas.reduce((a, f) => a + f.valor, 0));
  const totalPrevio = previo ? redondear(filas.reduce((a, f) => a + f.valor_previo, 0)) : null;
  return { fecha: f1, compararCon: compararCon || null, filas, total, totalPrevio, diferencia: previo ? redondear(total - totalPrevio) : null };
}

// Consumo diario de cada producto (unidades facturadas menos devueltas) en los últimos DIAS_CONSUMO días.
function consumoDiario(db, hoy = hoyLocal()) {
  const desde = new Date(Date.parse(`${sumarDias(hoy, -DIAS_CONSUMO)}T00:00:00-04:00`)).toISOString();
  const filas = db
    .prepare(
      `SELECT d.producto_id,
              SUM(CASE WHEN v.tipo = 'factura' THEN d.cantidad ELSE -d.cantidad END) AS cantidad
       FROM documentos_venta_detalle d JOIN documentos_venta v ON v.id = d.documento_id
       WHERE v.tipo IN ('factura', 'nota_credito') AND v.estado != 'anulado' AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.fecha >= ?
       GROUP BY d.producto_id`
    )
    .all(desde);
  return new Map(filas.map((f) => [f.producto_id, Math.max(0, f.cantidad) / DIAS_CONSUMO]));
}

function existenciasConsolidadas(db) {
  return db
    .prepare(
      `SELECT p.id, p.codigo_interno, p.descripcion, p.stock_minimo, p.stock_maximo, p.costo_promedio,
              COALESCE(SUM(e.cantidad_disponible), 0) AS existencia
       FROM productos p LEFT JOIN existencias e ON e.producto_id = p.id AND e.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.activo = 1 AND p.es_kit = 0
       GROUP BY p.id ORDER BY p.descripcion`
    )
    .all();
}

// Productos en o bajo su punto de reorden. Cantidad sugerida: lo que falta para llegar al
// máximo del producto o, si no tiene máximo, al mínimo más 30 días de consumo histórico.
function reposicionSugerida(db) {
  session.requerirPermiso('inventario.ver');
  const consumo = consumoDiario(db);
  return existenciasConsolidadas(db)
    .filter((p) => p.stock_minimo > 0 && p.existencia <= p.stock_minimo)
    .map((p) => {
      const diario = consumo.get(p.id) || 0;
      const objetivo = p.stock_maximo !== null && p.stock_maximo !== undefined ? p.stock_maximo : p.stock_minimo + diario * DIAS_COBERTURA_REPOSICION;
      return {
        codigo_interno: p.codigo_interno, descripcion: p.descripcion, existencia: p.existencia, stock_minimo: p.stock_minimo,
        consumo_diario: Math.round(diario * 100) / 100, dias_cobertura: diario > 0 ? Math.round(p.existencia / diario) : null,
        cantidad_sugerida: Math.max(0, Math.ceil(objetivo - p.existencia)),
      };
    })
    .sort((a, b) => (a.dias_cobertura ?? 1e9) - (b.dias_cobertura ?? 1e9));
}

// Productos con más inventario del necesario: sobre su máximo, o con más de 180 días de
// cobertura, o sin ventas en 90 días. Útil para promociones de liquidación.
function sobreStock(db) {
  session.requerirPermiso('inventario.costos.ver');
  const consumo = consumoDiario(db);
  const filas = [];
  for (const p of existenciasConsolidadas(db)) {
    if (!(p.existencia > 0)) continue;
    const diario = consumo.get(p.id) || 0;
    let exceso = 0;
    let motivo = null;
    if (p.stock_maximo !== null && p.stock_maximo !== undefined && p.existencia > p.stock_maximo) {
      exceso = p.existencia - p.stock_maximo; motivo = 'Sobre el máximo';
    } else if (diario > 0 && p.existencia / diario > DIAS_COBERTURA_EXCESO) {
      exceso = p.existencia - diario * DIAS_COBERTURA_EXCESO; motivo = `Más de ${DIAS_COBERTURA_EXCESO} días de cobertura`;
    } else if (diario === 0) {
      exceso = p.existencia; motivo = `Sin ventas en ${DIAS_CONSUMO} días`;
    }
    if (motivo) {
      filas.push({
        codigo_interno: p.codigo_interno, descripcion: p.descripcion, existencia: p.existencia, stock_maximo: p.stock_maximo,
        consumo_diario: Math.round(diario * 100) / 100, dias_cobertura: diario > 0 ? Math.round(p.existencia / diario) : null,
        cantidad_exceso: Math.round(exceso * 100) / 100, valor_exceso: redondear(exceso * p.costo_promedio), motivo,
      });
    }
  }
  return filas.sort((a, b) => b.valor_exceso - a.valor_exceso);
}

// Rotación = costo de ventas ÷ inventario promedio del periodo (promedio entre el valor al
// inicio y al final), por producto o por categoría. Días de inventario = días del periodo ÷ rotación.
function rotacionInventario(db, { desde, hasta, agrupar = 'producto' } = {}) {
  session.requerirPermiso('inventario.costos.ver');
  const fin = dia(hasta) || hoyLocal();
  const inicio = dia(desde) || sumarDias(fin, -89);
  if (inicio > fin) throw new Error('La fecha inicial no puede ser posterior a la final');
  const dias = Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / 86400000) + 1;
  const antes = new Map(saldosAFecha(db, sumarDias(inicio, -1)).map((x) => [x.producto_id, x]));
  const despues = new Map(saldosAFecha(db, fin).map((x) => [x.producto_id, x]));
  const ini = new Date(Date.parse(`${inicio}T00:00:00-04:00`)).toISOString();
  const fi = finDelDiaUtc(fin);
  const costos = new Map(
    db
      .prepare(
        `SELECT d.producto_id, SUM(CASE WHEN v.tipo = 'factura' THEN d.cantidad * d.costo_unitario ELSE -d.cantidad * d.costo_unitario END) AS costo
         FROM documentos_venta_detalle d JOIN documentos_venta v ON v.id = d.documento_id
         WHERE v.tipo IN ('factura', 'nota_credito') AND v.estado != 'anulado' AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.fecha >= ? AND v.fecha <= ?
         GROUP BY d.producto_id`
      )
      .all(ini, fi)
      .map((r) => [r.producto_id, r.costo])
  );
  const grupos = new Map();
  for (const [id, a] of despues) {
    const clave = agrupar === 'categoria' ? (a.categoria_id || 'sin') : id;
    const g = grupos.get(clave) || { codigo_interno: agrupar === 'categoria' ? '' : a.codigo_interno, descripcion: agrupar === 'categoria' ? (a.categoria_nombre || 'Sin categoría') : a.descripcion, costo_ventas: 0, valor_inicial: 0, valor_final: 0 };
    g.costo_ventas += costos.get(id) || 0;
    g.valor_inicial += (antes.get(id) || { valor: 0 }).valor;
    g.valor_final += a.valor;
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .filter((g) => g.costo_ventas !== 0 || g.valor_inicial !== 0 || g.valor_final !== 0)
    .map((g) => {
      const promedio = (g.valor_inicial + g.valor_final) / 2;
      const rotacion = promedio > 0 ? g.costo_ventas / promedio : null;
      return {
        codigo_interno: g.codigo_interno, descripcion: g.descripcion, costo_ventas: redondear(g.costo_ventas), inventario_promedio: redondear(promedio),
        rotacion: rotacion === null ? null : Math.round(rotacion * 100) / 100, dias_inventario: rotacion ? Math.round(dias / rotacion) : null,
      };
    })
    .sort((a, b) => (a.rotacion ?? -1) - (b.rotacion ?? -1));
}

// Todos los movimientos de inventario con quién y cuándo, filtrables por fecha, tipo y producto.
function bitacoraMovimientos(db, { desde, hasta, tipo, productoId, limite = 500 } = {}) {
  session.requerirPermiso('inventario.ver');
  desde = dia(desde);
  hasta = dia(hasta);
  const cond = ['k.deleted_at IS NULL'];
  const params = [];
  if (desde) { cond.push('k.created_at >= ?'); params.push(new Date(Date.parse(`${desde}T00:00:00-04:00`)).toISOString()); }
  if (hasta) { cond.push('k.created_at <= ?'); params.push(finDelDiaUtc(hasta)); }
  if (tipo) { cond.push('k.tipo_movimiento = ?'); params.push(tipo); }
  if (productoId) { cond.push('k.producto_id = ?'); params.push(productoId); }
  params.push(Math.min(Number(limite) || 500, 5000));
  return db
    .prepare(
      `SELECT k.created_at AS fecha, p.codigo_interno, p.descripcion, a.nombre AS almacen_nombre, k.tipo_movimiento, k.cantidad,
              k.costo_unitario, k.saldo_cantidad, u.nombre_completo AS usuario_nombre, k.documento_origen_tipo
       FROM kardex_movimientos k JOIN productos p ON p.id = k.producto_id JOIN almacenes a ON a.id = k.almacen_id
       LEFT JOIN usuarios u ON u.id = k.usuario_id
       WHERE ${cond.join(' AND ')} ORDER BY k.created_at DESC, k.rowid DESC LIMIT ?`
    )
    .all(...params);
}

function register(ipcMain, getDb) {
  ipcMain.handle('reportesInv:valorizacion', (event, filtros) => valorizacionAFecha(getDb(), filtros || {}));
  ipcMain.handle('reportesInv:reposicion', () => reposicionSugerida(getDb()));
  ipcMain.handle('reportesInv:sobreStock', () => sobreStock(getDb()));
  ipcMain.handle('reportesInv:rotacion', (event, filtros) => rotacionInventario(getDb(), filtros || {}));
  ipcMain.handle('reportesInv:bitacora', (event, filtros) => bitacoraMovimientos(getDb(), filtros || {}));
}

module.exports = { register, valorizacionAFecha, reposicionSugerida, sobreStock, rotacionInventario, bitacoraMovimientos, saldosAFecha };
