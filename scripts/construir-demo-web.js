// Arma la demo web de prueba (renderer + assets con los "bridges" de renderer/shared/web, que
// simulan el backend con datos de prueba en el navegador) en dist-demo/, lista para publicar como
// sitio estático (GitHub Pages). No incluye la base real ni nada del proceso principal.
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'dist-demo');

// Se vacía el contenido (no la carpeta) para poder reconstruir con un servidor local abierto en ella.
fs.mkdirSync(destino, { recursive: true });
for (const e of fs.readdirSync(destino)) fs.rmSync(path.join(destino, e), { recursive: true, force: true });
fs.cpSync(path.join(raiz, 'renderer'), path.join(destino, 'renderer'), { recursive: true });
fs.cpSync(path.join(raiz, 'assets', 'fonts'), path.join(destino, 'assets', 'fonts'), { recursive: true });
fs.cpSync(path.join(raiz, 'assets', 'marca'), path.join(destino, 'assets', 'marca'), { recursive: true });
fs.copyFileSync(path.join(raiz, 'assets', 'icon.png'), path.join(destino, 'assets', 'icon.png'));

fs.writeFileSync(path.join(destino, 'index.html'), `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="0; url=renderer/login/index.html" />
<link rel="icon" href="assets/icon.png" /><title>Nodo — Demo</title></head>
<body><p><a href="renderer/login/index.html">Abrir la demo de Nodo</a></p></body></html>
`);
fs.writeFileSync(path.join(destino, '.nojekyll'), '');
console.log('Demo web en dist-demo/');
