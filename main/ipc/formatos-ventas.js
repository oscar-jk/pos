// Formatos de envío de la DGII sobre ventas (Norma General 07-2018): 607 (ventas de bienes y
// servicios) y 608 (comprobantes anulados). Se arman con las ventas de comprobantes serie B; los
// e-CF no se reportan aquí porque ya los recibió la DGII (un emisor electrónico no envía 607 ni
// 608). Layout según los instructivos oficiales (docs/dgii/pdf/f607.txt y f608.txt).
const session = require('../auth/session');

const TOPE_CONSUMO = 250000; // facturas de consumo menores a esto van en el resumen, no una por una
const FORMATO_NCF = /^B\d{10}$/;
const LIMITE_607 = 65000;
const LIMITE_608 = 4999;

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const DESFASE_MS = -4 * 3600 * 1000;

const TIPOS_ANULACION = {
  1: 'Deterioro de factura preimpresa', 2: 'Errores de impresión (factura preimpresa)', 3: 'Impresión defectuosa',
  4: 'Corrección de la información', 5: 'Cambio de productos', 6: 'Devolución de productos', 7: 'Omisión de productos',
  8: 'Errores en secuencia de NCF', 9: 'Por cese de operaciones', 10: 'Pérdida o hurto de talonarios',
};

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

// "AAAA-MM" → límites del mes en hora local (UTC-4) como instantes UTC, y "AAAAMM".
function rangoPeriodo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('Indica el mes a reportar (AAAA-MM)');
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const inicio = Date.UTC(anio, mes - 1, 1) - DESFASE_MS;
  const fin = Date.UTC(anio, mes, 1) - DESFASE_MS;
  return { desde: new Date(inicio).toISOString(), hasta: new Date(fin).toISOString(), aaaamm: `${m[1]}${m[2]}` };
}

