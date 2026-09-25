const { contextBridge, ipcRenderer } = require('electron');

const invoke = (canal) => (payload) => ipcRenderer.invoke(canal, payload);

contextBridge.exposeInMainWorld('puntoX', {
  getAppInfo: invoke('app:info'),
});

contextBridge.exposeInMainWorld('puntoXAuth', {
  login: invoke('auth:login'),
  logout: invoke('auth:logout'),
  sesionActual: invoke('auth:sesionActual'),
});

contextBridge.exposeInMainWorld('puntoXInventario', {
  buscarProductos: invoke('productos:buscar'),
  obtenerProducto: invoke('productos:obtener'),
  obtenerProductoCompleto: invoke('productos:obtenerCompleto'),
  listarProductos: invoke('productos:listar'),
  guardarProducto: invoke('productos:guardar'),

  listarAlmacenes: invoke('almacenes:listar'),
  crearAlmacen: invoke('almacenes:crear'),
  listarCategorias: invoke('inventario:categorias'),
  listarUnidadesMedida: invoke('inventario:unidadesMedida'),
  listarTasasItbis: invoke('inventario:tasasItbis'),

  existencias: invoke('inventario:existencias'),
  kardex: invoke('inventario:kardex'),
  vencimientos: invoke('inventario:vencimientos'),

  crearAjuste: invoke('inventario:crearAjuste'),
  listarAjustes: invoke('inventario:listarAjustes'),

  crearMerma: invoke('inventario:crearMerma'),
  listarMermas: invoke('inventario:listarMermas'),

  crearTransferencia: invoke('inventario:crearTransferencia'),
  listarTransferencias: invoke('inventario:listarTransferencias'),
});

contextBridge.exposeInMainWorld('puntoXCxc', {
  buscarClientes: invoke('clientes:buscar'),
  obtenerCliente: invoke('clientes:obtener'),
  listarClientes: invoke('clientes:listar'),
  listarCategorias: invoke('clientes:categorias'),
  crearCliente: invoke('clientes:crear'),
  guardarCliente: invoke('clientes:guardar'),
  facturasAbiertas: invoke('clientes:facturasAbiertas'),
  estadoCuenta: invoke('clientes:estadoCuenta'),

  crearRecibo: invoke('cxc:crearRecibo'),
  anularRecibo: invoke('cxc:anularRecibo'),
  listarRecibos: invoke('cxc:listarRecibos'),

  antiguedadSaldos: invoke('cxc:antiguedadSaldos'),
  facturasVencidas: invoke('cxc:facturasVencidas'),

  crearGestionCobro: invoke('cxc:crearGestionCobro'),
  listarGestionCobros: invoke('cxc:listarGestionCobros'),

  crearCxcEmpleado: invoke('cxc:crearCxcEmpleado'),
  registrarPagoCxcEmpleado: invoke('cxc:registrarPagoCxcEmpleado'),
  listarCxcEmpleados: invoke('cxc:listarCxcEmpleados'),
});

