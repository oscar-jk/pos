// Servicios web del negocio como receptor electrónico, con las rutas estándar de la DGII
// (Descripción Técnica Emisores Electrónicos):
//   GET  /fe/autenticacion/api/semilla
//   POST /fe/autenticacion/api/validacioncertificado
//   POST /fe/recepcion/api/ecf               → acuse de recibo (ARECF) firmado
//   POST /fe/aprobacioncomercial/api/ecf     → 200 / 400
// Es solo el manejador HTTP (node:http, sin dependencias). La DGII exige que estos servicios
// estén en internet con SSL y disponibles siempre, así que se publican detrás de un servidor o
// túnel HTTPS; la aplicación de escritorio no los abre por su cuenta.
const http = require('node:http');

const receptor = require('./receptor');

const RUTAS = {
  semilla: '/fe/autenticacion/api/semilla',
  validar: '/fe/autenticacion/api/validacioncertificado',
  recepcion: '/fe/recepcion/api/ecf',
  aprobacion: '/fe/aprobacioncomercial/api/ecf',
};
const TAMANO_MAXIMO = 5 * 1024 * 1024;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > TAMANO_MAXIMO) { reject(new Error('El archivo excede el tamaño permitido')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

// El XML llega como multipart/form-data en el campo "xml" (o como cuerpo XML directo).
async function xmlDeLaPeticion(req) {
  const cuerpo = await leerCuerpo(req);
  const tipo = String(req.headers['content-type'] || '');
  if (tipo.includes('multipart/form-data')) {
    const form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': tipo }, body: cuerpo }).formData();
    const archivo = form.get('xml');
    if (!archivo) throw new Error('Falta el campo "xml"');
    return typeof archivo === 'string' ? archivo : archivo.text();
  }
  return cuerpo.toString('utf8');
}

function responder(res, status, cuerpo, tipo) {
  res.writeHead(status, { 'content-type': tipo || (typeof cuerpo === 'string' ? 'application/xml; charset=utf-8' : 'application/json; charset=utf-8') });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
}

// getDb: la base del negocio. requiereAutenticacion: si se publica la URL de autenticación,
// recepción y aprobación exigen el token (Authorization: Bearer).
function crearManejadorReceptor({ getDb, requiereAutenticacion = true, autenticador = receptor.crearAutenticador() }) {
  return async function manejar(req, res) {
    const ruta = new URL(req.url, 'http://local').pathname.toLowerCase().replace(/\/+$/, '');
    try {
      if (req.method === 'GET' && ruta.endsWith(RUTAS.semilla)) return responder(res, 200, autenticador.semilla());
      if (req.method === 'POST' && ruta.endsWith(RUTAS.validar)) {
        try {
          return responder(res, 200, autenticador.validarCertificado(await xmlDeLaPeticion(req)));
        } catch (e) {
          return responder(res, 400, { mensaje: e.message });
        }
      }
      const protegida = ruta.endsWith(RUTAS.recepcion) || ruta.endsWith(RUTAS.aprobacion);
      if (req.method === 'POST' && protegida && requiereAutenticacion && !autenticador.tokenValido(req.headers.authorization)) {
        return responder(res, 401, { mensaje: 'Token no válido o vencido' });
      }
      if (req.method === 'POST' && ruta.endsWith(RUTAS.recepcion)) {
        const xml = await xmlDeLaPeticion(req);
        const db = getDb();
        const r = db.transaction(() => receptor.recibirEcf(db, xml, { via: 'servicio' }))();
        return responder(res, 200, r.acuseXml);
      }
      if (req.method === 'POST' && ruta.endsWith(RUTAS.aprobacion)) {
        const xml = await xmlDeLaPeticion(req);
        const db = getDb();
        const r = db.transaction(() => receptor.recibirAprobacion(db, xml))();
        return responder(res, r.status, { mensaje: r.mensaje });
      }
      return responder(res, 404, { mensaje: 'Recurso no encontrado' });
    } catch (e) {
      return responder(res, 400, { mensaje: e.message });
    }
  };
}

function crearServidorReceptor(opciones) {
  return http.createServer(crearManejadorReceptor(opciones));
}

module.exports = { crearManejadorReceptor, crearServidorReceptor, RUTAS };
