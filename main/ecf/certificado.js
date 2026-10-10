// Certificado digital para procesos tributarios (.p12 / .pfx) emitido por una prestadora de
// servicios de confianza acreditada por INDOTEL. Se usa para firmar cada e-CF y para
// autenticarse en los servicios de la DGII.
const forge = require('node-forge');

const OID_SERIAL = '2.5.4.5'; // "SN" del sujeto: RNC, cédula o pasaporte del titular

function atributo(sujeto, ...claves) {
  for (const c of claves) {
    const a = sujeto.attributes.find((x) => x.shortName === c || x.name === c || x.type === c);
    if (a) return String(a.value);
  }
  return '';
}

function mismaClave(cert, clave) {
  const pub = cert.publicKey;
  return pub && pub.n && clave && clave.n && pub.n.equals(clave.n) && pub.e.equals(clave.e);
}

// contenido: Buffer del archivo .p12. Lanza un error en español si no se puede leer.
function leerP12(contenido, password) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(contenido.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password || '');
  } catch (e) {
    if (/mac|password|Invalid/i.test(e.message)) throw new Error('La contraseña del certificado no es correcta o el archivo no es un .p12 válido');
    throw new Error('El archivo no es un certificado .p12/.pfx válido');
  }
  const bolsasClave = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const clave = bolsasClave.map((b) => b.key).find(Boolean);
  if (!clave) throw new Error('El certificado no contiene la llave privada');
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert).filter(Boolean);
  const cert = certificados.find((c) => mismaClave(c, clave)) || certificados[0];
  if (!cert) throw new Error('El archivo no contiene un certificado');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    clavePrivadaPem: forge.pki.privateKeyToPem(clave),
    certificadoBase64: forge.util.encode64(der),
    titular: atributo(cert.subject, 'CN', 'O') || 'Sin nombre',
    identificacion: atributo(cert.subject, OID_SERIAL, 'serialName', 'serialNumber').replace(/^\D+/, ''),
    emisor: atributo(cert.issuer, 'O', 'CN'),
    serie: cert.serialNumber,
    validoDesde: cert.validity.notBefore.toISOString(),
    validoHasta: cert.validity.notAfter.toISOString(),
  };
}

function exigirVigente(datos, ahora = new Date()) {
  if (new Date(datos.validoDesde) > ahora) throw new Error('El certificado digital todavía no está vigente');
  if (new Date(datos.validoHasta) < ahora) {
    throw new Error(`El certificado digital venció el ${datos.validoHasta.slice(0, 10)}. Cargue el certificado renovado en Configuración > Facturación electrónica.`);
  }
}

module.exports = { leerP12, exigirVigente };