contextBridge.exposeInMainWorld('puntoXCaja', {
  obtenerCajaPrincipal: invoke('caja:principal'),
  listarCajas: invoke('caja:listar'),
  crearCaja: invoke('caja:crear'),

  obtenerTurnoAbierto: invoke('caja:turnoAbierto'),
  abrirTurno: invoke('caja:abrirTurno'),
  cerrarTurno: invoke('caja:cerrarTurno'),
  listarTurnos: invoke('caja:listarTurnos'),
  historialSobrantesFaltantes: invoke('caja:historialSobrantesFaltantes'),
  efectivoEsperado: invoke('caja:efectivoEsperado'),
  movimientosDeTurno: invoke('caja:movimientosDeTurno'),
  registrarMovimientoManual: invoke('caja:registrarMovimientoManual'),

  obtenerCajaChica: invoke('caja:cajaChica'),
  crearGastoCajaChica: invoke('caja:crearGastoCajaChica'),
  listarGastosCajaChica: invoke('caja:listarGastosCajaChica'),

  listarCuentasBancarias: invoke('caja:listarCuentasBancarias'),
  crearCuentaBancaria: invoke('caja:crearCuentaBancaria'),
  crearTransferenciaBanco: invoke('caja:crearTransferenciaBanco'),
  listarTransferenciasBanco: invoke('caja:listarTransferenciasBanco'),

  listarConciliaciones: invoke('caja:listarConciliaciones'),
  obtenerConciliacion: invoke('caja:obtenerConciliacion'),
  crearConciliacion: invoke('caja:crearConciliacion'),
  actualizarSaldoEstadoCuenta: invoke('caja:actualizarSaldoEstadoCuenta'),
  agregarPartidasConciliacion: invoke('caja:agregarPartidasConciliacion'),
  eliminarPartidaConciliacion: invoke('caja:eliminarPartidaConciliacion'),
  conciliarPareja: invoke('caja:conciliarPareja'),
  conciliarAutomaticamente: invoke('caja:conciliarAutomaticamente'),
  registrarPartidaEnContabilidad: invoke('caja:registrarPartidaEnContabilidad'),
  deshacerConciliacionPartida: invoke('caja:deshacerConciliacionPartida'),
  cerrarConciliacion: invoke('caja:cerrarConciliacion'),
  reabrirConciliacion: invoke('caja:reabrirConciliacion'),
});

contextBridge.exposeInMainWorld('puntoXContabilidad', {
  listarCuentas: invoke('contabilidad:cuentas'),
  crearCuenta: invoke('contabilidad:crearCuenta'),
  actualizarCuenta: invoke('contabilidad:actualizarCuenta'),

  listarAsientos: invoke('contabilidad:listarAsientos'),
  libroMayor: invoke('contabilidad:libroMayor'),
  balanceComprobacion: invoke('contabilidad:balanceComprobacion'),
  estadoResultados: invoke('contabilidad:estadoResultados'),
  balanceGeneral: invoke('contabilidad:balanceGeneral'),

  crearAsientoManual: invoke('contabilidad:crearAsientoManual'),
  anularAsiento: invoke('contabilidad:anularAsiento'),

  listarPeriodos: invoke('contabilidad:listarPeriodos'),
  cerrarPeriodo: invoke('contabilidad:cerrarPeriodo'),
  reabrirPeriodo: invoke('contabilidad:reabrirPeriodo'),
});

contextBridge.exposeInMainWorld('puntoXCompras', {
  buscarProveedores: invoke('proveedores:buscar'),
  obtenerProveedor: invoke('proveedores:obtener'),
  listarProveedores: invoke('proveedores:listar'),
  crearProveedor: invoke('proveedores:crear'),
  guardarProveedor: invoke('proveedores:guardar'),

  crearFacturaCompra: invoke('compras:crearFacturaCompra'),
  anularFacturaCompra: invoke('compras:anularFacturaCompra'),
  listarFacturas: invoke('compras:listarFacturas'),
  obtenerFactura: invoke('compras:obtenerFactura'),

  crearOrden: invoke('compras:crearOrden'),
  listarOrdenes: invoke('compras:listarOrdenes'),
  obtenerOrden: invoke('compras:obtenerOrden'),
  anularOrden: invoke('compras:anularOrden'),

  comparacionMejorCosto: invoke('compras:comparacionMejorCosto'),
  comprasPorProducto: invoke('compras:comprasPorProducto'),
});

contextBridge.exposeInMainWorld('puntoXCxp', {
  facturasAbiertas: invoke('cxp:facturasAbiertas'),
  crearPago: invoke('cxp:crearPago'),
  anularPago: invoke('cxp:anularPago'),
  listarPagos: invoke('cxp:listarPagos'),
  antiguedadSaldos: invoke('cxp:antiguedadSaldos'),
  facturasProximasAVencer: invoke('cxp:facturasProximasAVencer'),
  chequesPosdatadosPendientes: invoke('cxp:chequesPosdatadosPendientes'),
  marcarChequeCobrado: invoke('cxp:marcarChequeCobrado'),
});

