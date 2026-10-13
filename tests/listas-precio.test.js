// E2: listas de precio aplicadas en la venta. Regla: lista de la categoría del cliente >
// lista de la sucursal > nivel de precio; el precio de lista no cuenta como descuento manual.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const inv = () => h.m('inventario');

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db); // admin
  const p = h.producto(db, ctx, { precioDetalle: 1000 });
  h.entrada(db, ctx, p, 50, 400);
  h.abrirTurno(db, ctx);
  const categoriaId = db.prepare('SELECT id FROM categorias_cliente').get().id;
  const clienteId = h.cliente(db, ctx, { categoriaId });
  return { db, ctx, p, categoriaId, clienteId };
}

const crearLista = (db, ctx, datos) => h.tx(db, () => inv().guardarListaPrecio(db, { usuarioId: ctx.usuarioId, lineas: [], ...datos }));
const venta = (db, ctx, p, precio, extra = {}) => h.facturar(db, ctx, [{ productoId: p, cantidad: 1, ...(precio === undefined ? {} : { precioUnitario: precio }) }], [{ formaPago: 'efectivo', monto: precio ?? 1000 }], extra);

test('E2: la lista de la categoría gana a la de la sucursal; sin lista vale el nivel de precio', () => {
  const { db, ctx, p, categoriaId } = base();
  const sucursalId = ctx.sucursalId;
  crearLista(db, ctx, { nombre: 'Sucursal', sucursalId, lineas: [{ productoId: p, precio: 900 }] });
  crearLista(db, ctx, { nombre: 'Mayoristas', categoriaClienteId: categoriaId, lineas: [{ productoId: p, precio: 800 }] });
  const producto = inv().obtenerProducto(db, p, ctx.almacenId);
  assert.deepEqual(inv().precioSegunListas(inv().listasParaVenta(db, { sucursalId, categoriaClienteId: categoriaId }), producto), { precio: 800, lista: 'Mayoristas' });
  assert.deepEqual(inv().precioSegunListas(inv().listasParaVenta(db, { sucursalId, categoriaClienteId: null }), producto), { precio: 900, lista: 'Sucursal' });
  assert.equal(inv().precioSegunListas(inv().listasParaVenta(db, { sucursalId: null, categoriaClienteId: null }), producto), null);
});

test('E2: producto fuera de la lista usa el % sobre el detalle; una asignación solo admite una lista activa', () => {
  const { db, ctx, p, categoriaId } = base();
  const otro = h.producto(db, ctx, { precioDetalle: 500 });
  crearLista(db, ctx, { nombre: 'Mayoristas', categoriaClienteId: categoriaId, porcentajeSobreDetalle: -10, lineas: [{ productoId: p, precio: 800 }] });
  const listas = inv().listasParaVenta(db, { sucursalId: ctx.sucursalId, categoriaClienteId: categoriaId });
  assert.equal(inv().precioSegunListas(listas, inv().obtenerProducto(db, otro, ctx.almacenId)).precio, 450);
  assert.throws(() => crearLista(db, ctx, { nombre: 'Otra', categoriaClienteId: categoriaId }), /misma asignación/);
  assert.throws(() => crearLista(db, ctx, { nombre: 'Sin destino' }), /sucursal, a una categoría/);
});

test('E2: el cajero vende con el precio de lista sin chocar con su tope de descuento', () => {
  const { db, ctx, p, categoriaId, clienteId } = base();
  // Cajero: tope de descuento 10 %. Una lista al 20 % por debajo del detalle no es descuento manual.
  crearLista(db, ctx, { nombre: 'Mayoristas', categoriaClienteId: categoriaId, lineas: [{ productoId: p, precio: 800 }] });
  const sinLista = h.cliente(db, ctx, { categoriaId: null });
  const cajero = h.usuarioDeRol(db, 'Cajero');
  h.loginUsuario(db, cajero);
  const f = venta(db, ctx, p, 800, { clienteId });
  assert.equal(h.m('ventas').obtenerFactura(db, f).total, 800);
  assert.equal(db.prepare('SELECT precio_unitario FROM documentos_venta_detalle WHERE documento_id = ?').get(f).precio_unitario, 800);
  // Sin lista (cliente sin categoría con lista) el mismo rebaje sí es descuento y supera el tope.
  assert.throws(() => venta(db, ctx, p, 800, { clienteId: sinLista }), /excede el límite permitido/);
});

test('E2: cotización, conduce y pedido usan la misma regla de precio', () => {
  const { db, ctx, p, categoriaId, clienteId } = base();
  crearLista(db, ctx, { nombre: 'Mayoristas', categoriaClienteId: categoriaId, lineas: [{ productoId: p, precio: 800 }] });
  const cajero = h.usuarioDeRol(db, 'Cajero');
  h.loginUsuario(db, cajero);
  const cot = h.tx(db, () => h.m('ventas').crearCotizacion(db, {
    sucursalId: ctx.sucursalId, almacenId: ctx.almacenId, clienteId, usuarioId: ctx.usuarioId, nivelPrecio: 'detalle',
    lineas: [{ productoId: p, cantidad: 2, precioUnitario: 800 }],
  }));
  assert.equal(h.m('ventas').obtenerFactura(db, cot).total, 1600);
});

test('E2: desactivar una lista la deja sin efecto y exige permiso', () => {
  const { db, ctx, p, categoriaId } = base();
  const id = crearLista(db, ctx, { nombre: 'Mayoristas', categoriaClienteId: categoriaId, lineas: [{ productoId: p, precio: 800 }] });
  h.tx(db, () => inv().desactivarListaPrecio(db, { listaId: id, usuarioId: ctx.usuarioId }));
  assert.equal(inv().listasParaVenta(db, { sucursalId: ctx.sucursalId, categoriaClienteId: categoriaId }).categoria, null);
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => crearLista(db, ctx, { nombre: 'X', categoriaClienteId: categoriaId }), /permiso/i);
});
