// Validación contra los XSD oficiales de la DGII con libxml2 (xmllint-wasm), independiente del
// validador propio de main/ecf/xml.js. Los XSD de la DGII usan grupos "(?:" que .NET acepta y
// libxml2 no; se normalizan a "(" (mismo significado) solo para validar. También el nombre de
// tipo con espacio inicial del XSD 31 (" IndicadorServicioTodoIncluidoType").
const fs = require('node:fs');
const path = require('node:path');
const { validateXML } = require('xmllint-wasm');
const { ARCHIVOS, CARPETA_XSD } = require('../scripts/compilar-esquemas-ecf');

const cache = new Map();
function xsd(formato) {
  if (!cache.has(formato)) {
    const texto = fs.readFileSync(path.join(CARPETA_XSD, ARCHIVOS[formato]), 'utf8')
      .replace(/^﻿/, '')
      .split('(?:').join('(')
      .split('name=" ').join('name="');
    cache.set(formato, texto);
  }
  return cache.get(formato);
}

async function validarContraXsd(formato, xml) {
  const r = await validateXML({ xml: [{ fileName: 'doc.xml', contents: xml }], schema: [{ fileName: 'esquema.xsd', contents: xsd(formato) }] });
  return { valido: r.valid, errores: r.errors.map((e) => e.message || e.rawMessage || String(e)) };
}

module.exports = { validarContraXsd };
