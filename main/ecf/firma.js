// Firma XMLDSig "enveloped" con RSA-SHA256, como la exige la DGII (instructivo "Firmado de e-CF"):
// Reference URI="" (todo el documento), canonicalización inclusiva, digest SHA-256 y el
// certificado X.509 en KeyInfo. Una vez firmado, el XML no puede alterarse.
const crypto = require('node:crypto');
const c14n = require('./c14n');

const ALG = {
  c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  firma: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  envuelta: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
};

const DECLARACION = '<?xml version="1.0" encoding="utf-8"?>';

function hijoPorNombre(el, nombre) {
  return Array.from(el.childNodes || []).find((h) => h.nodeType === 1 && h.localName === nombre);
}

// xml: texto del documento sin firmar. certificado: { clavePrivadaPem, certificadoBase64 }.
function firmarXml(xml, certificado) {
  const doc = c14n.parsearXml(xml);
  const raiz = doc.documentElement;
  if (Array.from(raiz.childNodes).some((h) => h.nodeType === 1 && c14n.esFirma(h))) throw new Error('El documento ya está firmado');
  c14n.quitarEspaciosEntreEtiquetas(raiz);

  const digest = crypto.createHash('sha256').update(c14n.canonicalizarSinFirma(raiz), 'utf8').digest('base64');
  const signedInfo = `<SignedInfo><CanonicalizationMethod Algorithm="${ALG.c14n}"/><SignatureMethod Algorithm="${ALG.firma}"/>`
    + `<Reference URI=""><Transforms><Transform Algorithm="${ALG.envuelta}"/></Transforms><DigestMethod Algorithm="${ALG.digest}"/>`
    + `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const firmaTexto = `<Signature xmlns="${c14n.NS_DSIG}">${signedInfo}<SignatureValue></SignatureValue>`
    + `<KeyInfo><X509Data><X509Certificate>${certificado.certificadoBase64}</X509Certificate></X509Data></KeyInfo></Signature>`;
  const firma = doc.importNode(c14n.parsearXml(firmaTexto).documentElement, true);
  raiz.appendChild(firma);

  const nodoSignedInfo = hijoPorNombre(firma, 'SignedInfo');
  const valor = crypto.sign('RSA-SHA256', Buffer.from(c14n.canonicalizar(nodoSignedInfo), 'utf8'), certificado.clavePrivadaPem).toString('base64');
  hijoPorNombre(firma, 'SignatureValue').appendChild(doc.createTextNode(valor));

  return {
    xml: DECLARACION + c14n.serializarParaEnvio(raiz),
    signatureValue: valor,
    digestValue: digest,
    // "Código de seguridad": los primeros seis caracteres del SignatureValue (va bajo el QR).
    codigoSeguridad: valor.slice(0, 6),
  };
}

// Verificación propia (sin servicios externos): digest y firma con el certificado incluido.
// Sirve para revisar XML recibidos de proveedores y en las pruebas.
function verificarFirma(xml) {
  const doc = c14n.parsearXml(xml);
  const raiz = doc.documentElement;
  const firma = Array.from(raiz.childNodes).find((h) => h.nodeType === 1 && c14n.esFirma(h));
  if (!firma) return { valida: false, motivo: 'El documento no está firmado' };
  const signedInfo = hijoPorNombre(firma, 'SignedInfo');
  const referencia = hijoPorNombre(signedInfo, 'Reference');
  const digestEsperado = (hijoPorNombre(referencia, 'DigestValue').textContent || '').trim();
  const digest = crypto.createHash('sha256').update(c14n.canonicalizarSinFirma(raiz), 'utf8').digest('base64');
  if (digest !== digestEsperado) return { valida: false, motivo: 'El contenido fue alterado después de firmado' };
  const certB64 = (firma.getElementsByTagNameNS(c14n.NS_DSIG, 'X509Certificate')[0] || {}).textContent || '';
  const pem = `-----BEGIN CERTIFICATE-----\n${certB64.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  const valor = (hijoPorNombre(firma, 'SignatureValue').textContent || '').replace(/\s+/g, '');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(c14n.canonicalizar(signedInfo), 'utf8'), crypto.createPublicKey(pem), Buffer.from(valor, 'base64'));
  return ok ? { valida: true, signatureValue: valor } : { valida: false, motivo: 'La firma no corresponde al certificado' };
}

module.exports = { firmarXml, verificarFirma, ALG };
