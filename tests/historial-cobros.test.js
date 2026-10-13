// Historial de cobros por vendedor (y por cliente).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const cxc = () => h.m('cxc');
const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 100 });
  h.entrada(db, ctx, p, 100, 40);
  h.abrirTurno(db, ctx, 0);
  const ana = h.usuarioDeRol(db, 'Cajero');
  return { db, ctx, p, ana };
}
const credito = (db, ctx, p, cliente, vendedorId, n) => h.facturar(db, ctx, [{ productoId: p, cantidad: n }], [{ formaPago: 'credito', monto: 100 * n }], { clienteId: cliente, vendedorId });
const idDe = (r) => (typeof r === 'string' ? r : r.id);
const cobrar = (db, ctx, cliente, factura, monto) => h.tx(db, () => cxc().crearRecibo(db, {
  clienteId: cliente, formaPago: 'efectivo', cajaId: ctx.cajaId, montoTotal: monto, usuarioId: ctx.usuarioId, aplicaciones: [{ documentoVentaId: idDe(factura), montoAplicado: monto }],
}));

test('cobros: se atribuyen al vendedor de la factura y se miden los días de cobro', () => {
  const { db, ctx, p, ana } = base();
  const c1 = h.cliente(db, ctx);
  const c2 = h.cliente(db, ctx);
  const f1 = credito(db, ctx, p, c1, ana, 2);          // 236, vendedora Ana
  const f2 = credito(db, ctx, p, c2, ctx.usuarioId, 1); // 118, usuario admin
  const f3 = credito(db, ctx, p, c1, null, 1);          // 118, sin vendedor
  db.prepare('UPDATE documentos_venta SET fecha = ? WHERE id = ?').run(new Date(Date.now() - 10 * 86400000).toISOString(), idDe(f1));
  cobrar(db, ctx, c1, f1, 150);
  cobrar(db, ctx, c2, f2, 100);
  cobrar(db, ctx, c1, f3, 50);
  const r = cxc().historialCobros(db, {});
  assert.equal(r.total, 300);
  const porNombre = Object.fromEntries(r.porVendedor.map((v) => [v.id, v]));
  assert.equal(porNombre[ana].cobrado, 150);
  assert.equal(porNombre[ana].diasPromedio, 10);
  assert.equal(porNombre[ctx.usuarioId].cobrado, 100);
  assert.equal(porNombre.sin_vendedor.cobrado, 50);
  assert.equal(r.porCliente.find((x) => x.id === c1).cobrado, 200);
  assert.equal(cxc().historialCobros(db, { vendedorId: ana }).filas.length, 1);
  assert.equal(cxc().historialCobros(db, { vendedorId: 'sin_vendedor' }).total, 50);
  assert.equal(cxc().historialCobros(db, { clienteId: c2 }).total, 100);
});

test('cobros: un recibo anulado no cuenta y el filtro de fechas usa el día local', () => {
  const { db, ctx, p, ana } = base();
  const c1 = h.cliente(db, ctx);
  const f1 = credito(db, ctx, p, c1, ana, 1);
  const recibo = cobrar(db, ctx, c1, f1, 100);
  assert.equal(cxc().historialCobros(db, { desde: hoy(), hasta: hoy() }).total, 100);
  assert.equal(cxc().historialCobros(db, { desde: `${hoy()}T00:00:00.000Z`, hasta: `${hoy()}T00:00:00.000Z` }).total, 100, 'acepta instantes ISO del filtro de reportes');
  assert.equal(cxc().historialCobros(db, { desde: '2020-01-01', hasta: '2020-01-31' }).total, 0);
  h.tx(db, () => cxc().anularRecibo(db, { reciboId: idDe(recibo), motivo: 'Error', usuarioId: ctx.usuarioId }));
  assert.equal(cxc().historialCobros(db, {}).total, 0);
});
