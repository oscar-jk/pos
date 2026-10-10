// Cola de envío a la DGII. Las ventas nunca esperan a la red: el e-CF se firma al emitir y aquí
// se transmite (recepción o RFCE), se consulta su resultado por TrackId y, si no hay conexión,
// se reintenta con espera creciente. El plazo legal para enviar lo emitido sin conexión es de
// 72 horas (Informe Técnico e-CF §19).
const { crearClienteDgii, ErrorConexionDgii } = require('./dgii');
const { firmarXml } = require('./firma');
const emision = require('./emision');

const ESPERAS_MIN = [1, 5, 15, 60]; // minutos entre reintentos según los intentos fallidos
const PLAZO_CONTINGENCIA_H = 72;

const ESTADO_POR_CODIGO = { 1: 'aceptado', 2: 'rechazado', 3: 'en_proceso', 4: 'aceptado_condicional' };
const ESTADO_POR_TEXTO = { aceptado: 'aceptado', 'aceptado condicional': 'aceptado_condicional', rechazado: 'rechazado', 'en proceso': 'en_proceso' };
const FINALES = new Set(['aceptado', 'aceptado_condicional', 'rechazado']);

function estadoDe(respuesta) {
  const texto = String(respuesta.estado || '').toLowerCase().trim();
  if (ESTADO_POR_TEXTO[texto]) return ESTADO_POR_TEXTO[texto];
  return ESTADO_POR_CODIGO[Number(respuesta.codigo)] || null;
}

function mensajesDe(respuesta) {
  const lista = [].concat(respuesta.mensajes || respuesta.mensaje || respuesta.error || []);
  return lista
    .map((m) => (typeof m === 'string' ? { valor: m } : { codigo: m.codigo, valor: m.valor || m.mensaje || JSON.stringify(m) }))
    .filter((m) => m.valor);
}

const masMinutos = (fecha, minutos) => new Date(fecha.getTime() + minutos * 60000).toISOString();

