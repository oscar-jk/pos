// Facturación electrónica: configuración (modo, ambiente, certificado, secuencias e-NCF,
// contingencia), monitor de e-CF ante la DGII y anulación de secuencias. La red solo la toca el
// proceso principal (main/ecf/dgii.js); la ventana pide todo por IPC.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { dialog, BrowserWindow } = require('electron');

const session = require('../auth/session');
const configuracion = require('./configuracion');
const emision = require('../ecf/emision');
const cola = require('../ecf/cola');
const anulacion = require('../ecf/anulacion');
const { crearClienteDgii } = require('../ecf/dgii');
const { firmarXml } = require('../ecf/firma');
const { TIPOS_ECF, SIN_VENCIMIENTO, rncValido } = require('../ecf/construir');
const { fechaLocalRD } = require('../ecf/fechas');

const APLICA_POR_TIPO = {
  31: 'credito_fiscal', 32: 'consumo', 33: 'nota_debito', 34: 'nota_credito', 41: 'compras',
  43: 'gastos_menores', 44: 'regimen_especial', 45: 'gubernamental', 46: 'exportacion', 47: 'pagos_exterior',
};
const TIPOS_REQUERIDOS_PARA_ACTIVAR = [31, 32, 33, 34];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function guardarParametro(db, clave, valor) {
  db.prepare(
    `INSERT INTO parametros_negocio (clave, valor, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at`
  ).run(clave, valor);
}

