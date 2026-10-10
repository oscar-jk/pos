// Emisión de e-CF desde los documentos del sistema: modo y ambiente configurados, certificado
// digital, secuencias e-NCF y registro del comprobante firmado en ecf_documentos. Todo corre
// dentro de la transacción del documento que lo origina: si el e-CF no se puede firmar, la
// venta no se guarda.
const crypto = require('node:crypto');
const electron = require('electron');

const configuracion = require('../ipc/configuracion');
const construir = require('./construir');
const { construirXml } = require('./xml');
const { firmarXml } = require('./firma');
const { leerP12, exigirVigente } = require('./certificado');
const { fechaLocalRD, fechaDgii } = require('./fechas');

const AMBIENTES = ['TesteCF', 'CerteCF', 'eCF'];

function parametro(db, clave, porDefecto = '') {
  const fila = db.prepare('SELECT valor FROM parametros_negocio WHERE clave = ?').get(clave);
  return fila ? fila.valor : porDefecto;
}

function modoEcf(db) {
  return parametro(db, 'ecf_modo', 'tradicional') === 'electronico' ? 'electronico' : 'tradicional';
}

function ambienteEcf(db) {
  const a = parametro(db, 'ecf_ambiente', 'TesteCF');
  return AMBIENTES.includes(a) ? a : 'TesteCF';
}

function contingenciaDesde(db) {
  return parametro(db, 'ecf_contingencia_desde', '') || null;
}

// Se emiten e-CF cuando el negocio está en modo electrónico y no declaró contingencia (en
// contingencia por imposibilidad de emitir, se usan las secuencias serie B autorizadas).
function usaEcf(db) {
  return modoEcf(db) === 'electronico' && !contingenciaDesde(db);
}

// =========================================================================
// Contraseña del certificado: cifrada con el almacén del sistema operativo (DPAPI en Windows).
// =========================================================================

function cifrar(texto) {
  const almacen = electron.safeStorage;
  if (!almacen || !almacen.isEncryptionAvailable()) {
    throw new Error('El sistema operativo no ofrece almacenamiento seguro para guardar la contraseña del certificado');
  }
  return `ss:${almacen.encryptString(texto).toString('base64')}`;
}

function descifrar(valor) {
  if (!String(valor).startsWith('ss:')) throw new Error('La contraseña del certificado no se puede leer. Vuelva a cargar el certificado.');
  return electron.safeStorage.decryptString(Buffer.from(valor.slice(3), 'base64'));
}

// =========================================================================
// Certificado digital
// =========================================================================

let cacheCertificado = null; // { id, datos } — leer un .p12 es costoso; se lee una vez por certificado

function filaCertificadoActivo(db) {
  return db.prepare('SELECT * FROM ecf_certificados WHERE activo = 1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1').get();
}

function certificadoActivo(db) {
  const fila = filaCertificadoActivo(db);
  if (!fila) throw new Error('No hay certificado digital cargado. Cárguelo en Configuración > Facturación electrónica.');
  if (!cacheCertificado || cacheCertificado.id !== fila.id) {
    cacheCertificado = { id: fila.id, datos: leerP12(Buffer.from(fila.contenido_p12, 'base64'), descifrar(fila.password_cifrada)) };
  }
  exigirVigente(cacheCertificado.datos);
  return cacheCertificado.datos;
}

