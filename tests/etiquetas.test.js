// Etiquetas de código de barras (Code 128) y precio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const barcode = require('../main/printing/barcode');
const impresion = require('../main/printing');

// Decodifica una cadena de módulos con la tabla de patrones (verifica que sea decodificable).
function decodificar(m) {
  const porPatron = new Map(barcode.PATRONES.map((p, v) => [p, v]));
  const valores = [];
  let i = 0;
  const leer = (n) => {
    const anchos = [];
    let pos = i;
    for (let k = 0; k < n; k += 1) {
      const c = m[pos];
      let j = pos;
      while (j < m.length && m[j] === c) j += 1;
      anchos.push(j - pos);
      pos = j;
    }
    return { patron: anchos.join(''), fin: pos };
  };
  while (i < m.length) {
    const largo = valores.length > 0 && valores[valores.length - 1] === undefined ? 0 : 6;
    let r = leer(largo || 6);
    let v = porPatron.get(r.patron);
    if (v === undefined) { r = leer(7); v = porPatron.get(r.patron); }
    assert.notEqual(v, undefined, `patrón ${r.patron} desconocido`);
    valores.push(v);
    i = r.fin;
  }
  return valores;
}

test('Code 128: cada patrón suma 11 módulos (13 el de parada) y no hay patrones repetidos', () => {
  barcode.PATRONES.slice(0, 106).forEach((p, v) => {
    assert.equal(p.length, 6, `símbolo ${v}`);
    assert.equal([...p].reduce((a, d) => a + Number(d), 0), 11, `símbolo ${v}`);
  });
  assert.equal([...barcode.PATRONES[106]].reduce((a, d) => a + Number(d), 0), 13);
  assert.equal(new Set(barcode.PATRONES).size, 107);
});

test('Code 128: el código se decodifica de vuelta y su dígito de control cuadra', () => {
  for (const texto of ['7461234567890', 'ZAP-01', 'Aa 9~']) {
    const valores = decodificar(barcode.modulos(texto));
    assert.equal(valores[0], 104, 'inicio B');
    assert.equal(valores[valores.length - 1], 106, 'parada');
    const datos = valores.slice(1, -2).map((v) => String.fromCharCode(v + 32)).join('');
    assert.equal(datos, texto);
    const control = valores.slice(0, -2).reduce((a, v, i) => a + (i === 0 ? v : v * i), 0) % 103;
    assert.equal(valores[valores.length - 2], control);
  }
  assert.throws(() => barcode.simbolos(''), /vacío/);
  assert.throws(() => barcode.simbolos('ñ'), /no se puede codificar/);
});

test('Code 128: el SVG tiene zona de silencio y barras', () => {
  const svg = barcode.codigoBarrasSvg('12345');
  assert.match(svg, /^<svg[^>]*viewBox/);
  assert.ok((svg.match(/<rect/g) || []).length >= 20);
});

test('etiquetas: nombre, precio, código de barras y copias; usa el código interno si no hay barras', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const conBarras = h.producto(db, ctx, { descripcion: 'Arroz selecto', precioDetalle: 118, codigosBarra: [{ codigoBarra: '7461234567890', presentacion: 'unidad', factorConversion: 1 }] });
  const sinBarras = h.producto(db, ctx, { descripcion: 'Aceite & sal', precioDetalle: 59.5, codigoInterno: 'ACE-01' });
  const html = impresion.htmlEtiquetas(db, { formato: 'anaquel', items: [{ productoId: conBarras, copias: 3 }, { productoId: sinBarras, copias: 1 }] });
  assert.equal((html.match(/class="etiqueta"/g) || []).length, 4);
  assert.match(html, /Arroz selecto/);
  assert.match(html, /RD\$ 118\.00/);
  assert.match(html, /7461234567890/);
  assert.match(html, /Aceite &amp; sal/);
  assert.match(html, /ACE-01/);
  assert.match(html, /<svg/);
  const caja = impresion.htmlEtiquetas(db, { formato: 'caja', items: [{ productoId: conBarras, copias: 1 }] });
  assert.match(caja, /size: 50mm 30mm/);
  assert.throws(() => impresion.htmlEtiquetas(db, { items: [] }), /al menos un producto/);
  assert.throws(() => impresion.htmlEtiquetas(db, { items: [{ productoId: 'no-existe' }] }), /no encontrado/);
  assert.throws(() => impresion.htmlEtiquetas(db, { items: Array.from({ length: 5 }, () => ({ productoId: conBarras, copias: 500 })) }), /demasiadas/);
});
