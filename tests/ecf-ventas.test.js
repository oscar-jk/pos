// e-CF de punta a punta en el sistema: venta en modo electrónico (e-NCF, firma, cola), envío a
// una DGII simulada (RFCE, recepción + TrackId, sin conexión), anulaciones, notas y contingencia.
// Las invariantes contables globales se revisan al final de la suite (helpers.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { certificadoDePrueba } = require('./ecf-certificado');
const { validarContraXsd } = require('./ecf-xsd');
const { verificarFirma } = require('../main/ecf/firma');
const { ErrorConexionDgii } = require('../main/ecf/dgii');
const cola = require('../main/ecf/cola');
const emision = require('../main/ecf/emision');

const ecfIpc = () => h.m('ecf');
const ventas = () => h.m('ventas');
const { p12, password } = certificadoDePrueba();

function configurarEmisor(db, ctx, { secuencias = [31, 32, 33, 34, 44, 45], modo = 'electronico' } = {}) {
  h.tx(db, () => h.m('configuracion').actualizarDatosNegocio(db, {
    nombre: 'Comercial ZYL', iniciales: 'CZ', colorAcento: '#146356', rnc: '131880738', razonSocial: 'Comercial ZYL, SRL',
    direccion: 'Calle Segunda #1, Gascue', telefono: '8095551234',
  }, ctx.usuarioId));
  h.tx(db, () => emision.guardarCertificado(db, { nombreArchivo: 'prueba.p12', contenido: p12, password }, ctx.usuarioId));
  for (const t of secuencias) {
    h.tx(db, () => ecfIpc().registrarSecuencia(db, { tipoEcf: t, desde: 1, hasta: 100, vencimiento: [32, 34].includes(t) ? undefined : '2028-12-31' }, ctx.usuarioId));
  }
  if (modo === 'electronico') h.tx(db, () => ecfIpc().guardarModo(db, { modo: 'electronico', ambiente: 'TesteCF' }, ctx.usuarioId));
}

function base(opciones) {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  configurarEmisor(db, ctx, opciones);
  const p = h.producto(db, ctx); // precio 118 con ITBIS 18%
  h.entrada(db, ctx, p, 50, 60);
  h.abrirTurno(db, ctx);
  return { db, ctx, p };
}

const ecfDe = (db, documentoId) => db.prepare("SELECT * FROM ecf_documentos WHERE origen_tipo = 'documentos_venta' AND origen_id = ?").get(documentoId);

// DGII simulada: cada método responde según el guion de la prueba.
function dgiiSimulada(guion = {}) {
  const llamadas = [];
  const cliente = {
    async enviarRfce(xml, nombre) { llamadas.push(['rfce', nombre]); return guion.rfce ? guion.rfce(xml) : { status: 200, codigo: 1, estado: 'Aceptado', mensajes: [], secuenciaUtilizada: true }; },
    async enviarEcf(xml, nombre) { llamadas.push(['ecf', nombre]); return guion.ecf ? guion.ecf(xml) : { status: 200, trackId: 'trk-1' }; },
    async consultarResultado(trackId) { llamadas.push(['consulta', trackId]); return guion.consulta ? guion.consulta(trackId) : { status: 200, codigo: 1, estado: 'Aceptado', mensajes: [] }; },
    async anularRangos(xml, nombre) { llamadas.push(['anecf', nombre]); return guion.anecf ? guion.anecf(xml) : { status: 200, codigo: '1', mensajes: ['Las secuencias fueron anuladas correctamente'] }; },
    async consultarDirectorio(rnc) { llamadas.push(['directorio', rnc]); return guion.directorio ? guion.directorio(rnc) : null; },
  };
  return { llamadas, crearCliente: () => cliente };
}

test('e-CF: factura de consumo toma un e-NCF E32, se firma y queda en cola con su RFCE', async () => {
  const { db, ctx, p } = base();
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 236 }]);
  const factura = ventas().obtenerFactura(db, f);
  assert.equal(factura.ncf, 'E320000000001');
  const e = ecfDe(db, f);
  assert.equal(e.estado, 'pendiente');
  assert.equal(e.via, 'rfce');
  assert.equal(e.monto_total, 236);
  assert.equal(e.total_itbis, 36);
  assert.equal(verificarFirma(e.xml).valida, true);
  assert.deepEqual((await validarContraXsd('ECF32', e.xml)).errores, []);
  assert.deepEqual((await validarContraXsd('RFCE', e.xml_rfce)).errores, []);
  assert.equal(factura.ecf.codigo_seguridad.length, 6);
  // La segunda venta toma el siguiente número.
  const f2 = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  assert.equal(ventas().obtenerFactura(db, f2).ncf, 'E320000000002');
});

