const crypto = require('node:crypto');
const session = require('../auth/session');

let configuracion;
function auditoria() {
  if (!configuracion) configuracion = require('./configuracion');
  return configuracion;
}

function redondear(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// =========================================================================
// Catálogos
// =========================================================================

function listarCategorias(db) {
  return db.prepare('SELECT id, nombre FROM categorias_producto WHERE deleted_at IS NULL ORDER BY nombre').all();
}

function listarUnidadesMedida(db) {
  return db.prepare('SELECT id, nombre, abreviatura FROM unidades_medida ORDER BY nombre').all();
}

function listarTasasItbis(db) {
  return db.prepare('SELECT id, nombre, porcentaje, es_default FROM tasas_itbis WHERE deleted_at IS NULL AND activo = 1').all();
}

function listarAlmacenes(db) {
  return db.prepare('SELECT id, nombre, sucursal_id FROM almacenes WHERE deleted_at IS NULL AND activo = 1 ORDER BY nombre').all();
}

function crearAlmacen(db, { sucursalId, nombre }) {
  session.requerirPermiso('configuracion.gestionar');
  if (!nombre || !nombre.trim()) throw new Error('El nombre del almacén es obligatorio');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO almacenes (id, sucursal_id, nombre, activo) VALUES (?, ?, ?, 1)').run(id, sucursalId, nombre.trim());
  return { id, sucursal_id: sucursalId, nombre: nombre.trim() };
}

// =========================================================================
// Búsqueda / ficha de producto
// =========================================================================

function buscarProductos(db, { texto, almacenId, limite = 20 }) {
  const like = `%${texto}%`;
  return db
    .prepare(
      `SELECT p.id, p.codigo_interno, p.descripcion, p.precio_detalle, p.precio_mayorista,
              p.precio_distribuidor, p.costo_promedio, p.permite_venta_negativo, p.es_kit,
              p.controla_lote, p.tasa_itbis_id, t.porcentaje AS tasa_itbis_pct,
              COALESCE(e.cantidad_disponible, 0) AS cantidad_disponible,
              COALESCE(e.cantidad_comprometida, 0) AS cantidad_comprometida
       FROM productos p
       JOIN tasas_itbis t ON t.id = p.tasa_itbis_id
       LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = ?
       LEFT JOIN productos_codigos_barra b ON b.producto_id = p.id AND b.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.activo = 1
         AND (p.codigo_interno LIKE ? OR p.descripcion LIKE ? OR b.codigo_barra = ?)
       GROUP BY p.id
       ORDER BY p.descripcion
       LIMIT ?`
    )
    .all(almacenId, like, like, texto, limite);
}

function obtenerProducto(db, productoId, almacenId) {
  return db
    .prepare(
      `SELECT p.*, t.porcentaje AS tasa_itbis_pct,
              COALESCE(e.cantidad_disponible, 0) AS cantidad_disponible
       FROM productos p
       JOIN tasas_itbis t ON t.id = p.tasa_itbis_id
       LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = ?
       WHERE p.id = ? AND p.deleted_at IS NULL`
    )
    .get(almacenId, productoId);
}

// Ficha completa: producto + códigos de barra + unidades alternativas + componentes (si es kit)
// + existencia por cada almacén. Para la pantalla de edición.
function obtenerProductoCompleto(db, productoId) {
  const producto = db
    .prepare(
      `SELECT p.*, t.porcentaje AS tasa_itbis_pct, c.nombre AS categoria_nombre
       FROM productos p JOIN tasas_itbis t ON t.id = p.tasa_itbis_id
       LEFT JOIN categorias_producto c ON c.id = p.categoria_id
       WHERE p.id = ? AND p.deleted_at IS NULL`
    )
    .get(productoId);
  if (!producto) return null;

  producto.codigosBarra = db
    .prepare('SELECT * FROM productos_codigos_barra WHERE producto_id = ? AND deleted_at IS NULL')
    .all(productoId);
  producto.unidadesAlternativas = db
    .prepare(
      `SELECT pua.*, u.nombre AS unidad_nombre, u.abreviatura FROM productos_unidades_alternativas pua
       JOIN unidades_medida u ON u.id = pua.unidad_id WHERE pua.producto_id = ? AND pua.deleted_at IS NULL`
    )
    .all(productoId);
  if (producto.es_kit) {
    producto.componentes = db
      .prepare(
        `SELECT kc.*, p.descripcion, p.codigo_interno FROM kits_componentes kc
         JOIN productos p ON p.id = kc.componente_producto_id
         WHERE kc.kit_producto_id = ? AND kc.deleted_at IS NULL`
      )
      .all(productoId);
  }
  producto.existencias = db
    .prepare(
      `SELECT e.almacen_id, a.nombre AS almacen_nombre, e.cantidad_disponible, e.cantidad_comprometida
       FROM existencias e JOIN almacenes a ON a.id = e.almacen_id WHERE e.producto_id = ?`
    )
    .all(productoId);

  return producto;
}

function listarProductos(db, { texto = '', soloActivos = true, limite = 100 } = {}) {
  const like = `%${texto}%`;
  const condiciones = ['p.deleted_at IS NULL', '(p.codigo_interno LIKE ? OR p.descripcion LIKE ?)'];
  if (soloActivos) condiciones.push('p.activo = 1');
  const filas = db
    .prepare(
      `SELECT p.id, p.codigo_interno, p.descripcion, p.precio_detalle, p.costo_promedio,
              p.activo, p.es_kit, p.controla_lote, p.stock_minimo, c.nombre AS categoria_nombre,
              COALESCE((SELECT SUM(e.cantidad_disponible) FROM existencias e WHERE e.producto_id = p.id), 0) AS existencia_total
       FROM productos p LEFT JOIN categorias_producto c ON c.id = p.categoria_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY p.descripcion LIMIT ?`
    )
    .all(like, like, limite);

  // El costo es información sensible (spec: "no ve costos de producto" para el Cajero) —
  // se oculta en la respuesta si la sesión activa no tiene permiso para verlo.
  if (!session.tienePermiso('inventario.costos.ver')) {
    filas.forEach((f) => { f.costo_promedio = null; });
  }
  return filas;
}

function guardarProducto(db, payload, productoIdExistente) {
  session.requerirPermiso(productoIdExistente ? 'inventario.producto.editar' : 'inventario.producto.crear');
  const {
    codigoInterno, descripcion, categoriaId, unidadMedidaBaseId, tasaItbisId,
    precioDetalle, precioMayorista, precioDistribuidor, costoPromedio,
    metodoValoracion, esKit, permiteVentaNegativo, controlaLote, stockMinimo, stockMaximo,
    diasAlertaVencimiento, activo, codigosBarra, unidadesAlternativas, componentes,
  } = payload;

  if (!codigoInterno || !codigoInterno.trim()) throw new Error('El código interno es obligatorio');
  if (!descripcion || !descripcion.trim()) throw new Error('La descripción es obligatoria');
  if (!unidadMedidaBaseId) throw new Error('La unidad de medida base es obligatoria');
  if (!tasaItbisId) throw new Error('La tasa de ITBIS es obligatoria');

  const productoId = productoIdExistente || crypto.randomUUID();

  if (productoIdExistente) {
    db.prepare(
      `UPDATE productos SET codigo_interno = ?, descripcion = ?, categoria_id = ?, unidad_medida_base_id = ?,
         tasa_itbis_id = ?, precio_detalle = ?, precio_mayorista = ?, precio_distribuidor = ?,
         metodo_valoracion = ?, es_kit = ?, permite_venta_negativo = ?, controla_lote = ?,
         stock_minimo = ?, stock_maximo = ?, dias_alerta_vencimiento = ?, activo = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    ).run(
      codigoInterno.trim(), descripcion.trim(), categoriaId || null, unidadMedidaBaseId, tasaItbisId,
      precioDetalle || 0, precioMayorista || 0, precioDistribuidor || 0,
      metodoValoracion || 'promedio_ponderado', esKit ? 1 : 0, permiteVentaNegativo ? 1 : 0,
      controlaLote ? 1 : 0, stockMinimo || 0, stockMaximo || null, diasAlertaVencimiento || null,
      activo === false ? 0 : 1, productoId
    );
  } else {
    db.prepare(
      `INSERT INTO productos
         (id, codigo_interno, descripcion, categoria_id, unidad_medida_base_id, tasa_itbis_id,
          precio_detalle, precio_mayorista, precio_distribuidor, costo_promedio, metodo_valoracion,
          es_kit, permite_venta_negativo, controla_lote, stock_minimo, stock_maximo, dias_alerta_vencimiento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      productoId, codigoInterno.trim(), descripcion.trim(), categoriaId || null, unidadMedidaBaseId, tasaItbisId,
      precioDetalle || 0, precioMayorista || 0, precioDistribuidor || 0, costoPromedio || 0,
      metodoValoracion || 'promedio_ponderado', esKit ? 1 : 0, permiteVentaNegativo ? 1 : 0,
      controlaLote ? 1 : 0, stockMinimo || 0, stockMaximo || null, diasAlertaVencimiento || null
    );
  }

  // Códigos de barra: se reemplaza el set completo (borrado lógico de los que ya no vienen).
  if (codigosBarra) {
    db.prepare('UPDATE productos_codigos_barra SET deleted_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE producto_id = ?').run(productoId);
    const insertCodigo = db.prepare(
      `INSERT INTO productos_codigos_barra (id, producto_id, codigo_barra, presentacion, factor_conversion)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const c of codigosBarra) {
      if (!c.codigoBarra) continue;
      insertCodigo.run(crypto.randomUUID(), productoId, c.codigoBarra, c.presentacion || 'unidad', c.factorConversion || 1);
    }
  }

  if (unidadesAlternativas) {
    db.prepare('UPDATE productos_unidades_alternativas SET deleted_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE producto_id = ?').run(productoId);
    const insertUnidad = db.prepare(
      `INSERT INTO productos_unidades_alternativas (id, producto_id, unidad_id, factor_conversion) VALUES (?, ?, ?, ?)`
    );
    for (const u of unidadesAlternativas) {
      if (!u.unidadId) continue;
      insertUnidad.run(crypto.randomUUID(), productoId, u.unidadId, u.factorConversion || 1);
    }
  }

  if (esKit && componentes) {
    db.prepare('UPDATE kits_componentes SET deleted_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE kit_producto_id = ?').run(productoId);
    const insertComponente = db.prepare(
      `INSERT INTO kits_componentes (id, kit_producto_id, componente_producto_id, cantidad) VALUES (?, ?, ?, ?)`
    );
    for (const c of componentes) {
      if (!c.componenteProductoId || !c.cantidad) continue;
      insertComponente.run(crypto.randomUUID(), productoId, c.componenteProductoId, c.cantidad);
    }
  }

  return productoId;
}

// =========================================================================
// Existencias y kardex
// =========================================================================

function existenciaDisponible(db, productoId, almacenId) {
  const row = db
    .prepare('SELECT cantidad_disponible FROM existencias WHERE producto_id = ? AND almacen_id = ?')
    .get(productoId, almacenId);
  return row ? row.cantidad_disponible : 0;
}

function componentesKit(db, kitProductoId) {
  return db
    .prepare('SELECT componente_producto_id, cantidad FROM kits_componentes WHERE kit_producto_id = ? AND deleted_at IS NULL')
    .all(kitProductoId);
}

// Cuántos kits se pueden armar hoy según la existencia de sus componentes.
function existenciaDisponibleParaVenta(db, producto, almacenId) {
  if (!producto.es_kit) return existenciaDisponible(db, producto.id, almacenId);
  const componentes = componentesKit(db, producto.id);
  if (componentes.length === 0) return 0;
  return Math.min(...componentes.map((c) => Math.floor(existenciaDisponible(db, c.componente_producto_id, almacenId) / c.cantidad)));
}

// Costo de una unidad vendida: para un producto normal es su costo_promedio; para un kit,
// la suma del costo de sus componentes.
function costoUnitarioVenta(db, producto) {
  if (!producto.es_kit) return producto.costo_promedio;
  const componentes = componentesKit(db, producto.id);
  return redondear(
    componentes.reduce((acc, c) => {
      const comp = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(c.componente_producto_id);
      return acc + (comp ? comp.costo_promedio * c.cantidad : 0);
    }, 0)
  );
}

// Registra un movimiento de kardex y actualiza la existencia consolidada.
// cantidad: positiva = entrada, negativa = salida. Debe llamarse dentro de una transacción.
function registrarMovimientoInventario(db, {
  productoId, almacenId, loteId = null, tipoMovimiento, cantidad, costoUnitario,
  documentoOrigenTipo, documentoOrigenId, usuarioId,
}) {
  const existenciaActual = existenciaDisponible(db, productoId, almacenId);
  const saldoCantidad = existenciaActual + cantidad;

  db.prepare(
    `INSERT INTO kardex_movimientos
       (id, producto_id, almacen_id, lote_id, tipo_movimiento, documento_origen_tipo,
        documento_origen_id, cantidad, costo_unitario, saldo_cantidad, saldo_costo, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(), productoId, almacenId, loteId, tipoMovimiento, documentoOrigenTipo,
    documentoOrigenId, cantidad, costoUnitario, saldoCantidad, costoUnitario, usuarioId
  );

  const existeFila = db.prepare('SELECT 1 FROM existencias WHERE producto_id = ? AND almacen_id = ?').get(productoId, almacenId);
  if (existeFila) {
    db.prepare(
      `UPDATE existencias SET cantidad_disponible = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE producto_id = ? AND almacen_id = ?`
    ).run(saldoCantidad, productoId, almacenId);
  } else {
    db.prepare(
      `INSERT INTO existencias (id, producto_id, almacen_id, cantidad_disponible, cantidad_comprometida)
       VALUES (?, ?, ?, ?, 0)`
    ).run(crypto.randomUUID(), productoId, almacenId, saldoCantidad);
  }

  // Recalcula el costo promedio ponderado del producto cuando entra mercancía con costo propio.
  if (cantidad > 0 && costoUnitario > 0) {
    const producto = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(productoId);
    if (producto && producto.metodo_valoracion !== 'peps') {
      const existenciaTotal = db.prepare('SELECT COALESCE(SUM(cantidad_disponible),0) AS total FROM existencias WHERE producto_id = ?').get(productoId).total;
      const costoActual = producto.costo_promedio || 0;
      const existenciaPrevia = existenciaTotal - cantidad;
      const nuevoPromedio = existenciaTotal > 0
        ? redondear(((costoActual * existenciaPrevia) + (costoUnitario * cantidad)) / existenciaTotal)
        : costoUnitario;
      db.prepare("UPDATE productos SET costo_promedio = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(nuevoPromedio, productoId);
    }
  }

  return saldoCantidad;
}

// Vende (o revierte una venta de) un producto, resolviendo automáticamente los componentes si es un kit.
function moverInventarioPorVenta(db, { producto, almacenId, cantidad, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
  if (producto.es_kit) {
    for (const c of componentesKit(db, producto.id)) {
      const comp = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(c.componente_producto_id);
      registrarMovimientoInventario(db, {
        productoId: c.componente_producto_id, almacenId, tipoMovimiento: cantidad < 0 ? 'salida_venta' : 'ajuste_entrada',
        cantidad: cantidad * c.cantidad, costoUnitario: comp.costo_promedio,
        documentoOrigenTipo, documentoOrigenId, usuarioId,
      });
    }
  } else {
    registrarMovimientoInventario(db, {
      productoId: producto.id, almacenId, tipoMovimiento: cantidad < 0 ? 'salida_venta' : 'ajuste_entrada',
      cantidad, costoUnitario: producto.costo_promedio, documentoOrigenTipo, documentoOrigenId, usuarioId,
    });
  }
}

function kardexPorProducto(db, { productoId, almacenId, desde, hasta, limite = 200 }) {
  const condiciones = ['k.producto_id = ?'];
  const params = [productoId];
  if (almacenId) { condiciones.push('k.almacen_id = ?'); params.push(almacenId); }
  if (desde) { condiciones.push('k.created_at >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('k.created_at <= ?'); params.push(hasta); }
  params.push(limite);
  return db
    .prepare(
      `SELECT k.*, a.nombre AS almacen_nombre, u.nombre_completo AS usuario_nombre
       FROM kardex_movimientos k JOIN almacenes a ON a.id = k.almacen_id
       LEFT JOIN usuarios u ON u.id = k.usuario_id
       WHERE ${condiciones.join(' AND ')} ORDER BY k.created_at DESC LIMIT ?`
    )
    .all(...params);
}

function existenciasConsolidadas(db, { almacenId, soloBajoMinimo = false } = {}) {
  const condiciones = ['p.deleted_at IS NULL', 'p.activo = 1', 'p.es_kit = 0'];
  const params = [];
  let joinAlmacen = 'LEFT JOIN existencias e ON e.producto_id = p.id';
  if (almacenId) { joinAlmacen += ' AND e.almacen_id = ?'; params.push(almacenId); }

  const sql = `
    SELECT p.id, p.codigo_interno, p.descripcion, p.stock_minimo, p.stock_maximo, p.costo_promedio,
           COALESCE(SUM(e.cantidad_disponible), 0) AS existencia_total,
           COALESCE(SUM(e.cantidad_comprometida), 0) AS comprometida_total
    FROM productos p ${joinAlmacen}
    WHERE ${condiciones.join(' AND ')}
    GROUP BY p.id
    ${soloBajoMinimo ? 'HAVING existencia_total <= p.stock_minimo' : ''}
    ORDER BY p.descripcion`;
  return db.prepare(sql).all(...params);
}

function productosPorVencer(db, { diasDefault = 30 } = {}) {
  return db
    .prepare(
      `SELECT l.*, p.descripcion, p.codigo_interno, a.nombre AS almacen_nombre,
              CAST(julianday(l.fecha_vencimiento) - julianday('now') AS INTEGER) AS dias_restantes
       FROM lotes l JOIN productos p ON p.id = l.producto_id JOIN almacenes a ON a.id = l.almacen_id
       WHERE l.deleted_at IS NULL AND l.cantidad > 0 AND l.fecha_vencimiento IS NOT NULL
         AND julianday(l.fecha_vencimiento) - julianday('now') <= COALESCE(p.dias_alerta_vencimiento, ?)
       ORDER BY l.fecha_vencimiento ASC`
    )
    .all(diasDefault);
}

// =========================================================================
// Ajustes de inventario (entrada / salida manual)
// =========================================================================

function siguienteNumeroDocumento(db, tabla) {
  const row = db.prepare(`SELECT MAX(CAST(numero AS INTEGER)) AS maximo FROM ${tabla}`).get();
  return String((row.maximo || 0) + 1).padStart(6, '0');
}

function crearAjuste(db, { almacenId, tipo, motivo, motivoDetalle, lineas, usuarioId }) {
  session.requerirPermiso('inventario.ajuste.crear');
  if (!lineas || lineas.length === 0) throw new Error('El ajuste debe tener al menos una línea');
  if (!motivo) throw new Error('El motivo del ajuste es obligatorio');

  const ajusteId = crypto.randomUUID();
  const numero = siguienteNumeroDocumento(db, 'ajustes_inventario');
  db.prepare(
    `INSERT INTO ajustes_inventario (id, numero, almacen_id, tipo, motivo, motivo_detalle, fecha, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(ajusteId, numero, almacenId, tipo, motivo, motivoDetalle || null, usuarioId);

  const insertDetalle = db.prepare(
    `INSERT INTO ajustes_inventario_detalle (id, ajuste_id, producto_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?, ?)`
  );
  for (const l of lineas) {
    const producto = obtenerProducto(db, l.productoId, almacenId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
    const costoUnitario = l.costoUnitario ?? producto.costo_promedio;
    const cantidadFirmada = tipo === 'salida' ? -Math.abs(l.cantidad) : Math.abs(l.cantidad);

    if (tipo === 'salida' && !producto.permite_venta_negativo) {
      const disponible = existenciaDisponible(db, l.productoId, almacenId);
      if (disponible < Math.abs(l.cantidad)) {
        throw new Error(`Existencia insuficiente de "${producto.descripcion}" para el ajuste de salida (disponible: ${disponible})`);
      }
    }

    insertDetalle.run(crypto.randomUUID(), ajusteId, l.productoId, cantidadFirmada, costoUnitario);
    registrarMovimientoInventario(db, {
      productoId: l.productoId, almacenId, tipoMovimiento: tipo === 'salida' ? 'ajuste_salida' : 'ajuste_entrada',
      cantidad: cantidadFirmada, costoUnitario, documentoOrigenTipo: 'ajustes_inventario',
      documentoOrigenId: ajusteId, usuarioId,
    });
  }

  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'inventario', entidad: 'ajustes_inventario', entidadId: ajusteId, accion: 'crear', detalle: { numero, tipo, motivo } });
  return ajusteId;
}

function listarAjustes(db, { limite = 50 } = {}) {
  return db
    .prepare(
      `SELECT a.*, al.nombre AS almacen_nombre, u.nombre_completo AS usuario_nombre
       FROM ajustes_inventario a JOIN almacenes al ON al.id = a.almacen_id
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.fecha DESC LIMIT ?`
    )
    .all(limite);
}

// =========================================================================
// Mermas y averías
// =========================================================================

function crearMerma(db, { almacenId, productoId, cantidad, costoUnitario, motivo, usuarioId }) {
  session.requerirPermiso('inventario.merma.crear');
  if (!motivo) throw new Error('El motivo de la merma es obligatorio');
  const producto = obtenerProducto(db, productoId, almacenId);
  if (!producto) throw new Error('Producto no encontrado');
  const disponible = existenciaDisponible(db, productoId, almacenId);
  if (disponible < cantidad) throw new Error(`Existencia insuficiente de "${producto.descripcion}" para registrar la merma`);

  const mermaId = crypto.randomUUID();
  const numero = siguienteNumeroDocumento(db, 'mermas_averias');
  const costo = costoUnitario ?? producto.costo_promedio;
  db.prepare(
    `INSERT INTO mermas_averias (id, numero, almacen_id, producto_id, cantidad, costo_unitario, motivo, fecha, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(mermaId, numero, almacenId, productoId, cantidad, costo, motivo, usuarioId);

  registrarMovimientoInventario(db, {
    productoId, almacenId, tipoMovimiento: 'merma', cantidad: -Math.abs(cantidad), costoUnitario: costo,
    documentoOrigenTipo: 'mermas_averias', documentoOrigenId: mermaId, usuarioId,
  });

  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'inventario', entidad: 'mermas_averias', entidadId: mermaId, accion: 'crear', detalle: { numero, motivo, cantidad } });
  return mermaId;
}

function listarMermas(db, { limite = 50 } = {}) {
  return db
    .prepare(
      `SELECT m.*, p.descripcion AS producto_descripcion, al.nombre AS almacen_nombre
       FROM mermas_averias m JOIN productos p ON p.id = m.producto_id JOIN almacenes al ON al.id = m.almacen_id
       ORDER BY m.fecha DESC LIMIT ?`
    )
    .all(limite);
}

// =========================================================================
// Transferencias entre almacenes
// =========================================================================

function crearTransferencia(db, { almacenOrigenId, almacenDestinoId, lineas, usuarioId }) {
  session.requerirPermiso('inventario.transferencia.crear');
  if (almacenOrigenId === almacenDestinoId) throw new Error('El almacén de origen y destino no pueden ser el mismo');
  if (!lineas || lineas.length === 0) throw new Error('La transferencia debe tener al menos una línea');

  const transferenciaId = crypto.randomUUID();
  const numero = siguienteNumeroDocumento(db, 'transferencias_almacen');
  db.prepare(
    `INSERT INTO transferencias_almacen (id, numero, almacen_origen_id, almacen_destino_id, fecha, usuario_id)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(transferenciaId, numero, almacenOrigenId, almacenDestinoId, usuarioId);

  const insertDetalle = db.prepare(
    `INSERT INTO transferencias_almacen_detalle (id, transferencia_id, producto_id, cantidad) VALUES (?, ?, ?, ?)`
  );
  for (const l of lineas) {
    const producto = obtenerProducto(db, l.productoId, almacenOrigenId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
    const disponible = existenciaDisponible(db, l.productoId, almacenOrigenId);
    if (disponible < l.cantidad) {
      throw new Error(`Existencia insuficiente de "${producto.descripcion}" en el almacén de origen (disponible: ${disponible})`);
    }

    insertDetalle.run(crypto.randomUUID(), transferenciaId, l.productoId, l.cantidad);
    registrarMovimientoInventario(db, {
      productoId: l.productoId, almacenId: almacenOrigenId, tipoMovimiento: 'transferencia_salida',
      cantidad: -l.cantidad, costoUnitario: producto.costo_promedio, documentoOrigenTipo: 'transferencias_almacen',
      documentoOrigenId: transferenciaId, usuarioId,
    });
    registrarMovimientoInventario(db, {
      productoId: l.productoId, almacenId: almacenDestinoId, tipoMovimiento: 'transferencia_entrada',
      cantidad: l.cantidad, costoUnitario: producto.costo_promedio, documentoOrigenTipo: 'transferencias_almacen',
      documentoOrigenId: transferenciaId, usuarioId,
    });
  }

  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'inventario', entidad: 'transferencias_almacen', entidadId: transferenciaId, accion: 'crear', detalle: { numero } });
  return transferenciaId;
}

function listarTransferencias(db, { limite = 50 } = {}) {
  return db
    .prepare(
      `SELECT t.*, ao.nombre AS almacen_origen_nombre, ad.nombre AS almacen_destino_nombre, u.nombre_completo AS usuario_nombre
       FROM transferencias_almacen t
       JOIN almacenes ao ON ao.id = t.almacen_origen_id JOIN almacenes ad ON ad.id = t.almacen_destino_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
       ORDER BY t.fecha DESC LIMIT ?`
    )
    .all(limite);
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('productos:buscar', (event, { texto, almacenId, limite }) => buscarProductos(getDb(), { texto: texto || '', almacenId, limite }));
  ipcMain.handle('productos:obtener', (event, { productoId, almacenId }) => obtenerProducto(getDb(), productoId, almacenId));
  ipcMain.handle('productos:obtenerCompleto', (event, { productoId }) => obtenerProductoCompleto(getDb(), productoId));
  ipcMain.handle('productos:listar', (event, filtros) => listarProductos(getDb(), filtros || {}));
  ipcMain.handle('productos:guardar', (event, { productoId, payload }) => {
    const db = getDb();
    const id = db.transaction(() => guardarProducto(db, payload, productoId))();
    return obtenerProductoCompleto(db, id);
  });

  ipcMain.handle('inventario:categorias', () => listarCategorias(getDb()));
  ipcMain.handle('inventario:unidadesMedida', () => listarUnidadesMedida(getDb()));
  ipcMain.handle('inventario:tasasItbis', () => listarTasasItbis(getDb()));
  ipcMain.handle('almacenes:listar', () => listarAlmacenes(getDb()));
  ipcMain.handle('almacenes:crear', (event, payload) => crearAlmacen(getDb(), payload));

  ipcMain.handle('inventario:existencias', (event, filtros) => existenciasConsolidadas(getDb(), filtros || {}));
  ipcMain.handle('inventario:kardex', (event, filtros) => kardexPorProducto(getDb(), filtros));
  ipcMain.handle('inventario:vencimientos', () => productosPorVencer(getDb()));

  ipcMain.handle('inventario:crearAjuste', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearAjuste(db, payload))();
  });
  ipcMain.handle('inventario:listarAjustes', (event, filtros) => listarAjustes(getDb(), filtros || {}));

  ipcMain.handle('inventario:crearMerma', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearMerma(db, payload))();
  });
  ipcMain.handle('inventario:listarMermas', (event, filtros) => listarMermas(getDb(), filtros || {}));

  ipcMain.handle('inventario:crearTransferencia', (event, payload) => {
    const db = getDb();
    return db.transaction(() => crearTransferencia(db, payload))();
  });
  ipcMain.handle('inventario:listarTransferencias', (event, filtros) => listarTransferencias(getDb(), filtros || {}));
}

module.exports = {
  register, buscarProductos, obtenerProducto, obtenerProductoCompleto, listarProductos, guardarProducto,
  existenciaDisponible, existenciaDisponibleParaVenta, costoUnitarioVenta, registrarMovimientoInventario,
  moverInventarioPorVenta, kardexPorProducto, existenciasConsolidadas, productosPorVencer,
  listarCategorias, listarUnidadesMedida, listarTasasItbis, listarAlmacenes, crearAlmacen,
  crearAjuste, listarAjustes, crearMerma, listarMermas, crearTransferencia, listarTransferencias,
};
