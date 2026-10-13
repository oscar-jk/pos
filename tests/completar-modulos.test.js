// Huecos cerrados en la revisión por módulo: roles propios, delivery y varias cajas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const config = () => h.m('configuracion');
const delivery = () => h.m('delivery');
const caja = () => h.m('caja');
const id = (r) => (typeof r === 'string' ? r : r.id);

// --- Roles ----------------------------------------------------------------------------------

test('roles: crear uno propio a partir de otro, editarlo y eliminarlo', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const cajero = db.prepare("SELECT * FROM roles WHERE nombre LIKE 'Cajero%'").get();
  const rolId = h.tx(db, () => config().crearRol(db, { nombre: '  Cajero   nocturno ', descripcion: 'Turno de noche', copiarDeRolId: cajero.id }, ctx.usuarioId));
  const rol = db.prepare('SELECT * FROM roles WHERE id = ?').get(rolId);
  assert.equal(rol.nombre, 'Cajero nocturno');
  assert.equal(rol.es_rol_sistema, 0);
  assert.equal(rol.limite_descuento_pct, cajero.limite_descuento_pct);
  assert.deepEqual(new Set(config().permisosDeRol(db, rolId)), new Set(config().permisosDeRol(db, cajero.id)));

  assert.throws(() => h.tx(db, () => config().crearRol(db, { nombre: 'cajero NOCTURNO' }, ctx.usuarioId)), /Ya existe/);
  h.tx(db, () => config().editarRol(db, rolId, { nombre: 'Cajero de noche', descripcion: '' }, ctx.usuarioId));
  assert.equal(db.prepare('SELECT nombre FROM roles WHERE id = ?').get(rolId).nombre, 'Cajero de noche');

  // Con un usuario asignado no se elimina; sin usuarios, sí (borrado lógico).
  const u = h.tx(db, () => config().crearUsuario(db, { nombreCompleto: 'Luis', usuario: 'luis', password: 'clave-segura', rolId }, ctx.usuarioId));
  assert.throws(() => h.tx(db, () => config().eliminarRol(db, rolId, ctx.usuarioId)), /1 usuario/);
  db.prepare('UPDATE usuarios SET rol_id = ? WHERE id = ?').run(cajero.id, u);
  h.tx(db, () => config().eliminarRol(db, rolId, ctx.usuarioId));
  assert.ok(db.prepare('SELECT deleted_at FROM roles WHERE id = ?').get(rolId).deleted_at);
  assert.equal(config().listarRoles(db).some((r) => r.id === rolId), false);
  // Crear de nuevo con el mismo nombre restaura el rol, sin permisos viejos.
  const otra = h.tx(db, () => config().crearRol(db, { nombre: 'Cajero de noche' }, ctx.usuarioId));
  assert.equal(otra, rolId);
  assert.equal(config().permisosDeRol(db, rolId).length, 0);
});

test('roles: los del sistema no se renombran ni se eliminan; exige permiso', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const admin = db.prepare("SELECT id FROM roles WHERE nombre = 'Administrador/Dueño'").get().id;
  assert.throws(() => h.tx(db, () => config().editarRol(db, admin, { nombre: 'Jefe' }, ctx.usuarioId)), /no se pueden renombrar/);
  h.tx(db, () => config().editarRol(db, admin, { nombre: 'Administrador/Dueño', descripcion: 'Todo' }, ctx.usuarioId));
  assert.throws(() => h.tx(db, () => config().eliminarRol(db, admin, ctx.usuarioId)), /no se pueden eliminar/);
  assert.throws(() => h.tx(db, () => config().crearRol(db, { nombre: ' ' }, ctx.usuarioId)), /nombre del rol/);
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => h.tx(db, () => config().crearRol(db, { nombre: 'X' }, ctx.usuarioId)), /permiso/i);
});

// --- Delivery -------------------------------------------------------------------------------