function secuenciasEcf(db) {
  return db
    .prepare("SELECT * FROM tipos_ncf WHERE codigo LIKE 'E%' AND deleted_at IS NULL ORDER BY codigo, secuencia_desde")
    .all()
    .map((s) => ({ ...s, tipo_ecf: Number(s.codigo.slice(1)), nombre_tipo: TIPOS_ECF[Number(s.codigo.slice(1))], disponibles: Math.max(0, s.secuencia_hasta - s.secuencia_actual + 1) }));
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Avisos para la pantalla de configuración y el monitor: lo que impide o pone en riesgo emitir.
function alertas(db, ahora = new Date()) {
  const lista = [];
  const cert = emision.resumenCertificado(db);
  const modo = emision.modoEcf(db);
  if (modo === 'electronico') {
    if (!cert) lista.push({ nivel: 'error', texto: 'No hay certificado digital cargado: no se pueden firmar comprobantes.' });
    else {
      const dias = Math.floor((Date.parse(cert.validoHasta) - ahora.getTime()) / 86400000);
      if (dias < 0) lista.push({ nivel: 'error', texto: `El certificado digital venció el ${cert.validoHasta.slice(0, 10)}.` });
      else if (dias <= 30) lista.push({ nivel: 'aviso', texto: `El certificado digital vence en ${dias} días (${cert.validoHasta.slice(0, 10)}).` });
    }
    const hoy = fechaLocalRD(ahora);
    for (const s of secuenciasEcf(db).filter((x) => x.activo)) {
      if (s.disponibles === 0) continue;
      if (!SIN_VENCIMIENTO.has(s.tipo_ecf) && s.vencimiento && s.vencimiento < hoy) lista.push({ nivel: 'error', texto: `La secuencia ${s.codigo} venció el ${s.vencimiento}.` });
      else if (s.disponibles <= 50) lista.push({ nivel: 'aviso', texto: `Quedan ${s.disponibles} números de ${s.codigo} (${s.nombre_tipo}).` });
    }
  }
  const desde = emision.contingenciaDesde(db);
  if (desde) {
    const dias = Math.floor((ahora.getTime() - Date.parse(desde)) / 86400000);
    lista.push({ nivel: dias >= 15 ? 'error' : 'aviso', texto: `Contingencia activa desde ${desde.slice(0, 10)} (${dias} días; la DGII admite hasta 15). Al superarla, emita los e-CF que reemplazan los NCF serie B en un máximo de 30 días.` });
  }
  const vencidos = cola.vencidosOPorVencer(db, ahora);
  if (vencidos.length) {
    lista.push({ nivel: 'error', texto: `${plural(vencidos.length, 'e-CF sin enviar a la DGII se acerca o pasó', 'e-CF sin enviar a la DGII se acercan o pasaron')} el plazo de 72 horas. Revise la conexión y use "Enviar pendientes".` });
  }
  const rechazados = db.prepare("SELECT COUNT(*) AS n FROM ecf_documentos d JOIN documentos_venta v ON v.id = d.origen_id WHERE d.estado = 'rechazado' AND v.estado != 'anulado'").get().n;
  if (rechazados) {
    lista.push({ nivel: 'error', texto: rechazados === 1
      ? '1 e-CF rechazado por la DGII sigue vigente en el sistema: anule ese documento y emítalo de nuevo.'
      : `${rechazados} e-CF rechazados por la DGII siguen vigentes en el sistema: anule esos documentos y emítalos de nuevo.` });
  }
  if (emision.ambienteEcf(db) !== 'eCF' && modo === 'electronico') {
    lista.push({ nivel: 'aviso', texto: `Ambiente de ${emision.ambienteEcf(db) === 'TesteCF' ? 'pruebas' : 'certificación'}: los comprobantes NO tienen validez fiscal.` });
  }
  return lista;
}

function estadoGeneral(db) {
  session.requerirAlgunPermiso('configuracion.ecf.gestionar', 'ventas.ecf.ver');
  const negocio = configuracion.obtenerDatosNegocio(db);
  const conteos = Object.fromEntries(db.prepare('SELECT estado, COUNT(*) AS n FROM ecf_documentos WHERE deleted_at IS NULL GROUP BY estado').all().map((r) => [r.estado, r.n]));
  return {
    modo: emision.modoEcf(db),
    ambiente: emision.ambienteEcf(db),
    contingenciaDesde: emision.contingenciaDesde(db),
    certificado: emision.resumenCertificado(db),
    negocio: { rnc: negocio.negocio_rnc, razonSocial: negocio.negocio_razon_social, nombre: negocio.negocio_nombre, direccion: negocio.negocio_direccion },
    secuencias: secuenciasEcf(db),
    conteos,
    alertas: alertas(db),
  };
}

function requisitosParaActivar(db) {
  const faltan = [];
  const negocio = configuracion.obtenerDatosNegocio(db);
  if (!rncValido(negocio.negocio_rnc)) faltan.push('el RNC del negocio');
  if (!String(negocio.negocio_razon_social || '').trim()) faltan.push('la razón social');
  if (!String(negocio.negocio_direccion || '').trim()) faltan.push('la dirección del negocio');
  try { emision.certificadoActivo(db); } catch (e) { faltan.push('un certificado digital vigente'); }
  const activos = new Set(secuenciasEcf(db).filter((s) => s.activo && s.disponibles > 0).map((s) => s.tipo_ecf));
  const sinSecuencia = TIPOS_REQUERIDOS_PARA_ACTIVAR.filter((t) => !activos.has(t));
  if (sinSecuencia.length) faltan.push(`secuencias e-NCF de ${sinSecuencia.map((t) => `E${t}`).join(', ')}`);
  return faltan;
}

function guardarModo(db, { modo, ambiente }, usuarioId) {
  session.requerirPermiso('configuracion.ecf.gestionar');
  if (!['tradicional', 'electronico'].includes(modo)) throw new Error('Modo de comprobantes no válido');
  if (!emision.AMBIENTES.includes(ambiente)) throw new Error('Ambiente de la DGII no válido');
  if (modo === 'electronico') {
    const faltan = requisitosParaActivar(db);
    if (faltan.length) throw new Error(`Para emitir e-CF falta: ${faltan.join(', ')}.`);
  }
  const antes = { modo: emision.modoEcf(db), ambiente: emision.ambienteEcf(db) };
  guardarParametro(db, 'ecf_modo', modo);
  guardarParametro(db, 'ecf_ambiente', ambiente);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: 'ecf', accion: 'editar', detalle: { antes, despues: { modo, ambiente } } });
}

