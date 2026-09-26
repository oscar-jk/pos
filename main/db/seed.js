const crypto = require('node:crypto');
const { hashPassword } = require('../auth/password');

// Catálogo de permisos por acción (no solo por módulo), según la sección
// "Roles, Permisos y Configuración General" del documento fuente.
const PERMISOS = [
  // Ventas
  ['ventas', 'ventas.factura.crear', 'Crear factura de venta'],
  ['ventas', 'ventas.factura.editar', 'Editar documentos de venta abiertos'],
  ['ventas', 'ventas.factura.anular', 'Anular factura de venta'],
  ['ventas', 'ventas.cotizacion.crear', 'Crear cotización'],
  ['ventas', 'ventas.pedido.crear', 'Crear pedido/orden de venta'],
  ['ventas', 'ventas.conduce.crear', 'Crear nota de entrega/conduce'],
  ['ventas', 'ventas.devolucion.crear', 'Registrar devolución (nota de crédito de venta)'],
  ['ventas', 'ventas.nota_debito.crear', 'Registrar nota de débito de venta'],
  ['ventas', 'ventas.descuento.aplicar', 'Aplicar descuentos dentro del límite del rol'],
  ['ventas', 'ventas.descuento.exceder_limite', 'Aplicar descuentos por encima del límite del rol'],
  ['ventas', 'ventas.costos.ver', 'Ver costo de producto en ventas'],
  ['ventas', 'ventas.reportes_financieros.ver', 'Ver reportes financieros de ventas (márgenes, utilidad)'],
  ['ventas', 'ventas.comision.ver', 'Ver comisiones propias'],
  ['ventas', 'ventas.factura.imprimir', 'Imprimir factura o tique de venta'],
  ['ventas', 'ventas.cuenta_abierta.gestionar', 'Abrir cuentas abiertas y agregarles productos'],
  ['ventas', 'ventas.cuenta_abierta.anular', 'Quitar productos de una cuenta abierta o anularla'],
  ['ventas', 'ventas.promocion.gestionar', 'Crear, editar y desactivar promociones programadas'],
  // Inventario
  ['inventario', 'inventario.ver', 'Consultar inventario (solo lectura)'],
  ['inventario', 'inventario.costos.ver', 'Ver costo de producto en inventario'],
  ['inventario', 'inventario.producto.crear', 'Crear/editar ficha de producto'],
  ['inventario', 'inventario.producto.editar', 'Editar ficha de producto'],
  ['inventario', 'inventario.ajuste.crear', 'Registrar ajuste de inventario'],
  ['inventario', 'inventario.ajuste.anular', 'Anular ajuste de inventario'],
  ['inventario', 'inventario.transferencia.crear', 'Registrar transferencia entre almacenes'],
  ['inventario', 'inventario.recepcion.crear', 'Registrar recepción de mercancía'],
  ['inventario', 'inventario.merma.crear', 'Registrar merma o avería'],
  // Compras
  ['compras', 'compras.orden.crear', 'Crear orden de compra'],
  ['compras', 'compras.factura.crear', 'Registrar factura de compra'],
  ['compras', 'compras.factura.anular', 'Anular documento de compra'],
  ['compras', 'compras.devolucion.crear', 'Registrar devolución a proveedor o nota de crédito de compra'],
  ['compras', 'compras.nota_debito.crear', 'Registrar nota de débito de compra'],
  ['compras', 'compras.pago.aprobar', 'Aprobar pago a proveedor'],
  ['compras', 'compras.costos.ver', 'Ver costos de compra'],
  ['compras', 'compras.reportes.ver', 'Ver reportes de compras'],
  // Cuentas por Cobrar
  ['cxc', 'cxc.recibo.crear', 'Registrar recibo de ingreso (cobro)'],
  ['cxc', 'cxc.recibo.anular', 'Anular recibo de ingreso'],
  ['cxc', 'cxc.gestion_cobro.crear', 'Registrar gestión de cobro'],
  ['cxc', 'cxc.cliente.editar', 'Crear/editar ficha de cliente'],
  ['cxc', 'cxc.reportes.ver', 'Ver reportes de cuentas por cobrar'],
  ['cxc', 'cxc.empleados.crear', 'Registrar préstamo/anticipo/consumo de empleado'],
  ['cxc', 'cxc.empleados.pagar', 'Registrar pago de préstamo/anticipo/consumo de empleado'],
  // Cuentas por Pagar
  ['cxp', 'cxp.pago.crear', 'Registrar pago a proveedor'],
  ['cxp', 'cxp.pago.anular', 'Anular pago a proveedor'],
  ['cxp', 'cxp.reportes.ver', 'Ver reportes de cuentas por pagar'],
  // Caja y Tesorería
  ['caja', 'caja.apertura', 'Abrir turno de caja'],
  ['caja', 'caja.cierre', 'Cerrar turno de caja'],
  ['caja', 'caja.movimiento.crear', 'Registrar movimiento manual de caja'],
  ['caja', 'caja.conciliacion.gestionar', 'Gestionar conciliación bancaria'],
  ['caja', 'caja.tique.imprimir', 'Imprimir tique de arqueo de caja'],
  // Contabilidad
  ['contabilidad', 'contabilidad.ver', 'Ver libro diario, libro mayor y estados financieros'],
  ['contabilidad', 'contabilidad.asiento_manual.crear', 'Registrar asiento contable manual'],
  ['contabilidad', 'contabilidad.periodo.cerrar', 'Cerrar periodo contable'],
  ['contabilidad', 'contabilidad.periodo.reabrir', 'Reabrir periodo contable cerrado'],
  // Configuración
  ['configuracion', 'configuracion.gestionar', 'Gestionar usuarios, roles y parámetros del sistema'],
  ['configuracion', 'configuracion.auditoria.ver', 'Ver bitácora de auditoría'],
  ['configuracion', 'configuracion.impresoras.gestionar', 'Configurar impresoras de factura, tique y etiqueta'],
];

