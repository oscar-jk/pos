// Genera assets/icon.png (512×512) y assets/icon.ico (16–256 px, PNG incrustado) con Electron
// fuera de pantalla: verde de la marca (#0F3D34 / #146356) y una "X". Uso:
//   node_modules/electron/dist/electron.exe scripts/generar-icono.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DESTINO = path.join(__dirname, '..', 'assets');
const TAMANOS = [16, 24, 32, 48, 64, 128, 256];

const HTML = (tam) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;overflow:hidden">
<canvas id="c" style="display:block" width="${tam}" height="${tam}"></canvas>
<script>
const c = document.getElementById('c'); const g = c.getContext('2d'); const t = ${tam};
const r = t * 0.22;
g.beginPath(); g.moveTo(r, 0); g.arcTo(t, 0, t, t, r); g.arcTo(t, t, 0, t, r); g.arcTo(0, t, 0, 0, r); g.arcTo(0, 0, t, 0, r); g.closePath();
const fondo = g.createLinearGradient(0, 0, t, t); fondo.addColorStop(0, '#146356'); fondo.addColorStop(1, '#0F3D34');
g.fillStyle = fondo; g.fill();
g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineWidth = t * 0.13;
const a = t * 0.30, b = t * 0.70;
g.beginPath(); g.moveTo(a, a); g.lineTo(b, b); g.moveTo(b, a); g.lineTo(a, b); g.stroke();
</script>`;

// Se dibuja una sola vez a 512 px (las ventanas muy pequeñas no cargan) y se reduce con calidad máxima.
async function dibujar() {
  const tam = 512;
  const w = new BrowserWindow({ show: false, width: tam, height: tam, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const temporal = path.join(os.tmpdir(), 'punto-x-icono.html');
  fs.writeFileSync(temporal, HTML(tam));
  await w.loadFile(temporal);
  fs.unlinkSync(temporal);
  await new Promise((r) => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: tam, height: tam });
  w.destroy();
  // En pantallas con escala (125 %) la captura sale más grande: se normaliza a 512 px.
  return img.resize({ width: tam, height: tam, quality: 'best' });
}

// ICO con imágenes PNG: cabecera (6) + entradas (16 c/u) + datos.
function armarIco(imagenes) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(imagenes.length, 4);
  let offset = 6 + 16 * imagenes.length;
  const entradas = imagenes.map(({ tam, datos }) => {
    const e = Buffer.alloc(16);
    e[0] = tam >= 256 ? 0 : tam; e[1] = tam >= 256 ? 0 : tam;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(datos.length, 8); e.writeUInt32LE(offset, 12);
    offset += datos.length;
    return e;
  });
  return Buffer.concat([cab, ...entradas, ...imagenes.map((i) => i.datos)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  const base = await dibujar();
  const imagenes = TAMANOS.map((tam) => ({ tam, datos: base.resize({ width: tam, height: tam, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(DESTINO, 'icon.ico'), armarIco(imagenes));
  fs.writeFileSync(path.join(DESTINO, 'icon.png'), base.toPNG());
  console.log('Iconos generados en assets/');
  app.quit();
});
