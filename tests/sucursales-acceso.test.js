// Acceso por módulo, bitácora completa y trabajo por sucursal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const acceso = require('../main/auth/acceso');

const id = (r) => (typeof r === 'string' ? r : r.id);

// --- Acceso por módulo en los canales IPC ------------------------------------------------------

test('acceso: un cajero no lee contabilidad, compras ni CxP; el contador sí lee contabilidad', () => {
  const cajero = { permisos: new Set(['ventas.factura.crear', 'caja.apertura', 'inventario.ver', 'cxc.recibo.crear']) };
  for (const canal of ['contabilidad:listarAsientos', 'contabilidad:balanceGeneral', 'compras:listarFacturas', 'compras:listarProveedores', 'cxp:antiguedadSaldos']) {
    assert.throws(() => acceso.verificarCanal(canal, cajero), /No tienes acceso/, canal);
  }
  for (const canal of ['ventas:crearFactura', 'inventario:existencias', 'cxc:listarClientes', 'caja:abrirTurno', 'app:info']) {
    assert.doesNotThrow(() => acceso.verificarCanal(canal, cajero), canal);
  }
  const contador = { permisos: new Set(['contabilidad.ver', 'cxp.reportes.ver', 'compras.reportes.ver']) };
  assert.doesNotThrow(() => acceso.verificarCanal('contabilidad:libroMayor', contador));
  assert.doesNotThrow(() => acceso.verificarCanal('cxp:antiguedadSaldos', contador));
  const comprador = { permisos: new Set(['compras.orden.crear']) };
  assert.doesNotThrow(() => acceso.verificarCanal('compras:listarProveedores', comprador));
  assert.throws(() => acceso.verificarCanal('cxp:listarPagos', comprador), /Cuentas por Pagar/);
  assert.throws(() => acceso.verificarCanal('contabilidad:cuentas', null), /Inicia sesión/);
});

test('permisos que faltaban: proveedores y catálogo de cuentas', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const compras = h.m('compras');
  const conta = h.m('contabilidad');
  const prov = id(h.tx(db, () => compras.guardarProveedor(db, { nombre: 'Suplidor', diasCredito: 15 })));
  h.tx(db, () => conta.crearCuenta(db, { codigo: '6150', nombre: 'Publicidad', tipo: 'gasto' }));
  const contador = h.usuarioDeRol(db, 'Contador');
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => h.tx(db, () => compras.guardarProveedor(db, { nombre: 'Otro' })), /permiso/i);
  assert.throws(() => h.tx(db, () => compras.guardarProveedor(db, { nombre: 'Cambiado' }, prov)), /permiso/i);
  assert.throws(() => h.tx(db, () => conta.crearCuenta(db, { codigo: '6151', nombre: 'X', tipo: 'gasto' })), /permiso/i);
  h.loginUsuario(db, contador);
  h.tx(db, () => conta.crearCuenta(db, { codigo: '6152', nombre: 'Seguros', tipo: 'gasto' }));
  assert.ok(ctx);
});

test('bitácora: clientes, proveedores, productos, categorías, almacenes, cuentas contables y bancarias', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 100 });
  h.cliente(db, ctx);
  h.tx(db, () => h.m('compras').guardarProveedor(db, { nombre: 'Suplidor' }));
  h.tx(db, () => h.m('inventario').crearCategoria(db, { nombre: 'Bebidas' }));
  h.tx(db, () => h.m('inventario').crearAlmacen(db, { sucursalId: ctx.sucursalId, nombre: 'Depósito' }));
  h.tx(db, () => h.m('contabilidad').crearCuenta(db, { codigo: '6150', nombre: 'Publicidad', tipo: 'gasto' }));
  h.tx(db, () => h.m('caja').crearCuentaBancaria(db, { nombre: 'Corriente', banco: 'Banco' }));
  const entidades = new Set(db.prepare("SELECT entidad FROM bitacora_auditoria WHERE accion IN ('crear', 'editar')").all().map((r) => r.entidad));
  for (const e of ['clientes', 'proveedores', 'productos', 'categorias_producto', 'almacenes', 'cuentas_contables', 'cuentas_bancarias']) assert.ok(entidades.has(e), e);
  const fila = db.prepare("SELECT usuario_id FROM bitacora_auditoria WHERE entidad = 'productos' AND entidad_id = ?").get(p);
  assert.equal(fila.usuario_id, ctx.usuarioId, 'firma el usuario de la sesión');
});

// --- Sucursales -----------------------------------------------------------------------------

