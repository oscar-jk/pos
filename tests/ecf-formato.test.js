// e-CF: XML conforme a los XSD oficiales de la DGII, firma XMLDSig verificable de forma
// independiente (xml-crypto) y montos cuadrados con el documento.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');
const { SignedXml } = require('xml-crypto');

const { construirEcf, construirRfce, construirAnecf, calcularMontos } = require('../main/ecf/construir');
const { construirXml, ErrorFormatoEcf } = require('../main/ecf/xml');
const { firmarXml, verificarFirma } = require('../main/ecf/firma');
const { leerP12 } = require('../main/ecf/certificado');
const { certificadoDePrueba } = require('./ecf-certificado');
const { validarContraXsd } = require('./ecf-xsd');

const { p12, password } = certificadoDePrueba();
const cert = leerP12(p12, password);

const emisor = { rnc: '131-88073-8', razonSocial: 'Comercial ZYL, SRL', nombreComercial: 'Comercial ZYL', direccion: 'Calle Segunda #1, Gascue, Distrito Nacional', telefono: '809-555-1234' };
const lineaGravada = { codigo: 'P001', nombre: 'Zapatos', cantidad: 2, precioUnitario: 590, totalLinea: 1180, baseImponible: 1000, tasaItbis: 0.18 };
const lineaExenta = { codigo: 'P002', nombre: 'Arroz "selecto" & cía', cantidad: 1, precioUnitario: 100, totalLinea: 100, baseImponible: 100, tasaItbis: 0 };

function documento(extra = {}) {
  return { numero: '000123', fecha: '2026-10-09T15:30:00.000Z', total: 1280, subtotal: 1100, condicion: 'contado', ...extra };
}

function verificarConXmlCrypto(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const nodo = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.certificadoBase64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
  const sig = new SignedXml({ publicCert: pem });
  sig.loadSignature(nodo);
  return sig.checkSignature(xml);
}

async function emitirYValidar(entrada) {
  const ecf = construirEcf(entrada);
  const firmado = firmarXml(construirXml(ecf.formato, ecf.datos), cert);
  const xsd = await validarContraXsd(ecf.formato, firmado.xml);
  assert.deepEqual(xsd.errores, [], `${ecf.formato} no valida contra el XSD`);
  assert.ok(verificarConXmlCrypto(firmado.xml), 'xml-crypto verifica la firma');
  assert.equal(verificarFirma(firmado.xml).valida, true);
  assert.equal(firmado.codigoSeguridad, firmado.signatureValue.slice(0, 6));
  return { ecf, firmado };
}

test('e-CF 31 crédito fiscal: válido contra el XSD, firmado y con totales del documento', async () => {
  const { ecf, firmado } = await emitirYValidar({
    tipoEcf: 31, encf: 'E310000000001', vencimientoSecuencia: '2028-12-31', emisor,
    comprador: { rnc: '101-00000-1', nombre: 'Cliente Empresa SRL' },
    documento: documento(), lineas: [lineaGravada, lineaExenta],
    pagos: [{ formaPago: 'efectivo', monto: 1000 }, { formaPago: 'tarjeta', monto: 280 }],
  });
  const t = ecf.datos.Encabezado.Totales;
  assert.equal(t.MontoTotal, 1280);
  assert.equal(t.MontoGravadoI1, 1000);
  assert.equal(t.TotalITBIS1, 180);
  assert.equal(t.MontoExento, 100);
  assert.equal(ecf.datos.Encabezado.IdDoc.IndicadorMontoGravado, 1);
  assert.match(firmado.xml, /<FechaVencimientoSecuencia>31-12-2028<\/FechaVencimientoSecuencia>/);
  assert.match(firmado.xml, /Arroz &quot;selecto&quot; &amp; cía/);
  assert.equal(ecf.resumen.via, 'recepcion');
});