function fechaAAAAMMDD(iso) {
  return new Date(new Date(iso).getTime() + DESFASE_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

// Tipo de identificación del 607: 1 RNC (9 dígitos), 2 cédula (11), 3 pasaporte o ID tributaria.
function tipoIdentificacion(valor) {
  const t = String(valor || '').trim();
  if (!t) return null;
  const d = soloDigitos(t);
  if (/^\d[\d-]*$/.test(t)) return d.length === 9 ? '1' : d.length === 11 ? '2' : null;
  return '3';
}

function identificacion(valor) {
  const t = String(valor || '').trim();
  return /^\d[\d-]*$/.test(t) ? soloDigitos(t) : t.toUpperCase();
}

function rncNegocio(db) {
  return soloDigitos((db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'negocio_rnc'").get() || {}).valor);
}

// Formas de pago (campos 17 a 23): el total debe igualar el de la comprobante, con impuestos.
function formasDePago(db, doc) {
  const f = { efectivo: 0, cheque_transferencia: 0, tarjeta: 0, credito: 0, bonos: 0, permuta: 0, otras: 0 };
  if (doc.tipo === 'factura') {
    for (const p of db.prepare('SELECT forma_pago, monto FROM pagos_venta WHERE documento_id = ?').all(doc.id)) {
      if (p.forma_pago === 'efectivo') f.efectivo += p.monto;
      else if (p.forma_pago === 'transferencia' || p.forma_pago === 'cheque' || p.forma_pago === 'deposito') f.cheque_transferencia += p.monto;
      else if (p.forma_pago === 'tarjeta') f.tarjeta += p.monto;
      else if (p.forma_pago === 'credito') f.credito += p.monto;
      else f.otras += p.monto;
    }
  } else if (doc.tipo === 'nota_credito') {
    // La devolución se acredita a la cuenta del cliente o, sin cliente, se devuelve en efectivo.
    if (doc.cliente_id) f.credito = doc.total; else f.efectivo = doc.total;
  } else {
    f.credito = doc.total; // la nota de débito se carga a la cuenta del cliente
  }
  const suma = redondear(Object.values(f).reduce((a, b) => a + b, 0));
  if (Math.abs(suma - doc.total) >= 0.005) f.otras = redondear(f.otras + doc.total - suma);
  for (const k of Object.keys(f)) f[k] = redondear(f[k]);
  return f;
}

function reporte607(db, { periodo }) {
  session.requerirPermiso('ventas.reportes_financieros.ver');
  const { desde, hasta, aaaamm } = rangoPeriodo(periodo);
  const rnc = rncNegocio(db);
  const registros = [];
  const excluidos = [];
  const avisos = [];
  const consumo = { cantidad: 0, montoFacturado: 0, itbis: 0, total: 0 };

  const docs = db
    .prepare(
      `SELECT dv.*, c.nombre AS cliente_nombre, c.rnc_cedula AS cliente_rnc, f.ncf AS ncf_factura
       FROM documentos_venta dv LEFT JOIN clientes c ON c.id = dv.cliente_id LEFT JOIN documentos_venta f ON f.id = dv.documento_referencia_id
       WHERE dv.tipo IN ('factura', 'nota_credito', 'nota_debito') AND dv.estado != 'anulado' AND dv.deleted_at IS NULL
         AND dv.fecha >= ? AND dv.fecha < ? ORDER BY dv.fecha ASC`
    )
    .all(desde, hasta);
  const ETIQUETA = { factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' };
  let electronicos = 0;

  for (const d of docs) {
    const ref = { origen: ETIQUETA[d.tipo], numero: d.numero, cliente: d.cliente_nombre || 'Consumidor final', fecha: d.fecha, total: d.total, ncf: d.ncf };
    if (/^E\d{12}$/.test(d.ncf || '')) { electronicos += 1; continue; }
    if (!d.ncf) {
      if (d.tipo === 'factura') excluidos.push({ ...ref, motivo: 'sin comprobante fiscal' });
      else excluidos.push({ ...ref, motivo: 'la nota no tiene NCF: registra la secuencia de notas (B03/B04) en Parámetros fiscales' });
      continue;
    }
    if (!FORMATO_NCF.test(d.ncf)) { excluidos.push({ ...ref, motivo: `NCF con formato inválido (${d.ncf})` }); continue; }
    if (d.tipo !== 'factura' && !FORMATO_NCF.test(d.ncf_factura || '')) {
      excluidos.push({ ...ref, motivo: 'la factura afectada no tiene NCF serie B' });
      continue;
    }
    const esConsumoMenor = d.tipo === 'factura' && d.ncf.startsWith('B02') && d.total < TOPE_CONSUMO;
    if (esConsumoMenor) {
      consumo.cantidad += 1;
      consumo.montoFacturado += d.subtotal;
      consumo.itbis += d.itbis_total;
      consumo.total += d.total;
      continue;
    }
    const idCliente = identificacion(d.cliente_rnc);
    const tipoId = tipoIdentificacion(d.cliente_rnc);
    if (!tipoId) {
      excluidos.push({ ...ref, motivo: d.ncf.startsWith('B02') ? 'factura de consumo de RD$250,000 o más sin identificación del cliente' : 'el cliente no tiene RNC, cédula o pasaporte válido' });
      continue;
    }
    const f = formasDePago(db, d);
    registros.push({
      ...ref,
      rnc: idCliente, tipo_id: tipoId, ncf: d.ncf, ncf_modificado: d.tipo === 'factura' ? '' : d.ncf_factura,
      tipo_ingreso: '01', fecha_comprobante: fechaAAAAMMDD(d.fecha), fecha_retencion: '',
      monto_facturado: redondear(d.subtotal), itbis_facturado: redondear(d.itbis_total), itbis_retenido: 0, itbis_percibido: 0,
      retencion_renta: 0, isr_percibido: 0, impuesto_selectivo: 0, otros_impuestos: 0, propina_legal: 0,
      efectivo: f.efectivo, cheque_transferencia: f.cheque_transferencia, tarjeta: f.tarjeta, credito: f.credito,
      bonos: f.bonos, permuta: f.permuta, otras: f.otras,
    });
  }
  if (registros.length > LIMITE_607) throw new Error(`El formato 607 admite hasta ${LIMITE_607.toLocaleString('es-DO')} registros; el periodo tiene ${registros.length}`);
  if (electronicos) avisos.push(`${electronicos} comprobante(s) electrónico(s) (e-CF) no se incluyen: la DGII ya los recibió y un emisor electrónico no envía el 607.`);
  const retenciones = db.prepare(
    `SELECT COUNT(*) n FROM recibos_ingreso WHERE estado != 'anulado' AND deleted_at IS NULL AND fecha >= ? AND fecha < ? AND (retencion_isr > 0 OR retencion_itbis > 0)`
  ).get(desde, hasta).n;
  if (retenciones) avisos.push(`${retenciones} cobro(s) del mes tienen retenciones de ISR o ITBIS. El archivo las deja en cero: complételas con su contador (campos de retención y fecha de retención).`);
  if (rnc && !tipoIdentificacion(rnc)) avisos.push('El RNC del negocio no tiene un formato válido.');

  const suma = (campo) => redondear(registros.reduce((a, r) => a + r[campo], 0));
  return {
    periodo: aaaamm, rncNegocio: rnc || null, registros, excluidos, avisos,
    resumenConsumo: { cantidad: consumo.cantidad, montoFacturado: redondear(consumo.montoFacturado), itbis: redondear(consumo.itbis), total: redondear(consumo.total) },
    totales: { cantidad: registros.length, facturado: suma('monto_facturado'), itbis: suma('itbis_facturado') },
  };
}

const CAMPOS_607 = [
  'rnc', 'tipo_id', 'ncf', 'ncf_modificado', 'tipo_ingreso', 'fecha_comprobante', 'fecha_retencion', 'monto_facturado', 'itbis_facturado',
  'itbis_retenido', 'itbis_percibido', 'retencion_renta', 'isr_percibido', 'impuesto_selectivo', 'otros_impuestos', 'propina_legal',
  'efectivo', 'cheque_transferencia', 'tarjeta', 'credito', 'bonos', 'permuta', 'otras',
];
const OBLIGATORIOS_607 = new Set(['monto_facturado', 'itbis_facturado']);

function valor607(r, campo) {
  const v = r[campo];
  if (typeof v === 'number') return OBLIGATORIOS_607.has(campo) || v !== 0 ? v.toFixed(2) : '';
  return v ?? '';
}

// Archivo DGII_F_607_RNC_AAAAMM.TXT: encabezado y una línea por registro, campos separados por "|".
function txt607(reporte) {
  if (!tipoIdentificacion(reporte.rncNegocio)) throw new Error('Configura el RNC del negocio en Configuración → Negocio antes de generar el archivo 607');
  const lineas = [`607|${reporte.rncNegocio}|${reporte.periodo}|${reporte.registros.length}`];
  for (const r of reporte.registros) lineas.push(CAMPOS_607.map((c) => valor607(r, c)).join('|'));
  return `${lineas.join('\r\n')}\r\n`;
}

// 608: comprobantes serie B anulados en el mes. La fecha de anulación es la última modificación del
// documento anulado. Tipo de anulación por documento: tipos = { [documentoId]: 1..10 }; por defecto
// 4 (corrección de la información), o 6 (devolución de productos) en las notas de crédito.
function reporte608(db, { periodo, tipos = {} }) {
  session.requerirPermiso('ventas.reportes_financieros.ver');
  const { desde, hasta, aaaamm } = rangoPeriodo(periodo);
  const rnc = rncNegocio(db);
  const registros = [];
  const excluidos = [];
  const docs = db
    .prepare(
      `SELECT dv.id, dv.tipo, dv.numero, dv.ncf, dv.fecha, dv.total, dv.motivo_anulacion, dv.updated_at, c.nombre AS cliente_nombre
       FROM documentos_venta dv LEFT JOIN clientes c ON c.id = dv.cliente_id
       WHERE dv.tipo IN ('factura', 'nota_credito', 'nota_debito') AND dv.estado = 'anulado' AND dv.deleted_at IS NULL
         AND dv.ncf IS NOT NULL AND dv.updated_at >= ? AND dv.updated_at < ? ORDER BY dv.fecha ASC`
    )
    .all(desde, hasta);
  let electronicos = 0;
  for (const d of docs) {
    if (/^E\d{12}$/.test(d.ncf)) { electronicos += 1; continue; }
    const ref = { numero: d.numero, cliente: d.cliente_nombre || 'Consumidor final', total: d.total, motivo_anulacion: d.motivo_anulacion };
    if (!FORMATO_NCF.test(d.ncf)) { excluidos.push({ ...ref, motivo: `NCF con formato inválido (${d.ncf})` }); continue; }
    const tipo = Number(tipos[d.id]) || (d.tipo === 'nota_credito' ? 6 : 4);
    if (!TIPOS_ANULACION[tipo]) { excluidos.push({ ...ref, motivo: `tipo de anulación no válido (${tipos[d.id]})` }); continue; }
    registros.push({ ...ref, documento_id: d.id, ncf: d.ncf, fecha_comprobante: fechaAAAAMMDD(d.fecha), tipo_anulacion: tipo, tipo_anulacion_texto: TIPOS_ANULACION[tipo] });
  }
  if (registros.length > LIMITE_608) throw new Error(`El formato 608 admite hasta ${LIMITE_608.toLocaleString('es-DO')} registros`);
  const avisos = [];
  if (electronicos) avisos.push(`${electronicos} e-CF anulado(s) no se incluyen: se anulan ante la DGII por el servicio de anulación.`);
  avisos.push('Si un comprobante anulado ya se envió en el 607 de un mes anterior, rectifique ese 607 para excluirlo.');
  return { periodo: aaaamm, rncNegocio: rnc || null, registros, excluidos, avisos, tiposAnulacion: TIPOS_ANULACION };
}

function txt608(reporte) {
  if (!tipoIdentificacion(reporte.rncNegocio)) throw new Error('Configura el RNC del negocio en Configuración → Negocio antes de generar el archivo 608');
  const lineas = [`608|${reporte.rncNegocio}|${reporte.periodo}|${reporte.registros.length}`];
  for (const r of reporte.registros) lineas.push([r.ncf, r.fecha_comprobante, String(r.tipo_anulacion).padStart(2, '0')].join('|'));
  return `${lineas.join('\r\n')}\r\n`;
}

function csv607(reporte) {
  const encabezados = ['RNC/Cédula/Pasaporte', 'Tipo Id', 'NCF', 'NCF Modificado', 'Tipo de Ingreso', 'Fecha Comprobante', 'Fecha Retención', 'Monto Facturado', 'ITBIS Facturado',
    'ITBIS Retenido por Terceros', 'ITBIS Percibido', 'Retención Renta por Terceros', 'ISR Percibido', 'Impuesto Selectivo al Consumo', 'Otros Impuestos/Tasas', 'Monto Propina Legal',
    'Efectivo', 'Cheque/Transferencia/Depósito', 'Tarjeta Débito/Crédito', 'Venta a Crédito', 'Bonos o Certificados de Regalo', 'Permuta', 'Otras Formas de Ventas'];
  const celda = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lineas = [encabezados.map(celda).join(',')];
  for (const r of reporte.registros) lineas.push(CAMPOS_607.map((c) => celda(valor607(r, c))).join(','));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

function register(ipcMain, getDb) {
  const exportar = (nombreBase, generar, reportar) => async (event, payload) => {
    const { dialog, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    const reporte = reportar(getDb(), payload);
    const esTxt = payload.formato !== 'csv';
    const contenido = esTxt ? generar.txt(reporte) : generar.csv(reporte);
    const nombre = esTxt ? `DGII_F_${nombreBase}_${reporte.rncNegocio}_${reporte.periodo}.TXT` : `Formato_${nombreBase}_${reporte.periodo}.csv`;
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: esTxt ? `Guardar archivo ${nombreBase} para la DGII` : `Guardar ${nombreBase} para Excel`, defaultPath: nombre,
      filters: esTxt ? [{ name: 'Archivo de texto', extensions: ['TXT', 'txt'] }] : [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { cancelado: true };
    fs.writeFileSync(filePath, contenido, 'utf8');
    return { ruta: filePath, registros: reporte.registros.length };
  };
  ipcMain.handle('formatos:reporte607', (event, payload) => reporte607(getDb(), payload || {}));
  ipcMain.handle('formatos:reporte608', (event, payload) => reporte608(getDb(), payload || {}));
  ipcMain.handle('formatos:exportar607', exportar('607', { txt: txt607, csv: csv607 }, reporte607));
  ipcMain.handle('formatos:exportar608', exportar('608', { txt: txt608, csv: (r) => txt608(r) }, reporte608));
}

module.exports = { register, reporte607, reporte608, txt607, txt608, csv607, rangoPeriodo, tipoIdentificacion, TIPOS_ANULACION };