test('e-CF: crédito fiscal exige RNC del cliente; si falta, no se guarda nada', () => {
  const { db, ctx, p } = base();
  const sinRnc = h.cliente(db, ctx, { rncCedula: '', tipoComprobanteDefault: 'credito_fiscal' });
  const existenciaAntes = h.existencia(db, ctx, p);
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: sinRnc, tipoNcfCodigo: 'credito_fiscal' }), /requiere el RNC o la cédula/);
  assert.equal(h.existencia(db, ctx, p), existenciaAntes);
  assert.equal(db.prepare("SELECT secuencia_actual FROM tipos_ncf WHERE codigo = 'E31'").get().secuencia_actual, 1, 'la secuencia no avanza');
  const conRnc = h.cliente(db, ctx, { rncCedula: '101-00000-1' });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: conRnc, tipoNcfCodigo: 'credito_fiscal' });
  const e = ecfDe(db, f);
  assert.equal(e.encf, 'E310000000001');
  assert.equal(e.rnc_comprador, '101000001');
  assert.equal(e.via, 'recepcion');
});

test('e-CF: secuencia vencida, agotada o inexistente, y certificado vencido, impiden facturar', () => {
  const { db, ctx, p } = base({ secuencias: [31, 32, 33, 34] });
  db.prepare("UPDATE tipos_ncf SET vencimiento = '2020-01-01' WHERE codigo = 'E31'").run();
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' }), /vencieron/);
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'gubernamental' }), /No hay secuencias e-NCF autorizadas/);
  db.prepare("UPDATE tipos_ncf SET secuencia_actual = 101 WHERE codigo = 'E32'").run();
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]), /Se agotaron/);

  const otra = h.nuevaBase();
  const ctx2 = h.contexto(otra);
  const vencido = certificadoDePrueba({ password: 'otra', dias: -1 });
  assert.throws(() => h.tx(otra, () => emision.guardarCertificado(otra, { nombreArchivo: 'v.p12', contenido: vencido.p12, password: 'otra' }, ctx2.usuarioId)), /venció/);
  assert.throws(() => h.tx(otra, () => emision.guardarCertificado(otra, { nombreArchivo: 'v.p12', contenido: p12, password: 'incorrecta' }, ctx2.usuarioId)), /contraseña/);
});

test('e-CF: no se activa el modo electrónico sin RNC, certificado y secuencias', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  assert.throws(() => h.tx(db, () => ecfIpc().guardarModo(db, { modo: 'electronico', ambiente: 'TesteCF' }, ctx.usuarioId)), /RNC del negocio.*certificado digital vigente.*E31, E32, E33, E34/);
  assert.equal(emision.modoEcf(db), 'tradicional');
  assert.throws(() => h.tx(db, () => h.m('configuracion').actualizarParametroNegocio(db, 'ecf_modo', 'electronico', ctx.usuarioId)), /Facturación electrónica/);
});

test('cola: RFCE aceptado; recepción con TrackId y consulta; sin conexión queda en contingencia y se reintenta', async () => {
  const { db, ctx, p } = base();
  const consumo = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  const credito = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });

  const sinRed = dgiiSimulada({
    rfce: () => { throw new ErrorConexionDgii('Sin conexión con la DGII (ENOTFOUND)'); },
    ecf: () => { throw new ErrorConexionDgii('Sin conexión con la DGII (ENOTFOUND)'); },
  });
  const ahora = new Date();
  let r = await cola.procesarCola(db, { crearCliente: sinRed.crearCliente, ahora });
  assert.equal(r.errores, 2);
  for (const id of [consumo, credito]) {
    const e = ecfDe(db, id);
    assert.equal(e.estado, 'pendiente');
    assert.equal(e.contingencia, 1, 'la representación impresa llevará la leyenda de contingencia');
    assert.equal(e.intentos, 1);
    assert.ok(e.proximo_intento_at > ahora.toISOString());
  }
  // Antes del próximo intento no se vuelve a llamar.
  r = await cola.procesarCola(db, { crearCliente: sinRed.crearCliente, ahora });
  assert.equal(sinRed.llamadas.length, 2);

  const dgii = dgiiSimulada();
  const despues = new Date(ahora.getTime() + 10 * 60000);
  r = await cola.procesarCola(db, { crearCliente: dgii.crearCliente, ahora: despues });
  assert.equal(ecfDe(db, consumo).estado, 'aceptado');
  assert.equal(ecfDe(db, credito).estado, 'aceptado', 'se envió, recibió TrackId y se consultó en la misma pasada');
  assert.equal(ecfDe(db, credito).track_id, 'trk-1');
  assert.deepEqual(dgii.llamadas.map((l) => l[0]), ['rfce', 'ecf', 'consulta', 'directorio']);
  assert.equal(ecfDe(db, credito).entrega_estado, 'no_electronico', 'el comprador no está en el directorio: recibe la representación impresa');
  assert.equal(dgii.llamadas[0][1], `131880738${ecfDe(db, consumo).encf}.xml`, 'nombre de archivo RNC + e-NCF');
});

