// Genera renderer/shared/iconos.js a partir del sprite de Nodo (assets/marca/nodo-sprite.svg).
// El sprite no se referencia con <use href="archivo#id"> porque las referencias externas no
// funcionan bajo file://; los trazos se incrustan en línea y heredan el color con currentColor.
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const sprite = fs.readFileSync(path.join(raiz, 'assets', 'marca', 'nodo-sprite.svg'), 'utf8');
const iconos = {};
for (const m of sprite.matchAll(/<symbol id="i-([a-z-]+)"[^>]*>([\s\S]*?)<\/symbol>/g)) {
  iconos[m[1]] = m[2].replace(/<(\w+)([^>]*)><\/\1>/g, '<$1$2/>');
}
if (Object.keys(iconos).length < 30) throw new Error('El sprite no tiene los 36 iconos esperados');

const salida = `// Generado por scripts/generar-iconos.js desde assets/marca/nodo-sprite.svg. No editar a mano.
(function () {
  const ICONOS = ${JSON.stringify(iconos, null, 2)};

  // Icono de línea de 24 px (trazo 1.75) que hereda el color del texto.
  function icono(nombre, tamano) {
    const trazos = ICONOS[nombre];
    if (!trazos) return '';
    const t = tamano || 20;
    return '<svg class="icono" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + trazos + '</svg>';
  }

  window.PuntoXIconos = { icono, nombres: Object.keys(ICONOS) };
})();
`;
fs.writeFileSync(path.join(raiz, 'renderer', 'shared', 'iconos.js'), salida);
console.log(`iconos.js: ${Object.keys(iconos).length} iconos`);