function baseVentas() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  h.entrada(db, ctx, p, 20, 40);
  h.abrirTurno(db, ctx, 0);
  return { db, ctx, p };
}
const venderDelivery = (db, ctx, p, extra) => id(h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { esDelivery: true, ...extra }));

test('delivery: la factura guarda dirección, zona, tiempo y repartidor; avanza hasta entregado', () => {
  const { db, ctx, p } = baseVentas();
  const moto = h.usuarioDeRol(db, 'Cajero');
  const f = venderDelivery(db, ctx, p, { direccionEntrega: 'Calle 5 #12, Naco', zonaEntrega: 'Naco', tiempoEstimadoMin: 45 });
  const d = db.prepare('SELECT * FROM documentos_venta WHERE id = ?').get(f);
  assert.deepEqual([d.es_delivery, d.estado_delivery, d.zona_entrega, d.tiempo_estimado_min, d.repartidor_id], [1, 'pendiente', 'Naco', 45, null]);
  assert.equal(delivery().listarDeliveries(db, { estado: 'activos' }).length, 1);
  assert.throws(() => h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, usuarioId: ctx.usuarioId })), /Asigna el repartidor/);
  assert.equal(h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, repartidorId: moto, usuarioId: ctx.usuarioId })), 'en_ruta');
  assert.ok(db.prepare('SELECT fecha_en_ruta FROM documentos_venta WHERE id = ?').get(f).fecha_en_ruta);
  assert.equal(h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, usuarioId: ctx.usuarioId })), 'entregado');
  assert.throws(() => h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, usuarioId: ctx.usuarioId })), /ya fue entregado/);
  assert.equal(delivery().listarDeliveries(db, { estado: 'activos' }).length, 0);
  assert.equal(delivery().listarDeliveries(db, { estado: 'entregado' })[0].repartidor_id, moto);
});

test('delivery: valida la dirección y el tiempo, y no avanza una factura anulada', () => {
  const { db, ctx, p } = baseVentas();
  assert.throws(() => venderDelivery(db, ctx, p, { direccionEntrega: '  ' }), /dirección de entrega/);
  assert.throws(() => venderDelivery(db, ctx, p, { direccionEntrega: 'X', tiempoEstimadoMin: 0 }), /1 a 1440/);
  assert.throws(() => venderDelivery(db, ctx, p, { direccionEntrega: 'X', repartidorId: 'no-existe' }), /repartidor/);
  const f = venderDelivery(db, ctx, p, { direccionEntrega: 'Av. Lincoln' });
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'Cliente canceló', usuarioId: ctx.usuarioId }));
  assert.throws(() => h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, repartidorId: ctx.usuarioId, usuarioId: ctx.usuarioId })), /anulada/);
  // Una venta sin delivery no guarda datos de entrega aunque lleguen.
  const normal = id(h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { direccionEntrega: 'X' }));
  assert.equal(db.prepare('SELECT direccion_entrega FROM documentos_venta WHERE id = ?').get(normal).direccion_entrega, null);
});

test('delivery: tiempos de entrega por repartidor y por zona, con la parte a tiempo', () => {
  const { db, ctx, p } = baseVentas();
  const a = h.usuarioDeRol(db, 'Cajero');
  const entregar = (zona, estimado, minutosReales, repartidorId) => {
    const f = venderDelivery(db, ctx, p, { direccionEntrega: 'Dir', zonaEntrega: zona, tiempoEstimadoMin: estimado, repartidorId });
    h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, usuarioId: ctx.usuarioId }));
    h.tx(db, () => delivery().avanzarDelivery(db, { documentoId: f, usuarioId: ctx.usuarioId }));
    const fecha = db.prepare('SELECT fecha FROM documentos_venta WHERE id = ?').get(f).fecha;
    db.prepare('UPDATE documentos_venta SET fecha_entrega_real = ? WHERE id = ?').run(new Date(Date.parse(fecha) + minutosReales * 60000).toISOString(), f);
  };
  entregar('Naco', 45, 30, a);
  entregar('Naco', 45, 60, a);
  entregar('Gazcue', null, 20, ctx.usuarioId);
  const r = delivery().reporteTiempoEntrega(db, {});
  assert.equal(r.entregas, 3);
  assert.equal(r.promedioMin, 36.67);
  const naco = r.porZona.find((z) => z.nombre === 'Naco');
  assert.deepEqual([naco.entregas, naco.promedioMin, naco.pctATiempo], [2, 45, 50]);
  assert.equal(r.porZona.find((z) => z.nombre === 'Gazcue').pctATiempo, null, 'sin estimado no se mide a tiempo');
  assert.equal(r.porRepartidor.length, 2);
  assert.equal(delivery().reporteTiempoEntrega(db, { desde: '2020-01-01', hasta: '2020-01-31' }).entregas, 0);
});