test('cola: rechazo de la DGII y error de estructura se registran con sus mensajes', async () => {
  const { db, ctx, p } = base();
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  const f1 = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const dgii = dgiiSimulada({ consulta: () => ({ status: 200, codigo: 2, estado: 'Rechazado', mensajes: [{ codigo: 600, valor: 'El RNC del comprador no existe' }] }) });
  await cola.procesarCola(db, { crearCliente: dgii.crearCliente });
  const e = ecfDe(db, f1);
  assert.equal(e.estado, 'rechazado');
  assert.match(e.mensajes, /RNC del comprador no existe/);
  // Un e-CF rechazado no tiene validez: la factura sí se puede anular (sin ANECF).
  h.tx(db, () => ventas().anularFactura(db, { documentoId: f1, motivo: 'Rechazado por la DGII', usuarioId: ctx.usuarioId }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ecf_anulaciones').get().n, 0);

  const f2 = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const conError = dgiiSimulada({ ecf: () => ({ status: 400, trackId: null, error: 'XSD', mensaje: 'La estructura del archivo XML no es válida' }) });
  await cola.procesarCola(db, { crearCliente: conError.crearCliente });
  const e2 = ecfDe(db, f2);
  assert.equal(e2.estado, 'pendiente');
  assert.equal(e2.contingencia, 0, 'no es falta de conexión');
  assert.match(e2.ultimo_error, /estructura del archivo XML/);
  assert.equal(ecfIpc().listarEcf(db, { estado: 'con_error' }).length, 1);
});

test('anulación: e-CF no enviado → ANECF en cola; e-CF ya en la DGII → solo con nota de crédito', async () => {
  const { db, ctx, p } = base();
  const pendiente = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  h.tx(db, () => ventas().anularFactura(db, { documentoId: pendiente, motivo: 'Error de digitación', usuarioId: ctx.usuarioId }));
  assert.equal(ecfDe(db, pendiente).estado, 'anulado');
  const an = db.prepare('SELECT * FROM ecf_anulaciones').get();
  assert.equal(an.encf_desde, 'E320000000001');
  assert.deepEqual((await validarContraXsd('ANECF', an.xml)).errores, []);

  const enviada = h.facturar(db, ctx, [{ productoId: p, cantidad: 3 }], [{ formaPago: 'efectivo', monto: 354 }]);
  const dgii = dgiiSimulada();
  await cola.procesarCola(db, { crearCliente: dgii.crearCliente });
  assert.equal(db.prepare('SELECT estado FROM ecf_anulaciones WHERE id = ?').get(an.id).estado, 'aceptada');
  assert.equal(ecfDe(db, enviada).estado, 'aceptado');
  assert.throws(() => h.tx(db, () => ventas().anularFactura(db, { documentoId: enviada, motivo: 'X', usuarioId: ctx.usuarioId })), /ya fue enviado a la DGII.*nota de crédito/);

  // Nota de crédito por el total: E34 con código 1 (anula el NCF modificado).
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(enviada);
  const nc = h.tx(db, () => ventas().crearNotaCredito(db, { facturaOrigenId: enviada, motivo: 'Devolución total', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 3 }] }));
  const e34 = ecfDe(db, nc);
  assert.equal(e34.encf, 'E340000000001');
  assert.match(e34.xml, /<NCFModificado>E320000000002<\/NCFModificado>/);
  assert.match(e34.xml, /<CodigoModificacion>1<\/CodigoModificacion>/);
  assert.match(e34.xml, /<IndicadorNotaCredito>0<\/IndicadorNotaCredito>/);
  assert.deepEqual((await validarContraXsd('ECF34', e34.xml)).errores, []);
});