// Matriz rol -> permisos, según los 6 roles propuestos en el documento fuente.
// 'ALL' se expande a todos los códigos del catálogo (Administrador/Dueño).
const ROLES = [
  {
    nombre: 'Administrador/Dueño',
    descripcion: 'Acceso total: configuración de impuestos, catálogo contable, reapertura de periodos cerrados.',
    limite_descuento_pct: 100,
    permisos: 'ALL',
  },
  {
    nombre: 'Cajero/Vendedor',
    descripcion: 'Factura, cobra, consulta inventario en solo lectura. No ve costos ni accede a contabilidad o compras.',
    limite_descuento_pct: 10,
    permisos: [
      'ventas.factura.crear', 'ventas.cotizacion.crear', 'ventas.pedido.crear',
      'ventas.conduce.crear', 'ventas.devolucion.crear', 'ventas.descuento.aplicar',
      'ventas.comision.ver', 'ventas.factura.imprimir', 'ventas.cuenta_abierta.gestionar', 'inventario.ver', 'caja.apertura', 'caja.cierre',
      'caja.movimiento.crear', 'caja.tique.imprimir', 'cxc.recibo.crear',
    ],
  },
  {
    nombre: 'Encargado de Inventario/Almacén',
    descripcion: 'Ajustes de inventario, transferencias, recepción de mercancía. Ve costos. No factura ni cobra.',
    limite_descuento_pct: 0,
    permisos: [
      'inventario.ver', 'inventario.costos.ver', 'inventario.producto.crear',
      'inventario.producto.editar', 'inventario.ajuste.crear', 'inventario.ajuste.anular',
      'inventario.transferencia.crear', 'inventario.recepcion.crear', 'inventario.merma.crear',
    ],
  },
  {
    nombre: 'Comprador',
    descripcion: 'Crea órdenes de compra y registra facturas de compra. No aprueba pagos.',
    limite_descuento_pct: 0,
    permisos: [
      'compras.orden.crear', 'compras.factura.crear', 'compras.devolucion.crear', 'compras.nota_debito.crear',
      'compras.costos.ver', 'compras.reportes.ver', 'inventario.ver',
    ],
  },
  {
    nombre: 'Contador',
    descripcion: 'Solo lectura en todos los módulos operativos. Acceso completo a contabilidad, cierre de periodos y asientos manuales.',
    limite_descuento_pct: 0,
    permisos: [
      'ventas.costos.ver', 'ventas.reportes_financieros.ver', 'inventario.ver', 'inventario.costos.ver',
      'compras.costos.ver', 'compras.reportes.ver', 'cxc.reportes.ver', 'cxp.reportes.ver',
      'contabilidad.ver', 'contabilidad.asiento_manual.crear', 'contabilidad.periodo.cerrar',
      'contabilidad.periodo.reabrir', 'configuracion.auditoria.ver',
    ],
  },
  {
    nombre: 'Cobrador/Gestor de cartera',
    descripcion: 'Solo el módulo de CxC: recibos de ingreso, gestión de llamadas. No factura.',
    limite_descuento_pct: 0,
    permisos: ['cxc.recibo.crear', 'cxc.gestion_cobro.crear', 'cxc.reportes.ver'],
  },
];

