window.__PUNTOX_CATALOGO_PERMISOS = {"permisos":[["ventas","ventas.factura.crear","Crear factura de venta"],["ventas","ventas.factura.editar","Editar documentos de venta abiertos"],["ventas","ventas.factura.anular","Anular factura de venta"],["ventas","ventas.cotizacion.crear","Crear cotización"],["ventas","ventas.pedido.crear","Crear pedido/orden de venta"],["ventas","ventas.conduce.crear","Crear nota de entrega/conduce"],["ventas","ventas.devolucion.crear","Registrar devolución (nota de crédito de venta)"],["ventas","ventas.nota_debito.crear","Registrar nota de débito de venta"],["ventas","ventas.descuento.aplicar","Aplicar descuentos dentro del límite del rol"],["ventas","ventas.descuento.exceder_limite","Aplicar descuentos por encima del límite del rol"],["ventas","ventas.costos.ver","Ver costo de producto en ventas"],["ventas","ventas.reportes_financieros.ver","Ver reportes financieros de ventas (márgenes, utilidad)"],["ventas","ventas.comision.ver","Ver comisiones propias"],["ventas","ventas.factura.imprimir","Imprimir factura o tique de venta"],["ventas","ventas.delivery.gestionar","Despachar y entregar pedidos de delivery"],["ventas","ventas.cuenta_abierta.gestionar","Abrir cuentas abiertas y agregarles productos"],["ventas","ventas.cuenta_abierta.anular","Quitar productos de una cuenta abierta o anularla"],["ventas","ventas.promocion.gestionar","Crear, editar y desactivar promociones programadas"],["inventario","inventario.ver","Consultar inventario (solo lectura)"],["inventario","inventario.costos.ver","Ver costo de producto en inventario"],["inventario","inventario.producto.crear","Crear/editar ficha de producto"],["inventario","inventario.producto.editar","Editar ficha de producto"],["inventario","inventario.ajuste.crear","Registrar ajuste de inventario"],["inventario","inventario.ajuste.anular","Anular ajuste de inventario"],["inventario","inventario.transferencia.crear","Registrar transferencia entre almacenes"],["inventario","inventario.recepcion.crear","Registrar recepción de mercancía"],["inventario","inventario.merma.crear","Registrar merma o avería"],["inventario","inventario.conversion.crear","Convertir un producto en otro (ej. saco en libras)"],["inventario","inventario.conversion.anular","Anular una conversión de producto"],["inventario","inventario.lista_precio.gestionar","Crear y editar listas de precio"],["inventario","inventario.etiqueta.imprimir","Imprimir etiquetas de código de barra y precio"],["compras","compras.orden.crear","Crear orden de compra"],["compras","compras.factura.crear","Registrar factura de compra"],["compras","compras.factura.anular","Anular documento de compra"],["compras","compras.devolucion.crear","Registrar devolución a proveedor o nota de crédito de compra"],["compras","compras.nota_debito.crear","Registrar nota de débito de compra"],["compras","compras.pago.aprobar","Aprobar pago a proveedor"],["compras","compras.costos.ver","Ver costos de compra"],["compras","compras.reportes.ver","Ver reportes de compras"],["cxc","cxc.recibo.crear","Registrar recibo de ingreso (cobro)"],["cxc","cxc.recibo.anular","Anular recibo de ingreso"],["cxc","cxc.gestion_cobro.crear","Registrar gestión de cobro"],["cxc","cxc.cliente.editar","Crear/editar ficha de cliente"],["cxc","cxc.reportes.ver","Ver reportes de cuentas por cobrar"],["cxc","cxc.empleados.crear","Registrar préstamo/anticipo/consumo de empleado"],["cxc","cxc.empleados.pagar","Registrar pago de préstamo/anticipo/consumo de empleado"],["cxp","cxp.pago.crear","Registrar pago a proveedor"],["cxp","cxp.pago.anular","Anular pago a proveedor"],["cxp","cxp.reportes.ver","Ver reportes de cuentas por pagar"],["caja","caja.apertura","Abrir turno de caja"],["caja","caja.cierre","Cerrar turno de caja"],["caja","caja.movimiento.crear","Registrar movimiento manual de caja"],["caja","caja.conciliacion.gestionar","Gestionar conciliación bancaria"],["caja","caja.tique.imprimir","Imprimir tique de arqueo de caja"],["contabilidad","contabilidad.ver","Ver libro diario, libro mayor y estados financieros"],["contabilidad","contabilidad.asiento_manual.crear","Registrar asiento contable manual"],["contabilidad","contabilidad.catalogo.gestionar","Crear y editar cuentas del catálogo contable"],["contabilidad","contabilidad.periodo.cerrar","Cerrar periodo contable"],["contabilidad","contabilidad.periodo.reabrir","Reabrir periodo contable cerrado"],["configuracion","configuracion.gestionar","Gestionar usuarios, roles y parámetros del sistema"],["configuracion","configuracion.auditoria.ver","Ver bitácora de auditoría"],["configuracion","configuracion.impresoras.gestionar","Configurar impresoras de factura, tique y etiqueta"],["configuracion","configuracion.ecf.gestionar","Configurar facturación electrónica: certificado digital, ambiente y secuencias e-NCF"],["ventas","ventas.ecf.ver","Ver el estado de los comprobantes electrónicos (e-CF) ante la DGII"],["ventas","ventas.ecf.gestionar","Reenviar e-CF a la DGII y anular secuencias e-NCF no usadas"],["compras","compras.ecf.recibir","Recibir e-CF de proveedores y dar su aprobación o rechazo comercial"]],"roles":[{"nombre":"Administrador/Dueño","descripcion":"Acceso total: configuración de impuestos, catálogo contable, reapertura de periodos cerrados.","limite_descuento_pct":100,"permisos":"ALL"},{"nombre":"Cajero/Vendedor","descripcion":"Factura, cobra, consulta inventario en solo lectura. No ve costos ni accede a contabilidad o compras.","limite_descuento_pct":10,"permisos":["ventas.factura.crear","ventas.cotizacion.crear","ventas.pedido.crear","ventas.conduce.crear","ventas.devolucion.crear","ventas.descuento.aplicar","ventas.comision.ver","ventas.factura.imprimir","ventas.delivery.gestionar","ventas.cuenta_abierta.gestionar","ventas.ecf.ver","inventario.ver","caja.apertura","caja.cierre","caja.movimiento.crear","caja.tique.imprimir","cxc.recibo.crear"]},{"nombre":"Encargado de Inventario/Almacén","descripcion":"Ajustes de inventario, transferencias, recepción de mercancía. Ve costos. No factura ni cobra.","limite_descuento_pct":0,"permisos":["inventario.ver","inventario.costos.ver","inventario.producto.crear","inventario.producto.editar","inventario.ajuste.crear","inventario.ajuste.anular","inventario.transferencia.crear","inventario.recepcion.crear","inventario.merma.crear","inventario.conversion.crear","inventario.conversion.anular","inventario.etiqueta.imprimir"]},{"nombre":"Comprador","descripcion":"Crea órdenes de compra y registra facturas de compra. No aprueba pagos.","limite_descuento_pct":0,"permisos":["compras.orden.crear","compras.factura.crear","compras.devolucion.crear","compras.nota_debito.crear","compras.costos.ver","compras.reportes.ver","compras.ecf.recibir","inventario.ver"]},{"nombre":"Contador","descripcion":"Solo lectura en todos los módulos operativos. Acceso completo a contabilidad, cierre de periodos y asientos manuales.","limite_descuento_pct":0,"permisos":["ventas.costos.ver","ventas.reportes_financieros.ver","inventario.ver","inventario.costos.ver","compras.costos.ver","compras.reportes.ver","cxc.reportes.ver","cxp.reportes.ver","contabilidad.ver","contabilidad.asiento_manual.crear","contabilidad.catalogo.gestionar","contabilidad.periodo.cerrar","contabilidad.periodo.reabrir","configuracion.auditoria.ver","ventas.ecf.ver"]},{"nombre":"Cobrador/Gestor de cartera","descripcion":"Solo el módulo de CxC: recibos de ingreso, gestión de llamadas. No factura.","limite_descuento_pct":0,"permisos":["cxc.recibo.crear","cxc.gestion_cobro.crear","cxc.reportes.ver"]}]};
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
      tiposNcf: [
        { id: uuid(), codigo: 'B02', nombre: 'Consumo', aplica_cliente: 'consumo', secuencia_desde: 1, secuencia_hasta: 500, secuencia_actual: 1, activo: true },
        { id: uuid(), codigo: 'B01', nombre: 'Crédito Fiscal', aplica_cliente: 'credito_fiscal', secuencia_desde: 1, secuencia_hasta: 500, secuencia_actual: 1, activo: true },
        { id: uuid(), codigo: 'B14', nombre: 'Gubernamental', aplica_cliente: 'gubernamental', secuencia_desde: 1, secuencia_hasta: 500, secuencia_actual: 1, activo: true },
        { id: uuid(), codigo: 'B15', nombre: 'Régimen Especial', aplica_cliente: 'regimen_especial', secuencia_desde: 1, secuencia_hasta: 500, secuencia_actual: 1, activo: true },
      ],
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
    // Roles base y usuario cajero de prueba (también en demos creadas antes de que existieran).
    if (!db.rolesSembrados && catalogo().roles.length) { rolesDe(db); guardar(); }
    return db;
  }

  function guardar({ exigir = false } = {}) {
    try {
      localStorage.setItem(CLAVE_ALMACENAMIENTO, JSON.stringify(db));
    } catch (e) {
      console.error('No se pudo guardar en localStorage (¿modo privado o cuota llena?):', e);
      if (exigir) {
        // Se recarga lo último guardado para no quedar con datos que no se pudieron guardar.
        try { db = JSON.parse(localStorage.getItem(CLAVE_ALMACENAMIENTO)) || db; } catch (err) { /* se conserva en memoria */ }
        throw new Error('El navegador ya no tiene espacio para guardar más fotos en la demo. Quita algunas o usa la app de escritorio');
      }
    }
  }

  function reiniciar() {
    localStorage.removeItem(CLAVE_ALMACENAMIENTO);
    db = null;
    cargar();
  }

  // --- Roles y permisos de la demo ---
  // La compilación de la demo (scripts/construir-demo-web.js) inyecta el catálogo real de permisos
  // y los roles base de escritorio en window.__PUNTOX_CATALOGO_PERMISOS. Sin él (abriendo los
  // archivos sueltos) queda solo el rol de administrador.
  const ROL_ADMIN_ID = 'rol-unico-web';
  function catalogo() { return window.__PUNTOX_CATALOGO_PERMISOS || { permisos: [], roles: [] }; }
  const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Asegura los roles base (una sola vez por demo) y un usuario cajero de prueba.
  function rolesDe(base) {
    if (!Array.isArray(base.roles)) base.roles = [];
    if (!base.roles.some((r) => r.id === ROL_ADMIN_ID)) {
      base.roles.unshift({ id: ROL_ADMIN_ID, nombre: 'Administrador/Dueño', descripcion: 'Acceso total.', es_rol_sistema: true, limite_descuento_pct: 100, permisos: [] });
    }
    if (!base.rolesSembrados && catalogo().roles.length) {
      catalogo().roles.forEach((r) => {
        if (r.permisos === 'ALL') { base.roles.find((x) => x.id === ROL_ADMIN_ID).descripcion = r.descripcion; return; }
        const id = 'rol-web-' + slug(r.nombre);
        if (!base.roles.some((x) => x.id === id)) base.roles.push({ id, nombre: r.nombre, descripcion: r.descripcion, es_rol_sistema: true, limite_descuento_pct: r.limite_descuento_pct, permisos: [...r.permisos] });
      });
      const cajero = base.roles.find((x) => x.id === 'rol-web-cajero-vendedor');
      if (cajero && !base.usuarios.some((u) => u.usuario === 'cajero')) {
        base.usuarios.push({ id: uuid(), nombre_completo: 'Cajera de prueba', usuario: 'cajero', password_hash: hashSimple('cajero123'), rol_id: cajero.id, rol_nombre: cajero.nombre, pct_comision: 0, activo: true });
      }
      base.rolesSembrados = true;
    }
    return base;
  }

  // Permisos efectivos de un usuario: el administrador (o un usuario sin rol) tiene todos.
  function permisosDeUsuario(base, usuario) {
    const rolId = usuario.rol_id || ROL_ADMIN_ID;
    if (rolId === ROL_ADMIN_ID) return ['*'];
    const rol = rolesDe(base).roles.find((r) => r.id === rolId && !r.deleted_at);
    return rol ? [...(rol.permisos || [])] : [];
  }

  window.PuntoXWebStore = { cargar, guardar, reiniciar, uuid, ahora, redondear, siguienteNumero, hashSimple, rolesDe, permisosDeUsuario, ROL_ADMIN_ID, catalogo };
})();
