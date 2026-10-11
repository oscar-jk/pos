// Presupuesto de compra: documento de intención que no mueve inventario ni costo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const compras = () => h.m('compras');
function proveedor(db, nombre) {
  return h.tx(db, () => compras().guardarProveedor(db, { nombre, rnc: '101000004', diasCredito: 30 }));
}
function presupuesto(db, ctx, proveedorId, productoId, cantidad, costo) {
  return h.tx(db, () => compras().crearOrdenCompra(db, { tipo: 'presupuesto', proveedorId, usuarioId: ctx.usuarioId, lineas: [{ productoId, cantidad, costoUnitario: costo }] }));
}

test('presupuesto: se numera aparte, no mueve inventario ni contabilidad y no sale en las órdenes', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  const antes = db.prepare('SELECT COUNT(*) n FROM asientos_contables').get().n;
  const prov = proveedor(db, 'Proveedor A');
  const id = presupuesto(db, ctx, prov, p, 10, 50);
  assert.equal(db.prepare('SELECT tipo, numero, estado FROM documentos_compra WHERE id = ?').get(id).numero, '000001');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM kardex_movimientos').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM asientos_contables').get().n, antes);
  assert.equal(compras().listarOrdenesCompra(db, {}).length, 0);
  assert.equal(compras().listarOrdenesCompra(db, { tipo: 'presupuesto' }).length, 1);
  h.tx(db, () => compras().crearOrdenCompra(db, { proveedorId: prov, usuarioId: ctx.usuarioId, lineas: [{ productoId: p, cantidad: 1, costoUnitario: 50 }] }));
  assert.equal(db.prepare("SELECT numero FROM documentos_compra WHERE tipo = 'orden_compra'").get().numero, '000001', 'la orden lleva su propia numeración');
});

test('presupuesto: convertir crea la orden con el costo cotizado y no se puede convertir dos veces', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  const prov = proveedor(db, 'Proveedor A');
  const id = presupuesto(db, ctx, prov, p, 10, 55);
  const ordenId = h.tx(db, () => compras().convertirPresupuestoEnOrden(db, { documentoId: id, usuarioId: ctx.usuarioId }));
  const orden = compras().obtenerOrdenCompra(db, ordenId);
  assert.equal(orden.tipo, 'orden_compra');
  assert.equal(orden.documento_referencia_id, id);
  assert.equal(orden.lineas[0].costo_unitario, 55);
  assert.equal(db.prepare('SELECT estado FROM documentos_compra WHERE id = ?').get(id).estado, 'convertido');
  assert.throws(() => h.tx(db, () => compras().convertirPresupuestoEnOrden(db, { documentoId: id, usuarioId: ctx.usuarioId })), /ya se convirtió/);
  assert.throws(() => h.tx(db, () => compras().anularOrdenCompra(db, { documentoId: id, motivo: 'x', usuarioId: ctx.usuarioId })), /todavía no tiene mercancía/);
});

test('presupuesto: anular, y comparar lo cotizado por producto con el mejor primero', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  const a = proveedor(db, 'Proveedor A');
  const b = proveedor(db, 'Proveedor B');
  const c = proveedor(db, 'Proveedor C');
  presupuesto(db, ctx, a, p, 10, 60);
  presupuesto(db, ctx, b, p, 10, 52);
  const pc = presupuesto(db, ctx, c, p, 10, 40);
  let cmp = compras().compararPresupuestos(db);
  assert.equal(cmp.length, 1);
  assert.deepEqual(cmp[0].ofertas.map((o) => o.proveedor), ['Proveedor C', 'Proveedor B', 'Proveedor A']);
  assert.equal(cmp[0].ofertas[2].diferencia, 20);
  h.tx(db, () => compras().anularOrdenCompra(db, { documentoId: pc, motivo: 'Ya no surte', usuarioId: ctx.usuarioId }));
  cmp = compras().compararPresupuestos(db);
  assert.equal(cmp[0].mejorCosto, 52);
  assert.equal(cmp[0].ofertas.length, 2);
});

test('presupuesto: exige permiso y al menos una línea', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const prov = proveedor(db, 'Proveedor A');
  assert.throws(() => h.tx(db, () => compras().crearOrdenCompra(db, { tipo: 'presupuesto', proveedorId: prov, usuarioId: ctx.usuarioId, lineas: [] })), /El presupuesto debe tener al menos una línea/);
  const sinPermiso = h.usuarioDeRol(db, 'Cobrador');
  h.loginUsuario(db, sinPermiso);
  assert.throws(() => h.tx(db, () => compras().crearOrdenCompra(db, { tipo: 'presupuesto', proveedorId: prov, usuarioId: sinPermiso, lineas: [{ productoId: 'x', cantidad: 1, costoUnitario: 1 }] })), /permiso/i);
});