test('e-CF 32 consumo menor a RD$250,000: va por RFCE con el código de seguridad del e-CF', async () => {
  const { ecf, firmado } = await emitirYValidar({
    tipoEcf: 32, encf: 'E320000000001', emisor, comprador: null,
    documento: documento(), lineas: [lineaGravada, lineaExenta], pagos: [{ formaPago: 'efectivo', monto: 1280 }],
  });
  assert.equal(ecf.resumen.via, 'rfce');
  assert.doesNotMatch(firmado.xml, /FechaVencimientoSecuencia/);
  const rfce = firmarXml(construirXml('RFCE', construirRfce(ecf.datos, firmado.codigoSeguridad)), cert);
  assert.deepEqual((await validarContraXsd('RFCE', rfce.xml)).errores, []);
  assert.match(rfce.xml, new RegExp(`<CodigoSeguridadeCF>${firmado.codigoSeguridad.replace(/[+/]/g, '\\$&')}</CodigoSeguridadeCF>`));
  assert.match(rfce.xml, /<Comprador><\/Comprador>/, 'el XSD exige la sección aunque el consumidor sea anónimo');
  assert.ok(verificarConXmlCrypto(rfce.xml));
});

test('e-CF 32 de RD$250,000 o más: exige RNC del cliente y va completo por recepción', async () => {
  const grande = { ...lineaGravada, cantidad: 500, totalLinea: 295000, baseImponible: 250000 };
  assert.throws(() => construirEcf({
    tipoEcf: 32, encf: 'E320000000002', emisor, comprador: null,
    documento: documento({ total: 295000, subtotal: 250000 }), lineas: [grande], pagos: [{ formaPago: 'transferencia', monto: 295000 }],
  }), /250,000 o más requieren el RNC/);
  const { ecf } = await emitirYValidar({
    tipoEcf: 32, encf: 'E320000000002', emisor, comprador: { rnc: '00112345678', nombre: 'Juan Pérez' },
    documento: documento({ total: 295000, subtotal: 250000 }), lineas: [grande], pagos: [{ formaPago: 'transferencia', monto: 295000 }],
  });
  assert.equal(ecf.resumen.via, 'recepcion');
});

test('e-CF 34 nota de crédito y 33 nota de débito: referencian el comprobante modificado', async () => {
  const { ecf: nc } = await emitirYValidar({
    tipoEcf: 34, encf: 'E340000000001', emisor, comprador: { rnc: '101000001', nombre: 'Cliente Empresa SRL' },
    documento: documento({ fecha: '2026-11-20T12:00:00.000Z', total: 590, subtotal: 500 }),
    lineas: [{ ...lineaGravada, cantidad: 1, totalLinea: 590, baseImponible: 500 }], pagos: [],
    referencia: { ncf: 'E310000000001', fecha: '2026-10-09T15:30:00.000Z', codigoModificacion: 3, razon: 'Devolución parcial' },
  });
  assert.equal(nc.datos.Encabezado.IdDoc.IndicadorNotaCredito, 1, 'más de 30 días desde la factura');
  assert.equal(nc.datos.Encabezado.IdDoc.TablaFormasPago, null);
  await emitirYValidar({
    tipoEcf: 33, encf: 'E330000000001', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '101000001', nombre: 'Cliente Empresa SRL' },
    documento: documento({ total: 118, subtotal: 100, condicion: 'credito', diasCredito: 30 }),
    lineas: [{ nombre: 'Flete', esServicio: true, cantidad: 1, precioUnitario: 118, totalLinea: 118, baseImponible: 100, tasaItbis: 0.18 }],
    pagos: [{ formaPago: 'credito', monto: 118 }],
    referencia: { ncf: 'B0100000005', fecha: '2026-10-01T15:30:00.000Z', codigoModificacion: 3, razon: 'Flete' },
  });
});

test('e-CF 45 gubernamental y 44 regímenes especiales (solo exento)', async () => {
  await emitirYValidar({
    tipoEcf: 45, encf: 'E450000000001', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '401000001', nombre: 'Ministerio X' },
    documento: documento({ condicion: 'credito', diasCredito: 45 }), lineas: [lineaGravada, lineaExenta], pagos: [{ formaPago: 'credito', monto: 1280 }],
  });
  await emitirYValidar({
    tipoEcf: 44, encf: 'E440000000001', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '130000001', nombre: 'Zona Franca SA' },
    documento: documento({ total: 100, subtotal: 100 }), lineas: [lineaExenta], pagos: [{ formaPago: 'efectivo', monto: 100 }],
  });
  assert.throws(() => construirEcf({
    tipoEcf: 44, encf: 'E440000000002', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '130000001', nombre: 'Zona Franca SA' },
    documento: documento(), lineas: [lineaGravada, lineaExenta], pagos: [{ formaPago: 'efectivo', monto: 1280 }],
  }), /solo admite partidas exentas/);
});

