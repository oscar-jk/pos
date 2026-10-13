// A2: política de seguridad de contenido y escape de datos en las pantallas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const RENDERER = path.join(__dirname, '..', 'renderer');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'";

function listar(dir, ext, excluir = []) {
  const salida = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (!excluir.includes(f)) salida.push(...listar(p, ext, excluir)); } else if (f.endsWith(ext)) salida.push(p);
  }
  return salida;
}
const paginas = listar(RENDERER, '.html');
const scripts = listar(RENDERER, '.js', ['web']);

test('A2: las 14 pantallas declaran la CSP exacta', () => {
  assert.equal(paginas.length, 14);
  for (const p of paginas) {
    const html = fs.readFileSync(p, 'utf8');
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
    assert.ok(meta, `${path.relative(RENDERER, p)} no tiene CSP`);
    assert.equal(meta[1], CSP, path.relative(RENDERER, p));
  }
});

test('A2: sin scripts ni manejadores en línea (la CSP los bloquearía)', () => {
  for (const p of paginas) {
    const html = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${path.relative(RENDERER, p)} tiene un <script> en línea`);
    assert.doesNotMatch(html, /\son[a-z]+=["']/, `${path.relative(RENDERER, p)} tiene un manejador en línea`);
  }
  for (const s of scripts) assert.doesNotMatch(fs.readFileSync(s, 'utf8'), /\son(click|change|input|submit|load|error)=["\\]/, path.relative(RENDERER, s));
});

test('A2: escape.js se carga primero en cada pantalla', () => {
  for (const p of paginas) {
    const srcs = [...fs.readFileSync(p, 'utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(srcs[0], '../shared/escape.js', path.relative(RENDERER, p));
  }
});

test('A2: una sola función de escape (renderer/shared/escape.js)', () => {
  for (const s of scripts) {
    if (s.endsWith(path.join('shared', 'escape.js'))) continue;
    assert.doesNotMatch(fs.readFileSync(s, 'utf8'), /function (esc|escHtml|escTopbar|escModal|escapar|escaparHtml)\s*\(/, path.relative(RENDERER, s));
  }
  const contexto = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(RENDERER, 'shared', 'escape.js'), 'utf8'), contexto);
  assert.equal(contexto.esc(`<img src=x onerror="alert('x')">&`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
  assert.equal(contexto.esc(null), '');
  assert.equal(contexto.esc(0), '0');
});

// Un campo de datos (obj.campo, obj.campo || 'x', cond ? obj.a : 'b') dentro de una plantilla
// que arma HTML debe ir dentro de esc(). Los nombres que por diseño traen HTML se excluyen.
test('A2: ningún dato se inserta en HTML sin esc()', () => {
  const NOMBRES_HTML = /(html|Html|icono|svg|filas|contenido|campo|selector|opciones)$/;
  const literal = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !/</.test(n.text);
  const esCampo = (n) => {
    if (ts.isParenthesizedExpression(n)) return esCampo(n.expression);
    if (ts.isPropertyAccessExpression(n)) return !NOMBRES_HTML.test(n.name.text) && (ts.isIdentifier(n.expression) || esCampo(n.expression) || ts.isElementAccessExpression(n.expression));
    if (ts.isElementAccessExpression(n)) return ts.isIdentifier(n.expression) || esCampo(n.expression);
    return false;
  };
  const esDato = (n) => {
    if (ts.isParenthesizedExpression(n)) return esDato(n.expression);
    if (esCampo(n)) return true;
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind)) return esDato(n.left) && (literal(n.right) || esDato(n.right));
    if (ts.isConditionalExpression(n)) return (literal(n.whenTrue) || esDato(n.whenTrue)) && (literal(n.whenFalse) || esDato(n.whenFalse)) && (esDato(n.whenTrue) || esDato(n.whenFalse));
    return false;
  };
  const sinEscape = [];
  for (const archivo of scripts) {
    const src = fs.readFileSync(archivo, 'utf8');
    const sf = ts.createSourceFile(archivo, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    (function visitar(n) {
      if (ts.isTemplateExpression(n) && /<[a-zA-Z/!]/.test(n.head.text + n.templateSpans.map((s) => s.literal.text).join(''))) {
        for (const span of n.templateSpans) {
          if (esDato(span.expression)) {
            const linea = sf.getLineAndCharacterOfPosition(span.expression.getStart(sf)).line + 1;
            sinEscape.push(`${path.relative(RENDERER, archivo)}:${linea} \${${span.expression.getText(sf)}}`);
          }
        }
      }
      ts.forEachChild(n, visitar);
    })(sf);
  }
  assert.deepEqual(sinEscape, []);
});
