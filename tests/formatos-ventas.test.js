// Formatos 607 (ventas) y 608 (comprobantes anulados) de la DGII.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fv = require('../main/ipc/formatos-ventas');

const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 7);
const aaaamm = () => hoy().replace('-', '');

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  db.prepare("UPDATE parametros_negocio SET valor = '101999999' WHERE clave = 'negocio_rnc'").run();
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  h.entrada(db, ctx, p, 500, 40);
  h.abrirTurno(db, ctx, 0);
  return { db, ctx, p };
}
const vender = (db, ctx, p, cantidad, forma, extra = {}) => h.facturar(db, ctx, [{ productoId: p, cantidad }], [{ formaPago: forma, monto: 118 * cantidad }], extra);
const id = (r) => (typeof r === 'string' ? r : r.id);

test('607: tipo de identificación y fecha en hora local', () => {
  assert.equal(fv.tipoIdentificacion('101-99999-9'), '1');
  assert.equal(fv.tipoIdentificacion('00100000001'), '2');
  assert.equal(fv.tipoIdentificacion('AB123456'), '3');
  assert.equal(fv.tipoIdentificacion(''), null);
  assert.equal(fv.tipoIdentificacion('12345'), null);
  assert.throws(() => fv.rangoPeriodo('2026-13'), /AAAA-MM/);
});

test('607: factura con cliente va detallada con sus formas de pago; el consumo menor va al resumen', () => {
  const { db, ctx, p } = base();
  const cliente = h.cliente(db, ctx, { rncCedula: '101000004' });
  const f = id(vender(db, ctx, p, 2, 'tarjeta', { clienteId: cliente, tipoNcfCodigo: 'credito_fiscal' }));
  vender(db, ctx, p, 1, 'efectivo'); // consumidor final, B02 menor de 250,000
  const r = fv.reporte607(db, { periodo: hoy() });
  const reg = r.registros.find((x) => x.numero === db.prepare('SELECT numero FROM documentos_venta WHERE id = ?').get(f).numero);
  assert.ok(reg, 'la factura con RNC va detallada');
  assert.equal(reg.rnc, '101000004');
  assert.equal(reg.tipo_id, '1');
  assert.equal(reg.tarjeta, 236);
  assert.equal(reg.monto_facturado + reg.itbis_facturado, 236);
  assert.equal(reg.efectivo + reg.cheque_transferencia + reg.tarjeta + reg.credito + reg.bonos + reg.permuta + reg.otras, 236);
  assert.equal(r.resumenConsumo.cantidad, 1);
  assert.equal(r.resumenConsumo.total, 118);
});

test('607: el archivo TXT lleva encabezado, 23 campos por línea y CRLF', () => {
  const { db, ctx, p } = base();
  const cliente = h.cliente(db, ctx, { rncCedula: '101000004' });
  vender(db, ctx, p, 2, 'credito', { clienteId: cliente, tipoNcfCodigo: 'credito_fiscal', condicionPago: 'credito' });
  const r = fv.reporte607(db, { periodo: hoy() });
  const lineas = fv.txt607(r).split('\r\n');
  assert.equal(lineas[0], `607|101999999|${aaaamm()}|${r.registros.length}`);
  assert.equal(lineas[1].split('|').length, 23);
  assert.match(lineas[1], /^101000004\|1\|B01\d{8}\|\|01\|\d{8}\|\|200\.00\|36\.00\|/);
  assert.equal(lineas[lineas.length - 1], '');
});

test('607: nota de crédito referencia la factura y excluye lo anulado', () => {
  const { db, ctx, p } = base();
  const cliente = h.cliente(db, ctx, { rncCedula: '101000004' });
  const f = id(vender(db, ctx, p, 2, 'efectivo', { clienteId: cliente, tipoNcfCodigo: 'credito_fiscal' }));
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Devuelto', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  const anulada = id(vender(db, ctx, p, 1, 'efectivo', { clienteId: cliente, tipoNcfCodigo: 'credito_fiscal' }));
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: anulada, motivo: 'Error', usuarioId: ctx.usuarioId }));
  const r = fv.reporte607(db, { periodo: hoy() });
  const ncfFactura = db.prepare('SELECT ncf FROM documentos_venta WHERE id = ?').get(f).ncf;
  const nota = r.registros.find((x) => x.origen === 'Nota de crédito');
  if (nota) {
    assert.equal(nota.ncf_modificado, ncfFactura);
    assert.equal(nota.efectivo + nota.credito, 118);
  } else {
    assert.ok(r.excluidos.some((x) => x.origen === 'Nota de crédito'), 'si no tiene NCF debe quedar listada como excluida');
  }
  assert.equal(r.registros.some((x) => x.ncf === db.prepare('SELECT ncf FROM documentos_venta WHERE id = ?').get(anulada).ncf), false);
});

test('607: los e-CF no se reportan y el RNC del negocio es obligatorio para el archivo', () => {
  const { db, ctx, p } = base();
  const cliente = h.cliente(db, ctx, { rncCedula: '101000004' });
  const f = id(vender(db, ctx, p, 1, 'efectivo', { clienteId: cliente, tipoNcfCodigo: 'credito_fiscal' }));
  db.prepare("UPDATE documentos_venta SET ncf = 'E310000000001' WHERE id = ?").run(f);
  const r = fv.reporte607(db, { periodo: hoy() });
  assert.equal(r.registros.length, 0);
  assert.match(r.avisos.join(' '), /electrónico/);
  db.prepare("UPDATE parametros_negocio SET valor = '' WHERE clave = 'negocio_rnc'").run();
  assert.throws(() => fv.txt607(fv.reporte607(db, { periodo: hoy() })), /RNC del negocio/);
});

test('608: lista los comprobantes anulados del mes con su tipo de anulación', () => {
  const { db, ctx, p } = base();
  const f = id(vender(db, ctx, p, 1, 'efectivo'));
  const ncf = db.prepare('SELECT ncf FROM documentos_venta WHERE id = ?').get(f).ncf;
  h.tx(db, () => h.m('ventas').anularFactura(db, { documentoId: f, motivo: 'Error de digitación', usuarioId: ctx.usuarioId }));
  const r = fv.reporte608(db, { periodo: hoy() });
  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].ncf, ncf);
  assert.equal(r.registros[0].tipo_anulacion, 4);
  const con = fv.reporte608(db, { periodo: hoy(), tipos: { [f]: 2 } });
  assert.equal(con.registros[0].tipo_anulacion, 2);
  const lineas = fv.txt608(con).split('\r\n');
  assert.equal(lineas[0], `608|101999999|${aaaamm()}|1`);
  assert.match(lineas[1], new RegExp(`^${ncf}\\|\\d{8}\\|02$`));
  assert.equal(fv.reporte608(db, { periodo: '2020-01' }).registros.length, 0);
});
