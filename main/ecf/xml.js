// Arma los XML de facturación electrónica a partir de un objeto de datos, en el orden exacto
// que fijan los XSD de la DGII (esquemas.json) y validando cada valor contra su tipo antes de
// firmar. La DGII rechaza tags vacíos: todo campo sin valor se omite.
const esquemas = require('./esquemas.json');

// Patrones XSD → RegExp anclada (los XSD siempre comparan el valor completo).
const cacheRegex = new Map();
function regex(patron) {
  if (!cacheRegex.has(patron)) cacheRegex.set(patron, new RegExp(`^(?:${patron})$`));
  return cacheRegex.get(patron);
}

function vacio(valor) {
  if (valor === null || valor === undefined || valor === '') return true;
  if (Array.isArray(valor)) return valor.every(vacio);
  if (typeof valor === 'object') return Object.values(valor).every(vacio);
  return false;
}

// Cantidad de decimales que admite un tipo decimal: la faceta fractionDigits o, si no la trae,
// la mayor que acepte su patrón (se prueba "1.0000", "1.000", "1.00").
function decimalesDe(tipo) {
  if (tipo.fracDig !== undefined) return tipo.fracDig;
  for (let d = 4; d > 2; d -= 1) {
    const prueba = `1.${'0'.repeat(d)}`;
    if ((tipo.pat || []).every((p) => regex(p).test(prueba))) return d;
  }
  return 2;
}

// Números: hasta los decimales del tipo, nunca menos de dos (formato de montos de la DGII:
// punto decimal, sin separador de miles). Regla de redondeo DGII: tercer decimal ≥ 5 sube.
function formatearDecimal(numero, decimales) {
  if (!Number.isFinite(numero)) return null;
  const factor = 10 ** decimales;
  const redondeado = Math.round((Math.abs(numero) + Number.EPSILON) * factor) / factor;
  let texto = redondeado.toFixed(decimales);
  if (decimales > 2) texto = texto.replace(/0+$/, '').replace(/\.(\d?)$/, (_, d) => `.${d.padEnd(2, '0')}`);
  return (numero < 0 && redondeado !== 0 ? '-' : '') + texto;
}

function formatear(tipo, valor) {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number') {
    if (tipo.base === 'integer') return Number.isInteger(valor) ? String(valor) : null;
    if (tipo.base === 'decimal') return formatearDecimal(valor, Math.max(2, decimalesDe(tipo)));
    return String(valor);
  }
  return null;
}

function errorDeValor(tipo, texto) {
  if (texto === null) return 'tipo de dato no válido';
  if (tipo.enum && !tipo.enum.includes(texto)) return 'no es uno de los valores permitidos';
  for (const p of tipo.pat || []) {
    if (!regex(p).test(texto)) return 'no cumple el formato';
  }
  if (tipo.maxLen !== undefined && [...texto].length > tipo.maxLen) return `excede ${tipo.maxLen} caracteres`;
  if (tipo.minLen !== undefined && [...texto].length < tipo.minLen) return `debe tener al menos ${tipo.minLen} caracteres`;
  if (tipo.base === 'decimal' || tipo.base === 'integer') {
    const n = Number(texto);
    if (!Number.isFinite(n)) return 'no es un número';
    if (tipo.minInc !== undefined && n < Number(tipo.minInc)) return `debe ser al menos ${tipo.minInc}`;
    if (tipo.minExc !== undefined && n <= Number(tipo.minExc)) return `debe ser mayor que ${tipo.minExc}`;
    if (tipo.maxInc !== undefined && n > Number(tipo.maxInc)) return `debe ser como máximo ${tipo.maxInc}`;
    if (tipo.maxExc !== undefined && n >= Number(tipo.maxExc)) return `debe ser menor que ${tipo.maxExc}`;
    const [enteros, decimales = ''] = texto.replace(/^[+-]/, '').split('.');
    if (tipo.totDig !== undefined && (enteros.replace(/^0+(?=\d)/, '') + decimales).length > tipo.totDig) return 'tiene demasiados dígitos';
    if (tipo.fracDig !== undefined && decimales.length > tipo.fracDig) return `admite hasta ${tipo.fracDig} decimales`;
  }
  return null;
}

function armar(esquema, valor, ruta, errores) {
  if (esquema.h) {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
      errores.push(`${ruta}: se esperaba una sección`);
      return { n: esquema.n, h: [] };
    }
    const conocidos = new Set(esquema.h.map((h) => h.n));
    for (const [clave, v] of Object.entries(valor)) {
      if (!conocidos.has(clave) && !vacio(v)) errores.push(`${ruta}/${clave}: el campo no existe en este formato`);
    }
    const hijos = [];
    for (const h of esquema.h) {
      if (h.n === '*') continue; // la firma digital: la agrega firma.js
      const crudo = valor[h.n];
      let lista = (Array.isArray(crudo) ? crudo : [crudo]).filter((x) => !vacio(x));
      const min = h.min ?? 1;
      const max = h.max ?? 1;
      // Sección obligatoria cuyos campos son todos opcionales (p. ej. Comprador del RFCE de un
      // consumidor anónimo): el XSD exige la etiqueta aunque quede sin contenido.
      if (lista.length === 0 && min >= 1 && h.h && h.h.every((x) => (x.min ?? 1) === 0)) lista = [{}];
      if (lista.length < min) errores.push(`${ruta}/${h.n}: es obligatorio`);
      if (lista.length > max) errores.push(`${ruta}/${h.n}: admite hasta ${max}`);
      for (const x of lista) hijos.push(armar(h, x, `${ruta}/${h.n}`, errores));
    }
    return { n: esquema.n, h: hijos };
  }
  const tipo = esquemas.tipos[esquema.t];
  const texto = formatear(tipo, valor);
  const problema = errorDeValor(tipo, texto);
  if (problema) errores.push(`${ruta}: «${valor}» ${problema}`);
  return { n: esquema.n, v: texto ?? '' };
}

// Escapado para el XML que se envía. En texto, la DGII pide además reemplazar comillas y
// apóstrofos; la firma se calcula sobre la forma canónica, que es equivalente.
function escaparTexto(texto) {
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function serializarArbol(nodo) {
  if (nodo.h) return `<${nodo.n}>${nodo.h.map(serializarArbol).join('')}</${nodo.n}>`;
  return `<${nodo.n}>${escaparTexto(nodo.v)}</${nodo.n}>`;
}

class ErrorFormatoEcf extends Error {
  constructor(formato, errores) {
    super(`El comprobante no cumple el formato de la DGII (${formato}): ${errores.slice(0, 5).join('; ')}${errores.length > 5 ? ` y ${errores.length - 5} más` : ''}`);
    this.errores = errores;
  }
}

// formato: clave de esquemas.raices (ECF31, RFCE, ANECF...). Devuelve el XML sin firmar.
function construirXml(formato, datos) {
  const esquema = esquemas.raices[formato];
  if (!esquema) throw new Error(`Formato desconocido: ${formato}`);
  const errores = [];
  const arbol = armar(esquema, datos, esquema.n, errores);
  if (errores.length) throw new ErrorFormatoEcf(formato, errores);
  return `<?xml version="1.0" encoding="utf-8"?>${serializarArbol(arbol)}`;
}

module.exports = { construirXml, ErrorFormatoEcf, escaparTexto, formatearDecimal, vacio };