test('nota de crédito con descuento global: nunca acredita más de lo cobrado (y el E34 cuadra)', async () => {
  const { db, ctx, p } = base();
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  // 3 × 118 = 354 con 10% de descuento global → 318.60
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 3 }], [{ formaPago: 'efectivo', monto: 318.6 }], { clienteId: c, descuentoGlobalPct: 10 });
  const factura = ventas().obtenerFactura(db, f);
  assert.equal(factura.total, 318.6);
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  const nc1 = h.tx(db, () => ventas().crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Parcial', usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  const nc2 = h.tx(db, () => ventas().crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Resto', usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 2 }] }));
  const totales = [nc1, nc2].map((id) => ventas().obtenerFactura(db, id).total);
  assert.equal(Math.round((totales[0] + totales[1]) * 100) / 100, 318.6, 'lo acreditado suma exactamente lo cobrado');
  assert.match(ecfDe(db, nc2).xml, /<CodigoModificacion>3<\/CodigoModificacion>/, 'completa devoluciones previas: corrige montos');
  for (const id of [nc1, nc2]) assert.deepEqual((await validarContraXsd('ECF34', ecfDe(db, id).xml)).errores, []);
  assert.deepEqual(h.invariantes(db), []);
});

test('nota de débito electrónica (E33): exige la factura que modifica', async () => {
  const { db, ctx, p } = base();
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'credito', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const monedaId = db.prepare('SELECT id FROM monedas WHERE es_local = 1').get().id;
  assert.throws(() => h.tx(db, () => ventas().crearNotaDebito(db, { clienteId: c, sucursalId: ctx.sucursalId, almacenId: ctx.almacenId, monedaId, concepto: 'Flete', monto: 59, tasaItbisId: ctx.tasaItbisId, usuarioId: ctx.usuarioId })), /debe indicar la factura/);
  const nd = h.tx(db, () => ventas().crearNotaDebito(db, { clienteId: c, facturaOrigenId: f, monedaId, concepto: 'Flete', monto: 59, tasaItbisId: ctx.tasaItbisId, usuarioId: ctx.usuarioId }));
  const e33 = ecfDe(db, nd);
  assert.equal(e33.encf, 'E330000000001');
  assert.match(e33.xml, /<NCFModificado>E310000000001<\/NCFModificado>/);
  assert.match(e33.xml, /<IndicadorBienoServicio>2<\/IndicadorBienoServicio>/);
  assert.deepEqual((await validarContraXsd('ECF33', e33.xml)).errores, []);
});

test('contingencia: con NCF serie B registrados se factura con B02; al salir vuelve a e-CF', () => {
  const { db, ctx, p } = base();
  db.prepare("UPDATE tipos_ncf SET activo = 0 WHERE codigo IN ('B01', 'B02')").run();
  assert.throws(() => h.tx(db, () => ecfIpc().cambiarContingencia(db, { activar: true, motivo: 'Falla del sistema' }, ctx.usuarioId)), /secuencias NCF serie B/);
  db.prepare("UPDATE tipos_ncf SET activo = 1 WHERE codigo IN ('B01', 'B02')").run();
  h.tx(db, () => ecfIpc().cambiarContingencia(db, { activar: true, motivo: 'Falla del sistema' }, ctx.usuarioId));
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  assert.match(ventas().obtenerFactura(db, f).ncf, /^B02\d{8}$/);
  assert.equal(ecfDe(db, f), undefined);
  assert.ok(ecfIpc().alertas(db).some((a) => /Contingencia activa/.test(a.texto)));
  h.tx(db, () => ecfIpc().cambiarContingencia(db, { activar: false }, ctx.usuarioId));
  const f2 = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  assert.match(ventas().obtenerFactura(db, f2).ncf, /^E32/);
});

test('anulación de secuencias no usadas: ANECF desde el próximo número y la secuencia avanza', async () => {
  const { db, ctx, p } = base();
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const r = h.tx(db, () => require('../main/ecf/anulacion').anularSecuenciasNoUsadas(db, { tipoEcf: 32, hasta: 100, motivo: 'Cierre del rango', usuarioId: ctx.usuarioId }));
  assert.equal(r.desde, 'E320000000002');
  assert.equal(r.cantidad, 99);
  assert.throws(() => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]), /Se agotaron/);
});