contextBridge.exposeInMainWorld('puntoXConfig', {
  obtenerDatosNegocio: invoke('config:datosNegocio'),
  actualizarDatosNegocio: invoke('config:actualizarDatosNegocio'),

  listarParametrosNegocio: invoke('config:parametrosNegocio'),
  actualizarParametro: invoke('config:actualizarParametro'),

  listarUsuarios: invoke('config:listarUsuarios'),
  crearUsuario: invoke('config:crearUsuario'),
  actualizarUsuario: invoke('config:actualizarUsuario'),

  listarRoles: invoke('config:listarRoles'),
  listarPermisos: invoke('config:listarPermisos'),
  permisosDeRol: invoke('config:permisosDeRol'),
  actualizarPermisosRol: invoke('config:actualizarPermisosRol'),
  actualizarLimiteDescuentoRol: invoke('config:actualizarLimiteDescuentoRol'),

  listarTasasItbis: invoke('config:listarTasasItbis'),
  crearTasaItbis: invoke('config:crearTasaItbis'),
  actualizarTasaItbis: invoke('config:actualizarTasaItbis'),

  listarTiposNcf: invoke('config:listarTiposNcf'),
  crearTipoNcf: invoke('config:crearTipoNcf'),
  ampliarRangoNcf: invoke('config:ampliarRangoNcf'),
  actualizarEstadoTipoNcf: invoke('config:actualizarEstadoTipoNcf'),

  listarSucursales: invoke('config:listarSucursales'),
  crearSucursal: invoke('config:crearSucursal'),

  listarBitacora: invoke('config:listarBitacora'),
});

contextBridge.exposeInMainWorld('puntoXImpresion', {
  listarImpresoras: invoke('impresion:listarImpresoras'),
  guardarImpresora: invoke('impresion:guardarImpresora'),
  eliminarImpresora: invoke('impresion:eliminarImpresora'),
  listarDispositivos: invoke('impresion:listarDispositivos'),
  imprimirFactura: invoke('impresion:imprimirFactura'),
  imprimirArqueo: invoke('impresion:imprimirArqueo'),
});

contextBridge.exposeInMainWorld('puntoXVentas', {
  crearFactura: invoke('ventas:crearFactura'),
  anularFactura: invoke('ventas:anularFactura'),
  listarFacturas: invoke('ventas:listarFacturas'),
  obtenerFactura: invoke('ventas:obtenerFactura'),
  listarMonedas: invoke('ventas:monedas'),
  listarVendedores: invoke('ventas:vendedores'),

  crearNotaCredito: invoke('ventas:crearNotaCredito'),
  anularNotaCredito: invoke('ventas:anularNotaCredito'),
  crearNotaDebito: invoke('ventas:crearNotaDebito'),
  anularNotaDebito: invoke('ventas:anularNotaDebito'),
  listarNotas: invoke('ventas:listarNotas'),

  ventasPorPeriodo: invoke('ventas:reportes:ventasPorPeriodo'),
  ventasPorVendedor: invoke('ventas:reportes:ventasPorVendedor'),
  ventasPorArticulo: invoke('ventas:reportes:ventasPorArticulo'),
  comisionesPorVendedor: invoke('ventas:reportes:comisionesPorVendedor'),
  marcarComisionPagada: invoke('ventas:reportes:marcarComisionPagada'),
  margenPorFactura: invoke('ventas:reportes:margenPorFactura'),
  resumenCobrosDelDia: invoke('ventas:reportes:resumenCobrosDelDia'),
  itbisGeneradoVentas: invoke('ventas:reportes:itbisGeneradoVentas'),
});