// Parámetros de negocio agregados después del seed inicial — ver sincronizarPermisosFaltantes.
const PARAMETROS_NEGOCIO_NUEVOS = [
  ['negocio_rnc', '', 'RNC del negocio, impreso en el encabezado de factura'],
  ['negocio_direccion', '', 'Dirección del negocio, impresa en el encabezado de factura'],
  ['negocio_telefono', '', 'Teléfono del negocio, impreso en el encabezado de factura'],
  ['modulo_cuentas_abiertas', '0', 'Módulo opcional: cuentas abiertas tipo bar/mesa (1 = activo)'],
  ['metodo_valoracion', 'promedio_ponderado', 'Método de valoración de inventario para los productos que no definen uno propio'],
];

const MONEDAS_EXTRANJERAS = [['USD', 'Dólar estadounidense']];

// Catálogo de cuentas contables mínimas exigido por el Módulo 7.
const CUENTAS_CONTABLES = [
  ['1000', 'ACTIVO', 'activo', null, 0],
  ['1100', 'Caja', 'activo', '1000', 1],
  ['1200', 'Bancos', 'activo', '1000', 1],
  ['1300', 'Inventario', 'activo', '1000', 1],
  ['1350', 'Mercancía entregada por facturar', 'activo', '1000', 1],
  ['1400', 'Clientes (CxC)', 'activo', '1000', 1],
  ['1500', 'ITBIS Pagado (crédito fiscal)', 'activo', '1000', 1],
  ['1510', 'ISR retenido por terceros', 'activo', '1000', 1],
  ['1520', 'ITBIS retenido por terceros', 'activo', '1000', 1],
  ['2000', 'PASIVO', 'pasivo', null, 0],
  ['2100', 'Proveedores (CxP)', 'pasivo', '2000', 1],
  ['2200', 'ITBIS por Pagar', 'pasivo', '2000', 1],
  ['3000', 'PATRIMONIO', 'patrimonio', null, 0],
  ['3100', 'Capital/Patrimonio', 'patrimonio', '3000', 1],
  ['4000', 'INGRESOS', 'ingreso', null, 0],
  ['4100', 'Ingresos por Ventas', 'ingreso', '4000', 1],
  ['5000', 'COSTOS', 'costo', null, 0],
  ['5100', 'Costo de Ventas', 'costo', '5000', 1],
  ['6000', 'GASTOS', 'gasto', null, 0],
  ['6100', 'Gastos Operativos', 'gasto', '6000', 1],
  ['6200', 'Pérdida por mermas y averías', 'gasto', '6000', 1],
  ['6300', 'Diferencias de inventario', 'gasto', '6000', 1],
];

