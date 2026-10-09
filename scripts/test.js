// Corre las pruebas de tests/ con el Node que trae Electron (ELECTRON_RUN_AS_NODE).
// better-sqlite3 es un módulo nativo: se compila para un solo runtime. La app lo necesita
// compilado para Electron, así que las pruebas usan ese mismo runtime y no hay que recompilar
// nada entre `npm start` y `npm test`. Para usar el Node del sistema: `npm run test:node`
// (requiere `npm run rebuild:node` antes y `npm run rebuild:electron` después).
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const carpeta = path.join(raiz, 'tests');
const filtro = process.argv[2];
const archivos = fs.readdirSync(carpeta)
  .filter((f) => f.endsWith('.test.js') && (!filtro || f.includes(filtro)))
  .sort()
  .map((f) => path.join('tests', f));

if (archivos.length === 0) {
  console.error(filtro ? `No hay pruebas que coincidan con "${filtro}".` : 'No hay pruebas en tests/.');
  process.exit(1);
}

const electron = require('electron'); // en Node, require('electron') devuelve la ruta del ejecutable
const resultado = spawnSync(electron, ['--test', ...archivos], {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(resultado.status === null ? 1 : resultado.status);