test('e-CF en otra moneda: agrega la sección OtraMoneda con la tasa del documento', async () => {
  const { firmado } = await emitirYValidar({
    tipoEcf: 31, encf: 'E310000000009', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '101000001', nombre: 'Cliente' },
    documento: documento({ monedaCodigo: 'USD', tasaCambio: 58.5 }), lineas: [lineaGravada, lineaExenta], pagos: [{ formaPago: 'efectivo', monto: 1280 }],
  });
  assert.match(firmado.xml, /<TipoMoneda>USD<\/TipoMoneda><TipoCambio>58.50<\/TipoCambio>/);
  assert.match(firmado.xml, /<MontoTotalOtraMoneda>21.88<\/MontoTotalOtraMoneda>/);
});

test('descuento global: se reparte en las líneas y los totales cuadran con lo cobrado', () => {
  // Factura de 1,280 con 10% de descuento global: total 1,152 (subtotal 990, ITBIS 162).
  const { montos, grupos } = calcularMontos({ total: 1152, subtotal: 990 }, [lineaGravada, lineaExenta]);
  assert.deepEqual(montos, [1062, 90]);
  assert.equal(grupos[1].base, 900);
  assert.equal(grupos[1].itbis, 162);
  assert.equal(grupos[4].monto, 90);
  const ecf = construirEcf({
    tipoEcf: 31, encf: 'E310000000002', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '101000001', nombre: 'X' },
    documento: documento({ total: 1152, subtotal: 990 }), lineas: [lineaGravada, lineaExenta], pagos: [{ formaPago: 'efectivo', monto: 1152 }],
  });
  const it = ecf.datos.DetallesItems.Item[0];
  assert.equal(it.DescuentoMonto, 118);
  assert.equal(it.MontoItem, 1062);
});

test('el validador propio rechaza lo que no cumple el XSD antes de firmar', () => {
  assert.throws(() => construirXml('ACECF', { DetalleAprobacionComercial: { Version: '1.0', RNCEmisor: '12', eNCF: 'E310000000001' } }), ErrorFormatoEcf);
  try {
    construirXml('ACECF', { DetalleAprobacionComercial: { Version: '1.0', RNCEmisor: '12', eNCF: 'E310000000001', Inventado: 'x' } });
  } catch (e) {
    assert.ok(e.errores.some((x) => /RNCEmisor/.test(x)));
    assert.ok(e.errores.some((x) => /Inventado: el campo no existe/.test(x)));
    assert.ok(e.errores.some((x) => /FechaEmision: es obligatorio/.test(x)));
  }
  assert.throws(() => construirEcf({
    tipoEcf: 31, encf: 'E310000000003', vencimientoSecuencia: '2028-12-31', emisor, comprador: { rnc: '', nombre: 'Sin RNC' },
    documento: documento(), lineas: [lineaGravada, lineaExenta], pagos: [],
  }), /requiere el RNC o la cédula del cliente/);
});

test('ANECF: anulación de rangos válida contra el XSD', async () => {
  const datos = construirAnecf({ rncEmisor: '131880738', rangos: [
    { tipoEcf: 32, desde: 'E320000000010', hasta: 'E320000000015' },
    { tipoEcf: 31, desde: 'E310000000004', hasta: 'E310000000004' },
  ] });
  assert.equal(datos.Encabezado.CantidadeNCFAnulados, 7);
  const firmado = firmarXml(construirXml('ANECF', datos), cert);
  assert.deepEqual((await validarContraXsd('ANECF', firmado.xml)).errores, []);
});

test('firma: un e-CF alterado después de firmado no verifica', async () => {
  const { firmado } = await emitirYValidar({
    tipoEcf: 32, encf: 'E320000000003', emisor, comprador: null,
    documento: documento(), lineas: [lineaGravada, lineaExenta], pagos: [{ formaPago: 'efectivo', monto: 1280 }],
  });
  const alterado = firmado.xml.replace('<MontoTotal>1280.00</MontoTotal>', '<MontoTotal>1.00</MontoTotal>');
  assert.equal(verificarFirma(alterado).valida, false);
});
