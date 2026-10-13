// Representación impresa (RI) del e-CF: tipo en palabras, e-NCF, vencimiento, QR de consulta,
// código de seguridad, fecha de firma y leyendas (Informe Técnico e-CF §18-19).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { certificadoDePrueba } = require('./ecf-certificado');
const emision = require('../main/ecf/emision');
const cola = require('../main/ecf/cola');
const { ErrorConexionDgii } = require('../main/ecf/dgii');
const impresion = require('../main/printing');

const { p12, password } = certificadoDePrueba();

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  h.tx(db, () => h.m('configuracion').actualizarDatosNegocio(db, {
    nombre: 'Comercial ZYL', iniciales: 'CZ', colorAcento: '#146356', rnc: '131880738', razonSocial: 'ZYL, SRL', direccion: 'Calle Segunda #1', telefono: '809-555-1234',
  }, ctx.usuarioId));
  h.tx(db, () => emision.guardarCertificado(db, { nombreArchivo: 'p.p12', contenido: p12, password }, ctx.usuarioId));
  for (const t of [31, 32, 33, 34]) {
    h.tx(db, () => h.m('ecf').registrarSecuencia(db, { tipoEcf: t, desde: 1, hasta: 50, vencimiento: [32, 34].includes(t) ? undefined : '2028-12-31' }, ctx.usuarioId));
  }
  h.tx(db, () => h.m('ecf').guardarModo(db, { modo: 'electronico', ambiente: 'eCF' }, ctx.usuarioId));
  const p = h.producto(db, ctx);
  const tasaExenta = h.tx(db, () => h.m('configuracion').crearTasaItbis(db, { nombre: 'Exenta', porcentaje: 0 }, ctx.usuarioId));
  const exento = h.producto(db, ctx, { tasaItbisId: tasaExenta, precioDetalle: 50 });
  h.entrada(db, ctx, p, 10, 60);
  h.entrada(db, ctx, exento, 10, 30);
  h.abrirTurno(db, ctx);
  return { db, ctx, p, exento };
}

test('RI de crédito fiscal: tipo, e-NCF, vencimiento, QR de consulta, código y fecha de firma', () => {
  const { db, ctx, p, exento } = base();
  const c = h.cliente(db, ctx, { rncCedula: '101000001', nombre: 'Cliente Empresa' });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }, { productoId: exento, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 168 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const html = impresion.htmlFactura(db, f, 'factura');
  const ecf = db.prepare('SELECT * FROM ecf_documentos WHERE origen_id = ?').get(f);
  assert.match(html, /Factura de Crédito Fiscal Electrónica/);
  assert.match(html, /e-NCF:<\/strong> E310000000001/);
  assert.match(html, /Fecha Vencimiento:<\/strong> 31-12-2028/);
  assert.match(html, /RNC Cliente:<\/strong> 101000001/);
  assert.match(html, /ZYL, SRL/, 'razón social del emisor');
  assert.match(html, new RegExp(`Código de Seguridad: <strong>${ecf.codigo_seguridad.replace(/[+/]/g, '\\$&')}</strong>`));
  assert.match(html, /<svg[^>]*viewBox/);
  assert.match(html, /<strong>E<\/strong>&nbsp; Prod /, 'la partida exenta lleva la marca E');
  assert.doesNotMatch(html, /contingencia|validez fiscal/);
  const ri = impresion.representacionFiscal(db, h.m('ventas').obtenerFactura(db, f));
  assert.ok(ri.urlConsulta.startsWith('https://ecf.dgii.gov.do/ecf/consultatimbre?rncemisor=131880738&rnccomprador=101000001&encf=E310000000001&fechaemision='));
  assert.match(ri.urlConsulta, /&montototal=168\.00&fechafirma=\d{2}-\d{2}-\d{4}%20\d{2}%3A\d{2}%3A\d{2}&codigoseguridad=/);
});

test('RI de consumo menor a RD$250,000: QR de consulta timbre FC; contingencia lleva la leyenda', async () => {
  const { db, ctx, p } = base();
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const ri = impresion.representacionFiscal(db, h.m('ventas').obtenerFactura(db, f));
  assert.match(ri.urlConsulta, /^https:\/\/fc\.dgii\.gov\.do\/ecf\/consultatimbrefc\?rncemisor=131880738&encf=E320000000001&montototal=118\.00&codigoseguridad=/);
  assert.equal(ri.vencimiento, null, 'la factura de consumo no lleva vencimiento de secuencia');
  await cola.procesarCola(db, { crearCliente: () => ({ enviarRfce: async () => { throw new ErrorConexionDgii('sin red'); } }) });
  const tique = impresion.htmlFactura(db, f, 'tique');
  assert.match(tique, /Factura de Consumo Electrónica/);
  assert.match(tique, /e-CF emitido en modalidad de contingencia/);
});

test('RI de nota de crédito: NCF modificado y código de modificación en palabras; pruebas sin validez', () => {
  const { db, ctx, p } = base();
  h.tx(db, () => h.m('ecf').guardarModo(db, { modo: 'electronico', ambiente: 'TesteCF' }, ctx.usuarioId));
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 236 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  const nc = h.tx(db, () => h.m('ventas').crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Avería', usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  const html = impresion.htmlFactura(db, nc, 'factura');
  assert.match(html, /Nota de Crédito Electrónica/);
  assert.match(html, /NCF modificado:<\/strong> E310000000001/);
  assert.match(html, /Código de modificación:<\/strong> Corrige montos del NCF modificado/);
  assert.match(html, /ambiente de pruebas de la DGII: este comprobante no tiene validez fiscal/);
});

test('RI en modo tradicional: igual que antes, sin bloque fiscal electrónico', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 5, 60);
  h.abrirTurno(db, ctx);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const html = impresion.htmlFactura(db, f, 'factura');
  assert.match(html, /NCF: B02/);
  assert.doesNotMatch(html, /e-NCF|Código de Seguridad|<svg/);
});
