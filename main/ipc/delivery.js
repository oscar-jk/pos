// Delivery (Módulo 1): facturas con entrega a domicilio, su repartidor, dirección, zona y tiempo
// estimado, y el avance pendiente → en ruta → entregado. El reporte de tiempos mide desde la
// factura hasta la entrega, por repartidor y por zona.
const session = require('../auth/session');
const configuracion = require('./configuracion');

const ahora = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const SIGUIENTE = { pendiente: 'en_ruta', en_ruta: 'entregado' };
const ETIQUETA = { pendiente: 'Pendiente', en_ruta: 'En ruta', entregado: 'Entregado' };

// Valida y normaliza los datos de entrega que llegan con la factura.
function datosEntrega(db, { esDelivery, direccionEntrega, repartidorId, zonaEntrega, tiempoEstimadoMin }) {
  if (!esDelivery) return { esDelivery: false };
  const direccion = String(direccionEntrega || '').trim();
  if (!direccion) throw new Error('El delivery requiere la dirección de entrega');
  if (repartidorId && !db.prepare('SELECT 1 FROM usuarios WHERE id = ? AND activo = 1 AND deleted_at IS NULL').get(repartidorId)) {
    throw new Error('El repartidor no existe o está inactivo');
  }
  const minutos = tiempoEstimadoMin === undefined || tiempoEstimadoMin === null || tiempoEstimadoMin === '' ? null : Number(tiempoEstimadoMin);
  if (minutos !== null && (!Number.isInteger(minutos) || minutos <= 0 || minutos > 1440)) throw new Error('El tiempo estimado debe ser de 1 a 1440 minutos');
  return { esDelivery: true, direccion, repartidorId: repartidorId || null, zona: String(zonaEntrega || '').trim() || null, minutos };
}

function listarRepartidores(db) {
  session.requerirPermiso('ventas.factura.crear');
  return db.prepare('SELECT id, nombre_completo FROM usuarios WHERE activo = 1 AND deleted_at IS NULL ORDER BY nombre_completo').all();
}

function listarDeliveries(db, { estado, repartidorId, limite = 200 } = {}) {
  session.requerirPermiso('ventas.delivery.gestionar');
  const condiciones = ["dv.tipo = 'factura'", 'dv.es_delivery = 1', "dv.estado != 'anulado'", 'dv.deleted_at IS NULL'];
  const params = [];
  if (estado === 'activos') condiciones.push("dv.estado_delivery IN ('pendiente', 'en_ruta')");
  else if (estado) { condiciones.push('dv.estado_delivery = ?'); params.push(estado); }
  if (repartidorId) { condiciones.push('dv.repartidor_id = ?'); params.push(repartidorId); }
  params.push(limite);
  return db.prepare(
    `SELECT dv.id, dv.numero, dv.fecha, dv.total, dv.direccion_entrega, dv.zona_entrega, dv.tiempo_estimado_min, dv.estado_delivery,
            dv.fecha_en_ruta, dv.fecha_entrega_real, dv.repartidor_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
            r.nombre_completo AS repartidor_nombre
     FROM documentos_venta dv LEFT JOIN clientes c ON c.id = dv.cliente_id LEFT JOIN usuarios r ON r.id = dv.repartidor_id
     WHERE ${condiciones.join(' AND ')} ORDER BY CASE dv.estado_delivery WHEN 'pendiente' THEN 0 WHEN 'en_ruta' THEN 1 ELSE 2 END, dv.fecha DESC LIMIT ?`
  ).all(...params).map((d) => ({ ...d, estado_texto: ETIQUETA[d.estado_delivery] || d.estado_delivery }));
}

