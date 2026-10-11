// D1 y D2: cobro en efectivo con cambio y atajos de teclado del mostrador.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const { calcularCobroEfectivo, accionDeTecla, BILLETES } = require('../renderer/ventas/cobro');

test('D2: billete de 1000 sobre una venta de 700: efectivo 700 y cambio 300', () => {
  assert.deepEqual(calcularCobroEfectivo({ total: 700, recibido: 1000 }), { efectivo: 700, cambio: 300, faltante: 0 });
  assert.deepEqual(BILLETES, [50, 100, 200, 500, 1000, 2000]);
});

test('D2: pago exacto, entrega insuficiente y pago mixto con tarjeta', () => {
  assert.deepEqual(calcularCobroEfectivo({ total: 700, recibido: 700 }), { efectivo: 700, cambio: 0, faltante: 0 });
  assert.deepEqual(calcularCobroEfectivo({ total: 700, recibido: 500 }), { efectivo: 500, cambio: 0, faltante: 200 });
  // 300 con tarjeta: solo se deben 400 en efectivo; el cliente da 500 y recibe 100.
  assert.deepEqual(calcularCobroEfectivo({ total: 700, tarjeta: 300, recibido: 500 }), { efectivo: 400, cambio: 100, faltante: 0 });
  assert.deepEqual(calcularCobroEfectivo({ total: 700, tarjeta: 700, recibido: 1000 }), { efectivo: 0, cambio: 1000, faltante: 0 });
  assert.deepEqual(calcularCobroEfectivo({ total: 100.1, recibido: 200 }), { efectivo: 100.1, cambio: 99.9, faltante: 0 });
});

test('D2: lo facturado y la caja registran lo que se debe, no el billete', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx, { precioDetalle: 700 });
  h.entrada(db, ctx, p, 5, 300);
  h.abrirTurno(db, ctx, 1000);
  const { efectivo, cambio } = calcularCobroEfectivo({ total: 700, recibido: 1000 });
  assert.equal(cambio, 300);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: efectivo }]);
  assert.equal(h.m('ventas').obtenerFactura(db, f).total, 700);
  const turno = db.prepare("SELECT * FROM turnos_caja WHERE estado = 'abierto'").get();
  assert.equal(h.m('caja').efectivoEsperado(db, turno), 1700, 'fondo 1000 + 700 cobrados; el cambio no entra');
});

test('D1: cada tecla del mostrador mapea a su acción', () => {
  const esperado = { F1: 'nueva_venta', F2: 'consultar_precio', F3: 'cliente', F4: 'cantidad', F8: 'descuento', F10: 'cobrar', Delete: 'quitar_linea', Escape: 'cerrar' };
  for (const [tecla, accion] of Object.entries(esperado)) assert.equal(accionDeTecla(tecla), accion, tecla);
  assert.equal(accionDeTecla('a'), null);
  assert.equal(accionDeTecla('F5'), null);
});

test('D1: Supr dentro de un campo no quita la línea, y con un modal abierto no hay atajos', () => {
  assert.equal(accionDeTecla('Delete', { enCampoDeTexto: true }), null);
  assert.equal(accionDeTecla('F10', { enCampoDeTexto: true }), 'cobrar', 'las teclas F funcionan dentro de un campo');
  for (const t of ['F1', 'F10', 'Delete', 'Escape']) assert.equal(accionDeTecla(t, { modalAbierto: true }), null, t);
});

test('D1/D2: la pantalla carga cobro.js antes de ventas.js y muestra la leyenda y el efectivo recibido', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ventas', 'index.html'), 'utf8');
  assert.ok(html.indexOf('./cobro.js') > 0 && html.indexOf('./cobro.js') < html.indexOf('./ventas.js'));
  for (const id of ['atajos-leyenda', 'pago-recibido', 'cobro-billetes', 'cobro-cambio']) assert.match(html, new RegExp(`id="${id}"`));
  for (const tecla of ['F1', 'F2', 'F3', 'F4', 'F8', 'F10', 'Supr', 'Esc']) assert.match(html, new RegExp(`${tecla} `));
});