function guardarCertificado(db, { nombreArchivo, contenido, password }, usuarioId) {
  const datos = leerP12(contenido, password);
  exigirVigente(datos);
  db.prepare("UPDATE ecf_certificados SET activo = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE activo = 1").run();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ecf_certificados (id, nombre_archivo, contenido_p12, password_cifrada, titular, identificacion, emisor, valido_desde, valido_hasta, activo, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(id, nombreArchivo, contenido.toString('base64'), cifrar(password), datos.titular, datos.identificacion || null, datos.emisor || null, datos.validoDesde, datos.validoHasta, usuarioId || null);
  cacheCertificado = null;
  configuracion.registrarAuditoria(db, {
    usuarioId, modulo: 'configuracion', entidad: 'ecf_certificados', entidadId: id, accion: 'crear',
    detalle: { titular: datos.titular, identificacion: datos.identificacion, validoHasta: datos.validoHasta },
  });
  return id;
}

function resumenCertificado(db) {
  const f = filaCertificadoActivo(db);
  if (!f) return null;
  return { id: f.id, nombreArchivo: f.nombre_archivo, titular: f.titular, identificacion: f.identificacion, emisor: f.emisor, validoDesde: f.valido_desde, validoHasta: f.valido_hasta };
}

// =========================================================================
// Secuencias e-NCF: E + tipo (2) + secuencial (10). Vigentes hasta su fecha de vencimiento,
// salvo las de consumo (32) y notas de crédito (34), que no vencen.
// =========================================================================

function tomarEncf(db, tipoEcf, fechaIso = new Date().toISOString()) {
  const codigo = `E${tipoEcf}`;
  const nombre = construir.TIPOS_ECF[tipoEcf];
  const hoy = fechaLocalRD(fechaIso);
  const filas = db
    .prepare('SELECT * FROM tipos_ncf WHERE codigo = ? AND activo = 1 AND deleted_at IS NULL ORDER BY secuencia_desde, created_at')
    .all(codigo);
  if (!filas.length) throw new Error(`No hay secuencias e-NCF autorizadas para ${nombre}. Regístrelas en Configuración > Facturación electrónica.`);
  const disponibles = filas.filter((f) => f.secuencia_actual <= f.secuencia_hasta);
  if (!disponibles.length) throw new Error(`Se agotaron las secuencias e-NCF de ${nombre}. Solicite un nuevo rango en la Oficina Virtual de la DGII y regístrelo.`);
  const vence = !construir.SIN_VENCIMIENTO.has(tipoEcf);
  const fila = disponibles.find((f) => !vence || (f.vencimiento && f.vencimiento >= hoy));
  if (!fila) {
    const sinFecha = disponibles.find((f) => !f.vencimiento);
    if (sinFecha) throw new Error(`La secuencia ${codigo} no tiene fecha de vencimiento registrada. Complétela en Configuración > Facturación electrónica.`);
    throw new Error(`Las secuencias e-NCF de ${nombre} vencieron el ${fechaDgii(disponibles[disponibles.length - 1].vencimiento)}. Solicite nuevas en la Oficina Virtual de la DGII.`);
  }
  const encf = `${codigo}${String(fila.secuencia_actual).padStart(10, '0')}`;
  db.prepare("UPDATE tipos_ncf SET secuencia_actual = secuencia_actual + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(fila.id);
  return { encf, tipoNcfId: fila.id, vencimiento: vence ? fila.vencimiento : null };
}

function datosEmisor(db) {
  const d = configuracion.obtenerDatosNegocio(db);
  return {
    rnc: d.negocio_rnc,
    razonSocial: (d.negocio_razon_social || '').trim() || d.negocio_nombre,
    nombreComercial: d.negocio_nombre,
    direccion: d.negocio_direccion,
    telefono: d.negocio_telefono,
  };
}

// Firma el e-CF (y su RFCE si corresponde) y lo deja en cola para enviarse a la DGII.
function registrarEcf(db, { origenTipo, origenId, construido }) {
  const cert = certificadoActivo(db);
  const firmado = firmarXml(construirXml(construido.formato, construido.datos), cert);
  const r = construido.resumen;
  const xmlRfce = r.via === 'rfce'
    ? firmarXml(construirXml('RFCE', construir.construirRfce(construido.datos, firmado.codigoSeguridad)), cert).xml
    : null;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ecf_documentos
       (id, origen_tipo, origen_id, tipo_ecf, encf, ambiente, rnc_emisor, rnc_comprador, fecha_emision, fecha_firma,
        monto_total, total_itbis, codigo_seguridad, xml, via, xml_rfce, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`
  ).run(
    id, origenTipo, origenId, r.tipoEcf, r.encf, ambienteEcf(db), r.rncEmisor, r.rncComprador || null, r.fechaEmision, r.fechaFirma,
    r.montoTotal, r.totalItbis, firmado.codigoSeguridad, firmado.xml, r.via, xmlRfce
  );
  return db.prepare('SELECT * FROM ecf_documentos WHERE id = ?').get(id);
}

// =========================================================================
// Ventas: factura (31, 32, 44, 45), nota de crédito (34) y nota de débito (33)
// =========================================================================

function lineasVenta(db, documentoId) {
  return db
    .prepare(
      `SELECT d.*, p.codigo_interno, p.descripcion, p.es_servicio
       FROM documentos_venta_detalle d JOIN productos p ON p.id = d.producto_id
       WHERE d.documento_id = ? AND d.deleted_at IS NULL ORDER BY d.rowid`
    )
    .all(documentoId)
    .map((l) => ({
      codigo: l.codigo_interno, nombre: l.descripcion, esServicio: Boolean(l.es_servicio), cantidad: l.cantidad,
      precioUnitario: l.precio_unitario, totalLinea: l.total_linea, baseImponible: l.base_imponible, tasaItbis: l.tasa_itbis,
    }));
}

function documentoVentaParaEcf(db, doc, cliente) {
  const moneda = db.prepare('SELECT codigo, es_local FROM monedas WHERE id = ?').get(doc.moneda_id) || {};
  return {
    numero: doc.numero, fecha: doc.fecha, total: doc.total, subtotal: doc.subtotal, condicion: doc.condicion_pago,
    diasCredito: cliente ? cliente.dias_credito : 0,
    monedaCodigo: moneda.es_local ? null : moneda.codigo, tasaCambio: doc.tasa_cambio,
  };
}

// tipoEcf/encf/vencimiento: los que tomó la venta con tomarEncf. lineas: opcional (nota de
// débito, que no tiene detalle de productos). referencia: notas de crédito y débito.
function emitirParaVenta(db, documentoId, { tipoEcf, encf, vencimiento, lineas, referencia }) {
  const doc = db.prepare('SELECT * FROM documentos_venta WHERE id = ?').get(documentoId);
  const cliente = doc.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(doc.cliente_id) : null;
  const pagos = db.prepare('SELECT forma_pago, monto FROM pagos_venta WHERE documento_id = ?').all(documentoId)
    .map((p) => ({ formaPago: p.forma_pago, monto: p.monto }));
  const construido = construir.construirEcf({
    tipoEcf, encf, vencimientoSecuencia: vencimiento,
    emisor: datosEmisor(db),
    comprador: cliente ? { rnc: cliente.rnc_cedula, nombre: cliente.nombre } : null,
    documento: documentoVentaParaEcf(db, doc, cliente),
    lineas: lineas || lineasVenta(db, documentoId),
    pagos: tipoEcf === 33 ? [{ formaPago: 'credito', monto: doc.total }] : pagos,
    referencia,
  });
  return registrarEcf(db, { origenTipo: 'documentos_venta', origenId: documentoId, construido });
}

// Al superar una contingencia por imposibilidad de emitir (Informe Técnico e-CF §19.3): cada
// factura que salió con NCF serie B en ese periodo recibe su e-CF, que referencia el NCF con el
// código 4 ("Reemplazo NCF emitido en contingencia") y se envía solo a la DGII; el cliente
// conserva el comprobante serie B que recibió. Las notas de crédito y débito no se regularizan
// solas (el e-CF admite una sola referencia): se informan para revisarlas.
function regularizarContingencia(db, desdeIso) {
  const facturas = db
    .prepare(
      `SELECT dv.* FROM documentos_venta dv
       WHERE dv.tipo = 'factura' AND dv.estado != 'anulado' AND dv.fecha >= ? AND dv.ncf LIKE 'B%'
         AND NOT EXISTS (SELECT 1 FROM ecf_documentos e WHERE e.origen_tipo = 'documentos_venta' AND e.origen_id = dv.id)
       ORDER BY dv.fecha`
    )
    .all(desdeIso);
  let regularizadas = 0;
  for (const f of facturas) {
    const tipoEcf = construir.TIPO_ECF_POR_CODIGO_B[f.ncf.slice(0, 3)];
    if (!tipoEcf) throw new Error(`La factura ${f.numero} tiene un NCF (${f.ncf}) sin equivalente electrónico`);
    const t = tomarEncf(db, tipoEcf);
    emitirParaVenta(db, f.id, {
      tipoEcf, encf: t.encf, vencimiento: t.vencimiento,
      referencia: { ncf: f.ncf, fecha: f.fecha, codigoModificacion: 4 },
    });
    regularizadas += 1;
  }
  const notas = db
    .prepare("SELECT COUNT(*) AS n FROM documentos_venta WHERE tipo IN ('nota_credito', 'nota_debito') AND estado != 'anulado' AND fecha >= ? AND ncf LIKE 'B%'")
    .get(desdeIso).n;
  return { regularizadas, notasPorRevisar: notas };
}

function ecfDeOrigen(db, origenTipo, origenId) {
  return db
    .prepare("SELECT * FROM ecf_documentos WHERE origen_tipo = ? AND origen_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(origenTipo, origenId) || null;
}

const ESTADOS_EN_DGII = new Set(['en_proceso', 'aceptado', 'aceptado_condicional']);

// Antes de anular un documento con e-CF: si la DGII ya lo recibió, solo se corrige con una nota
// (Informe Técnico §10). Si nunca se envió, la anulación interna sigue y la secuencia se anula
// ante la DGII (ANECF, queda en cola). Si la DGII lo rechazó, no tiene validez y se puede anular.
function prepararAnulacion(db, origenTipo, origenId, { notaSugerida }) {
  const ecf = ecfDeOrigen(db, origenTipo, origenId);
  if (!ecf || ecf.estado === 'rechazado' || ecf.estado === 'anulado') return null;
  if (ESTADOS_EN_DGII.has(ecf.estado)) {
    throw new Error(`Este documento ya fue enviado a la DGII (e-CF ${ecf.encf}) y no se puede anular. Para revertirlo, emita ${notaSugerida}.`);
  }
  return ecf;
}

module.exports = {
  AMBIENTES, parametro, modoEcf, ambienteEcf, contingenciaDesde, usaEcf,
  certificadoActivo, guardarCertificado, resumenCertificado, cifrar, descifrar,
  tomarEncf, datosEmisor, registrarEcf, emitirParaVenta, ecfDeOrigen, prepararAnulacion, lineasVenta, regularizarContingencia,
};