// --- Cajas ----------------------------------------------------------------------------------

test('cajas: se crean por sucursal y cada usuario trabaja con la de su turno abierto', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const principal = caja().cajaDelUsuario(db, ctx.usuarioId);
  assert.equal(principal.id, ctx.cajaId);
  const c2 = h.tx(db, () => caja().crearCaja(db, { sucursalId: ctx.sucursalId, nombre: 'Caja 2', usuarioId: ctx.usuarioId }));
  assert.throws(() => h.tx(db, () => caja().crearCaja(db, { sucursalId: ctx.sucursalId, nombre: 'caja 2', usuarioId: ctx.usuarioId })), /Ya existe/);
  assert.throws(() => h.tx(db, () => caja().crearCaja(db, { sucursalId: 'x', nombre: 'Caja 3', usuarioId: ctx.usuarioId })), /sucursal/);
  assert.equal(caja().listarCajas(db).length, 2);
  // Abre turno en la caja 2: ventas y cobros de este usuario van a esa caja.
  h.tx(db, () => caja().abrirTurno(db, { cajaId: c2.id, fondoInicial: 500, usuarioId: ctx.usuarioId }));
  assert.equal(caja().cajaDelUsuario(db, ctx.usuarioId).id, c2.id);
  const otro = h.usuarioDeRol(db, 'Cajero');
  assert.equal(caja().cajaDelUsuario(db, otro).id, ctx.cajaId, 'sin turno, la primera caja');
  assert.ok(db.prepare("SELECT 1 FROM bitacora_auditoria WHERE entidad = 'cajas' AND entidad_id = ?").get(c2.id));
});

// --- Estado de cuenta: imprimible y exportable --------------------------------------------

test('estado de cuenta: cargos y abonos con su nombre, HTML imprimible y CSV para Excel', () => {
  const { db, ctx, p } = baseVentas();
  const cliente = h.cliente(db, ctx, { nombre: 'Ferretería "La 27", SRL' });
  const f = id(h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'credito', monto: 236 }], { clienteId: cliente }));
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Devuelto', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  const movimientos = h.m('cxc').estadoCuenta(db, cliente);
  assert.deepEqual(movimientos.map((m) => m.tipo), ['factura', 'nota_credito']);
  assert.equal(movimientos[1].saldo_acumulado, 118);
  const html = require('../main/printing').htmlEstadoCuenta(db, cliente);
  assert.match(html, /ESTADO DE CUENTA/);
  assert.match(html, /Nota de crédito/);
  assert.match(html, /Ferretería &quot;La 27&quot;, SRL/);
  assert.match(html, /Saldo pendiente: RD\$ 118\.00/);
  const csv = h.m('cxc').csvEstadoCuenta(db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente), movimientos);
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /"Ferretería ""La 27"", SRL"/);
  assert.match(csv, /Nota de crédito,[^,]*,,118\.00,118\.00/);
});

