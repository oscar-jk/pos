// Reportes de inventario: valorización a fecha, reposición, sobre-stock, rotación y bitácora.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const rep = require('../main/ipc/reportes-inventario');

const dia = (n) => new Date(Date.now() - 4 * 3600000 - n * 86400000).toISOString().slice(0, 10);
const instante = (n) => new Date(Date.parse(`${dia(n)}T15:00:00Z`)).toISOString();

// Producto con 10 unidades a 50 hace 10 días y una venta de 4 hace 5 días.
function escenario(extra = {}) {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 118, ...extra });
  h.entrada(db, ctx, p, 10, 50);
  h.abrirTurno(db, ctx);
  db.prepare('UPDATE kardex_movimientos SET created_at = ?').run(instante(10));
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 4 }], [{ formaPago: 'efectivo', monto: 472 }]);
  db.prepare("UPDATE kardex_movimientos SET created_at = ? WHERE documento_origen_id = ? AND cantidad < 0").run(instante(5), f);
  db.prepare('UPDATE documentos_venta SET fecha = ? WHERE id = ?').run(instante(5), f);
  return { db, ctx, p, f };
}

test('valorización a fecha: antes y después de la venta, comparable, y cuadrada con la cuenta 1300 hoy', () => {
  const { db, p } = escenario();
  const antes = rep.valorizacionAFecha(db, { fecha: dia(7) });
  assert.equal(antes.total, 500);
  const despues = rep.valorizacionAFecha(db, { fecha: dia(3), compararCon: dia(7) });
  assert.equal(despues.total, 300);
  assert.equal(despues.totalPrevio, 500);
  assert.equal(despues.diferencia, -200);
  assert.deepEqual([despues.filas[0].cantidad, despues.filas[0].cantidad_previa], [6, 10]);
  assert.equal(rep.valorizacionAFecha(db, { fecha: dia(11) }).total, 0, 'antes de existir el inventario');
  assert.equal(rep.valorizacionAFecha(db, {}).total, h.saldoCuenta(db, '1300'), 'hoy coincide con la contabilidad');
  assert.equal(rep.saldosAFecha(db, dia(3), { productoId: p })[0].valor, 300);
});

test('reposición sugerida: solo los que están en o bajo su mínimo, con cantidad según consumo', () => {
  const { db, ctx } = escenario({ stockMinimo: 8 });
  const sano = h.producto(db, ctx, { stockMinimo: 2 });
  h.entrada(db, ctx, sano, 20, 10);
  const r = rep.reposicionSugerida(db);
  assert.equal(r.length, 1);
  assert.equal(r[0].existencia, 6);
  assert.ok(r[0].consumo_diario > 0, 'se vendió en los últimos 90 días');
  // objetivo = mínimo 8 + 30 días × (4/90) = 9.33 → faltan 3.33 → 4
  assert.equal(r[0].cantidad_sugerida, 4);
  assert.ok(r[0].dias_cobertura > 0);
});

test('sobre-stock: sobre el máximo, sin ventas y con mucha cobertura', () => {
  const { db, ctx } = escenario({ stockMaximo: 4 });
  const quieto = h.producto(db, ctx, {});
  h.entrada(db, ctx, quieto, 30, 20);
  const r = rep.sobreStock(db);
  const porProducto = Object.fromEntries(r.map((x) => [x.motivo, x]));
  assert.equal(porProducto['Sobre el máximo'].cantidad_exceso, 2);
  assert.equal(porProducto['Sobre el máximo'].valor_exceso, 100);
  assert.equal(porProducto['Sin ventas en 90 días'].cantidad_exceso, 30);
  assert.equal(r[0].motivo, 'Sin ventas en 90 días', 'ordenado por valor del exceso (600 vs 100)');
});

test('rotación: costo de ventas entre inventario promedio, por producto y por categoría', () => {
  const { db } = escenario();
  const r = rep.rotacionInventario(db, { desde: dia(9), hasta: dia(0) });
  assert.equal(r.length, 1);
  assert.equal(r[0].costo_ventas, 200);
  // valor inicial a la víspera: 500; final: 300 → promedio 400 → rotación 0.5 en 10 días → 20 días de inventario
  assert.equal(r[0].inventario_promedio, 400);
  assert.equal(r[0].rotacion, 0.5);
  assert.equal(r[0].dias_inventario, 20);
  const porCategoria = rep.rotacionInventario(db, { desde: dia(9), hasta: dia(0), agrupar: 'categoria' });
  assert.equal(porCategoria[0].descripcion, 'Sin categoría');
  assert.throws(() => rep.rotacionInventario(db, { desde: dia(0), hasta: dia(5) }), /posterior/);
});

test('rotación: una devolución resta del costo de ventas', () => {
  const { db, ctx, f } = escenario();
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Dev', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  assert.equal(rep.rotacionInventario(db, { desde: dia(9), hasta: dia(0) })[0].costo_ventas, 150);
});

test('bitácora de movimientos: filtra por tipo y fecha, con usuario', () => {
  const { db } = escenario();
  const todos = rep.bitacoraMovimientos(db, {});
  assert.equal(todos.length, 2);
  assert.ok(todos.every((m) => m.usuario_nombre));
  assert.deepEqual(rep.bitacoraMovimientos(db, { tipo: 'salida_venta' }).map((m) => m.cantidad), [-4]);
  assert.equal(rep.bitacoraMovimientos(db, { desde: dia(7), hasta: dia(3) }).length, 1);
});

test('los reportes con costos exigen el permiso de costos', () => {
  const { db } = escenario();
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajero'));
  assert.throws(() => rep.valorizacionAFecha(db, {}), /permiso/i);
  assert.throws(() => rep.rotacionInventario(db, {}), /permiso/i);
  assert.throws(() => rep.sobreStock(db), /permiso/i);
});

test('los filtros de fecha de la pantalla llegan como instante ISO y se interpretan como día', () => {
  const { db } = escenario();
  const iso = (n) => `${dia(n)}T00:00:00.000Z`;
  assert.equal(rep.valorizacionAFecha(db, { fecha: iso(7) }).total, 500);
  assert.equal(rep.bitacoraMovimientos(db, { desde: iso(7), hasta: `${dia(3)}T23:59:59.999Z` }).length, 1);
  assert.equal(rep.rotacionInventario(db, { desde: iso(9), hasta: iso(0) })[0].costo_ventas, 200);
});
