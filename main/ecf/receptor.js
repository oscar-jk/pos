// El negocio como receptor electrónico (Descripción Técnica Emisores Electrónicos): autenticación
// por semilla (opcional), recepción de e-CF con acuse de recibo firmado (ARECF) y recepción de
// aprobaciones comerciales (ACECF) de sus clientes. Son funciones sin servidor: reciben el XML y
// devuelven la respuesta, para usarlas desde el servicio web que se publique en internet y desde
// la importación manual de un XML recibido por correo.
const crypto = require('node:crypto');

const c14n = require('./c14n');
const { firmarXml, verificarFirma } = require('./firma');
const { construirXml } = require('./xml');
const { fechaHoraDgii } = require('./fechas');
const emision = require('./emision');

const MOTIVO_NO_RECIBIDO = { 1: 'Error de especificación', 2: 'Error de firma digital', 3: 'Envío duplicado', 4: 'RNC Comprador no corresponde' };
const SEMILLA_MIN = 5;
const TOKEN_MIN = 60;

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

function valor(doc, nombre) {
  const nodo = doc.getElementsByTagName(nombre)[0];
  return nodo ? String(nodo.textContent || '').trim() : null;
}

// =========================================================================
// Autenticación (opcional para el receptor; si se publica, sigue el estándar de la DGII)
// =========================================================================

function crearAutenticador() {
  const semillas = new Map();
  const tokens = new Map();
  const limpiar = (mapa, ahora) => { for (const [k, v] of mapa) if (v <= ahora) mapa.delete(k); };
  return {
    semilla(ahora = new Date()) {
      limpiar(semillas, ahora.getTime());
      const valorSemilla = crypto.randomBytes(48).toString('base64');
      semillas.set(valorSemilla, ahora.getTime() + SEMILLA_MIN * 60000);
      return '<?xml version="1.0" encoding="utf-8"?><SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
        + `<valor>${valorSemilla}</valor><fecha>${ahora.toISOString()}</fecha></SemillaModel>`;
    },
    // Semilla firmada → token. Lanza error si la firma no es válida o la semilla no es nuestra.
    validarCertificado(xmlFirmado, ahora = new Date()) {
      const firma = verificarFirma(xmlFirmado);
      if (!firma.valida) throw new Error(firma.motivo);
      const valorSemilla = valor(c14n.parsearXml(xmlFirmado), 'valor');
      const vence = semillas.get(valorSemilla);
      if (!vence || vence <= ahora.getTime()) throw new Error('La semilla no es válida o ya venció');
      semillas.delete(valorSemilla);
      const token = crypto.randomBytes(32).toString('base64url');
      const expira = ahora.getTime() + TOKEN_MIN * 60000;
      tokens.set(token, expira);
      return { token, expira: new Date(expira).toISOString().replace(/\.\d{3}Z$/, 'Z'), expedido: ahora.toISOString().replace(/\.\d{3}Z$/, 'Z') };
    },
    tokenValido(encabezadoAutorizacion, ahora = new Date()) {
      const token = String(encabezadoAutorizacion || '').replace(/^Bearer\s+/i, '');
      const vence = tokens.get(token);
      return Boolean(vence && vence > ahora.getTime());
    },
  };
}

// =========================================================================
// Recepción de e-CF: siempre se responde con un acuse firmado, recibido o no.
// =========================================================================

function acuse(db, { rncEmisor, rncComprador, encf, estado, motivo, ahora }) {
  const datos = {
    DetalleAcusedeRecibo: {
      Version: '1.0',
      RNCEmisor: soloDigitos(rncEmisor) || '000000000',
      RNCComprador: soloDigitos(rncComprador) || soloDigitos(emision.datosEmisor(db).rnc),
      eNCF: encf || 'E000000000000',
      Estado: String(estado),
      CodigoMotivoNoRecibido: estado === 1 ? String(motivo) : null,
      FechaHoraAcuseRecibo: fechaHoraDgii(ahora),
    },
  };
  return firmarXml(construirXml('ARECF', datos), emision.certificadoActivo(db)).xml;
}