function actualizar(db, tabla, id, campos) {
  const claves = Object.keys(campos);
  db.prepare(`UPDATE ${tabla} SET ${claves.map((c) => `${c} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(...claves.map((c) => campos[c]), id);
}

function registrarFallo(db, tabla, fila, motivo, { conexion, ahora }) {
  const intentos = fila.intentos + 1;
  const campos = { intentos, ultimo_error: motivo, proximo_intento_at: masMinutos(ahora, ESPERAS_MIN[Math.min(intentos, ESPERAS_MIN.length) - 1]) };
  if (conexion && tabla === 'ecf_documentos') campos.contingencia = 1;
  actualizar(db, tabla, fila.id, campos);
}

function clienteParaAmbiente(db, ambiente, opciones, cache) {
  if (!cache.has(ambiente)) {
    cache.set(ambiente, opciones.crearCliente
      ? opciones.crearCliente(ambiente)
      : crearClienteDgii({ ambiente, firmar: (xml) => firmarXml(xml, emision.certificadoActivo(db)).xml }));
  }
  return cache.get(ambiente);
}

async function enviarDocumento(db, doc, cliente, ahora, resumen) {
  const nombre = `${doc.rnc_emisor}${doc.encf}.xml`;
  try {
    if (doc.via === 'rfce') {
      const r = await cliente.enviarRfce(doc.xml_rfce, nombre);
      const estado = estadoDe(r);
      if (!FINALES.has(estado)) {
        registrarFallo(db, 'ecf_documentos', doc, mensajesDe(r).map((m) => m.valor).join('; ') || `Respuesta no reconocida de la DGII (HTTP ${r.status})`, { conexion: false, ahora });
        resumen.errores += 1;
        return;
      }
      actualizar(db, 'ecf_documentos', doc.id, {
        estado, mensajes: JSON.stringify(mensajesDe(r)), secuencia_utilizada: r.secuenciaUtilizada === undefined ? null : (r.secuenciaUtilizada ? 1 : 0),
        enviado_at: ahora.toISOString(), respondido_at: ahora.toISOString(), ultimo_error: null, proximo_intento_at: null,
      });
      resumen.enviados += 1;
      resumen[estado === 'rechazado' ? 'rechazados' : 'aceptados'] += 1;
      return;
    }
    const r = await cliente.enviarEcf(doc.xml, nombre);
    if (!r.trackId) {
      registrarFallo(db, 'ecf_documentos', doc, r.mensaje || r.error || `La DGII no devolvió TrackId (HTTP ${r.status})`, { conexion: false, ahora });
      resumen.errores += 1;
      return;
    }
    actualizar(db, 'ecf_documentos', doc.id, { estado: 'en_proceso', track_id: r.trackId, enviado_at: ahora.toISOString(), ultimo_error: null, proximo_intento_at: null });
    resumen.enviados += 1;
  } catch (e) {
    registrarFallo(db, 'ecf_documentos', doc, e.message, { conexion: e instanceof ErrorConexionDgii, ahora });
    resumen.errores += 1;
  }
}

async function consultarDocumento(db, doc, cliente, ahora, resumen) {
  try {
    const r = await cliente.consultarResultado(doc.track_id);
    const estado = ESTADO_POR_CODIGO[Number(r.codigo)] || estadoDe(r);
    if (FINALES.has(estado)) {
      actualizar(db, 'ecf_documentos', doc.id, {
        estado, mensajes: JSON.stringify(mensajesDe(r)), secuencia_utilizada: r.secuenciaUtilizada === undefined ? null : (r.secuenciaUtilizada ? 1 : 0),
        respondido_at: ahora.toISOString(), proximo_intento_at: null, ultimo_error: null,
      });
      resumen[estado === 'rechazado' ? 'rechazados' : 'aceptados'] += 1;
    } else {
      // En proceso (la DGII valida en ~200 ms) o todavía no encontrado: se vuelve a consultar.
      actualizar(db, 'ecf_documentos', doc.id, { proximo_intento_at: masMinutos(ahora, estado === 'en_proceso' ? 0.5 : 2) });
      resumen.enProceso += 1;
    }
  } catch (e) {
    registrarFallo(db, 'ecf_documentos', doc, e.message, { conexion: e instanceof ErrorConexionDgii, ahora });
    resumen.errores += 1;
  }
}

async function enviarAnulacion(db, an, cliente, ahora, resumen) {
  try {
    const rnc = emision.datosEmisor(db).rnc.replace(/\D/g, '');
    const r = await cliente.anularRangos(an.xml, `${rnc}ANECF${an.encf_desde}.xml`);
    if (r.status >= 200 && r.status < 300) {
      actualizar(db, 'ecf_anulaciones', an.id, { estado: 'aceptada', respuesta: JSON.stringify(r), enviado_at: ahora.toISOString(), ultimo_error: null, proximo_intento_at: null });
      resumen.anulaciones += 1;
    } else if (r.status >= 400 && r.status < 500 && r.status !== 401) {
      actualizar(db, 'ecf_anulaciones', an.id, { estado: 'rechazada', respuesta: JSON.stringify(r), enviado_at: ahora.toISOString(), proximo_intento_at: null });
      resumen.rechazados += 1;
    } else {
      registrarFallo(db, 'ecf_anulaciones', an, `Respuesta no reconocida de la DGII (HTTP ${r.status})`, { conexion: false, ahora });
      resumen.errores += 1;
    }
  } catch (e) {
    registrarFallo(db, 'ecf_anulaciones', an, e.message, { conexion: e instanceof ErrorConexionDgii, ahora });
    resumen.errores += 1;
  }
}

// opciones: { ahora, limite, soloId, crearCliente (pruebas) }
async function procesarCola(db, opciones = {}) {
  const ahora = opciones.ahora || new Date();
  const limite = opciones.limite || 50;
  const resumen = { enviados: 0, aceptados: 0, rechazados: 0, enProceso: 0, anulaciones: 0, errores: 0 };
  const clientes = new Map();
  const filtroId = opciones.soloId ? 'AND id = ?' : '';
  const listos = (tabla, estado) => db
    .prepare(`SELECT * FROM ${tabla} WHERE estado = ? AND deleted_at IS NULL AND (proximo_intento_at IS NULL OR proximo_intento_at <= ?) ${filtroId} ORDER BY created_at LIMIT ?`)
    .all(...[estado, ahora.toISOString(), opciones.soloId, limite].filter((v) => v !== undefined));

  for (const doc of listos('ecf_documentos', 'pendiente')) {
    await enviarDocumento(db, doc, clienteParaAmbiente(db, doc.ambiente, opciones, clientes), ahora, resumen);
  }
  for (const doc of listos('ecf_documentos', 'en_proceso')) {
    await consultarDocumento(db, doc, clienteParaAmbiente(db, doc.ambiente, opciones, clientes), ahora, resumen);
  }
  if (!opciones.soloId) {
    for (const an of listos('ecf_anulaciones', 'pendiente')) {
      await enviarAnulacion(db, an, clienteParaAmbiente(db, an.ambiente, opciones, clientes), ahora, resumen);
    }
  }
  return resumen;
}

// e-CF pendientes de envío cuya firma pasó (o está por pasar) el plazo de 72 horas.
function vencidosOPorVencer(db, ahora = new Date(), margenHoras = 12) {
  return db
    .prepare("SELECT id, encf, fecha_firma, created_at FROM ecf_documentos WHERE estado = 'pendiente' AND deleted_at IS NULL ORDER BY created_at")
    .all()
    .filter((d) => (ahora.getTime() - Date.parse(d.created_at)) / 3600000 >= PLAZO_CONTINGENCIA_H - margenHoras);
}

// =========================================================================
// Ejecución en segundo plano en el proceso principal
// =========================================================================

const estado = { getDb: null, corriendo: null, temporizador: null, pronto: null, opciones: {} };

function hayTrabajo(db) {
  return Boolean(db.prepare("SELECT 1 FROM ecf_documentos WHERE estado IN ('pendiente', 'en_proceso') AND deleted_at IS NULL LIMIT 1").get()
    || db.prepare("SELECT 1 FROM ecf_anulaciones WHERE estado = 'pendiente' AND deleted_at IS NULL LIMIT 1").get());
}

function ejecutar(opciones = {}) {
  if (!estado.getDb) return Promise.resolve(null);
  if (estado.corriendo) return estado.corriendo.then(() => (opciones.soloId ? ejecutar(opciones) : null));
  const db = estado.getDb();
  if (!hayTrabajo(db)) return Promise.resolve(null);
  estado.corriendo = procesarCola(db, { ...estado.opciones, ...opciones })
    .catch((e) => { console.error('Cola e-CF:', e); return null; })
    .finally(() => { estado.corriendo = null; });
  return estado.corriendo;
}

function iniciar(getDb, { intervaloMs = 60000, ...opciones } = {}) {
  estado.getDb = getDb;
  estado.opciones = opciones;
  clearInterval(estado.temporizador);
  estado.temporizador = setInterval(() => ejecutar(), intervaloMs);
  estado.temporizador.unref?.();
  setTimeout(() => ejecutar(), 5000).unref?.();
}

function detener() {
  clearInterval(estado.temporizador);
  clearTimeout(estado.pronto);
  estado.getDb = null;
}

// Tras emitir un documento: se intenta enviarlo enseguida, sin bloquear la respuesta.
function programar() {
  if (!estado.getDb) return;
  clearTimeout(estado.pronto);
  estado.pronto = setTimeout(() => ejecutar(), 200);
}

// Antes de imprimir: un intento inmediato (con tope de espera) para que la representación
// impresa refleje si el e-CF salió en contingencia.
async function asegurarIntento(db, origenTipo, origenId, esperaMs = 8000) {
  const doc = emision.ecfDeOrigen(db, origenTipo, origenId);
  if (!doc || doc.estado !== 'pendiente' || doc.intentos > 0 || !estado.getDb) return;
  await Promise.race([ejecutar({ soloId: doc.id }), new Promise((r) => setTimeout(r, esperaMs))]);
}

module.exports = { procesarCola, vencidosOPorVencer, iniciar, detener, programar, ejecutar, asegurarIntento, estadoDe, PLAZO_CONTINGENCIA_H };