test('alertas del dashboard: enlazan a su pantalla y existe el filtro de stock sobre el máximo', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dash = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dashboard', 'dashboard.js'), 'utf8');
  for (const destino of ['inventario/index.html#existencias', 'inventario/index.html#vencimientos', 'cuentas-por-cobrar/index.html#vencidas', 'cuentas-por-pagar/index.html#proximas', 'cuentas-por-cobrar/index.html#empleados', 'ventas/ecf.html']) {
    assert.ok(dash.includes(destino), destino);
  }
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  db.prepare('UPDATE productos SET stock_maximo = 10 WHERE id = ?').run(p);
  h.entrada(db, ctx, p, 15, 40);
  const sobre = h.m('inventario').existenciasConsolidadas(db, { soloSobreMaximo: true });
  assert.deepEqual(sobre.map((x) => x.id), [p]);
});

// --- Listados con filtros -----------------------------------------------------------------

test('listado de CxC: saldo por vendedor, sucursal y categoría, con vencido y crédito disponible', () => {
  const { db, ctx, p } = baseVentas();
  const ana = h.usuarioDeRol(db, 'Cajero');
  const mayorista = db.prepare("SELECT id FROM categorias_cliente WHERE nombre = 'Mayorista'").get().id;
  const c1 = h.cliente(db, ctx, { nombre: 'Colmado Uno', categoriaId: mayorista, limiteCredito: 1000, diasCredito: 30 });
  const c2 = h.cliente(db, ctx, { nombre: 'Colmado Dos' });
  const credito = (cliente, vendedorId, n) => id(h.facturar(db, ctx, [{ productoId: p, cantidad: n }], [{ formaPago: 'credito', monto: 118 * n }], { clienteId: cliente, vendedorId }));
  const vieja = credito(c1, ana, 2);
  db.prepare('UPDATE documentos_venta SET fecha = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86400000).toISOString(), vieja);
  credito(c1, ctx.usuarioId, 1);
  credito(c2, ctx.usuarioId, 3);
  const cxc = h.m('cxc');
  const todo = cxc.listadoCxc(db, { soloConSaldo: true });
  assert.deepEqual(todo.map((f) => [f.nombre, f.saldo_pendiente]), [['Colmado Dos', 354], ['Colmado Uno', 354]]);
  const uno = todo.find((f) => f.nombre === 'Colmado Uno');
  assert.equal(uno.saldo_vencido, 236);
  assert.equal(uno.credito_disponible, 646);
  assert.deepEqual(cxc.listadoCxc(db, { vendedorId: ana, soloConSaldo: true }).map((f) => [f.nombre, f.saldo_pendiente]), [['Colmado Uno', 236]]);
  assert.deepEqual(cxc.listadoCxc(db, { categoriaId: mayorista, soloConSaldo: true }).map((f) => f.nombre), ['Colmado Uno']);
  assert.equal(cxc.listadoCxc(db, { sucursalId: 'otra', soloConSaldo: true }).length, 0);
});

test('historial de compras con estado de pago y listado de CxP por urgencia', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  h.abrirTurno(db, ctx, 0);
  const p = h.producto(db, ctx, { precioDetalle: 500 });
  const compras = h.m('compras');
  const prov = (nombre) => id(h.tx(db, () => compras.guardarProveedor(db, { nombre, diasCredito: 30 })));
  const a = prov('Proveedor A');
  const b = prov('Proveedor B');
  const comprar = (proveedorId, formaPago) => id(h.tx(db, () => compras.crearFacturaCompra(db, {
    proveedorId, almacenId: ctx.almacenId, sucursalId: ctx.sucursalId, usuarioId: ctx.usuarioId, cajaId: ctx.cajaId, ncfProveedor: 'B0100000001',
    lineas: [{ productoId: p, cantidad: 10, costoUnitario: 100 }], pagos: [{ formaPago, monto: 1180 }],
  })));
  const pagada = comprar(a, 'efectivo');
  const parcial = comprar(a, 'credito');
  const pendiente = comprar(b, 'credito');
  db.prepare('UPDATE documentos_compra SET fecha_vencimiento = ? WHERE id = ?').run(new Date(Date.now() - 10 * 86400000).toISOString(), pendiente);
  h.tx(db, () => h.m('cxp').crearPago(db, { proveedorId: a, formaPago: 'transferencia', aplicaciones: [{ documentoCompraId: parcial, montoAplicado: 500 }], usuarioId: ctx.usuarioId }));
  const hist = compras.historialCompras(db, {});
  const estado = (docId) => hist.find((x) => x.id === docId).estado_pago;
  assert.deepEqual([estado(pagada), estado(parcial), estado(pendiente)], ['pagada', 'parcial', 'pendiente']);
  assert.equal(hist.find((x) => x.id === parcial).pendiente, 680);
  assert.deepEqual(compras.historialCompras(db, { proveedorId: b }).map((x) => x.id), [pendiente]);
  assert.deepEqual(compras.historialCompras(db, { estadoPago: 'parcial' }).map((x) => x.id), [parcial]);
  const cxp = compras.listadoCxp(db, {});
  assert.deepEqual(cxp.map((x) => x.nombre), ['Proveedor B', 'Proveedor A'], 'lo vencido primero');
  assert.equal(cxp[0].dias_mora_max, 10);
  assert.equal(cxp[0].saldo_vencido, 1180);
  assert.deepEqual(compras.listadoCxp(db, { orden: 'saldo' }).map((x) => x.saldo_pendiente), [1180, 680]);
  assert.deepEqual(compras.listadoCxp(db, { soloVencidos: true }).map((x) => x.nombre), ['Proveedor B']);
});

