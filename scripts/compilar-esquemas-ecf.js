// Compila los XSD oficiales de la DGII (docs/dgii/xsd) a main/ecf/esquemas.json: el orden de
// los elementos, cuántas veces pueden aparecer y las restricciones de cada valor. El proceso
// principal arma y valida cada XML con este JSON, sin cargar los XSD en tiempo de ejecución.
//
// Uso: node scripts/compilar-esquemas-ecf.js          (escribe el JSON)
//      node scripts/compilar-esquemas-ecf.js --revisar (falla si el JSON no está al día)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DOMParser } = require('@xmldom/xmldom');

const RAIZ = path.join(__dirname, '..');
const CARPETA_XSD = path.join(RAIZ, 'docs', 'dgii', 'xsd');
const DESTINO = path.join(RAIZ, 'main', 'ecf', 'esquemas.json');

// Nombre interno → archivo XSD publicado por la DGII.
const ARCHIVOS = {
  ECF31: 'e-CF 31 v.1.0.xsd',
  ECF32: 'e-CF 32 v.1.0.xsd',
  ECF33: 'e-CF 33 v.1.0.xsd',
  ECF34: 'e-CF 34 v.1.0.xsd',
  ECF41: 'e-CF 41 v.1.0.xsd',
  ECF43: 'e-CF 43 v.1.0.xsd',
  ECF44: 'e-CF 44 v.1.0.xsd',
  ECF45: 'e-CF 45 v.1.0.xsd',
  ECF46: 'e-CF 46 v.1.0.xsd',
  ECF47: 'e-CF 47 v.1.0.xsd',
  RFCE: 'RFCE 32 v.1.0.xsd',
  ANECF: 'ANECF v.1.0.xsd',
  ACECF: 'ACECF v.1.0.xsd',
  ARECF: 'ARECF v1.0.xsd',
};

const hijos = (nodo, nombre) => Array.from(nodo.childNodes || []).filter((c) => c.nodeType === 1 && (!nombre || c.localName === nombre));
const sinPrefijo = (t) => (t || '').replace(/^[a-z]+:/, '');

function compilarTipoSimple(simpleType) {
  const restriccion = hijos(simpleType, 'restriction')[0];
  if (!restriccion) throw new Error('Tipo simple sin restricción');
  const tipo = { base: sinPrefijo(restriccion.getAttribute('base')) };
  for (const f of hijos(restriccion)) {
    const valor = f.getAttribute('value');
    switch (f.localName) {
      case 'enumeration': (tipo.enum = tipo.enum || []).push(valor); break;
      case 'pattern': (tipo.pat = tipo.pat || []).push(valor); break;
      case 'maxLength': tipo.maxLen = Number(valor); break;
      case 'minLength': tipo.minLen = Number(valor); break;
      case 'totalDigits': tipo.totDig = Number(valor); break;
      case 'fractionDigits': tipo.fracDig = Number(valor); break;
      case 'minInclusive': tipo.minInc = valor; break;
      case 'maxInclusive': tipo.maxInc = valor; break;
      case 'minExclusive': tipo.minExc = valor; break;
      case 'maxExclusive': tipo.maxExc = valor; break;
      default: throw new Error(`Faceta no soportada: ${f.localName}`);
    }
  }
  return tipo;
}

function compilar(archivo, tiposGlobales) {
  const texto = fs.readFileSync(path.join(CARPETA_XSD, archivo), 'utf8').replace(/^﻿/, '');
  const esquema = new DOMParser().parseFromString(texto, 'text/xml').documentElement;
  const claveDeTipo = (tipo) => {
    const clave = crypto.createHash('sha1').update(JSON.stringify(tipo)).digest('hex').slice(0, 12);
    tiposGlobales[clave] = tipo;
    return clave;
  };
  const nombrados = {};
  // trim: el XSD 31 publica un nombre con espacio inicial (" IndicadorServicioTodoIncluidoType").
  for (const st of hijos(esquema, 'simpleType')) nombrados[st.getAttribute('name').trim()] = claveDeTipo(compilarTipoSimple(st));

  function elemento(el) {
    const nodo = { n: el.getAttribute('name') };
    const min = el.getAttribute('minOccurs');
    const max = el.getAttribute('maxOccurs');
    if (min && min !== '1') nodo.min = Number(min);
    if (max && max !== '1') nodo.max = max === 'unbounded' ? 1e9 : Number(max);
    const tipo = el.getAttribute('type');
    const complejo = hijos(el, 'complexType')[0];
    const simple = hijos(el, 'simpleType')[0];
    if (tipo) {
      const t = sinPrefijo(tipo);
      if (nombrados[t]) nodo.t = nombrados[t];
      else if (['string', 'decimal', 'integer', 'dateTime'].includes(t)) nodo.t = claveDeTipo({ base: t });
      else throw new Error(`${archivo}: tipo desconocido ${tipo} en ${nodo.n}`);
    } else if (simple) {
      nodo.t = claveDeTipo(compilarTipoSimple(simple));
    } else if (complejo) {
      const secuencia = hijos(complejo, 'sequence')[0];
      if (!secuencia) throw new Error(`${archivo}: ${nodo.n} sin secuencia`);
      nodo.h = [];
      for (const h of hijos(secuencia)) {
        if (h.localName === 'element') nodo.h.push(elemento(h));
        else if (h.localName === 'any') nodo.h.push({ n: '*', min: Number(h.getAttribute('minOccurs') || 1) });
        else throw new Error(`${archivo}: ${h.localName} no soportado en ${nodo.n}`);
      }
    } else {
      throw new Error(`${archivo}: ${nodo.n} sin tipo`);
    }
    return nodo;
  }
  return elemento(hijos(esquema, 'element')[0]);
}

function generar() {
  const tipos = {};
  const raices = {};
  for (const [nombre, archivo] of Object.entries(ARCHIVOS)) raices[nombre] = compilar(archivo, tipos);
  const ordenados = Object.fromEntries(Object.keys(tipos).sort().map((k) => [k, tipos[k]]));
  return `${JSON.stringify({ fuente: 'DGII — Documentación Técnica (XSD) v1.0', raices, tipos: ordenados })}\n`;
}

if (require.main === module) {
  const contenido = generar();
  if (process.argv.includes('--revisar')) {
    const actual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : '';
    if (actual !== contenido) {
      console.error('main/ecf/esquemas.json no corresponde a los XSD. Ejecute: node scripts/compilar-esquemas-ecf.js');
      process.exit(1);
    }
    console.log('esquemas.json al día');
  } else {
    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(DESTINO, contenido);
    console.log(`Escrito ${path.relative(RAIZ, DESTINO)} (${contenido.length} bytes)`);
  }
}

module.exports = { generar, ARCHIVOS, CARPETA_XSD };