// Contingencia por imposibilidad de emitir e-CF (Informe Técnico §19.2): se factura con NCF
// serie B autorizados, hasta 15 días, notificándolo a la DGII.
function cambiarContingencia(db, { activar, motivo }, usuarioId) {
  session.requerirPermiso('configuracion.ecf.gestionar');
  let resultado = null;
  if (activar) {
    if (emision.modoEcf(db) !== 'electronico') throw new Error('La contingencia solo aplica cuando el negocio emite e-CF');
    if (!motivo || !String(motivo).trim()) throw new Error('Indique el motivo de la contingencia');
    const tieneB = db.prepare("SELECT 1 FROM tipos_ncf WHERE codigo IN ('B01', 'B02') AND activo = 1 AND secuencia_actual <= secuencia_hasta").get();
    if (!tieneB) throw new Error('Para operar en contingencia necesita secuencias NCF serie B (B01/B02) autorizadas y registradas');
    guardarParametro(db, 'ecf_contingencia_desde', new Date().toISOString());
  } else {
    const desde = emision.contingenciaDesde(db);
    guardarParametro(db, 'ecf_contingencia_desde', '');
    // Regularización: los e-CF que reemplazan los NCF serie B se emiten al terminar.
    resultado = desde ? emision.regularizarContingencia(db, desde) : { regularizadas: 0, notasPorRevisar: 0 };
  }
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: 'ecf_contingencia', accion: activar ? 'activar' : 'desactivar', detalle: { motivo: motivo || null, ...resultado } });
  return resultado;
}

function registrarSecuencia(db, { tipoEcf, desde, hasta, vencimiento }, usuarioId) {
  session.requerirPermiso('configuracion.ecf.gestionar');
  const tipo = Number(tipoEcf);
  if (!TIPOS_ECF[tipo]) throw new Error('Tipo de e-CF no válido');
  const d = Number(desde);
  const h = Number(hasta);
  if (!Number.isInteger(d) || !Number.isInteger(h) || d < 1 || h < d || h > 9999999999) throw new Error('El rango no es válido: "desde" y "hasta" son números enteros y "desde" no puede ser mayor');
  if (!SIN_VENCIMIENTO.has(tipo) && !FECHA.test(vencimiento || '')) throw new Error(`La secuencia E${tipo} requiere la fecha de vencimiento que indica la DGII`);
  const codigo = `E${tipo}`;
  const choque = db
    .prepare('SELECT secuencia_desde, secuencia_hasta FROM tipos_ncf WHERE codigo = ? AND deleted_at IS NULL AND NOT (secuencia_hasta < ? OR secuencia_desde > ?)')
    .get(codigo, d, h);
  if (choque) throw new Error(`El rango se cruza con otro ya registrado de ${codigo} (${choque.secuencia_desde} a ${choque.secuencia_hasta})`);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tipos_ncf (id, codigo, nombre, aplica_cliente, secuencia_desde, secuencia_hasta, secuencia_actual, vencimiento, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(id, codigo, TIPOS_ECF[tipo], APLICA_POR_TIPO[tipo], d, h, d, SIN_VENCIMIENTO.has(tipo) ? null : vencimiento);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: id, accion: 'crear', detalle: { codigo, desde: d, hasta: h, vencimiento: vencimiento || null } });
  return id;
}

