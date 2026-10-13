// Identidad visual Nodo: logo del negocio, tokens (contraste), tipografías locales e iconos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');

const RAIZ = path.join(__dirname, '..');
const RENDERER = path.join(RAIZ, 'renderer');
const config = () => h.m('configuracion');
const impresion = require('../main/printing/plantillas');

// PNG de 1x1 válido (firma + IHDR + IDAT + IEND).
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const logoPng = `data:image/png;base64,${PNG_1X1}`;

// --- Logo del negocio ----------------------------------------------------------------------

test('logo: se guarda, aparece en los datos del negocio y se puede quitar', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  h.tx(db, () => config().guardarLogoNegocio(db, { dataUrl: logoPng }, ctx.usuarioId));
  assert.equal(config().obtenerDatosNegocio(db).negocio_logo, logoPng);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bitacora_auditoria WHERE entidad_id = 'negocio_logo'").get().n, 1);
  h.tx(db, () => config().quitarLogoNegocio(db, ctx.usuarioId));
  assert.equal(config().obtenerDatosNegocio(db).negocio_logo, '');
});

test('logo: solo PNG, JPG o WebP reales y de hasta 300 KB', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const guardar = (dataUrl) => h.tx(db, () => config().guardarLogoNegocio(db, { dataUrl }, ctx.usuarioId));
  assert.throws(() => guardar('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), /PNG, JPG o WebP/);
  assert.throws(() => guardar('data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4='), /PNG, JPG o WebP/);
  assert.throws(() => guardar('https://ejemplo.com/logo.png'), /PNG, JPG o WebP/);
  assert.throws(() => guardar(null), /PNG, JPG o WebP/);
  // El tipo declarado no basta: el contenido debe tener la firma de la imagen.
  assert.throws(() => guardar(`data:image/png;base64,${Buffer.from('esto no es una imagen').toString('base64')}`), /no es una imagen válida/);
  assert.throws(() => guardar(`data:image/jpeg;base64,${PNG_1X1}`), /no es una imagen válida/);
  const grande = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(301 * 1024)]);
  assert.throws(() => guardar(`data:image/png;base64,${grande.toString('base64')}`), /300 KB/);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  guardar(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
  guardar(`data:image/webp;base64,${webp.toString('base64')}`);
  assert.equal(config().obtenerDatosNegocio(db).negocio_logo.startsWith('data:image/webp'), true);
});

test('logo: exige permiso de configuración', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const cajero = h.usuarioDeRol(db, 'Cajero');
  h.loginUsuario(db, cajero);
  assert.throws(() => h.tx(db, () => config().guardarLogoNegocio(db, { dataUrl: logoPng }, cajero)), /permiso/i);
  assert.throws(() => h.tx(db, () => config().quitarLogoNegocio(db, cajero)), /permiso/i);
  assert.ok(ctx);
});

test('logo: se imprime en la factura solo si es una imagen válida', () => {
  const factura = { numero: '000001', ncf: 'B0200000001', fecha: new Date().toISOString(), lineas: [], pagos: [], total: 0, subtotal: 0, itbis_total: 0, tipo: 'factura' };
  const conLogo = impresion.plantillaFactura(factura, { nombre: 'Mi negocio', logo: logoPng });
  assert.match(conLogo, new RegExp(`<img src="data:image/png;base64,${PNG_1X1.slice(0, 20)}`));
  const hostil = impresion.plantillaFactura(factura, { nombre: 'Mi negocio', logo: '"><script>alert(1)</script>' });
  assert.doesNotMatch(hostil, /<script>alert/);
  assert.doesNotMatch(hostil, /<img src=/);
});

// --- Tokens, tipografías e iconos ----------------------------------------------------------