// via: 'servicio' (lo envió el emisor a nuestra URL) | 'importado' (XML cargado a mano).
function recibirEcf(db, xml, { via = 'servicio', usuarioId = null, ahora = new Date() } = {}) {
  const nuestroRnc = soloDigitos(emision.datosEmisor(db).rnc);
  let doc = null;
  try { doc = c14n.parsearXml(xml); } catch { doc = null; }
  const datos = doc && doc.documentElement.nodeName === 'ECF' ? {
    tipoEcf: Number(valor(doc, 'TipoeCF')) || null,
    encf: valor(doc, 'eNCF'),
    rncEmisor: soloDigitos(valor(doc, 'RNCEmisor')),
    razonSocialEmisor: valor(doc, 'RazonSocialEmisor'),
    rncComprador: soloDigitos(valor(doc, 'RNCComprador')),
    fechaEmision: valor(doc, 'FechaEmision'),
    montoTotal: Number(valor(doc, 'MontoTotal')) || 0,
    totalItbis: Number(valor(doc, 'TotalITBIS')) || 0,
  } : null;

  let estado = 0;
  let motivo = null;
  if (!datos || !datos.encf || !datos.rncEmisor) {
    estado = 1; motivo = 1;
  } else if (!verificarFirma(xml).valida) {
    estado = 1; motivo = 2;
  } else if (datos.rncComprador !== nuestroRnc) {
    estado = 1; motivo = 4;
  } else if (db.prepare('SELECT 1 FROM ecf_recibidos WHERE rnc_emisor = ? AND encf = ? AND acuse_estado = 0 AND deleted_at IS NULL').get(datos.rncEmisor, datos.encf)) {
    estado = 1; motivo = 3;
  }

  const xmlAcuse = acuse(db, { ...(datos || {}), estado, motivo, ahora });
  let id = null;
  // Se guarda todo lo que llega con datos mínimos, aun no recibido (constancia del acuse).
  if (datos && datos.encf && datos.rncEmisor && motivo !== 3) {
    id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO ecf_recibidos (id, tipo_ecf, encf, rnc_emisor, razon_social_emisor, rnc_comprador, fecha_emision, monto_total, total_itbis,
         xml, via, acuse_estado, acuse_motivo, acuse_xml, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, datos.tipoEcf, datos.encf, datos.rncEmisor, datos.razonSocialEmisor, datos.rncComprador || null, datos.fechaEmision,
      datos.montoTotal, datos.totalItbis, xml, via, estado, motivo, xmlAcuse, usuarioId);
  }
  return { id, estado, motivo, motivoTexto: motivo ? MOTIVO_NO_RECIBIDO[motivo] : null, acuseXml: xmlAcuse, datos };
}

// =========================================================================
// Aprobación comercial
// =========================================================================

// La que nos envía un cliente sobre un e-CF que emitimos. Devuelve el HTTP a responder.
function recibirAprobacion(db, xml) {
  let doc;
  try { doc = c14n.parsearXml(xml); } catch { return { status: 400, mensaje: 'El archivo no es un XML válido' }; }
  if (doc.documentElement.nodeName !== 'ACECF') return { status: 400, mensaje: 'El documento no es una aprobación comercial' };
  if (!verificarFirma(xml).valida) return { status: 400, mensaje: 'La firma del documento no es válida' };
  const encf = valor(doc, 'eNCF');
  const propio = db.prepare('SELECT id, rnc_comprador FROM ecf_documentos WHERE encf = ? AND deleted_at IS NULL').get(encf);
  if (!propio) return { status: 400, mensaje: 'No existe un e-CF emitido con ese e-NCF' };
  if (propio.rnc_comprador && propio.rnc_comprador !== soloDigitos(valor(doc, 'RNCComprador'))) return { status: 400, mensaje: 'El RNC del comprador no corresponde al e-CF' };
  const estado = Number(valor(doc, 'Estado'));
  db.prepare("UPDATE ecf_documentos SET aprobacion_estado = ?, aprobacion_motivo = ?, aprobacion_xml = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(estado === 2 ? 2 : 1, valor(doc, 'DetalleMotivoRechazo'), xml, propio.id);
  return { status: 200, mensaje: 'Aprobación comercial recibida' };
}

// La nuestra sobre un e-CF recibido de un proveedor: se firma y queda en cola para enviarse al
// emisor (si es receptor electrónico) y a la DGII.
function aprobarComercialmente(db, recibidoId, { aprobado, motivo, usuarioId, ahora = new Date() }) {
  const r = db.prepare('SELECT * FROM ecf_recibidos WHERE id = ? AND deleted_at IS NULL').get(recibidoId);
  if (!r) throw new Error('Comprobante recibido no encontrado');
  if (r.acuse_estado !== 0) throw new Error('Solo se aprueban o rechazan los e-CF que se recibieron correctamente');
  if (r.aprobacion_estado) throw new Error('Este comprobante ya tiene una aprobación o un rechazo comercial');
  if (!aprobado && !String(motivo || '').trim()) throw new Error('Indique el motivo del rechazo comercial');
  const datos = {
    DetalleAprobacionComercial: {
      Version: '1.0', RNCEmisor: r.rnc_emisor, eNCF: r.encf, FechaEmision: r.fecha_emision, MontoTotal: r.monto_total,
      RNCComprador: r.rnc_comprador || soloDigitos(emision.datosEmisor(db).rnc), Estado: aprobado ? '1' : '2',
      DetalleMotivoRechazo: aprobado ? null : String(motivo).trim().slice(0, 250),
      FechaHoraAprobacionComercial: fechaHoraDgii(ahora),
    },
  };
  const xml = firmarXml(construirXml('ACECF', datos), emision.certificadoActivo(db)).xml;
  db.prepare(
    `UPDATE ecf_recibidos SET aprobacion_estado = ?, aprobacion_motivo = ?, aprobacion_xml = ?, aprobacion_envio = 'pendiente',
       usuario_id = COALESCE(usuario_id, ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(aprobado ? 1 : 2, aprobado ? null : String(motivo).trim(), xml, usuarioId || null, recibidoId);
  return xml;
}

module.exports = { crearAutenticador, recibirEcf, recibirAprobacion, aprobarComercialmente, MOTIVO_NO_RECIBIDO };