test('sucursales: cada usuario trabaja con la sucursal, el almacén y la caja que le tocan', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const caja = h.m('caja');
  const config = h.m('configuracion');
  const norte = id(h.tx(db, () => config.crearSucursal(db, { nombre: 'Sucursal Norte' }, ctx.usuarioId)));
  const almNorte = h.tx(db, () => h.m('inventario').crearAlmacen(db, { sucursalId: norte, nombre: 'Almacén Norte' }));
  const cajaNorte = h.tx(db, () => caja.crearCaja(db, { sucursalId: norte, nombre: 'Caja Norte', usuarioId: ctx.usuarioId }));
  const rol = db.prepare("SELECT id FROM roles WHERE nombre LIKE 'Cajero%'").get().id;
  const ana = h.tx(db, () => config.crearUsuario(db, { nombreCompleto: 'Ana', usuario: 'ana', password: 'clave-segura', rolId: rol, sucursalId: norte }, ctx.usuarioId));
  assert.equal(caja.sucursalDelUsuario(db, ana).id, norte);
  assert.equal(caja.almacenDeSucursal(db, norte).id, almNorte.id);
  assert.equal(caja.cajaDelUsuario(db, ana).id, cajaNorte.id);
  // El administrador (sin sucursal propia en la prueba) sigue en la principal.
  db.prepare('UPDATE usuarios SET sucursal_id = NULL WHERE id = ?').run(ctx.usuarioId);
  assert.equal(caja.sucursalDelUsuario(db, ctx.usuarioId).id, ctx.sucursalId);
  assert.equal(caja.cajaDelUsuario(db, ctx.usuarioId).id, ctx.cajaId);
  // Editar el usuario no le borra la sucursal.
  h.tx(db, () => config.actualizarUsuario(db, ana, { nombreCompleto: 'Ana Pérez', rolId: rol, sucursalId: norte }, ctx.usuarioId));
  assert.equal(caja.sucursalDelUsuario(db, ana).id, norte);
});

test('ventas por sucursal: consolidado con participación y filtros por sucursal en los reportes', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const ventas = h.m('ventas');
  const norte = id(h.tx(db, () => h.m('configuracion').crearSucursal(db, { nombre: 'Sucursal Norte' }, ctx.usuarioId)));
  const almNorte = h.tx(db, () => h.m('inventario').crearAlmacen(db, { sucursalId: norte, nombre: 'Almacén Norte' })).id;
  const p = h.producto(db, ctx, { precioDetalle: 100 });
  h.entrada(db, ctx, p, 50, 40);
  h.tx(db, () => h.m('inventario').crearAjuste(db, { almacenId: almNorte, tipo: 'entrada', motivo: 'Inicial', usuarioId: ctx.usuarioId, lineas: [{ productoId: p, cantidad: 20, costoUnitario: 40 }] }));
  h.abrirTurno(db, ctx, 0);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 3 }], [{ formaPago: 'efectivo', monto: 300 }]);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'tarjeta', monto: 100 }], { sucursalId: norte, almacenId: almNorte });
  const r = ventas.ventasPorSucursal(db, {});
  assert.deepEqual(r.map((x) => [x.sucursal_id, x.total, x.participacion_pct]), [[ctx.sucursalId, 300, 75], [norte, 100, 25]]);
  assert.equal(ventas.ventasPorPeriodo(db, { sucursalId: norte })[0].total, 100);
  assert.equal(ventas.ventasPorArticulo(db, { sucursalId: norte })[0].cantidad_vendida, 1);
  assert.equal(ventas.itbisGeneradoVentas(db, { sucursalId: ctx.sucursalId }).reduce((a, x) => a + x.base_total + x.itbis_total, 0), 300);
  const cobros = ventas.resumenCobrosDelDia(db, { sucursalId: norte });
  assert.deepEqual([cobros.totalFacturado, cobros.porForma.tarjeta, cobros.porForma.efectivo], [100, 100, 0]);
  assert.equal(ventas.resumenCobrosDelDia(db, {}).totalFacturado, 400, 'sin sucursal: consolidado');
});

// --- Cuadrícula táctil del mostrador -------------------------------------------------------

test('productos rápidos: primero los más vendidos en 30 días, filtrables por categoría, con existencia del almacén', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const inv = h.m('inventario');
  const bebidas = h.tx(db, () => inv.crearCategoria(db, { nombre: 'Bebidas' })).id;
  const agua = h.producto(db, ctx, { descripcion: 'Agua', precioDetalle: 25 });
  const refresco = h.producto(db, ctx, { descripcion: 'Refresco', precioDetalle: 50 });
  const pan = h.producto(db, ctx, { descripcion: 'Pan', precioDetalle: 10 });
  db.prepare('UPDATE productos SET categoria_id = ? WHERE id IN (?, ?)').run(bebidas, agua, refresco);
  for (const p of [agua, refresco, pan]) h.entrada(db, ctx, p, 50, 5);
  h.abrirTurno(db, ctx, 0);
  h.facturar(db, ctx, [{ productoId: refresco, cantidad: 5 }], [{ formaPago: 'efectivo', monto: 250 }]);
  h.facturar(db, ctx, [{ productoId: pan, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 20 }]);
  const todos = inv.productosRapidos(db, { almacenId: ctx.almacenId });
  assert.deepEqual(todos.slice(0, 3).map((p) => p.descripcion), ['Refresco', 'Pan', 'Agua']);
  assert.equal(todos[0].vendido_30d, 5);
  assert.equal(todos[0].cantidad_disponible, 45);
  assert.deepEqual(inv.productosRapidos(db, { almacenId: ctx.almacenId, categoriaId: bebidas }).map((p) => p.descripcion), ['Refresco', 'Agua']);
  assert.equal(inv.productosRapidos(db, { almacenId: ctx.almacenId, limite: 1000 }).length <= 60, true, 'tope de 60');
});
