// Datos de consulta de la representación impresa (RI): URL del código QR que valida el e-CF en
// la DGII (Descripción Técnica Servicios DGII, "Consulta timbre" y "Consulta timbre FC").
const qrcode = require('qrcode-generator');

const SEGMENTO_AMBIENTE = { TesteCF: 'testecf', CerteCF: 'certecf', eCF: 'ecf' };
const MODULOS_VERSION_8 = 49; // la DGII pide QR versión 8 como mínimo

const monto = (n) => Number(n).toFixed(2);

// El código de seguridad sale del SignatureValue (base64): "+", "/" y "=" van codificados.
function urlConsultaTimbre({ ambiente, rncEmisor, rncComprador, encf, fechaEmision, montoTotal, fechaFirma, codigoSeguridad, via }) {
  const seg = SEGMENTO_AMBIENTE[ambiente];
  if (!seg) throw new Error(`Ambiente de la DGII desconocido: ${ambiente}`);
  const cs = encodeURIComponent(codigoSeguridad);
  if (via === 'rfce') {
    return `https://fc.dgii.gov.do/${seg}/consultatimbrefc?rncemisor=${rncEmisor}&encf=${encf}&montototal=${monto(montoTotal)}&codigoseguridad=${cs}`;
  }
  const partes = [`rncemisor=${rncEmisor}`];
  if (rncComprador) partes.push(`rnccomprador=${rncComprador}`);
  partes.push(`encf=${encf}`, `fechaemision=${fechaEmision}`, `montototal=${monto(montoTotal)}`, `fechafirma=${encodeURIComponent(fechaFirma)}`, `codigoseguridad=${cs}`);
  return `https://ecf.dgii.gov.do/${seg}/consultatimbre?${partes.join('&')}`;
}

// SVG del QR (sin dependencias del renderizador): se incrusta tal cual en la plantilla impresa.
function qrSvg(texto) {
  let qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  if (qr.getModuleCount() < MODULOS_VERSION_8) {
    qr = qrcode(8, 'M');
    qr.addData(texto);
    qr.make();
  }
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

module.exports = { urlConsultaTimbre, qrSvg, SEGMENTO_AMBIENTE };