// --- Caja chica de fondo fijo ---------------------------------------------------------------

test('caja chica: el gasto no supera lo disponible, la reposición abre un periodo nuevo y el fondo se ajusta', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const turno = id(h.abrirTurno(db, ctx, 5000));
  const cc = h.tx(db, () => caja().obtenerOCrearCajaChica(db, { cajaId: ctx.cajaId, fondoAsignado: 1000 }));
  const gastar = (monto) => h.tx(db, () => caja().crearGastoCajaChica(db, { cajaChicaId: cc.id, turnoCajaId: turno, concepto: 'Agua', monto, comprobanteRuta: 'Recibo 1', usuarioId: ctx.usuarioId }));
  gastar(600);
  assert.throws(() => gastar(500), /supera lo disponible en caja chica \(RD\$ 400\.00\)/);
  gastar(400);
  let r = caja().resumenCajaChica(db, cc.id);
  assert.deepEqual([r.gastado_periodo, r.disponible, r.reposiciones.length], [1000, 0, 0]);
  h.tx(db, () => caja().reponerCajaChica(db, { cajaChicaId: cc.id, usuarioId: ctx.usuarioId }));
  r = caja().resumenCajaChica(db, cc.id);
  assert.deepEqual([r.gastado_periodo, r.disponible], [0, 1000]);
  assert.deepEqual([r.reposiciones[0].monto, r.reposiciones[0].gastos], [1000, 2]);
  assert.throws(() => h.tx(db, () => caja().reponerCajaChica(db, { cajaChicaId: cc.id, usuarioId: ctx.usuarioId })), /No hay gastos que reponer/);
  gastar(250);
  h.tx(db, () => caja().actualizarFondoCajaChica(db, { cajaChicaId: cc.id, fondoAsignado: 2000, usuarioId: ctx.usuarioId }));
  assert.equal(caja().resumenCajaChica(db, cc.id).disponible, 1750);
  assert.throws(() => h.tx(db, () => caja().actualizarFondoCajaChica(db, { cajaChicaId: cc.id, fondoAsignado: 0, usuarioId: ctx.usuarioId })), /mayor a cero/);
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cobrador'));
  assert.throws(() => h.tx(db, () => caja().reponerCajaChica(db, { cajaChicaId: cc.id, usuarioId: ctx.usuarioId })), /permiso/i);
});
