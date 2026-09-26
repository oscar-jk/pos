const crypto = require('node:crypto');
const session = require('../auth/session');
const contabilidad = require('./contabilidad');

// Ajustes y mermas: la diferencia con el inventario físico va a gasto, separada por causa.
const CUENTA_INVENTARIO = '1300';
const CUENTA_MERMAS = '6200';
const CUENTA_DIFERENCIAS_INVENTARIO = '6300';

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

function crearCategoria(db, { nombre }) {
  session.requerirAlgunPermiso('inventario.producto.crear', 'inventario.producto.editar');
  const limpio = String(nombre || '').trim();
  if (!limpio) throw new Error('El nombre de la categoría es obligatorio');
  const existente = db.prepare('SELECT id, nombre FROM categorias_producto WHERE deleted_at IS NULL AND lower(nombre) = lower(?)').get(limpio);
  if (existente) return existente;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO categorias_producto (id, nombre) VALUES (?, ?)').run(id, limpio);
  return { id, nombre: limpio };
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

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Promoción vigente hoy para el producto (propia o de su categoría). Si hay varias, la que más
// descuenta sobre el precio de detalle. Devuelve { id, nombre, tipo_descuento, valor } o null.
function promocionVigente(db, producto, fecha = hoyLocal()) {
  const candidatas = db
    .prepare(
      `SELECT id, nombre, tipo_descuento, valor, fecha_fin FROM promociones
       WHERE deleted_at IS NULL AND activo = 1 AND fecha_inicio <= ? AND fecha_fin >= ?
         AND (producto_id = ? OR (categoria_id IS NOT NULL AND categoria_id = ?))`
    )
    .all(fecha, fecha, producto.id, producto.categoria_id || '');
  const descuentoUnitario = (p) => (p.tipo_descuento === 'porcentaje' ? (producto.precio_detalle || 0) * p.valor / 100 : p.valor);
  return candidatas.sort((a, b) => descuentoUnitario(b) - descuentoUnitario(a))[0] || null;
}

function conPromocion(db, producto) {
  if (producto) producto.promocion = promocionVigente(db, producto);
  return producto;
}

function buscarProductos(db, { texto, almacenId, limite = 20 }) {
  const like = `%${texto}%`;
  return db
    .prepare(
      `SELECT p.id, p.codigo_interno, p.descripcion, p.categoria_id, p.precio_detalle, p.precio_mayorista,
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
    .all(almacenId, like, like, texto, limite)
    .map((p) => ocultarCostoSinPermiso(conPromocion(db, p)));
}

// Consulta rápida de precio y existencia (mostrador): los tres precios, la promoción vigente y
// la existencia de cada almacén, disponible real = existencia − comprometida en pedidos.
function consultarPrecio(db, { texto, limite = 8 }) {
  if (!session.obtenerSesion()) throw new Error('Inicie sesión para consultar precios');
  if (!texto || !texto.trim()) return [];
  const existencias = db.prepare(
    `SELECT a.nombre AS almacen_nombre, COALESCE(e.cantidad_disponible, 0) AS existencia, COALESCE(e.cantidad_comprometida, 0) AS comprometida
     FROM almacenes a LEFT JOIN existencias e ON e.almacen_id = a.id AND e.producto_id = ?
     WHERE a.deleted_at IS NULL AND a.activo = 1 ORDER BY a.nombre`
  );
  return buscarProductos(db, { texto: texto.trim(), almacenId: null, limite }).map((p) => {
    const porAlmacen = p.es_kit ? [] : existencias.all(p.id).map((e) => ({ ...e, disponible: e.existencia - e.comprometida }));
    const precioPromocion = p.promocion
      ? redondear(p.promocion.tipo_descuento === 'porcentaje' ? p.precio_detalle * (1 - p.promocion.valor / 100) : Math.max(0, p.precio_detalle - p.promocion.valor))
      : null;
    return {
      id: p.id, codigo_interno: p.codigo_interno, descripcion: p.descripcion, es_kit: p.es_kit,
      precio_detalle: p.precio_detalle, precio_mayorista: p.precio_mayorista, precio_distribuidor: p.precio_distribuidor,
      promocion: p.promocion, precio_promocion: precioPromocion, existencias: porAlmacen,
      disponible_total: p.es_kit ? null : porAlmacen.reduce((a, e) => a + e.disponible, 0),
    };
  });
}

// El costo es información sensible: el Cajero no lo ve (spec, Roles y Permisos).
function ocultarCostoSinPermiso(producto) {
  if (producto && !session.tienePermiso('inventario.costos.ver') && !session.tienePermiso('ventas.costos.ver')) producto.costo_promedio = null;
  return producto;
}

function obtenerProducto(db, productoId, almacenId) {
  const producto = db
    .prepare(
      `SELECT p.*, t.porcentaje AS tasa_itbis_pct,
              COALESCE(e.cantidad_disponible, 0) AS cantidad_disponible
       FROM productos p
       JOIN tasas_itbis t ON t.id = p.tasa_itbis_id
       LEFT JOIN existencias e ON e.producto_id = p.id AND e.almacen_id = ?
       WHERE p.id = ? AND p.deleted_at IS NULL`
    )
    .get(almacenId, productoId);
  return conPromocion(db, producto);
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

// 'heredado' = usa el método general de Configuración.
function metodoValoracionValido(metodo) {
  if (!metodo) return 'heredado';
  if (!['heredado', 'promedio_ponderado', 'peps'].includes(metodo)) throw new Error('Método de valoración inválido');
  return metodo;
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
      metodoValoracionValido(metodoValoracion), esKit ? 1 : 0, permiteVentaNegativo ? 1 : 0,
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
      metodoValoracionValido(metodoValoracion), esKit ? 1 : 0, permiteVentaNegativo ? 1 : 0,
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

// Costo estimado de una unidad (cotizaciones, márgenes): para un producto normal es su
// costo_promedio; para un kit, la suma del costo de sus componentes. El costo real de una
// salida lo devuelve registrarMovimientoInventario (con PEPS depende de las capas consumidas).
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

// =========================================================================
// Valoración (promedio ponderado o PEPS) y lotes con vencimiento
// =========================================================================
//
// Un producto que controla lote, o que se valora por PEPS, lleva su existencia en capas (tabla
// lotes): cada entrada crea una capa con su cantidad, su costo y, si aplica, número de lote y
// vencimiento. Las salidas consumen capas: primero la que vence antes si el producto controla
// lote, o la más antigua si solo es PEPS. El costo de una salida es el de las capas que consume
// (PEPS) o el costo promedio del producto (promedio ponderado, aunque controle lote).
// Por producto y almacén, la suma de las capas es igual a la existencia (cuando es positiva).

const EPS = 0.00001;

function redondearCantidad(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

const METODOS_VALORACION = ['promedio_ponderado', 'peps'];

function metodoValoracionGlobal(db) {
  const fila = db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'metodo_valoracion'").get();
  return fila && fila.valor === 'peps' ? 'peps' : 'promedio_ponderado';
}

function metodoValoracion(db, producto) {
  return METODOS_VALORACION.includes(producto.metodo_valoracion) ? producto.metodo_valoracion : metodoValoracionGlobal(db);
}

function usaCapas(db, producto) {
  return !producto.es_kit && (Boolean(producto.controla_lote) || metodoValoracion(db, producto) === 'peps');
}

function capasDisponibles(db, producto, almacenId) {
  const orden = producto.controla_lote
    ? 'ORDER BY fecha_vencimiento IS NULL, fecha_vencimiento, created_at, rowid'
    : 'ORDER BY created_at, rowid';
  return db
    .prepare(`SELECT * FROM lotes WHERE producto_id = ? AND almacen_id = ? AND deleted_at IS NULL AND cantidad > 0 ${orden}`)
    .all(producto.id, almacenId);
}

function insertarCapa(db, { productoId, almacenId, numeroLote, fechaVencimiento, cantidad, costoUnitario }) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO lotes (id, producto_id, almacen_id, numero_lote, fecha_vencimiento, cantidad, costo_unitario) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, productoId, almacenId, numeroLote || '', fechaVencimiento || null, redondearCantidad(cantidad), costoUnitario || 0);
  return id;
}

function sumarACapa(db, loteId, cantidad) {
  db.prepare("UPDATE lotes SET cantidad = ROUND(cantidad + ?, 4), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(cantidad, loteId);
}

// Repara el invariante antes de mover: al activar el control de lote o PEPS en un producto que
// ya tenía existencia, esa existencia entra como una capa inicial ("SIN LOTE") a su costo promedio.
function sincronizarCapas(db, producto, almacenId, existencia) {
  const objetivo = Math.max(0, existencia);
  const capas = capasDisponibles(db, producto, almacenId);
  const total = capas.reduce((a, c) => a + c.cantidad, 0);
  if (total < objetivo - EPS) {
    insertarCapa(db, {
      productoId: producto.id, almacenId, numeroLote: producto.controla_lote ? 'SIN LOTE' : '',
      cantidad: objetivo - total, costoUnitario: producto.costo_promedio,
    });
  } else if (total > objetivo + EPS) {
    let sobra = total - objetivo;
    for (const c of capas) {
      if (sobra <= EPS) break;
      const toma = Math.min(c.cantidad, sobra);
      sumarACapa(db, c.id, -toma);
      sobra -= toma;
    }
  }
}

// Las unidades vendidas en negativo no tienen capa: la entrada que las repone primero las cubre.
// Con PEPS esas unidades salieron valoradas al costo de referencia (costoDescubierto); la capa
// que queda absorbe la diferencia con su costo real, igual que lo hace el promedio ponderado,
// para que el valor del inventario siga cuadrando con la contabilidad.
function entrarCapas(db, producto, almacenId, existenciaAntes, capas, costoDescubierto = null) {
  let descubierto = Math.max(0, -existenciaAntes);
  return capas.map((c) => {
    const cubre = Math.min(descubierto, c.cantidad);
    descubierto -= cubre;
    const resto = redondearCantidad(c.cantidad - cubre);
    const costoCapa = cubre > 0 && costoDescubierto !== null && resto > EPS
      ? Math.max(0, Math.round(((c.cantidad * (c.costoUnitario || 0) - cubre * costoDescubierto) / resto) * 10000) / 10000)
      : c.costoUnitario;
    let loteId = null;
    if (resto > EPS) {
      const existente = c.loteId && db.prepare('SELECT id FROM lotes WHERE id = ? AND producto_id = ? AND almacen_id = ?').get(c.loteId, producto.id, almacenId);
      if (existente && costoCapa === c.costoUnitario) {
        sumarACapa(db, c.loteId, resto);
        loteId = c.loteId;
      } else {
        loteId = insertarCapa(db, {
          productoId: producto.id, almacenId, numeroLote: c.numeroLote, fechaVencimiento: c.fechaVencimiento,
          cantidad: resto, costoUnitario: costoCapa,
        });
      }
    }
    return { loteId, cantidad: c.cantidad, costoUnitario: c.costoUnitario || 0 };
  });
}

// loteId: el usuario eligió el lote (debe alcanzar). preferirLotes: se consumen primero esos
// (p. ej. los que entró una compra que se está devolviendo) y luego el orden normal.
function salirCapas(db, producto, almacenId, cantidad, { loteId, preferirLotes } = {}) {
  let capas = capasDisponibles(db, producto, almacenId);
  if (loteId) {
    // Un lote (número + vencimiento) puede tener varias capas, p. ej. si entró en dos compras.
    const ref = db.prepare('SELECT numero_lote, fecha_vencimiento FROM lotes WHERE id = ?').get(loteId);
    const grupo = ref ? capas.filter((c) => c.numero_lote === ref.numero_lote && (c.fecha_vencimiento || '') === (ref.fecha_vencimiento || '')) : [];
    if (grupo.length === 0) throw new Error(`El lote elegido de "${producto.descripcion}" no tiene existencia en este almacén`);
    const disponible = redondearCantidad(grupo.reduce((a, c) => a + c.cantidad, 0));
    if (disponible < cantidad - EPS) {
      throw new Error(`El lote ${ref.numero_lote} de "${producto.descripcion}" solo tiene ${disponible} unidades`);
    }
    capas = grupo;
  } else if (preferirLotes && preferirLotes.length > 0) {
    const preferidas = preferirLotes.map((id) => capas.find((c) => c.id === id)).filter(Boolean);
    capas = [...new Set([...preferidas, ...capas])];
  }
  const piezas = [];
  let pendiente = cantidad;
  for (const c of capas) {
    if (pendiente <= EPS) break;
    const toma = redondearCantidad(Math.min(c.cantidad, pendiente));
    sumarACapa(db, c.id, -toma);
    piezas.push({ loteId: c.id, cantidad: -toma, costoUnitario: c.costo_unitario });
    pendiente = redondearCantidad(pendiente - toma);
  }
  if (pendiente > EPS) piezas.push({ loteId: null, cantidad: -pendiente, costoUnitario: producto.costo_promedio || 0 });
  return piezas;
}

function costoPromedioDeCapas(db, productoId) {
  const fila = db
    .prepare('SELECT SUM(cantidad * costo_unitario) AS valor, SUM(cantidad) AS cantidad FROM lotes WHERE producto_id = ? AND deleted_at IS NULL AND cantidad > 0')
    .get(productoId);
  return fila.cantidad > EPS ? redondear(fila.valor / fila.cantidad) : null;
}

// Registra un movimiento de inventario (kardex + existencia + capas + costo del producto).
// cantidad: positiva = entrada, negativa = salida. Debe llamarse dentro de una transacción.
//   Entrada: `lote` { numeroLote, fechaVencimiento } si el producto controla lote, o `capas`
//            [{ loteId?, numeroLote, fechaVencimiento, cantidad, costoUnitario }] para reingresar
//            exactamente lo que salió (reversiones, transferencias).
//   Salida:  `loteId` para sacar de un lote específico; si no, el orden normal.
// Devuelve { saldo, costoTotal, costoUnitario, piezas }: el costo real de lo que entró o salió.
function registrarMovimientoInventario(db, {
  productoId, almacenId, loteId = null, preferirLotes = null, lote = null, capas = null, tipoMovimiento, cantidad, costoUnitario,
  documentoOrigenTipo, documentoOrigenId, usuarioId,
}) {
  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(productoId);
  if (!producto) throw new Error('Producto no encontrado');
  const existenciaAntes = existenciaDisponible(db, productoId, almacenId);
  const saldoCantidad = redondearCantidad(existenciaAntes + cantidad);
  const peps = metodoValoracion(db, producto) === 'peps';
  const capasEntrada = cantidad > 0
    ? (capas || [{ numeroLote: lote && lote.numeroLote, fechaVencimiento: lote && lote.fechaVencimiento, cantidad, costoUnitario }])
    : null;
  const costoEntrada = capasEntrada
    ? redondear(capasEntrada.reduce((a, c) => a + c.cantidad * (c.costoUnitario || 0), 0) / cantidad)
    : null;

  let piezas;
  if (cantidad !== 0 && usaCapas(db, producto)) {
    sincronizarCapas(db, producto, almacenId, existenciaAntes);
    piezas = cantidad > 0
      ? entrarCapas(db, producto, almacenId, existenciaAntes, capasEntrada, peps ? (producto.costo_promedio || 0) : null)
      : salirCapas(db, producto, almacenId, -cantidad, { loteId, preferirLotes });
    // Promedio ponderado con lotes: las capas llevan la cantidad; la salida se valora al promedio.
    if (cantidad < 0 && !peps) piezas.forEach((p) => { p.costoUnitario = costoUnitario ?? producto.costo_promedio; });
  } else {
    const costo = cantidad > 0 ? costoEntrada : (costoUnitario ?? producto.costo_promedio ?? 0);
    piezas = [{ loteId: null, cantidad, costoUnitario: costo }];
  }

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

  // Costo del producto: PEPS = promedio de las capas que quedan (referencia para márgenes y
  // cotizaciones); promedio ponderado = se recalcula cuando entra mercancía con costo propio.
  let costoVigente = producto.costo_promedio || 0;
  if (cantidad !== 0 && peps && usaCapas(db, producto)) {
    const promedioCapas = costoPromedioDeCapas(db, productoId);
    if (promedioCapas !== null) costoVigente = promedioCapas;
  } else if (cantidad > 0 && costoEntrada > 0) {
    const existenciaTotal = db.prepare('SELECT COALESCE(SUM(cantidad_disponible),0) AS total FROM existencias WHERE producto_id = ?').get(productoId).total;
    const existenciaPrevia = existenciaTotal - cantidad;
    costoVigente = existenciaTotal > 0
      ? redondear(((costoVigente * existenciaPrevia) + (costoEntrada * cantidad)) / existenciaTotal)
      : costoEntrada;
  }
  if (costoVigente !== producto.costo_promedio) {
    db.prepare("UPDATE productos SET costo_promedio = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(costoVigente, productoId);
  }

  const insertKardex = db.prepare(
    `INSERT INTO kardex_movimientos
       (id, producto_id, almacen_id, lote_id, tipo_movimiento, documento_origen_tipo,
        documento_origen_id, cantidad, costo_unitario, saldo_cantidad, saldo_costo, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let saldo = existenciaAntes;
  for (const p of piezas) {
    saldo = redondearCantidad(saldo + p.cantidad);
    insertKardex.run(
      crypto.randomUUID(), productoId, almacenId, p.loteId, tipoMovimiento, documentoOrigenTipo, documentoOrigenId,
      p.cantidad, p.costoUnitario, saldo, cantidad === 0 ? p.costoUnitario : costoVigente, usuarioId
    );
  }

  const costoTotal = redondear(piezas.reduce((a, p) => a + Math.abs(p.cantidad) * p.costoUnitario, 0));
  return { saldo: saldoCantidad, costoTotal, costoUnitario: cantidad !== 0 ? redondear(costoTotal / Math.abs(cantidad)) : 0, piezas };
}

// Un kit mueve sus componentes; cualquier otro producto se mueve a sí mismo.
function productosAMover(db, producto, cantidad) {
  if (!producto.es_kit) return [{ productoId: producto.id, cantidad }];
  return componentesKit(db, producto.id).map((c) => ({ productoId: c.componente_producto_id, cantidad: cantidad * c.cantidad }));
}

// Saca del inventario lo vendido (a los componentes, si es un kit). Devuelve el costo total real.
function moverInventarioPorVenta(db, { producto, almacenId, cantidad, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
  let costoTotal = 0;
  for (const m of productosAMover(db, producto, cantidad)) {
    costoTotal += registrarMovimientoInventario(db, {
      productoId: m.productoId, almacenId, tipoMovimiento: cantidad < 0 ? 'salida_venta' : 'ajuste_entrada',
      cantidad: m.cantidad, documentoOrigenTipo, documentoOrigenId, usuarioId,
    }).costoTotal;
  }
  return redondear(costoTotal);
}

// Reingresa lo que uno o varios documentos (origenIds) sacaron del inventario: a los mismos
// lotes y al mismo costo con que salió. `cantidad` null = todo; si es parcial, se reparte en
// proporción entre lo que salió. Devuelve el costo total reingresado.
function reingresarSalidas(db, {
  origenTipo, origenId, origenIds, productoId, almacenId, cantidad = null, tipoMovimiento, documentoOrigenTipo, documentoOrigenId, usuarioId,
}) {
  const ids = origenIds || [origenId];
  const salidas = db
    .prepare(
      `SELECT k.cantidad, k.costo_unitario, k.lote_id, l.numero_lote, l.fecha_vencimiento
       FROM kardex_movimientos k LEFT JOIN lotes l ON l.id = k.lote_id
       WHERE k.documento_origen_tipo = ? AND k.documento_origen_id IN (${ids.map(() => '?').join(',')})
         AND k.producto_id = ? AND k.almacen_id = ? AND k.cantidad < 0
       ORDER BY k.rowid`
    )
    .all(origenTipo, ...ids, productoId, almacenId);
  const totalSalido = redondearCantidad(salidas.reduce((a, s) => a - s.cantidad, 0));
  const objetivo = redondearCantidad(cantidad ?? totalSalido);
  if (objetivo <= EPS) return 0;
  if (totalSalido <= EPS) {
    const { costo_promedio: costoPromedio } = db.prepare('SELECT costo_promedio FROM productos WHERE id = ?').get(productoId);
    return registrarMovimientoInventario(db, { productoId, almacenId, tipoMovimiento, cantidad: objetivo, costoUnitario: costoPromedio, documentoOrigenTipo, documentoOrigenId, usuarioId }).costoTotal;
  }
  const factor = Math.min(1, objetivo / totalSalido);
  const capas = salidas.map((s) => ({
    loteId: s.lote_id, numeroLote: s.numero_lote, fechaVencimiento: s.fecha_vencimiento,
    cantidad: redondearCantidad(-s.cantidad * factor), costoUnitario: s.costo_unitario,
  }));
  const diferencia = redondearCantidad(objetivo - capas.reduce((a, c) => a + c.cantidad, 0));
  capas[capas.length - 1].cantidad = redondearCantidad(capas[capas.length - 1].cantidad + diferencia);
  return registrarMovimientoInventario(db, {
    productoId, almacenId, tipoMovimiento, cantidad: objetivo, capas: capas.filter((c) => c.cantidad > EPS),
    documentoOrigenTipo, documentoOrigenId, usuarioId,
  }).costoTotal;
}

// Reingresa todo lo que un documento sacó, producto por producto. Devuelve el costo total.
function reingresarDocumento(db, { origenTipo, origenId, almacenId, tipoMovimiento, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
  const productos = db
    .prepare(
      `SELECT DISTINCT producto_id FROM kardex_movimientos
       WHERE documento_origen_tipo = ? AND documento_origen_id = ? AND almacen_id = ? AND cantidad < 0`
    )
    .all(origenTipo, origenId, almacenId);
  let costoTotal = 0;
  for (const p of productos) {
    costoTotal += reingresarSalidas(db, {
      origenTipo, origenId, productoId: p.producto_id, almacenId, tipoMovimiento, documentoOrigenTipo, documentoOrigenId, usuarioId,
    });
  }
  return redondear(costoTotal);
}

// Reingresa parte de una línea vendida (devolución): resuelve los componentes si es un kit.
function reingresarVenta(db, { producto, cantidad, origenIds, almacenId, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
  let costoTotal = 0;
  for (const m of productosAMover(db, producto, cantidad)) {
    costoTotal += reingresarSalidas(db, {
      origenTipo: 'documentos_venta', origenIds, productoId: m.productoId, almacenId, cantidad: m.cantidad,
      tipoMovimiento: 'devolucion_venta', documentoOrigenTipo, documentoOrigenId, usuarioId,
    });
  }
  return redondear(costoTotal);
}

// Saca lo que entró con un documento (anular una compra o una devolución), empezando por los
// lotes que ese documento creó. Devuelve el resultado de registrarMovimientoInventario.
function retirarEntradas(db, {
  origenTipo, origenId, productoId, almacenId, cantidad, costoUnitario, tipoMovimiento, documentoOrigenTipo, documentoOrigenId, usuarioId,
}) {
  const lotes = db
    .prepare(
      `SELECT DISTINCT lote_id FROM kardex_movimientos
       WHERE documento_origen_tipo = ? AND documento_origen_id = ? AND producto_id = ? AND almacen_id = ? AND cantidad > 0 AND lote_id IS NOT NULL`
    )
    .all(origenTipo, origenId, productoId, almacenId)
    .map((f) => f.lote_id);
  return registrarMovimientoInventario(db, {
    productoId, almacenId, tipoMovimiento, cantidad: -cantidad, costoUnitario, preferirLotes: lotes,
    documentoOrigenTipo, documentoOrigenId, usuarioId,
  });
}

// Lotes que entró un documento (p. ej. una factura de compra) y que aún tienen existencia.
function lotesCreadosPor(db, { origenTipo, origenId, productoId }) {
  return db
    .prepare(
      `SELECT DISTINCT l.* FROM kardex_movimientos k JOIN lotes l ON l.id = k.lote_id
       WHERE k.documento_origen_tipo = ? AND k.documento_origen_id = ? AND k.producto_id = ? AND k.cantidad > 0`
    )
    .all(origenTipo, origenId, productoId);
}

function actualizarCostoCapa(db, loteId, costo) {
  db.prepare("UPDATE lotes SET costo_unitario = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(costo, loteId);
}

// Recalcula el costo de referencia de un producto PEPS después de cambiar el costo de sus capas.
function refrescarCostoPeps(db, productoId) {
  const promedio = costoPromedioDeCapas(db, productoId);
  if (promedio !== null) {
    db.prepare("UPDATE productos SET costo_promedio = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(promedio, productoId);
  }
  return promedio;
}

function listarLotes(db, { productoId, almacenId, soloConExistencia = true } = {}) {
  const condiciones = ["l.deleted_at IS NULL", "p.controla_lote = 1"];
  const params = [];
  if (productoId) { condiciones.push('l.producto_id = ?'); params.push(productoId); }
  if (almacenId) { condiciones.push('l.almacen_id = ?'); params.push(almacenId); }
  if (soloConExistencia) condiciones.push('l.cantidad > 0');
  return db
    .prepare(
      `SELECT l.numero_lote, l.fecha_vencimiento, l.producto_id, l.almacen_id, p.descripcion, p.codigo_interno,
              a.nombre AS almacen_nombre, ROUND(SUM(l.cantidad), 4) AS cantidad, MIN(l.id) AS lote_id,
              CAST(julianday(l.fecha_vencimiento) - julianday('now', 'localtime', 'start of day') AS INTEGER) AS dias_restantes
       FROM lotes l JOIN productos p ON p.id = l.producto_id JOIN almacenes a ON a.id = l.almacen_id
       WHERE ${condiciones.join(' AND ')}
       GROUP BY l.producto_id, l.almacen_id, l.numero_lote, l.fecha_vencimiento
       ORDER BY p.descripcion, l.fecha_vencimiento IS NULL, l.fecha_vencimiento`
    )
    .all(...params);
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
      `SELECT k.*, a.nombre AS almacen_nombre, u.nombre_completo AS usuario_nombre, l.numero_lote, l.fecha_vencimiento
       FROM kardex_movimientos k JOIN almacenes a ON a.id = k.almacen_id
       LEFT JOIN usuarios u ON u.id = k.usuario_id
       LEFT JOIN lotes l ON l.id = k.lote_id
       WHERE ${condiciones.join(' AND ')} ORDER BY k.created_at DESC, k.rowid DESC LIMIT ?`
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

// Lotes con existencia dentro de la ventana de alerta (la del producto o la general), incluidos
// los ya vencidos, del más urgente al menos urgente.
function productosPorVencer(db) {
  const parametro = db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'ventana_alerta_vencimiento_dias'").get();
  const ventanaGeneral = Number(parametro && parametro.valor) || 30;
  const ventanaProducto = db.prepare('SELECT dias_alerta_vencimiento FROM productos WHERE id = ?');
  return listarLotes(db)
    .filter((l) => l.fecha_vencimiento && l.dias_restantes <= (ventanaProducto.get(l.producto_id).dias_alerta_vencimiento || ventanaGeneral))
    .sort((a, b) => a.dias_restantes - b.dias_restantes);
}

// =========================================================================
// Ajustes de inventario (entrada / salida manual)
// =========================================================================

function siguienteNumeroDocumento(db, tabla) {
  const row = db.prepare(`SELECT MAX(CAST(numero AS INTEGER)) AS maximo FROM ${tabla}`).get();
  return String((row.maximo || 0) + 1).padStart(6, '0');
}

// Lote de una entrada manual o de compra: el número es obligatorio si el producto controla
// lote; el vencimiento es opcional (hay lotes que no vencen).
function loteDeEntrada(producto, linea) {
  if (!producto.controla_lote) return null;
  const numeroLote = String(linea.numeroLote || '').trim();
  if (!numeroLote) throw new Error(`Indique el número de lote de "${producto.descripcion}"`);
  const fechaVencimiento = linea.fechaVencimiento ? String(linea.fechaVencimiento).slice(0, 10) : null;
  if (fechaVencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento)) {
    throw new Error(`La fecha de vencimiento del lote de "${producto.descripcion}" no es válida`);
  }
  return { numeroLote, fechaVencimiento };
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
    `INSERT INTO ajustes_inventario_detalle (id, ajuste_id, producto_id, lote_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?, ?, ?)`
  );
  let valorTotal = 0;
  for (const l of lineas) {
    const producto = obtenerProducto(db, l.productoId, almacenId);
    if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
    if (producto.es_kit) throw new Error(`"${producto.descripcion}" es un kit: ajuste sus componentes`);
    const cantidadFirmada = tipo === 'salida' ? -Math.abs(l.cantidad) : Math.abs(l.cantidad);
    const lote = tipo === 'salida' ? null : loteDeEntrada(producto, l);

    if (tipo === 'salida' && !producto.permite_venta_negativo) {
      const disponible = existenciaDisponible(db, l.productoId, almacenId);
      if (disponible < Math.abs(l.cantidad)) {
        throw new Error(`Existencia insuficiente de "${producto.descripcion}" para el ajuste de salida (disponible: ${disponible})`);
      }
    }

    // En una salida con PEPS el costo lo dan las capas consumidas; el que se guarda es el real.
    const movimiento = registrarMovimientoInventario(db, {
      productoId: l.productoId, almacenId, tipoMovimiento: tipo === 'salida' ? 'ajuste_salida' : 'ajuste_entrada',
      cantidad: cantidadFirmada, costoUnitario: l.costoUnitario ?? producto.costo_promedio, lote,
      loteId: tipo === 'salida' ? (l.loteId || null) : null,
      documentoOrigenTipo: 'ajustes_inventario', documentoOrigenId: ajusteId, usuarioId,
    });
    insertDetalle.run(crypto.randomUUID(), ajusteId, l.productoId, movimiento.piezas[0].loteId, cantidadFirmada, movimiento.costoUnitario);
    valorTotal += movimiento.costoTotal;
  }

  // Entrada: sube el inventario contra Diferencias de inventario; salida: al revés.
  valorTotal = redondear(valorTotal);
  if (valorTotal > 0) {
    const entrada = tipo !== 'salida';
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Ajuste de inventario ${numero} (${entrada ? 'entrada' : 'salida'})`, origenModulo: 'inventario',
      origenDocumentoTipo: 'ajustes_inventario', origenDocumentoId: ajusteId, usuarioId,
      lineas: [
        { cuentaCodigo: entrada ? CUENTA_INVENTARIO : CUENTA_DIFERENCIAS_INVENTARIO, debe: valorTotal, descripcion: entrada ? 'Entrada por ajuste' : 'Faltante de inventario' },
        { cuentaCodigo: entrada ? CUENTA_DIFERENCIAS_INVENTARIO : CUENTA_INVENTARIO, haber: valorTotal, descripcion: entrada ? 'Sobrante de inventario' : 'Salida por ajuste' },
      ],
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

function crearMerma(db, { almacenId, productoId, loteId, cantidad, costoUnitario, motivo, usuarioId }) {
  session.requerirPermiso('inventario.merma.crear');
  if (!motivo) throw new Error('El motivo de la merma es obligatorio');
  const producto = obtenerProducto(db, productoId, almacenId);
  if (!producto) throw new Error('Producto no encontrado');
  if (producto.es_kit) throw new Error(`"${producto.descripcion}" es un kit: registre la merma de sus componentes`);
  const disponible = existenciaDisponible(db, productoId, almacenId);
  if (disponible < cantidad) throw new Error(`Existencia insuficiente de "${producto.descripcion}" para registrar la merma`);

  const mermaId = crypto.randomUUID();
  const numero = siguienteNumeroDocumento(db, 'mermas_averias');
  // Primero el movimiento: con PEPS o lote elegido, el costo real sale de las capas consumidas.
  const movimiento = registrarMovimientoInventario(db, {
    productoId, almacenId, tipoMovimiento: 'merma', cantidad: -Math.abs(cantidad), costoUnitario: costoUnitario ?? producto.costo_promedio,
    loteId: loteId || null, documentoOrigenTipo: 'mermas_averias', documentoOrigenId: mermaId, usuarioId,
  });
  db.prepare(
    `INSERT INTO mermas_averias (id, numero, almacen_id, producto_id, lote_id, cantidad, costo_unitario, motivo, fecha, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`
  ).run(mermaId, numero, almacenId, productoId, movimiento.piezas[0].loteId, cantidad, movimiento.costoUnitario, motivo, usuarioId);

  if (movimiento.costoTotal > 0) {
    contabilidad.generarAsiento(db, {
      fecha: new Date().toISOString(), concepto: `Merma/avería ${numero}: ${producto.descripcion}`, origenModulo: 'inventario',
      origenDocumentoTipo: 'mermas_averias', origenDocumentoId: mermaId, usuarioId,
      lineas: [
        { cuentaCodigo: CUENTA_MERMAS, debe: movimiento.costoTotal, descripcion: motivo },
        { cuentaCodigo: CUENTA_INVENTARIO, haber: movimiento.costoTotal, descripcion: 'Salida por merma' },
      ],
    });
  }

  auditoria().registrarAuditoria(db, { usuarioId, modulo: 'inventario', entidad: 'mermas_averias', entidadId: mermaId, accion: 'crear', detalle: { numero, motivo, cantidad } });
  return mermaId;
}

function listarMermas(db, { limite = 50 } = {}) {
  return db
    .prepare(
      `SELECT m.*, p.descripcion AS producto_descripcion, al.nombre AS almacen_nombre, l.numero_lote
       FROM mermas_averias m JOIN productos p ON p.id = m.producto_id JOIN almacenes al ON al.id = m.almacen_id
       LEFT JOIN lotes l ON l.id = m.lote_id
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

    if (producto.es_kit) throw new Error(`"${producto.descripcion}" es un kit: transfiera sus componentes`);

    insertDetalle.run(crypto.randomUUID(), transferenciaId, l.productoId, l.cantidad);
    const salida = registrarMovimientoInventario(db, {
      productoId: l.productoId, almacenId: almacenOrigenId, tipoMovimiento: 'transferencia_salida',
      cantidad: -l.cantidad, costoUnitario: producto.costo_promedio, loteId: l.loteId || null,
      documentoOrigenTipo: 'transferencias_almacen', documentoOrigenId: transferenciaId, usuarioId,
    });
    // Entra al destino con los mismos lotes, vencimientos y costos con que salió del origen.
    registrarMovimientoInventario(db, {
      productoId: l.productoId, almacenId: almacenDestinoId, tipoMovimiento: 'transferencia_entrada',
      cantidad: l.cantidad, capas: salida.piezas.map((p) => {
        const capa = p.loteId ? db.prepare('SELECT numero_lote, fecha_vencimiento FROM lotes WHERE id = ?').get(p.loteId) : null;
        return { numeroLote: capa && capa.numero_lote, fechaVencimiento: capa && capa.fecha_vencimiento, cantidad: -p.cantidad, costoUnitario: p.costoUnitario };
      }),
      documentoOrigenTipo: 'transferencias_almacen', documentoOrigenId: transferenciaId, usuarioId,
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
  ipcMain.handle('productos:consultaPrecio', (event, filtros) => consultarPrecio(getDb(), filtros || {}));
  ipcMain.handle('productos:buscar', (event, { texto, almacenId, limite }) => buscarProductos(getDb(), { texto: texto || '', almacenId, limite }));
  ipcMain.handle('productos:obtener', (event, { productoId, almacenId }) => ocultarCostoSinPermiso(obtenerProducto(getDb(), productoId, almacenId)));
  ipcMain.handle('productos:obtenerCompleto', (event, { productoId }) => obtenerProductoCompleto(getDb(), productoId));
  ipcMain.handle('productos:listar', (event, filtros) => listarProductos(getDb(), filtros || {}));
  ipcMain.handle('productos:guardar', (event, { productoId, payload }) => {
    const db = getDb();
    const id = db.transaction(() => guardarProducto(db, payload, productoId))();
    return obtenerProductoCompleto(db, id);
  });

  ipcMain.handle('inventario:categorias', () => listarCategorias(getDb()));
  ipcMain.handle('inventario:crearCategoria', (event, payload) => crearCategoria(getDb(), payload || {}));
  ipcMain.handle('inventario:unidadesMedida', () => listarUnidadesMedida(getDb()));
  ipcMain.handle('inventario:tasasItbis', () => listarTasasItbis(getDb()));
  ipcMain.handle('almacenes:listar', () => listarAlmacenes(getDb()));
  ipcMain.handle('almacenes:crear', (event, payload) => crearAlmacen(getDb(), payload));

  ipcMain.handle('inventario:existencias', (event, filtros) => existenciasConsolidadas(getDb(), filtros || {}));
  ipcMain.handle('inventario:kardex', (event, filtros) => kardexPorProducto(getDb(), filtros));
  ipcMain.handle('inventario:vencimientos', () => productosPorVencer(getDb()));
  ipcMain.handle('inventario:lotes', (event, filtros) => listarLotes(getDb(), filtros || {}));

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
  metodoValoracion, usaCapas, loteDeEntrada, reingresarSalidas, reingresarDocumento, reingresarVenta, retirarEntradas,
  lotesCreadosPor, actualizarCostoCapa, refrescarCostoPeps, listarLotes, promocionVigente, consultarPrecio, hoyLocal,
  listarCategorias, crearCategoria, listarUnidadesMedida, listarTasasItbis, listarAlmacenes, crearAlmacen,
  crearAjuste, listarAjustes, crearMerma, listarMermas, crearTransferencia, listarTransferencias,
};
