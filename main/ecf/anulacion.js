// Anulación de e-NCF ante la DGII (formato ANECF): secuencias que no se usaron y e-CF firmados
// que nunca se enviaron. Queda en cola y se transmite con los demás pendientes.
const crypto = require('node:crypto');

const construir = require('./construir');
const { construirXml } = require('./xml');
const { firmarXml } = require('./firma');
const emision = require('./emision');

const encfDe = (tipoEcf, numero) => `E${tipoEcf}${String(numero).padStart(10, '0')}`;

function registrarAnulacion(db, { tipoEcf, desde, hasta, motivo, usuarioId }) {
  if (!construir.TIPOS_ECF[tipoEcf]) throw new Error('Tipo de e-CF no válido');
  if (!(Number.isInteger(desde) && Number.isInteger(hasta) && desde > 0 && hasta >= desde)) {
    throw new Error('El rango a anular no es válido: "desde" debe ser menor o igual que "hasta"');
  }
  if (!motivo || !String(motivo).trim()) throw new Error('La anulación de secuencias requiere un motivo');
  const emisor = emision.datosEmisor(db);
  const rango = { tipoEcf, desde: encfDe(tipoEcf, desde), hasta: encfDe(tipoEcf, hasta) };
  const firmado = firmarXml(construirXml('ANECF', construir.construirAnecf({ rncEmisor: emisor.rnc, rangos: [rango] })), emision.certificadoActivo(db));
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ecf_anulaciones (id, tipo_ecf, encf_desde, encf_hasta, cantidad, motivo, ambiente, xml, estado, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`
  ).run(id, tipoEcf, rango.desde, rango.hasta, hasta - desde + 1, String(motivo).trim(), emision.ambienteEcf(db), firmado.xml, usuarioId || null);
  return id;
}

// e-CF firmado que no llegó a enviarse y cuyo documento se anula: se marca anulado y su e-NCF
// se anula ante la DGII.
function anularEcfNoEnviado(db, ecf, { motivo, usuarioId }) {
  db.prepare("UPDATE ecf_documentos SET estado = 'anulado', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(ecf.id);
  const numero = Number(ecf.encf.slice(3));
  return registrarAnulacion(db, { tipoEcf: ecf.tipo_ecf, desde: numero, hasta: numero, motivo, usuarioId });
}

// Secuencias que no se van a usar (p. ej. las que quedan al vencer el rango): se anulan desde
// el próximo número disponible, para que el sistema nunca llegue a emitirlas.
function anularSecuenciasNoUsadas(db, { tipoEcf, hasta, motivo, usuarioId }) {
  const filas = db
    .prepare('SELECT * FROM tipos_ncf WHERE codigo = ? AND deleted_at IS NULL AND secuencia_actual <= secuencia_hasta ORDER BY secuencia_desde, created_at')
    .all(`E${tipoEcf}`);
  const fila = filas.find((f) => hasta >= f.secuencia_actual && hasta <= f.secuencia_hasta);
  if (!fila) throw new Error('El número "hasta" no corresponde a una secuencia registrada sin usar');
  const id = registrarAnulacion(db, { tipoEcf, desde: fila.secuencia_actual, hasta, motivo, usuarioId });
  db.prepare("UPDATE tipos_ncf SET secuencia_actual = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hasta + 1, fila.id);
  return { id, desde: encfDe(tipoEcf, fila.secuencia_actual), hasta: encfDe(tipoEcf, hasta), cantidad: hasta - fila.secuencia_actual + 1 };
}

module.exports = { registrarAnulacion, anularEcfNoEnviado, anularSecuenciasNoUsadas, encfDe };
