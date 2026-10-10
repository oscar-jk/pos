// Cliente de los servicios web de facturación electrónica de la DGII (Descripción Técnica
// Servicios DGII). Solo lo usa el proceso principal. Sin conexión, la venta no se detiene: el
// e-CF ya está firmado y queda en cola (cola.js) para enviarse cuando vuelva la conexión.
const { SEGMENTO_AMBIENTE } = require('./timbre');

const TIEMPO_ESPERA_MS = 30000;

class ErrorConexionDgii extends Error {}

function urlsDe(ambiente) {
  const seg = SEGMENTO_AMBIENTE[ambiente];
  if (!seg) throw new Error(`Ambiente de la DGII desconocido: ${ambiente}`);
  const ecf = `https://ecf.dgii.gov.do/${seg}`;
  const fc = `https://fc.dgii.gov.do/${seg}`;
  return {
    semilla: `${ecf}/autenticacion/api/autenticacion/semilla`,
    validarSemilla: `${ecf}/autenticacion/api/autenticacion/validarsemilla`,
    recepcion: `${ecf}/recepcion/api/facturaselectronicas`,
    consultaResultado: `${ecf}/consultaresultado/api/consultas/estado`,
    consultaTrackIds: `${ecf}/consultatrackids/api/trackids/consulta`,
    recepcionRfce: `${fc}/recepcionfc/api/recepcion/ecf`,
    consultaRfce: `${fc}/consultarfce/api/Consultas/Consulta`,
    anulacion: `${ecf}/anulacionrangos/api/operaciones/anularrango`,
    aprobacionComercial: `${ecf}/aprobacioncomercial/api/aprobacioncomercial`,
  };
}

// firmar(xml) → xml firmado (con el certificado del negocio). fetchImpl: inyectable en pruebas.
function crearClienteDgii({ ambiente, firmar, fetchImpl = globalThis.fetch }) {
  const urls = urlsDe(ambiente);
  let token = null;

  async function pedir(url, opciones = {}) {
    let respuesta;
    try {
      respuesta = await fetchImpl(url, { ...opciones, signal: AbortSignal.timeout(TIEMPO_ESPERA_MS) });
    } catch (e) {
      throw new ErrorConexionDgii(`Sin conexión con la DGII (${e.cause && e.cause.code ? e.cause.code : e.name === 'TimeoutError' ? 'tiempo de espera agotado' : e.message})`);
    }
    const texto = await respuesta.text();
    if (respuesta.status === 401) token = null;
    if (respuesta.status >= 500) throw new ErrorConexionDgii(`El servicio de la DGII no está disponible (HTTP ${respuesta.status})`);
    let cuerpo = texto;
    if ((respuesta.headers.get('content-type') || '').includes('json') || /^\s*[[{]/.test(texto)) {
      try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
    }
    return { status: respuesta.status, cuerpo };
  }

  function formulario(xml, nombreArchivo) {
    const form = new FormData();
    form.append('xml', new Blob([xml], { type: 'text/xml' }), nombreArchivo);
    return form;
  }

  // Autenticación: semilla → semilla firmada → token (vigencia de una hora).
  async function autenticar() {
    if (token && Date.parse(token.expira) - 60000 > Date.now()) return token.valor;
    const semilla = await pedir(urls.semilla, { headers: { accept: '*/*' } });
    if (semilla.status !== 200 || typeof semilla.cuerpo !== 'string') throw new Error(`La DGII no entregó la semilla de autenticación (HTTP ${semilla.status})`);
    const firmada = firmar(semilla.cuerpo);
    const r = await pedir(urls.validarSemilla, { method: 'POST', headers: { accept: 'application/json' }, body: formulario(firmada, 'semilla.xml') });
    if (r.status !== 200 || !r.cuerpo || !r.cuerpo.token) {
      const detalle = r.cuerpo && (r.cuerpo.mensaje || r.cuerpo.message || r.cuerpo.title);
      throw new Error(`La DGII rechazó la autenticación${detalle ? `: ${detalle}` : ''}. Revise que el certificado esté vigente y delegado para este RNC.`);
    }
    token = { valor: r.cuerpo.token, expira: r.cuerpo.expira || new Date(Date.now() + 3600000).toISOString() };
    return token.valor;
  }

  async function conToken(url, opciones = {}) {
    const t = await autenticar();
    return pedir(url, { ...opciones, headers: { accept: 'application/json', ...(opciones.headers || {}), authorization: `Bearer ${t}` } });
  }

  return {
    urls,
    autenticar,
    // e-CF (todos menos el 32 menor a RD$250,000): devuelve { trackId, error, mensaje }.
    async enviarEcf(xml, nombreArchivo) {
      const r = await conToken(urls.recepcion, { method: 'POST', body: formulario(xml, nombreArchivo) });
      return { status: r.status, ...(typeof r.cuerpo === 'object' ? r.cuerpo : { mensaje: String(r.cuerpo) }) };
    },
    // Resultado de un envío: { codigo, estado, mensajes, secuenciaUtilizada, ... }.
    async consultarResultado(trackId) {
      const r = await conToken(`${urls.consultaResultado}?trackid=${encodeURIComponent(trackId)}`);
      return { status: r.status, ...(typeof r.cuerpo === 'object' ? r.cuerpo : { mensaje: String(r.cuerpo) }) };
    },
    // Resumen de factura de consumo: respuesta inmediata { codigo, estado, mensajes, secuenciaUtilizada }.
    async enviarRfce(xml, nombreArchivo) {
      const r = await conToken(urls.recepcionRfce, { method: 'POST', body: formulario(xml, nombreArchivo) });
      return { status: r.status, ...(typeof r.cuerpo === 'object' ? r.cuerpo : { mensaje: String(r.cuerpo) }) };
    },
    async anularRangos(xml, nombreArchivo) {
      const r = await conToken(urls.anulacion, { method: 'POST', body: formulario(xml, nombreArchivo) });
      return { status: r.status, ...(typeof r.cuerpo === 'object' ? r.cuerpo : { mensajes: [String(r.cuerpo)] }) };
    },
    async consultarTrackIds(rncEmisor, encf) {
      const r = await conToken(`${urls.consultaTrackIds}?rncemisor=${rncEmisor}&encf=${encf}`);
      return { status: r.status, lista: Array.isArray(r.cuerpo) ? r.cuerpo : [] };
    },
    async enviarAprobacionComercial(xml, nombreArchivo) {
      const r = await conToken(urls.aprobacionComercial, { method: 'POST', body: formulario(xml, nombreArchivo) });
      return { status: r.status, ...(typeof r.cuerpo === 'object' ? r.cuerpo : { mensaje: String(r.cuerpo) }) };
    },
  };
}

module.exports = { crearClienteDgii, ErrorConexionDgii, urlsDe };
