// Almacén local para la versión web de prueba de Punto X. Todo vive en localStorage del
// navegador — no hay servidor, no hay Supabase, nada sale de esta máquina. Es un sustituto
// deliberadamente más simple que SQLite + Electron (sin permisos por rol, sin partida doble
// completa) pensado solo para que un cliente pruebe el flujo desde un link, no para operar
// un negocio real. La app de escritorio real sigue siendo la fuente de verdad.
// Se captura ANTES de que cualquier bridge web defina window.puntoX, para saber si de
// verdad estamos dentro de Electron (donde el preload real ya lo habría definido a esta
// altura) o en un navegador normal. Los demás archivos api-*.js revisan esta bandera, no
// window.puntoX directamente — si revisaran window.puntoX, se confundirían apenas
// api-auth-app.js lo defina para la propia versión web.
window.__PUNTOX_ES_ELECTRON = Boolean(window.puntoX);

(function () {
  const CLAVE_ALMACENAMIENTO = 'punto-x-web-db-v1';
  let db = null;

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function ahora() {
    return new Date().toISOString();
  }

  function redondear(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function siguienteNumero(tipo) {
    db.secuencias[tipo] = (db.secuencias[tipo] || 0) + 1;
    return String(db.secuencias[tipo]).padStart(6, '0');
  }

  // --- Contraseña: hash simple (no criptográfico) solo para no guardar texto plano.
  // Suficiente para una demo local; la app de escritorio real usa scrypt de verdad. ---
  function hashSimple(texto) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  function crearSemilla() {
    const sucursalId = uuid();
    const almacenId = uuid();
    const cajaId = uuid();
    const monedaId = uuid();
    const tasaId = uuid();
    const adminId = uuid();
    const categoriaDetalle = uuid();
    const categoriaMayorista = uuid();
    const categoriaDistribuidor = uuid();
    const unidadId = uuid();

    return {
      version: 1,
      secuencias: {},
      sucursales: [{ id: sucursalId, nombre: 'Sucursal Principal', es_principal: true, direccion: null, telefono: null, activo: true }],
      almacenes: [{ id: almacenId, nombre: 'Almacén Principal', sucursal_id: sucursalId, deleted_at: null }],
      cajas: [{ id: cajaId, nombre: 'Caja Principal', deleted_at: null }],
      monedas: [{ id: monedaId, codigo: 'DOP', nombre: 'Peso Dominicano', es_local: true, activo: true }],
      tasasItbis: [{ id: tasaId, nombre: '18%', porcentaje: 0.18, es_default: true, activo: true }],
      categoriasCliente: [
        { id: categoriaDetalle, nombre: 'Detalle', nivel_precio: 'detalle' },
        { id: categoriaMayorista, nombre: 'Mayorista', nivel_precio: 'mayorista' },
        { id: categoriaDistribuidor, nombre: 'Distribuidor', nivel_precio: 'distribuidor' },
      ],
      unidadesMedida: [{ id: unidadId, nombre: 'Unidad', abreviatura: 'und' }],
      parametrosNegocio: { negocio_nombre: 'Mi Negocio', negocio_iniciales: 'MN', dias_credito_default: '30', ventana_alerta_vencimiento_dias: '30', dias_mora_bloqueo_credito: '60' },

      usuarios: [{
        id: adminId, nombre_completo: 'Administrador', usuario: 'admin', password_hash: hashSimple('admin123'),
        rol_nombre: 'Administrador/Dueño', pct_comision: 0, activo: true,
      }],

      productos: [],
      existencias: [], // { producto_id, almacen_id, cantidad_disponible }
      kardex: [],

      clientes: [
        {
          id: uuid(), nombre: 'Colmado Doña Milagros', rnc_cedula: null, categoria_id: categoriaDetalle, limite_credito: 30000,
          dias_credito: 30, tipo_comprobante_default: 'credito_fiscal', es_agente_retencion: false, pct_retencion_isr: 0,
          pct_retencion_itbis: 0, direccion: null, telefono: '809-555-1001', email: null, bloqueado: false, motivo_bloqueo: null, activo: true,
        },
        {
          id: uuid(), nombre: 'Supermercado La Familia', rnc_cedula: null, categoria_id: categoriaMayorista, limite_credito: 80000,
          dias_credito: 45, tipo_comprobante_default: 'credito_fiscal', es_agente_retencion: false, pct_retencion_isr: 0,
          pct_retencion_itbis: 0, direccion: null, telefono: '809-555-1002', email: null, bloqueado: false, motivo_bloqueo: null, activo: true,
        },
      ],
      documentosVenta: [],
      documentosVentaDetalle: [],
      pagosVenta: [],
      recibosIngreso: [],
      recibosIngresoAplicaciones: [],
      gestionCobros: [],
      comisionesVendedor: [],
      cxcEmpleados: [],

      proveedores: [],
      documentosCompra: [],
      documentosCompraDetalle: [],
      pagosProveedor: [],
      pagosProveedorAplicaciones: [],

      turnosCaja: [],
      movimientosCaja: [],
      cajaChica: [],
      gastosCajaChica: [],

      bitacora: [],

      idsPrincipales: { sucursalId, almacenId, cajaId, monedaId, tasaId, adminId },
    };
  }

  // --- Catálogo de demostración (para que la web no arranque vacía) ---
  function agregarDemoInventario(seed) {
    const PRODUCTOS_DEMO = [
      ['DEMO-001', 'Arroz Selecto 5kg', 295, 220, 40],
      ['DEMO-002', 'Aceite Vegetal 1L', 165, 118, 40],
      ['DEMO-003', 'Detergente en Polvo 1kg', 210, 150, 40],
      ['DEMO-004', 'Cerveza Presidente Six Pack', 380, 290, 30],
      ['DEMO-005', 'Agua Botella 500ml', 35, 18, 100],
      ['DEMO-006', 'Cloro 1L', 85, 52, 40],
    ];
    const tasaId = seed.idsPrincipales.tasaId;
    const almacenId = seed.idsPrincipales.almacenId;
    const idsPorCodigo = {};
    for (const [codigo, descripcion, precio, costo, existencia] of PRODUCTOS_DEMO) {
      const id = uuid();
      idsPorCodigo[codigo] = id;
      seed.productos.push({
        id, codigo_interno: codigo, descripcion, categoria_id: null, unidad_medida_base_id: seed.unidadesMedida[0].id,
        tasa_itbis_id: tasaId, precio_detalle: precio, precio_mayorista: redondear(precio * 0.9), precio_distribuidor: redondear(precio * 0.85),
        costo_promedio: costo, metodo_valoracion: 'promedio_ponderado', es_kit: false, permite_venta_negativo: false, controla_lote: false,
        stock_minimo: 10, stock_maximo: null, activo: true, codigosBarra: [], unidadesAlternativas: [], componentes: [],
      });
      seed.existencias.push({ producto_id: id, almacen_id: almacenId, cantidad_disponible: existencia, cantidad_comprometida: 0 });
      seed.kardex.push({
        id: uuid(), producto_id: id, almacen_id: almacenId, tipo_movimiento: 'ajuste_entrada', documento_origen_tipo: 'demo', documento_origen_id: null,
        cantidad: existencia, costo_unitario: costo, saldo_cantidad: existencia, usuario_id: seed.idsPrincipales.adminId, created_at: ahora(),
      });
    }
    // Un kit para mostrar esa funcionalidad también.
    const kitId = uuid();
    seed.productos.push({
      id: kitId, codigo_interno: 'DEMO-KIT-001', descripcion: 'Combo de Limpieza (Detergente + Cloro)', categoria_id: null,
      unidad_medida_base_id: seed.unidadesMedida[0].id, tasa_itbis_id: tasaId, precio_detalle: 260, precio_mayorista: 0, precio_distribuidor: 0,
      costo_promedio: 0, metodo_valoracion: 'promedio_ponderado', es_kit: true, permite_venta_negativo: false, controla_lote: false,
      stock_minimo: 0, stock_maximo: null, activo: true, codigosBarra: [], unidadesAlternativas: [],
      componentes: [
        { componenteProductoId: idsPorCodigo['DEMO-003'], descripcion: 'Detergente en Polvo 1kg', cantidad: 1 },
        { componenteProductoId: idsPorCodigo['DEMO-006'], descripcion: 'Cloro 1L', cantidad: 1 },
      ],
    });
  }

  function cargar() {
    if (db) return db;
    try {
      const crudo = localStorage.getItem(CLAVE_ALMACENAMIENTO);
      db = crudo ? JSON.parse(crudo) : null;
    } catch (e) {
      db = null;
    }
    if (!db) {
      db = crearSemilla();
      agregarDemoInventario(db);
      guardar();
    }
    return db;
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE_ALMACENAMIENTO, JSON.stringify(db));
    } catch (e) {
      console.error('No se pudo guardar en localStorage (¿modo privado o cuota llena?):', e);
    }
  }

  function reiniciar() {
    localStorage.removeItem(CLAVE_ALMACENAMIENTO);
    db = null;
    cargar();
  }

  window.PuntoXWebStore = { cargar, guardar, reiniciar, uuid, ahora, redondear, siguienteNumero, hashSimple };
})();