function seed(db) {
  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();

  const insertMany = db.transaction(() => {
    // --- Roles y permisos ---
    const permisoIdByCodigo = new Map();
    const insertPermiso = db.prepare(
      'INSERT INTO permisos (id, modulo, codigo, descripcion) VALUES (?, ?, ?, ?)'
    );
    for (const [modulo, codigo, descripcion] of PERMISOS) {
      const id = uuid();
      insertPermiso.run(id, modulo, codigo, descripcion);
      permisoIdByCodigo.set(codigo, id);
    }

    const insertRol = db.prepare(
      'INSERT INTO roles (id, nombre, descripcion, es_rol_sistema, limite_descuento_pct) VALUES (?, ?, ?, 1, ?)'
    );
    const insertRolPermiso = db.prepare(
      'INSERT INTO roles_permisos (id, rol_id, permiso_id) VALUES (?, ?, ?)'
    );
    const rolIdByNombre = new Map();
    for (const rol of ROLES) {
      const rolId = uuid();
      insertRol.run(rolId, rol.nombre, rol.descripcion, rol.limite_descuento_pct);
      rolIdByNombre.set(rol.nombre, rolId);

      const codigos = rol.permisos === 'ALL' ? PERMISOS.map((p) => p[1]) : rol.permisos;
      for (const codigo of codigos) {
        insertRolPermiso.run(uuid(), rolId, permisoIdByCodigo.get(codigo));
      }
    }

    // --- Moneda local y tasa de ITBIS por defecto ---
    const monedaId = uuid();
    db.prepare('INSERT INTO monedas (id, codigo, nombre, es_local, activo) VALUES (?, ?, ?, 1, 1)').run(
      monedaId, 'DOP', 'Peso Dominicano'
    );

    const tasaItbisId = uuid();
    db.prepare(
      'INSERT INTO tasas_itbis (id, nombre, porcentaje, es_default, activo) VALUES (?, ?, ?, 1, 1)'
    ).run(tasaItbisId, '18%', 0.18);

    // --- Sucursal, almacén y caja por defecto ---
    const sucursalId = uuid();
    db.prepare(
      'INSERT INTO sucursales (id, nombre, es_principal, activo) VALUES (?, ?, 1, 1)'
    ).run(sucursalId, 'Sucursal Principal');

    const almacenId = uuid();
    db.prepare('INSERT INTO almacenes (id, sucursal_id, nombre, activo) VALUES (?, ?, ?, 1)').run(
      almacenId, sucursalId, 'Almacén Principal'
    );

    const cajaId = uuid();
    db.prepare('INSERT INTO cajas (id, sucursal_id, nombre, activo) VALUES (?, ?, ?, 1)').run(
      cajaId, sucursalId, 'Caja Principal'
    );

    // --- Periodo contable y catálogo de cuentas ---
    const fecha = new Date();
    const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1).toISOString().slice(0, 10);
    const finMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).toISOString().slice(0, 10);
    const nombrePeriodo = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
    db.prepare(
      "INSERT INTO periodos_contables (id, nombre, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?, 'abierto')"
    ).run(uuid(), nombrePeriodo, inicioMes, finMes);

    const cuentaIdByCodigo = new Map();
    const insertCuenta = db.prepare(
      'INSERT INTO cuentas_contables (id, codigo, nombre, tipo, cuenta_padre_id, es_movimiento) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [codigo, nombre, tipo, codigoPadre, esMovimiento] of CUENTAS_CONTABLES) {
      const id = uuid();
      const cuentaPadreId = codigoPadre ? cuentaIdByCodigo.get(codigoPadre) : null;
      insertCuenta.run(id, codigo, nombre, tipo, cuentaPadreId, esMovimiento);
      cuentaIdByCodigo.set(codigo, id);
    }

    // --- Tipos de NCF/e-CF (rangos de ejemplo; el negocio debe sustituirlos por los
    // rangos reales asignados por la DGII desde Configuración) ---
    const insertTipoNcf = db.prepare(
      `INSERT INTO tipos_ncf (id, codigo, nombre, aplica_cliente, secuencia_desde, secuencia_hasta, secuencia_actual, activo)
       VALUES (?, ?, ?, ?, 1, 500, 1, 1)`
    );
    insertTipoNcf.run(uuid(), 'B02', 'Consumo', 'consumo');
    insertTipoNcf.run(uuid(), 'B01', 'Crédito Fiscal', 'credito_fiscal');
    insertTipoNcf.run(uuid(), 'B14', 'Gubernamental', 'gubernamental');
    insertTipoNcf.run(uuid(), 'B15', 'Régimen Especial', 'regimen_especial');

    // --- Categoría de cliente y unidad de medida por defecto ---
    const insertCategoriaCliente = db.prepare(
      'INSERT INTO categorias_cliente (id, nombre, nivel_precio) VALUES (?, ?, ?)'
    );
    insertCategoriaCliente.run(uuid(), 'Detalle', 'detalle');
    insertCategoriaCliente.run(uuid(), 'Mayorista', 'mayorista');
    insertCategoriaCliente.run(uuid(), 'Distribuidor', 'distribuidor');

    db.prepare("INSERT INTO unidades_medida (id, nombre, abreviatura) VALUES (?, 'Unidad', 'UND')").run(
      uuid()
    );

    // --- Usuario administrador inicial ---
    // Usuario: admin / Contraseña temporal: admin123 — cambiar en el primer inicio de sesión.
    db.prepare(
      `INSERT INTO usuarios (id, nombre_completo, usuario, password_hash, rol_id, sucursal_id, activo)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(
      uuid(),
      'Administrador',
      'admin',
      hashPassword('admin123'),
      rolIdByNombre.get('Administrador/Dueño'),
      sucursalId
    );

    // --- Parámetros de negocio por defecto ---
    const insertParametro = db.prepare(
      'INSERT INTO parametros_negocio (clave, valor, descripcion, updated_at) VALUES (?, ?, ?, ?)'
    );
    const timestamp = now();
    insertParametro.run('dias_credito_default', '30', 'Días de crédito por defecto para clientes nuevos', timestamp);
    insertParametro.run('ventana_alerta_vencimiento_dias', '30', 'Días de anticipación para alertar productos próximos a vencer', timestamp);
    insertParametro.run('dias_mora_bloqueo_credito', '60', 'Días de mora tras los cuales se bloquea el crédito de un cliente', timestamp);

    // --- Identidad del negocio (editable desde Configuración) ---
    insertParametro.run('negocio_nombre', 'Mi Negocio', 'Nombre del negocio mostrado en el sidebar', timestamp);
    insertParametro.run('negocio_iniciales', 'MN', 'Iniciales del negocio para el distintivo del sidebar', timestamp);
    insertParametro.run('negocio_color_acento', '#146356', 'Color de acento de la interfaz', timestamp);
    insertParametro.run('negocio_rnc', '', 'RNC del negocio, impreso en el encabezado de factura', timestamp);
    insertParametro.run('negocio_direccion', '', 'Dirección del negocio, impresa en el encabezado de factura', timestamp);
    insertParametro.run('negocio_telefono', '', 'Teléfono del negocio, impreso en el encabezado de factura', timestamp);
  });

  insertMany();
}

// Se ejecuta en cada arranque (además de `seed`, que solo corre en una base de datos nueva):
// inserta en el catálogo cualquier código de PERMISOS que no exista todavía, y luego reconcilia
// cada rol del sistema (ROLES) contra su lista de permisos esperada, agregando los enlaces
// roles_permisos que falten — así una base de datos ya sembrada en una versión anterior de la
// app recibe los permisos nuevos (y su asignación a los roles correctos) sin necesitar un
// sistema de migraciones completo.
function sincronizarPermisosFaltantes(db) {
  const uuid = () => crypto.randomUUID();

  const existentes = new Set(db.prepare('SELECT codigo FROM permisos').all().map((p) => p.codigo));
  const faltantes = PERMISOS.filter(([, codigo]) => !existentes.has(codigo));
  const insertPermiso = db.prepare('INSERT INTO permisos (id, modulo, codigo, descripcion) VALUES (?, ?, ?, ?)');

  db.transaction(() => {
    for (const [modulo, codigo, descripcion] of faltantes) {
      insertPermiso.run(uuid(), modulo, codigo, descripcion);
    }

    const permisoIdByCodigo = new Map(db.prepare('SELECT id, codigo FROM permisos').all().map((p) => [p.codigo, p.id]));
    const insertRolPermiso = db.prepare('INSERT INTO roles_permisos (id, rol_id, permiso_id) VALUES (?, ?, ?)');

    for (const rol of ROLES) {
      const rolRow = db.prepare('SELECT id FROM roles WHERE nombre = ? AND es_rol_sistema = 1').get(rol.nombre);
      if (!rolRow) continue; // rol de sistema renombrado/eliminado por el usuario: no se reconcilia
      const codigosEsperados = rol.permisos === 'ALL' ? PERMISOS.map((p) => p[1]) : rol.permisos;
      const yaAsignados = new Set(
        db.prepare('SELECT permiso_id FROM roles_permisos WHERE rol_id = ? AND deleted_at IS NULL').all(rolRow.id).map((r) => r.permiso_id)
      );
      for (const codigo of codigosEsperados) {
        const permisoId = permisoIdByCodigo.get(codigo);
        if (permisoId && !yaAsignados.has(permisoId)) insertRolPermiso.run(uuid(), rolRow.id, permisoId);
      }
    }

    // Mismo problema con parámetros de negocio agregados en una versión posterior (ej. RNC,
    // dirección y teléfono del negocio, necesarios para el encabezado de factura impresa):
    // se insertan con valor vacío si la clave no existe todavía, sin tocar las que ya tienen valor.
    const parametrosExistentes = new Set(db.prepare('SELECT clave FROM parametros_negocio').all().map((p) => p.clave));
    const insertParametroFaltante = db.prepare(
      'INSERT INTO parametros_negocio (clave, valor, descripcion, updated_at) VALUES (?, ?, ?, ?)'
    );
    const ahora = new Date().toISOString();
    for (const [clave, valorDefault, descripcion] of PARAMETROS_NEGOCIO_NUEVOS) {
      if (!parametrosExistentes.has(clave)) insertParametroFaltante.run(clave, valorDefault, descripcion, ahora);
    }

    // Monedas extranjeras disponibles para facturar (la tasa del día se registra en Configuración).
    const insertMoneda = db.prepare('INSERT INTO monedas (id, codigo, nombre, es_local, activo) VALUES (?, ?, ?, 0, 1)');
    for (const [codigo, nombre] of MONEDAS_EXTRANJERAS) {
      if (!db.prepare('SELECT 1 FROM monedas WHERE codigo = ?').get(codigo)) insertMoneda.run(uuid(), codigo, nombre);
    }

    // Cuentas contables del catálogo mínimo agregadas en versiones posteriores (p. ej. 1350).
    const cuentaIdPorCodigo = new Map(db.prepare('SELECT id, codigo FROM cuentas_contables').all().map((c) => [c.codigo, c.id]));
    const insertCuentaFaltante = db.prepare(
      'INSERT INTO cuentas_contables (id, codigo, nombre, tipo, cuenta_padre_id, es_movimiento) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [codigo, nombre, tipo, codigoPadre, esMovimiento] of CUENTAS_CONTABLES) {
      if (cuentaIdPorCodigo.has(codigo)) continue;
      const id = uuid();
      insertCuentaFaltante.run(id, codigo, nombre, tipo, codigoPadre ? cuentaIdPorCodigo.get(codigoPadre) || null : null, esMovimiento);
      cuentaIdPorCodigo.set(codigo, id);
    }
  })();
}

module.exports = { seed, sincronizarPermisosFaltantes };