function actualizarSecuencia(db, { tipoNcfId, vencimiento, activo }, usuarioId) {
  session.requerirPermiso('configuracion.ecf.gestionar');
  const fila = db.prepare("SELECT * FROM tipos_ncf WHERE id = ? AND codigo LIKE 'E%'").get(tipoNcfId);
  if (!fila) throw new Error('Secuencia no encontrada');
  const tipo = Number(fila.codigo.slice(1));
  if (vencimiento !== undefined && !SIN_VENCIMIENTO.has(tipo) && !FECHA.test(vencimiento || '')) throw new Error('Fecha de vencimiento no válida');
  db.prepare("UPDATE tipos_ncf SET vencimiento = COALESCE(?, vencimiento), activo = COALESCE(?, activo), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(SIN_VENCIMIENTO.has(tipo) ? null : vencimiento ?? null, activo === undefined ? null : (activo ? 1 : 0), tipoNcfId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: tipoNcfId, accion: 'editar', detalle: { vencimiento, activo } });
}

const parsearJson = (t) => { try { return t ? JSON.parse(t) : []; } catch { return []; } };

function listarEcf(db, { estado, tipoEcf, desde, hasta, texto, limite = 200 } = {}) {
  session.requerirPermiso('ventas.ecf.ver');
  const cond = ['d.deleted_at IS NULL'];
  const params = [];
  if (estado === 'con_error') cond.push("d.estado = 'pendiente' AND d.ultimo_error IS NOT NULL");
  else if (estado) { cond.push('d.estado = ?'); params.push(estado); }
  if (tipoEcf) { cond.push('d.tipo_ecf = ?'); params.push(Number(tipoEcf)); }
  // Días locales (RD, UTC-4) → instantes UTC como los de created_at.
  if (desde) { cond.push('d.created_at >= ?'); params.push(`${desde}T04:00:00.000Z`); }
  if (hasta) { cond.push('d.created_at < ?'); params.push(new Date(Date.parse(`${hasta}T04:00:00.000Z`) + 86400000).toISOString()); }
  if (texto) { cond.push('(d.encf LIKE ? OR v.numero LIKE ? OR c.nombre LIKE ?)'); params.push(`%${texto}%`, `%${texto}%`, `%${texto}%`); }
  params.push(Math.min(Number(limite) || 200, 1000));
  return db
    .prepare(
      `SELECT d.id, d.tipo_ecf, d.encf, d.ambiente, d.rnc_comprador, d.fecha_emision, d.fecha_firma, d.monto_total, d.total_itbis,
              d.codigo_seguridad, d.via, d.estado, d.track_id, d.mensajes, d.contingencia, d.intentos, d.ultimo_error,
              d.proximo_intento_at, d.enviado_at, d.respondido_at, d.created_at,
              v.id AS documento_id, v.tipo AS documento_tipo, v.numero AS documento_numero, v.estado AS documento_estado,
              COALESCE(c.nombre, 'Consumidor final') AS cliente_nombre
       FROM ecf_documentos d
       LEFT JOIN documentos_venta v ON d.origen_tipo = 'documentos_venta' AND v.id = d.origen_id
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE ${cond.join(' AND ')}
       ORDER BY d.created_at DESC LIMIT ?`
    )
    .all(...params)
    .map((r) => ({ ...r, nombre_tipo: TIPOS_ECF[r.tipo_ecf], mensajes: parsearJson(r.mensajes) }));
}

function listarAnulaciones(db) {
  session.requerirPermiso('ventas.ecf.ver');
  return db
    .prepare(
      `SELECT a.id, a.tipo_ecf, a.encf_desde, a.encf_hasta, a.cantidad, a.motivo, a.ambiente, a.estado, a.respuesta, a.intentos,
              a.ultimo_error, a.enviado_at, a.created_at, u.nombre_completo AS usuario_nombre
       FROM ecf_anulaciones a LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 200`
    )
    .all()
    .map((a) => ({ ...a, respuesta: parsearJson(a.respuesta) }));
}

function ventanaDe(event) {
  return BrowserWindow.fromWebContents(event.sender) || undefined;
}

function register(ipcMain, getDb) {
  ipcMain.handle('ecf:estado', () => estadoGeneral(getDb()));
  ipcMain.handle('ecf:guardarModo', (event, payload) => {
    const db = getDb();
    db.transaction(() => guardarModo(db, payload, payload.usuarioId))();
    return estadoGeneral(db);
  });
  ipcMain.handle('ecf:cambiarContingencia', (event, payload) => {
    const db = getDb();
    const resultado = db.transaction(() => cambiarContingencia(db, payload, payload.usuarioId))();
    cola.programar();
    return { ...estadoGeneral(db), regularizacion: resultado };
  });
  ipcMain.handle('ecf:registrarSecuencia', (event, payload) => {
    const db = getDb();
    db.transaction(() => registrarSecuencia(db, payload, payload.usuarioId))();
    return estadoGeneral(db);
  });
  ipcMain.handle('ecf:actualizarSecuencia', (event, payload) => {
    const db = getDb();
    db.transaction(() => actualizarSecuencia(db, payload, payload.usuarioId))();
    return estadoGeneral(db);
  });

  // El archivo lo elige el usuario en el diálogo nativo; la contraseña llega desde la pantalla
  // y se guarda cifrada con el almacén del sistema operativo.
  ipcMain.handle('ecf:cargarCertificado', async (event, payload) => {
    session.requerirPermiso('configuracion.ecf.gestionar');
    if (!payload || !payload.password) throw new Error('Indique la contraseña del certificado');
    const eleccion = await dialog.showOpenDialog(ventanaDe(event), {
      title: 'Certificado digital (.p12)', properties: ['openFile'],
      filters: [{ name: 'Certificado digital', extensions: ['p12', 'pfx'] }],
    });
    if (eleccion.canceled || !eleccion.filePaths.length) return { cancelado: true };
    const ruta = eleccion.filePaths[0];
    const db = getDb();
    db.transaction(() => emision.guardarCertificado(db, {
      nombreArchivo: ruta.split(/[\\/]/).pop(), contenido: fs.readFileSync(ruta), password: payload.password,
    }, payload.usuarioId))();
    return estadoGeneral(db);
  });

  ipcMain.handle('ecf:probarConexion', async () => {
    session.requerirPermiso('configuracion.ecf.gestionar');
    const db = getDb();
    const cert = emision.certificadoActivo(db);
    const cliente = crearClienteDgii({ ambiente: emision.ambienteEcf(db), firmar: (xml) => firmarXml(xml, cert).xml });
    await cliente.autenticar();
    return { ok: true, ambiente: emision.ambienteEcf(db) };
  });

  ipcMain.handle('ecf:listar', (event, filtros) => listarEcf(getDb(), filtros || {}));
  ipcMain.handle('ecf:listarAnulaciones', () => listarAnulaciones(getDb()));
  ipcMain.handle('ecf:obtenerXml', (event, { id }) => {
    session.requerirPermiso('ventas.ecf.ver');
    const fila = getDb().prepare('SELECT encf, rnc_emisor, xml, xml_rfce FROM ecf_documentos WHERE id = ?').get(id);
    if (!fila) throw new Error('Comprobante no encontrado');
    return fila;
  });
  ipcMain.handle('ecf:exportarXml', async (event, { id }) => {
    session.requerirPermiso('ventas.ecf.ver');
    const fila = getDb().prepare('SELECT encf, rnc_emisor, xml FROM ecf_documentos WHERE id = ?').get(id);
    if (!fila) throw new Error('Comprobante no encontrado');
    const destino = await dialog.showSaveDialog(ventanaDe(event), {
      title: 'Guardar e-CF', defaultPath: `${fila.rnc_emisor}${fila.encf}.xml`, filters: [{ name: 'XML', extensions: ['xml'] }],
    });
    if (destino.canceled || !destino.filePath) return { cancelado: true };
    fs.writeFileSync(destino.filePath, fila.xml, 'utf8');
    return { guardado: true, ruta: destino.filePath };
  });

  ipcMain.handle('ecf:reintentar', async (event, { id }) => {
    session.requerirPermiso('ventas.ecf.gestionar');
    const db = getDb();
    db.prepare("UPDATE ecf_documentos SET proximo_intento_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND estado IN ('pendiente', 'en_proceso')").run(id);
    await cola.ejecutar({ soloId: id });
    return listarEcf(db, {}).find((d) => d.id === id) || null;
  });
  ipcMain.handle('ecf:enviarPendientes', async () => {
    session.requerirPermiso('ventas.ecf.gestionar');
    const db = getDb();
    db.prepare("UPDATE ecf_documentos SET proximo_intento_at = NULL WHERE estado IN ('pendiente', 'en_proceso')").run();
    db.prepare("UPDATE ecf_anulaciones SET proximo_intento_at = NULL WHERE estado = 'pendiente'").run();
    return (await cola.ejecutar()) || { enviados: 0, aceptados: 0, rechazados: 0, enProceso: 0, anulaciones: 0, errores: 0 };
  });
  ipcMain.handle('ecf:anularSecuencias', (event, payload) => {
    session.requerirPermiso('ventas.ecf.gestionar');
    const db = getDb();
    const r = db.transaction(() => {
      const resultado = anulacion.anularSecuenciasNoUsadas(db, { tipoEcf: Number(payload.tipoEcf), hasta: Number(payload.hasta), motivo: payload.motivo, usuarioId: payload.usuarioId });
      configuracion.registrarAuditoria(db, { usuarioId: payload.usuarioId, modulo: 'ventas', entidad: 'ecf_anulaciones', entidadId: resultado.id, accion: 'crear', detalle: { ...resultado, motivo: payload.motivo } });
      return resultado;
    })();
    cola.programar();
    return r;
  });
}

module.exports = {
  register, estadoGeneral, guardarModo, cambiarContingencia, registrarSecuencia, actualizarSecuencia,
  listarEcf, listarAnulaciones, alertas, requisitosParaActivar,
};
