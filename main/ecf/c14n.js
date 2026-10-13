// Canonicalización XML inclusiva 1.0 sin comentarios (http://www.w3.org/TR/2001/REC-xml-c14n-20010315),
// el método que exige la DGII para firmar. Trabaja sobre nodos de @xmldom/xmldom.
//
// Para un subconjunto (p. ej. SignedInfo) se declaran en su elemento raíz todos los espacios de
// nombres heredados de los ancestros — así lo hace la canonicalización inclusiva de .NET, que es
// la que usa la DGII para verificar.
const { DOMParser } = require('@xmldom/xmldom');

const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const ELEMENTO = 1;
const TEXTO = 3;
const CDATA = 4;

function escaparTextoC14n(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

function escaparAtributoC14n(texto) {
  return texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
}

const esDeclaracionNs = (a) => a.name === 'xmlns' || a.name.startsWith('xmlns:');
const prefijoDeclarado = (a) => (a.name === 'xmlns' ? '' : a.name.slice(6));
const atributos = (el) => Array.from(el.attributes || []);

// Espacios de nombres en ámbito para los hijos de "el" (incluye los que declara "el").
function ambitoDe(el, ambitoPadre) {
  const ambito = { ...ambitoPadre };
  for (const a of atributos(el)) if (esDeclaracionNs(a)) ambito[prefijoDeclarado(a)] = a.value;
  return ambito;
}

// Los heredados de los ancestros de "el" (sin contar los que declara el propio "el").
function ambitoHeredado(el) {
  const cadena = [];
  for (let p = el.parentNode; p && p.nodeType === ELEMENTO; p = p.parentNode) cadena.unshift(p);
  return cadena.reduce((amb, anc) => ambitoDe(anc, amb), {});
}

function compararAtributos(a, b) {
  const nsA = a.namespaceURI || '';
  const nsB = b.namespaceURI || '';
  if (nsA !== nsB) return nsA < nsB ? -1 : 1;
  const la = a.localName || a.name;
  const lb = b.localName || b.name;
  return la < lb ? -1 : la > lb ? 1 : 0;
}

function renderizar(el, ambitoPadre, yaRenderizados, opciones, escaparTexto) {
  const ambito = ambitoDe(el, ambitoPadre);
  const renderizados = { ...yaRenderizados };
  const declaraciones = [];
  for (const [prefijo, uri] of Object.entries(ambito)) {
    if (prefijo === 'xml') continue;
    const anterior = renderizados[prefijo];
    if (prefijo === '' && uri === '' && !anterior) continue; // xmlns="" sin default previo: no se emite
    if (anterior === uri) continue;
    declaraciones.push([prefijo, uri]);
    renderizados[prefijo] = uri;
  }
  declaraciones.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const attrs = atributos(el).filter((a) => !esDeclaracionNs(a)).sort(compararAtributos);

  let salida = `<${el.nodeName}`;
  for (const [prefijo, uri] of declaraciones) salida += prefijo ? ` xmlns:${prefijo}="${escaparAtributoC14n(uri)}"` : ` xmlns="${escaparAtributoC14n(uri)}"`;
  for (const a of attrs) salida += ` ${a.name}="${escaparAtributoC14n(a.value)}"`;
  salida += '>';
  for (const hijo of Array.from(el.childNodes || [])) {
    if (hijo.nodeType === ELEMENTO) {
      if (opciones.excluir && opciones.excluir(hijo)) continue;
      salida += renderizar(hijo, ambito, renderizados, opciones, escaparTexto);
    } else if (hijo.nodeType === TEXTO || hijo.nodeType === CDATA) {
      salida += escaparTexto(hijo.data);
    }
    // Comentarios e instrucciones de procesamiento dentro del elemento: fuera (c14n sin comentarios).
  }
  return `${salida}</${el.nodeName}>`;
}

// Forma canónica del elemento como raíz de un subconjunto del documento.
function canonicalizar(el, opciones = {}) {
  return renderizar(el, ambitoHeredado(el), {}, opciones, escaparTextoC14n);
}

const esFirma = (nodo) => nodo.localName === 'Signature' && nodo.namespaceURI === NS_DSIG;

// Firma "enveloped": el documento se digiere sin su elemento Signature.
function canonicalizarSinFirma(raiz) {
  return canonicalizar(raiz, { excluir: esFirma });
}

// Mismo resultado que la forma canónica pero con comillas y apóstrofos escapados en el texto,
// como pide la DGII para el XML que se transmite.
function serializarParaEnvio(raiz) {
  const escaparEnvio = (t) => escaparTextoC14n(t).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return renderizar(raiz, ambitoHeredado(raiz), {}, {}, escaparEnvio);
}

// La DGII firma sin preservar espacios: se quitan los nodos de texto que son solo espacios
// entre etiquetas (los valores con contenido no se tocan).
function quitarEspaciosEntreEtiquetas(el) {
  for (const hijo of Array.from(el.childNodes || [])) {
    if (hijo.nodeType === TEXTO && !/\S/.test(hijo.data) && Array.from(el.childNodes).some((h) => h.nodeType === ELEMENTO)) {
      el.removeChild(hijo);
    } else if (hijo.nodeType === ELEMENTO) {
      quitarEspaciosEntreEtiquetas(hijo);
    } else if (hijo.nodeType !== TEXTO && hijo.nodeType !== CDATA) {
      el.removeChild(hijo); // comentarios / PIs internos
    }
  }
}

function parsearXml(texto) {
  const errores = [];
  const doc = new DOMParser({
    onError: (nivel, mensaje) => { if (nivel !== 'warning') errores.push(mensaje); },
  }).parseFromString(String(texto).replace(/^﻿/, ''), 'text/xml');
  if (errores.length || !doc || !doc.documentElement) throw new Error(`El XML no es válido: ${errores[0] || 'documento vacío'}`);
  return doc;
}

module.exports = { canonicalizar, canonicalizarSinFirma, serializarParaEnvio, quitarEspaciosEntreEtiquetas, parsearXml, esFirma, NS_DSIG };