test('modo tradicional: nada cambia y la nota de crédito toma B04 si el negocio la registró', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 5, 60);
  h.abrirTurno(db, ctx);
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 236 }]);
  assert.match(ventas().obtenerFactura(db, f).ncf, /^B02/);
  assert.equal(ventas().obtenerFactura(db, f).ecf, null);
  const det = db.prepare('SELECT id FROM documentos_venta_detalle WHERE documento_id = ?').get(f);
  const nc1 = h.tx(db, () => ventas().crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Dev', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  assert.equal(ventas().obtenerFactura(db, nc1).ncf, null, 'sin secuencia B04 registrada, como antes');
  h.tx(db, () => h.m('configuracion').crearTipoNcf(db, { codigo: 'B04', nombre: 'Nota de Crédito', aplicaCliente: 'nota_credito', secuenciaDesde: 1, secuenciaHasta: 100 }, ctx.usuarioId));
  const nc2 = h.tx(db, () => ventas().crearNotaCredito(db, { facturaOrigenId: f, motivo: 'Dev', cajaId: ctx.cajaId, usuarioId: ctx.usuarioId, lineas: [{ detalleId: det.id, cantidad: 1 }] }));
  assert.equal(ventas().obtenerFactura(db, nc2).ncf, 'B0400000001');
});

test('migración 012 sobre una base existente: crea tablas y columna, idempotente', () => {
  const { aplicarMigraciones } = require('../main/db/migrations');
  const db = h.nuevaBase();
  h.loginComo(db);
  db.exec('DROP TABLE ecf_documentos; DROP TABLE ecf_anulaciones; DROP TABLE ecf_certificados; ALTER TABLE productos DROP COLUMN es_servicio;');
  db.prepare("DELETE FROM migraciones_aplicadas WHERE id = '012_facturacion_electronica'").run();
  aplicarMigraciones(db);
  for (const t of ['ecf_documentos', 'ecf_anulaciones', 'ecf_certificados']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
  assert.ok(db.prepare('PRAGMA table_info(productos)').all().some((c) => c.name === 'es_servicio'));
  aplicarMigraciones(db);
});

test('producto marcado como servicio: el e-CF lo reporta con IndicadorBienoServicio 2', () => {
  const { db, ctx } = base();
  const servicio = h.producto(db, ctx, { descripcion: 'Instalación', esServicio: true, permiteVentaNegativo: true });
  assert.equal(db.prepare('SELECT es_servicio FROM productos WHERE id = ?').get(servicio).es_servicio, 1);
  const f = h.facturar(db, ctx, [{ productoId: servicio, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  assert.match(ecfDe(db, f).xml, /<NombreItem>Instalación<\/NombreItem><IndicadorBienoServicio>2<\/IndicadorBienoServicio>/);
});

test('fin de contingencia: cada factura serie B recibe su e-CF de reemplazo (código 4)', async () => {
  const { db, ctx, p } = base();
  h.tx(db, () => ecfIpc().cambiarContingencia(db, { activar: true, motivo: 'Certificado vencido' }, ctx.usuarioId));
  const c = h.cliente(db, ctx, { rncCedula: '101000001' });
  const consumo = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  const credito = h.facturar(db, ctx, [{ productoId: p, cantidad: 2 }], [{ formaPago: 'efectivo', monto: 236 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const ncfConsumo = ventas().obtenerFactura(db, consumo).ncf;
  const r = h.tx(db, () => ecfIpc().cambiarContingencia(db, { activar: false }, ctx.usuarioId));
  assert.deepEqual(r, { regularizadas: 2, notasPorRevisar: 0 });
  const e32 = ecfDe(db, consumo);
  assert.equal(e32.encf, 'E320000000001');
  assert.match(e32.xml, new RegExp(`<NCFModificado>${ncfConsumo}</NCFModificado>`));
  assert.match(e32.xml, /<CodigoModificacion>4<\/CodigoModificacion>/);
  assert.equal(ventas().obtenerFactura(db, consumo).ncf, ncfConsumo, 'el documento conserva el NCF que recibió el cliente');
  const e31 = ecfDe(db, credito);
  assert.match(e31.xml, /<CodigoModificacion>4<\/CodigoModificacion>/);
  assert.deepEqual((await validarContraXsd('ECF31', e31.xml)).errores, []);
  assert.deepEqual((await validarContraXsd('ECF32', e32.xml)).errores, []);
  assert.equal(require('../main/printing').representacionFiscal(db, ventas().obtenerFactura(db, consumo)), null, 'se reimprime como serie B');
});