// Avanza el delivery un paso. Al salir a ruta puede asignarse (o cambiarse) el repartidor.
function avanzarDelivery(db, { documentoId, repartidorId, usuarioId }) {
  session.requerirPermiso('ventas.delivery.gestionar');
  const d = db.prepare("SELECT * FROM documentos_venta WHERE id = ? AND tipo = 'factura' AND deleted_at IS NULL").get(documentoId);
  if (!d || !d.es_delivery) throw new Error('La factura no es de delivery');
  if (d.estado === 'anulado') throw new Error('La factura está anulada');
  const nuevo = SIGUIENTE[d.estado_delivery];
  if (!nuevo) throw new Error('El delivery ya fue entregado');
  const repartidor = repartidorId || d.repartidor_id;
  if (nuevo === 'en_ruta' && !repartidor) throw new Error('Asigna el repartidor antes de enviarlo a ruta');
  if (repartidorId && !db.prepare('SELECT 1 FROM usuarios WHERE id = ? AND activo = 1 AND deleted_at IS NULL').get(repartidorId)) {
    throw new Error('El repartidor no existe o está inactivo');
  }
  db.prepare(
    `UPDATE documentos_venta SET estado_delivery = ?, repartidor_id = ?,
       fecha_en_ruta = CASE WHEN ? = 'en_ruta' THEN ${ahora} ELSE fecha_en_ruta END,
       fecha_entrega_real = CASE WHEN ? = 'entregado' THEN ${ahora} ELSE fecha_entrega_real END,
       updated_at = ${ahora} WHERE id = ?`
  ).run(nuevo, repartidor || null, nuevo, nuevo, documentoId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'ventas', entidad: 'documentos_venta', entidadId: documentoId, accion: 'delivery', detalle: { numero: d.numero, estado: nuevo } });
  return nuevo;
}

// Tiempo de entrega: minutos entre la factura y la entrega, por repartidor y por zona, con la
// parte entregada dentro del tiempo estimado (cuando se indicó).
function reporteTiempoEntrega(db, { desde, hasta } = {}) {
  session.requerirPermiso('ventas.delivery.gestionar');
  const condiciones = ["dv.tipo = 'factura'", 'dv.es_delivery = 1', "dv.estado != 'anulado'", "dv.estado_delivery = 'entregado'", 'dv.deleted_at IS NULL'];
  const params = [];
  if (desde) { condiciones.push('dv.fecha >= ?'); params.push(`${String(desde).slice(0, 10)}T04:00:00.000Z`); }
  if (hasta) { condiciones.push('dv.fecha < ?'); params.push(new Date(Date.parse(`${String(hasta).slice(0, 10)}T04:00:00.000Z`) + 86400000).toISOString()); }
  const filas = db.prepare(
    `SELECT dv.numero, dv.fecha, dv.fecha_entrega_real, dv.tiempo_estimado_min, dv.zona_entrega, dv.repartidor_id,
            COALESCE(r.nombre_completo, 'Sin repartidor') AS repartidor_nombre
     FROM documentos_venta dv LEFT JOIN usuarios r ON r.id = dv.repartidor_id WHERE ${condiciones.join(' AND ')} ORDER BY dv.fecha DESC`
  ).all(...params).map((f) => {
    const minutos = Math.max(0, Math.round((Date.parse(f.fecha_entrega_real) - Date.parse(f.fecha)) / 60000));
    return { ...f, minutos, a_tiempo: f.tiempo_estimado_min ? minutos <= f.tiempo_estimado_min : null };
  });
  const agrupar = (clave, etiqueta) => {
    const g = new Map();
    for (const f of filas) {
      const k = f[clave] || 'sin';
      if (!g.has(k)) g.set(k, { nombre: f[etiqueta] || 'Sin zona', entregas: 0, minutos: 0, conEstimado: 0, aTiempo: 0 });
      const e = g.get(k);
      e.entregas += 1; e.minutos += f.minutos;
      if (f.a_tiempo !== null) { e.conEstimado += 1; if (f.a_tiempo) e.aTiempo += 1; }
    }
    return [...g.values()].map((e) => ({
      nombre: e.nombre, entregas: e.entregas, promedioMin: redondear(e.minutos / e.entregas),
      pctATiempo: e.conEstimado ? redondear((e.aTiempo / e.conEstimado) * 100) : null,
    })).sort((a, b) => a.promedioMin - b.promedioMin);
  };
  return {
    entregas: filas.length,
    promedioMin: filas.length ? redondear(filas.reduce((a, f) => a + f.minutos, 0) / filas.length) : 0,
    porRepartidor: agrupar('repartidor_id', 'repartidor_nombre'),
    porZona: agrupar('zona_entrega', 'zona_entrega'),
    filas,
  };
}

function register(ipcMain, getDb) {
  ipcMain.handle('delivery:repartidores', () => listarRepartidores(getDb()));
  ipcMain.handle('delivery:listar', (event, filtros) => listarDeliveries(getDb(), filtros || {}));
  ipcMain.handle('delivery:avanzar', (event, payload) => {
    const db = getDb();
    return db.transaction(() => avanzarDelivery(db, payload || {}))();
  });
  ipcMain.handle('delivery:reporteTiempos', (event, filtros) => reporteTiempoEntrega(getDb(), filtros || {}));
}

module.exports = { register, datosEntrega, listarRepartidores, listarDeliveries, avanzarDelivery, reporteTiempoEntrega };
