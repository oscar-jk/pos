// Servidor estático mínimo, solo para probar la carpeta renderer/ como si fuera un sitio
// web (GitHub Pages serviría estos mismos archivos igual). No se usa en producción ni se
// referencia desde package.json — es una herramienta de verificación local.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// La raíz es la carpeta del proyecto completa (no solo renderer/), porque las hojas de
// estilo referencian ../../assets/... desde renderer/*/ — igual a como quedaría publicado
// en GitHub Pages sirviendo el repo completo.
const RAIZ = path.join(__dirname, '..');
const PUERTO = process.env.PORT || 8080;

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/renderer/login/index.html';
  const rutaCompleta = path.join(RAIZ, urlPath);
  if (!rutaCompleta.startsWith(RAIZ)) { res.writeHead(403); res.end('Prohibido'); return; }
  fs.readFile(rutaCompleta, (err, contenido) => {
    if (err) { res.writeHead(404); res.end('No encontrado: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(rutaCompleta)] || 'application/octet-stream' });
    res.end(contenido);
  });
}).listen(PUERTO, () => console.log(`Servidor de prueba en http://localhost:${PUERTO}`));
