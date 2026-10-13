// Inventario, versión web. Réplica simplificada de main/ipc/inventario.js sobre el store
// local: promedio ponderado únicamente (sin PEPS), sin lotes/vencimientos (esa pestaña queda
// vacía), pero con kits, ajustes, mermas y transferencias funcionando de verdad.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  const store = window.PuntoXWebStore;

  function tasaPorId(db, id) { return db.tasasItbis.find((t) => t.id === id); }
  function almacenPorId(db, id) { return db.almacenes.find((a) => a.id === id); }
  function categoriaPorId(db, id) { return db.categoriasCliente.find((c) => c.id === id); } // no aplica a productos; solo por si acaso

  function existenciaFila(db, productoId, almacenId) {
    return db.existencias.find((e) => e.producto_id === productoId && e.almacen_id === almacenId);
  }
  function existenciaDisponible(db, productoId, almacenId) {
    const fila = existenciaFila(db, productoId, almacenId);
    return fila ? fila.cantidad_disponible : 0;
  }
  function existenciaTotal(db, productoId) {
    return db.existencias.filter((e) => e.producto_id === productoId).reduce((acc, e) => acc + e.cantidad_disponible, 0);
  }

  function registrarMovimiento(db, { productoId, almacenId, tipoMovimiento, cantidad, costoUnitario, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
    const actual = existenciaDisponible(db, productoId, almacenId);
    const saldo = store.redondear(actual + cantidad);
    db.kardex.push({
      id: store.uuid(), producto_id: productoId, almacen_id: almacenId, tipo_movimiento: tipoMovimiento,
      documento_origen_tipo: documentoOrigenTipo, documento_origen_id: documentoOrigenId,
      cantidad, costo_unitario: costoUnitario, saldo_cantidad: saldo, usuario_id: usuarioId, created_at: store.ahora(),
    });
    let fila = existenciaFila(db, productoId, almacenId);
    if (!fila) { fila = { producto_id: productoId, almacen_id: almacenId, cantidad_disponible: 0, cantidad_comprometida: 0 }; db.existencias.push(fila); }
    fila.cantidad_disponible = saldo;

    // Promedio ponderado: solo en entradas con costo (compras, ajustes de entrada).
    if (cantidad > 0 && costoUnitario > 0) {
      const producto = db.productos.find((p) => p.id === productoId);
      if (producto) {
        const totalAntes = existenciaTotal(db, productoId) - cantidad; // ya se sumó arriba
        const valorAntes = totalAntes * producto.costo_promedio;
        const valorEntrada = cantidad * costoUnitario;
        const totalDespues = totalAntes + cantidad;
        producto.costo_promedio = totalDespues > 0 ? store.redondear((valorAntes + valorEntrada) / totalDespues) : costoUnitario;
      }
    }
  }

  function componentesKit(db, kitProductoId) {
    const kit = db.productos.find((p) => p.id === kitProductoId);
    return (kit && kit.componentes) || [];
  }

  function costoUnitarioVenta(db, producto) {
    if (!producto.es_kit) return producto.costo_promedio;
    return store.redondear(componentesKit(db, producto.id).reduce((acc, c) => {
      const comp = db.productos.find((p) => p.id === c.componenteProductoId);
      return acc + (comp ? comp.costo_promedio * c.cantidad : 0);
    }, 0));
  }

  function existenciaDisponibleParaVenta(db, producto, almacenId) {
    if (!producto.es_kit) return existenciaDisponible(db, producto.id, almacenId);
    const componentes = componentesKit(db, producto.id);
    if (componentes.length === 0) return 0;
    return Math.min(...componentes.map((c) => Math.floor(existenciaDisponible(db, c.componenteProductoId, almacenId) / c.cantidad)));
  }

  function moverInventarioPorVenta(db, { producto, almacenId, cantidad, documentoOrigenTipo, documentoOrigenId, usuarioId }) {
    if (producto.es_kit) {
      for (const c of componentesKit(db, producto.id)) {
        const comp = db.productos.find((p) => p.id === c.componenteProductoId);
        registrarMovimiento(db, {
          productoId: c.componenteProductoId, almacenId, tipoMovimiento: cantidad < 0 ? 'salida_venta' : 'ajuste_entrada',
          cantidad: cantidad * c.cantidad, costoUnitario: comp ? comp.costo_promedio : 0, documentoOrigenTipo, documentoOrigenId, usuarioId,
        });
      }
    } else {
      registrarMovimiento(db, {
        productoId: producto.id, almacenId, tipoMovimiento: cantidad < 0 ? 'salida_venta' : 'ajuste_entrada',
        cantidad, costoUnitario: producto.costo_promedio, documentoOrigenTipo, documentoOrigenId, usuarioId,
      });
    }
  }

  function productoParaLista(db, p) {
    const categoria = p.categoria_id ? db.categoriasProducto?.find((c) => c.id === p.categoria_id) : null;
    return {
      ...p, categoria_nombre: categoria ? categoria.nombre : null,
      existencia_total: p.es_kit ? 0 : existenciaTotal(db, p.id),
    };
  }

  function productoParaVenta(db, p, almacenId) {
    const tasa = tasaPorId(db, p.tasa_itbis_id);
    return {
      ...p, tasa_itbis_pct: tasa ? tasa.porcentaje : 0.18,
      cantidad_disponible: existenciaDisponibleParaVenta(db, p, almacenId),
      costo_promedio: costoUnitarioVenta(db, p),
    };
  }

  window.puntoXInventario = {
    listarCategorias: async () => [],
    listarUnidadesMedida: async () => store.cargar().unidadesMedida,
    listarTasasItbis: async () => store.cargar().tasasItbis,
    listarAlmacenes: async () => store.cargar().almacenes.filter((a) => !a.deleted_at),

    buscarProductos: async ({ texto, almacenId, limite = 20 } = {}) => {
      const db = store.cargar();
      const t = (texto || '').toLowerCase();
      return db.productos
        .filter((p) => p.activo !== false && (p.descripcion.toLowerCase().includes(t) || p.codigo_interno.toLowerCase().includes(t)))
        .slice(0, limite)
        .map((p) => productoParaVenta(db, p, almacenId));
    },

    obtenerProducto: async ({ productoId, almacenId }) => {
      const db = store.cargar();
      const p = db.productos.find((x) => x.id === productoId);
      return p ? productoParaVenta(db, p, almacenId) : null;
    },

    obtenerProductoCompleto: async ({ productoId }) => {
      const db = store.cargar();
      const p = db.productos.find((x) => x.id === productoId);
      if (!p) return null;
      return {
        ...p,
        codigosBarra: (p.codigosBarra || []).map((c) => ({ codigo_barra: c.codigoBarra, presentacion: c.presentacion, factor_conversion: c.factorConversion })),
        unidadesAlternativas: (p.unidadesAlternativas || []).map((u) => ({ unidad_id: u.unidadId, factor_conversion: u.factorConversion })),
        componentes: (p.componentes || []).map((c) => ({ componente_producto_id: c.componenteProductoId, descripcion: c.descripcion, cantidad: c.cantidad })),
      };
    },

    listarProductos: async ({ texto = '' } = {}) => {
      const db = store.cargar();
      const t = texto.toLowerCase();
      return db.productos
        .filter((p) => p.descripcion.toLowerCase().includes(t) || p.codigo_interno.toLowerCase().includes(t))
        .map((p) => productoParaLista(db, p));
    },

    guardarProducto: async ({ productoId, payload }) => {
      const db = store.cargar();
      if (!payload.codigoInterno || !payload.codigoInterno.trim()) throw new Error('El código interno es obligatorio');
      if (!payload.descripcion || !payload.descripcion.trim()) throw new Error('La descripción es obligatoria');
      if (productoId) {
        const p = db.productos.find((x) => x.id === productoId);
        if (!p) throw new Error('Producto no encontrado');
        Object.assign(p, {
          codigo_interno: payload.codigoInterno.trim(), descripcion: payload.descripcion.trim(), categoria_id: payload.categoriaId || null,
          unidad_medida_base_id: payload.unidadMedidaBaseId, tasa_itbis_id: payload.tasaItbisId,
          precio_detalle: payload.precioDetalle || 0, precio_mayorista: payload.precioMayorista || 0, precio_distribuidor: payload.precioDistribuidor || 0,
          metodo_valoracion: payload.metodoValoracion || 'promedio_ponderado', es_kit: Boolean(payload.esKit),
          permite_venta_negativo: Boolean(payload.permiteVentaNegativo), controla_lote: Boolean(payload.controlaLote),
          stock_minimo: payload.stockMinimo || 0, stock_maximo: payload.stockMaximo || null, activo: payload.activo !== false,
          codigosBarra: payload.codigosBarra || p.codigosBarra, unidadesAlternativas: payload.unidadesAlternativas || p.unidadesAlternativas,
          componentes: payload.componentes || p.componentes,
        });
        store.guardar();
        return { id: p.id };
      }
      const nuevo = {
        id: store.uuid(), codigo_interno: payload.codigoInterno.trim(), descripcion: payload.descripcion.trim(), categoria_id: payload.categoriaId || null,
        unidad_medida_base_id: payload.unidadMedidaBaseId, tasa_itbis_id: payload.tasaItbisId,
        precio_detalle: payload.precioDetalle || 0, precio_mayorista: payload.precioMayorista || 0, precio_distribuidor: payload.precioDistribuidor || 0,
        costo_promedio: payload.costoPromedio || 0, metodo_valoracion: payload.metodoValoracion || 'promedio_ponderado',
        es_kit: Boolean(payload.esKit), permite_venta_negativo: Boolean(payload.permiteVentaNegativo), controla_lote: Boolean(payload.controlaLote),
        stock_minimo: payload.stockMinimo || 0, stock_maximo: payload.stockMaximo || null, activo: true,
        codigosBarra: payload.codigosBarra || [], unidadesAlternativas: payload.unidadesAlternativas || [], componentes: payload.componentes || [],
      };
      db.productos.push(nuevo);
      store.guardar();
      return { id: nuevo.id };
    },

    existenciaDisponible: async ({ productoId, almacenId }) => existenciaDisponible(store.cargar(), productoId, almacenId),

    existencias: async ({ soloBajoMinimo = false } = {}) => {
      const db = store.cargar();
      return db.productos.filter((p) => p.activo !== false && !p.es_kit).map((p) => ({
        id: p.id, codigo_interno: p.codigo_interno, descripcion: p.descripcion, stock_minimo: p.stock_minimo, stock_maximo: p.stock_maximo,
        costo_promedio: p.costo_promedio, existencia_total: existenciaTotal(db, p.id), comprometida_total: 0,
      })).filter((p) => !soloBajoMinimo || p.existencia_total <= p.stock_minimo);
    },

    kardex: async ({ productoId }) => {
      const db = store.cargar();
      return db.kardex
        .filter((k) => k.producto_id === productoId)
        .slice().reverse()
        .map((k) => ({ ...k, almacen_nombre: (almacenPorId(db, k.almacen_id) || {}).nombre || '—' }));
    },

    vencimientos: async () => [], // sin control de lotes en la versión web
    lotes: async () => [],

    crearAjuste: async ({ almacenId, tipo, motivo, motivoDetalle, lineas, usuarioId }) => {
      const db = store.cargar();
      if (!lineas || lineas.length === 0) throw new Error('El ajuste debe tener al menos una línea');
      if (!motivo) throw new Error('El motivo del ajuste es obligatorio');
      const id = store.uuid();
      const numero = store.siguienteNumero('ajustes_inventario');
      for (const l of lineas) {
        const producto = db.productos.find((p) => p.id === l.productoId);
        if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
        const costoUnitario = l.costoUnitario ?? producto.costo_promedio;
        const cantidadFirmada = tipo === 'salida' ? -Math.abs(l.cantidad) : Math.abs(l.cantidad);
        if (tipo === 'salida' && !producto.permite_venta_negativo) {
          const disp = existenciaDisponible(db, l.productoId, almacenId);
          if (disp < Math.abs(l.cantidad)) throw new Error(`Existencia insuficiente de "${producto.descripcion}" para el ajuste de salida (disponible: ${disp})`);
        }
        registrarMovimiento(db, { productoId: l.productoId, almacenId, tipoMovimiento: tipo === 'salida' ? 'ajuste_salida' : 'ajuste_entrada', cantidad: cantidadFirmada, costoUnitario, documentoOrigenTipo: 'ajustes_inventario', documentoOrigenId: id, usuarioId });
      }
      db.movimientosAjuste = db.movimientosAjuste || [];
      db.movimientosAjuste.push({ id, numero, almacen_id: almacenId, tipo, motivo, motivo_detalle: motivoDetalle || null, fecha: store.ahora(), usuario_id: usuarioId });
      store.guardar();
      return { id };
    },

    listarAjustes: async () => {
      const db = store.cargar();
      return (db.movimientosAjuste || []).slice().reverse().map((a) => ({
        ...a, almacen_nombre: (almacenPorId(db, a.almacen_id) || {}).nombre || '—',
        usuario_nombre: (db.usuarios.find((u) => u.id === a.usuario_id) || {}).nombre_completo || '',
      }));
    },

    crearMerma: async ({ almacenId, productoId, cantidad, costoUnitario, motivo, usuarioId }) => {
      const db = store.cargar();
      if (!motivo) throw new Error('El motivo de la merma es obligatorio');
      const producto = db.productos.find((p) => p.id === productoId);
      if (!producto) throw new Error('Producto no encontrado');
      const disp = existenciaDisponible(db, productoId, almacenId);
      if (disp < cantidad) throw new Error(`Existencia insuficiente de "${producto.descripcion}" para registrar la merma`);
      const id = store.uuid();
      const numero = store.siguienteNumero('mermas_averias');
      const costo = costoUnitario ?? producto.costo_promedio;
      db.mermas = db.mermas || [];
      db.mermas.push({ id, numero, almacen_id: almacenId, producto_id: productoId, cantidad, costo_unitario: costo, motivo, fecha: store.ahora(), usuario_id: usuarioId });
      registrarMovimiento(db, { productoId, almacenId, tipoMovimiento: 'merma', cantidad: -Math.abs(cantidad), costoUnitario: costo, documentoOrigenTipo: 'mermas_averias', documentoOrigenId: id, usuarioId });
      store.guardar();
      return { id };
    },

    listarMermas: async () => {
      const db = store.cargar();
      return (db.mermas || []).slice().reverse().map((m) => ({
        ...m, producto_descripcion: (db.productos.find((p) => p.id === m.producto_id) || {}).descripcion || '—',
        almacen_nombre: (almacenPorId(db, m.almacen_id) || {}).nombre || '—',
      }));
    },

    crearTransferencia: async ({ almacenOrigenId, almacenDestinoId, lineas, usuarioId }) => {
      const db = store.cargar();
      if (almacenOrigenId === almacenDestinoId) throw new Error('El almacén de origen y destino no pueden ser el mismo');
      if (!lineas || lineas.length === 0) throw new Error('La transferencia debe tener al menos una línea');
      const id = store.uuid();
      const numero = store.siguienteNumero('transferencias');
      for (const l of lineas) {
        const producto = db.productos.find((p) => p.id === l.productoId);
        if (!producto) throw new Error(`Producto ${l.productoId} no encontrado`);
        const disp = existenciaDisponible(db, l.productoId, almacenOrigenId);
        if (disp < l.cantidad) throw new Error(`Existencia insuficiente de "${producto.descripcion}" en el almacén de origen (disponible: ${disp})`);
        registrarMovimiento(db, { productoId: l.productoId, almacenId: almacenOrigenId, tipoMovimiento: 'transferencia_salida', cantidad: -l.cantidad, costoUnitario: producto.costo_promedio, documentoOrigenTipo: 'transferencias', documentoOrigenId: id, usuarioId });
        registrarMovimiento(db, { productoId: l.productoId, almacenId: almacenDestinoId, tipoMovimiento: 'transferencia_entrada', cantidad: l.cantidad, costoUnitario: producto.costo_promedio, documentoOrigenTipo: 'transferencias', documentoOrigenId: id, usuarioId });
      }
      db.transferencias = db.transferencias || [];
      db.transferencias.push({ id, numero, almacen_origen_id: almacenOrigenId, almacen_destino_id: almacenDestinoId, fecha: store.ahora(), usuario_id: usuarioId });
      store.guardar();
      return { id };
    },

    listarTransferencias: async () => {
      const db = store.cargar();
      return (db.transferencias || []).slice().reverse().map((t) => ({
        ...t, almacen_origen_nombre: (almacenPorId(db, t.almacen_origen_id) || {}).nombre || '—',
        almacen_destino_nombre: (almacenPorId(db, t.almacen_destino_id) || {}).nombre || '—',
        usuario_nombre: (db.usuarios.find((u) => u.id === t.usuario_id) || {}).nombre_completo || '',
      }));
    },

    // Expuestos para que otros bridges (ventas, compras) reutilicen la misma lógica.
    _interno: { existenciaDisponible, existenciaDisponibleParaVenta, costoUnitarioVenta, moverInventarioPorVenta, registrarMovimiento, existenciaTotal },
  };
})();
