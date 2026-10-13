// Certificado de prueba autofirmado (.p12) para las suites de facturación electrónica. Nunca se
// usa fuera de las pruebas: la DGII solo acepta certificados de una prestadora acreditada.
const crypto = require('node:crypto');
const forge = require('node-forge');

let cache = null;

function certificadoDePrueba({ password = 'clave-prueba', identificacion = '00100000001', dias = 365 } = {}) {
  if (cache && cache.password === password && cache.identificacion === identificacion && cache.dias === dias) return cache;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clave = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  cert.serialNumber = '01';
  const ahora = new Date();
  cert.validity.notBefore = new Date(ahora.getTime() - 86400000);
  cert.validity.notAfter = new Date(ahora.getTime() + dias * 86400000);
  const sujeto = [{ name: 'commonName', value: 'Firmante de Prueba' }, { type: '2.5.4.5', value: `IDCDO-${identificacion}` }];
  cert.setSubject(sujeto);
  cert.setIssuer([{ name: 'commonName', value: 'CA de Prueba' }, { name: 'organizationName', value: 'Pruebas Punto X' }]);
  cert.sign(clave, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(clave, [cert], password, { algorithm: '3des' });
  const p12 = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
  cache = { p12, password, identificacion, dias };
  return cache;
}

module.exports = { certificadoDePrueba };
