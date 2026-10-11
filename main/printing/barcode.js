// Código de barras Code 128 (juego B: ASCII 32 a 126) como SVG, sin dependencias. Lo leen todos
// los lectores comunes. Cada símbolo son 6 anchos alternos barra/espacio que suman 11 módulos;
// el de parada tiene 7 y suma 13.
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

// Valores de símbolo del texto (con inicio y dígito de control, sin parada).
function simbolos(texto) {
  const t = String(texto);
  if (!t.length) throw new Error('El código de barras no puede estar vacío');
  const valores = [START_B];
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`El carácter "${ch}" no se puede codificar en el código de barras`);
    valores.push(c - 32);
  }
  const control = valores.reduce((acc, v, i) => acc + (i === 0 ? v : v * i), 0) % 103;
  valores.push(control);
  return valores;
}

// Cadena de módulos ("1" barra, "0" espacio) del código completo.
function modulos(texto) {
  const todos = [...simbolos(texto), STOP];
  let salida = '';
  for (const v of todos) {
    let barra = true;
    for (const ancho of PATRONES[v]) {
      salida += (barra ? '1' : '0').repeat(Number(ancho));
      barra = !barra;
    }
  }
  return salida;
}

// SVG del código: zona de silencio de 10 módulos a cada lado, barras de la altura indicada.
function codigoBarrasSvg(texto, { moduloPx = 1.6, alto = 40 } = {}) {
  const m = modulos(texto);
  const silencio = 10;
  const ancho = (m.length + silencio * 2) * moduloPx;
  let rects = '';
  for (let i = 0; i < m.length;) {
    if (m[i] === '1') {
      let j = i;
      while (j < m.length && m[j] === '1') j += 1;
      rects += `<rect x="${((silencio + i) * moduloPx).toFixed(2)}" y="0" width="${((j - i) * moduloPx).toFixed(2)}" height="${alto}"/>`;
      i = j;
    } else {
      i += 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho.toFixed(2)}" height="${alto}" viewBox="0 0 ${ancho.toFixed(2)} ${alto}" shape-rendering="crispEdges" fill="#000">${rects}</svg>`;
}

module.exports = { codigoBarrasSvg, modulos, simbolos, PATRONES };
