// B3: las invariantes globales detectan de verdad un descuadre (cada una se rompe a propósito).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

function baseConMovimiento() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 10, 50);
  h.abrirTurno(db, ctx);
  const cl = h.cliente(db, ctx);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'credito', monto: 118 }], { clienteId: cl });
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  return { db, ctx, p, cl };
}
// Cada base rota se cierra al final para que la revisión de fin de suite no la cuente.
const romper = (fn) => { const b = baseConMovimiento(); assert.deepEqual(h.invariantes(b.db), []); const r = fn(b); const fallas = h.invariantes(b.db); b.db.close(); return { fallas, r }; };

test('B3: un asiento descuadrado se detecta', () => {
  const { fallas } = romper(({ db }) => db.prepare('UPDATE asientos_contables_detalle SET debe = debe + 5 WHERE rowid = (SELECT MIN(rowid) FROM asientos_contables_detalle WHERE debe > 0)').run());
  assert.ok(fallas.some((f) => f.startsWith('debe')), fallas.join('; '));
});

test('B3: inventario distinto de la cuenta 1300 se detecta', () => {
  const { fallas } = romper(({ db, p }) => db.prepare('UPDATE productos SET costo_promedio = costo_promedio + 1 WHERE id = ?').run(p));
  assert.ok(fallas.some((f) => f.startsWith('1300')), fallas.join('; '));
});

test('B3: saldo de clientes distinto de la cuenta 1400 se detecta', () => {
  const { fallas } = romper(({ db }) => db.prepare("UPDATE documentos_venta SET total = total + 10 WHERE condicion_pago = 'credito'").run());
  assert.ok(fallas.some((f) => f.startsWith('1400')), fallas.join('; '));
});

test('B3: un turno cerrado cuyo efectivo cambió después se detecta', () => {
  const { fallas } = romper(({ db, ctx }) => {
    const turno = h.m('caja').obtenerTurnoAbierto(db, ctx.cajaId);
    h.tx(db, () => h.m('caja').cerrarTurno(db, { turnoId: turno.id, efectivoContado: 1118 }));
    db.prepare("INSERT INTO movimientos_caja (id, turno_caja_id, tipo, concepto, monto, usuario_id) VALUES ('x1', ?, 'salida_manual', 'tarde', -50, ?)").run(turno.id, ctx.usuarioId);
  });
  assert.ok(fallas.some((f) => f.startsWith('turno cerrado')), fallas.join('; '));
});

test('B3: una operación normal deja todo cuadrado', () => {
  const { db } = baseConMovimiento();
  assert.deepEqual(h.invariantes(db), []);
});