function tokens(css, bloque) {
  const m = bloque.exec(css);
  assert.ok(m, 'no se encontró el bloque de tokens');
  return Object.fromEntries([...m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((x) => [x[1], x[2]]));
}
const luminancia = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('tokens: texto y estados con contraste mínimo de 4.5:1 en tema claro y oscuro', () => {
  const css = fs.readFileSync(path.join(RENDERER, 'shared', 'styles.css'), 'utf8');
  const claro = tokens(css, /:root \{([\s\S]*?)\n\}/);
  const oscuro = tokens(css, /:root\[data-theme="dark"\] \{([^}]*)\}/);
  for (const [nombre, t] of [['claro', claro], ['oscuro', oscuro]]) {
    for (const fondo of ['surface-100', 'surface-200', 'surface-300']) {
      for (const texto of ['ink', 'ink-muted', 'ink-faint', 'brand', 'success', 'warning', 'danger', 'info']) {
        assert.ok(contraste(t[texto], t[fondo]) >= 4.5, `${nombre}: ${texto} sobre ${fondo} = ${contraste(t[texto], t[fondo]).toFixed(2)}`);
      }
    }
    assert.ok(contraste(t['on-brand'], t.brand) >= 4.5, `${nombre}: on-brand sobre brand`);
    for (const e of ['success', 'warning', 'danger', 'info']) assert.ok(contraste(t[e], t[`${e}-tint`]) >= 4.5, `${nombre}: ${e} sobre su tinte`);
    assert.ok(contraste(t['border-strong'], t['surface-200']) >= 3, `${nombre}: borde de campos 3:1`);
    assert.ok(contraste(t.focus, t['surface-100']) >= 3, `${nombre}: anillo de foco 3:1`);
  }
});

test('tipografías: archivos locales presentes y sin referencias a la red', () => {
  const css = fs.readFileSync(path.join(RENDERER, 'shared', 'styles.css'), 'utf8');
  const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 3);
  for (const u of urls) {
    assert.doesNotMatch(u, /^https?:/, u);
    assert.ok(fs.existsSync(path.join(RENDERER, 'shared', u)), `falta ${u}`);
  }
  for (const familia of ['Manrope', 'Instrument Sans', 'JetBrains Mono']) assert.match(css, new RegExp(`font-family: '${familia}'`));
  assert.ok(fs.existsSync(path.join(RAIZ, 'assets', 'fonts', 'licencias', 'InstrumentSans-OFL.txt')));
});

function paginas(dir = RENDERER) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === 'web' ? [] : paginas(path.join(dir, d.name))) : d.name.endsWith('.html') ? [path.join(dir, d.name)] : []));
}

test('iconos: cada módulo del menú tiene su icono y todas las pantallas cargan tema.js', () => {
  const iconos = fs.readFileSync(path.join(RENDERER, 'shared', 'iconos.js'), 'utf8');
  const disponibles = new Set([...iconos.matchAll(/^\s{2}"([a-z-]+)": "/gm)].map((m) => m[1]));
  assert.ok(disponibles.size >= 36, `solo ${disponibles.size} iconos`);
  const sidebar = fs.readFileSync(path.join(RENDERER, 'shared', 'sidebar.js'), 'utf8');
  const usados = [...sidebar.matchAll(/icono: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(usados.length >= 11);
  for (const u of usados) assert.ok(disponibles.has(u), `icono inexistente: ${u}`);
  for (const p of paginas()) {
    const html = fs.readFileSync(p, 'utf8');
    assert.match(html, /<script src="\.\.\/shared\/tema\.js">/, path.relative(RENDERER, p));
    if (html.includes('shared/sidebar.js')) assert.match(html, /<script src="\.\.\/shared\/iconos\.js">/, path.relative(RENDERER, p));
  }
});

test('iconos.js corresponde al sprite de assets/marca (regenerable con npm run iconos)', () => {
  const { execFileSync } = require('node:child_process');
  const ruta = path.join(RENDERER, 'shared', 'iconos.js');
  const antes = fs.readFileSync(ruta, 'utf8');
  execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'generar-iconos.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(fs.readFileSync(ruta, 'utf8'), antes);
});

test('texto mínimo de 12 px en las hojas de estilo y pantallas', () => {
  const archivos = [];
  (function recorrer(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'web') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) recorrer(p); else if (/\.(css|html|js)$/.test(e.name)) archivos.push(p);
    }
  }(RENDERER));
  for (const a of archivos) assert.doesNotMatch(fs.readFileSync(a, 'utf8'), /font-size:\s*(?:[0-9]|1[01])px/, path.relative(RENDERER, a));
});
