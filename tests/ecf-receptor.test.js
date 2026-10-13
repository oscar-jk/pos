// e-CF entre contribuyentes: entrega al comprador electrónico con acuse de recibo, y el negocio
// como receptor (semilla/token, recepción con ARECF firmado, aprobación comercial ACECF).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { certificadoDePrueba } = require('./ecf-certificado');
const { validarContraXsd } = require('./ecf-xsd');
const emision = require('../main/ecf/emision');
const cola = require('../main/ecf/cola');
const receptor = require('../main/ecf/receptor');
const { firmarXml, verificarFirma } = require('../main/ecf/firma');
const { construirEcf } = require('../main/ecf/construir');
const { construirXml } = require('../main/ecf/xml');
const { leerP12 } = require('../main/ecf/certificado');

const { p12, password } = certificadoDePrueba();
const certProveedor = leerP12(certificadoDePrueba({ password: 'proveedor', identificacion: '00200000002' }).p12, 'proveedor');

function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  h.tx(db, () => h.m('configuracion').actualizarDatosNegocio(db, {
    nombre: 'Comercial ZYL', iniciales: 'CZ', colorAcento: '#146356', rnc: '131880738', razonSocial: 'ZYL, SRL', direccion: 'Calle 1', telefono: '',
  }, ctx.usuarioId));
  h.tx(db, () => emision.guardarCertificado(db, { nombreArchivo: 'p.p12', contenido: p12, password }, ctx.usuarioId));
  for (const t of [31, 32, 33, 34]) {
    h.tx(db, () => h.m('ecf').registrarSecuencia(db, { tipoEcf: t, desde: 1, hasta: 50, vencimiento: [32, 34].includes(t) ? undefined : '2028-12-31' }, ctx.usuarioId));
  }
  h.tx(db, () => h.m('ecf').guardarModo(db, { modo: 'electronico', ambiente: 'TesteCF' }, ctx.usuarioId));
  return { db, ctx };
}

// e-CF 31 que un proveedor (RNC 101000009) nos emite a nosotros (131880738).
function ecfDeProveedor({ rncComprador = '131880738', encf = 'E310000000077', cert = certProveedor } = {}) {
  const e = construirEcf({
    tipoEcf: 31, encf, vencimientoSecuencia: '2028-12-31',
    emisor: { rnc: '101000009', razonSocial: 'Proveedor Mayorista SRL', direccion: 'Av. Principal 10' },
    comprador: { rnc: rncComprador, nombre: 'ZYL, SRL' },
    documento: { numero: '9001', fecha: '2026-10-05T14:00:00.000Z', total: 5900, subtotal: 5000, condicion: 'credito', diasCredito: 30 },
    lineas: [{ nombre: 'Mercancía', cantidad: 10, precioUnitario: 590, totalLinea: 5900, baseImponible: 5000, tasaItbis: 0.18 }],
    pagos: [{ formaPago: 'credito', monto: 5900 }],
  });
  return firmarXml(construirXml('ECF31', e.datos), cert).xml;
}

test('receptor: autenticación por semilla firmada y token de una hora', () => {
  const auth = receptor.crearAutenticador();
  const ahora = new Date('2026-10-10T12:00:00Z');
  const semilla = auth.semilla(ahora);
  assert.match(semilla, /<SemillaModel[^>]*><valor>[^<]+<\/valor><fecha>/);
  const r = auth.validarCertificado(firmarXml(semilla, certProveedor).xml, ahora);
  assert.ok(r.token && r.expira === '2026-10-10T13:00:00Z');
  assert.ok(auth.tokenValido(`Bearer ${r.token}`, ahora));
  assert.equal(auth.tokenValido(`Bearer ${r.token}`, new Date('2026-10-10T13:00:01Z')), false);
  assert.throws(() => auth.validarCertificado(firmarXml(semilla, certProveedor).xml, ahora), /no es válida o ya venció/, 'una semilla se usa una sola vez');
  const alterada = firmarXml(auth.semilla(ahora), certProveedor).xml.replace(/<valor>./, '<valor>X');
  assert.throws(() => auth.validarCertificado(alterada, ahora), /alterado/);
});

test('receptor: e-CF recibido → acuse firmado y válido; duplicado, firma mala y RNC ajeno se rechazan', async () => {
  const { db } = base();
  const xml = ecfDeProveedor();
  const r = receptor.recibirEcf(db, xml);
  assert.equal(r.estado, 0);
  assert.deepEqual((await validarContraXsd('ARECF', r.acuseXml)).errores, []);
  assert.equal(verificarFirma(r.acuseXml).valida, true);
  assert.match(r.acuseXml, /<RNCEmisor>101000009<\/RNCEmisor><RNCComprador>131880738<\/RNCComprador><eNCF>E310000000077<\/eNCF><Estado>0<\/Estado>/);
  const fila = db.prepare('SELECT * FROM ecf_recibidos WHERE id = ?').get(r.id);
  assert.equal(fila.monto_total, 5900);
  assert.equal(fila.total_itbis, 900);
  assert.equal(fila.razon_social_emisor, 'Proveedor Mayorista SRL');

  assert.deepEqual([receptor.recibirEcf(db, xml).estado, receptor.recibirEcf(db, xml).motivo], [1, 3], 'envío duplicado');
  assert.equal(receptor.recibirEcf(db, xml.replace('<MontoTotal>5900.00</MontoTotal>', '<MontoTotal>1.00</MontoTotal>')).motivo, 2, 'firma no corresponde');
  assert.equal(receptor.recibirEcf(db, ecfDeProveedor({ rncComprador: '101000001', encf: 'E310000000078' })).motivo, 4, 'no somos el comprador');
  const basura = receptor.recibirEcf(db, '<hola/>');
  assert.equal(basura.motivo, 1);
  assert.deepEqual((await validarContraXsd('ARECF', basura.acuseXml)).errores, []);
});

test('aprobación comercial propia: ACECF firmado, válido y enviado a la DGII y al emisor', async () => {
  const { db, ctx } = base();
  const { id } = receptor.recibirEcf(db, ecfDeProveedor());
  assert.throws(() => receptor.aprobarComercialmente(db, id, { aprobado: false, usuarioId: ctx.usuarioId }), /motivo del rechazo/);
  const xml = receptor.aprobarComercialmente(db, id, { aprobado: true, usuarioId: ctx.usuarioId });
  assert.deepEqual((await validarContraXsd('ACECF', xml)).errores, []);
  assert.match(xml, /<RNCEmisor>101000009<\/RNCEmisor><eNCF>E310000000077<\/eNCF><FechaEmision>05-10-2026<\/FechaEmision><MontoTotal>5900.00<\/MontoTotal><RNCComprador>131880738<\/RNCComprador><Estado>1<\/Estado>/);
  assert.throws(() => receptor.aprobarComercialmente(db, id, { aprobado: true, usuarioId: ctx.usuarioId }), /ya tiene/);

  const llamadas = [];
  const cliente = {
    async enviarAprobacionComercial(x, nombre) { llamadas.push(['dgii', nombre]); return { status: 200, estado: 'Aprobación comercial aprobada', codigo: '1' }; },
    async consultarDirectorio(rnc) { llamadas.push(['directorio', rnc]); return { nombre: 'Proveedor', urlRecepcion: 'https://prov.test/recepcion', urlAceptacion: 'https://prov.test/aceptacion' }; },
  };
  const contribuyente = { async enviarAprobacion(x, nombre) { llamadas.push(['emisor', nombre]); return { status: 200, cuerpo: '' }; } };
  const r = await cola.procesarCola(db, { crearCliente: () => cliente, crearContribuyente: () => contribuyente });
  assert.equal(r.aprobaciones, 1);
  assert.deepEqual(llamadas, [['dgii', '131880738E310000000077.xml'], ['directorio', '101000009'], ['emisor', '131880738E310000000077.xml']]);
  assert.equal(db.prepare('SELECT aprobacion_envio FROM ecf_recibidos WHERE id = ?').get(id).aprobacion_envio, 'enviada');
});

test('entrega al comprador electrónico: se envía su e-CF y se guarda el acuse; la aprobación que devuelve se registra', async () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 10, 50);
  h.abrirTurno(db, ctx);
  const c = h.cliente(db, ctx, { rncCedula: '101000009' });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  const propio = db.prepare('SELECT * FROM ecf_documentos WHERE origen_id = ?').get(f);

  // El comprador es receptor electrónico: responde con su acuse firmado.
  const enviados = [];
  const cliente = {
    async enviarEcf() { return { status: 200, trackId: 't-1' }; },
    async consultarResultado() { return { status: 200, codigo: 1, estado: 'Aceptado', mensajes: [] }; },
    async consultarDirectorio() { return { nombre: 'Cliente', urlRecepcion: 'https://cliente.test/svc', urlAceptacion: 'https://cliente.test/svc', urlOpcional: null }; },
  };
  const acuseCliente = firmarXml(construirXml('ARECF', { DetalleAcusedeRecibo: {
    Version: '1.0', RNCEmisor: '131880738', RNCComprador: '101000009', eNCF: propio.encf, Estado: '0', FechaHoraAcuseRecibo: '10-10-2026 10:00:00',
  } }), certProveedor).xml;
  const contribuyente = { async enviarEcf(xml, nombre) { enviados.push(nombre); return { status: 200, cuerpo: acuseCliente }; } };
  await cola.procesarCola(db, { crearCliente: () => cliente, crearContribuyente: () => contribuyente });
  const e = db.prepare('SELECT * FROM ecf_documentos WHERE id = ?').get(propio.id);
  assert.equal(e.estado, 'aceptado');
  assert.equal(e.entrega_estado, 'entregado');
  assert.equal(e.acuse_estado, 0);
  assert.deepEqual(enviados, [`131880738${propio.encf}.xml`]);

  // Luego el cliente nos envía su aprobación comercial.
  const acecf = firmarXml(construirXml('ACECF', { DetalleAprobacionComercial: {
    Version: '1.0', RNCEmisor: '131880738', eNCF: propio.encf, FechaEmision: propio.fecha_emision, MontoTotal: 118, RNCComprador: '101000009',
    Estado: '2', DetalleMotivoRechazo: 'Mercancía no solicitada', FechaHoraAprobacionComercial: '10-10-2026 11:00:00',
  } }), certProveedor).xml;
  assert.deepEqual(receptor.recibirAprobacion(db, acecf), { status: 200, mensaje: 'Aprobación comercial recibida' });
  const conAprobacion = db.prepare('SELECT aprobacion_estado, aprobacion_motivo FROM ecf_documentos WHERE id = ?').get(propio.id);
  assert.deepEqual({ ...conAprobacion }, { aprobacion_estado: 2, aprobacion_motivo: 'Mercancía no solicitada' });
  assert.equal(receptor.recibirAprobacion(db, acecf.replace('<Estado>2</Estado>', '<Estado>1</Estado>')).status, 400, 'firma alterada');
});

test('entrega: sin conexión con el receptor se reintenta más tarde', async () => {
  const { db, ctx } = base();
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 10, 50);
  h.abrirTurno(db, ctx);
  const c = h.cliente(db, ctx, { rncCedula: '101000009' });
  const f = h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }], { clienteId: c, tipoNcfCodigo: 'credito_fiscal' });
  db.prepare("UPDATE ecf_documentos SET estado = 'aceptado' WHERE origen_id = ?").run(f);
  const cliente = { async consultarDirectorio() { return { urlRecepcion: 'https://cliente.test', urlAceptacion: 'https://cliente.test' }; } };
  const contribuyente = { async enviarEcf() { throw new Error('Sin conexión con cliente.test (ENOTFOUND)'); } };
  const ahora = new Date();
  await cola.procesarCola(db, { crearCliente: () => cliente, crearContribuyente: () => contribuyente, ahora });
  const e = db.prepare('SELECT * FROM ecf_documentos WHERE origen_id = ?').get(f);
  assert.equal(e.entrega_estado, 'pendiente');
  assert.equal(e.entrega_intentos, 1);
  assert.ok(e.entrega_proximo_at > ahora.toISOString());
  assert.match(e.entrega_error, /ENOTFOUND/);
});

test('servicio receptor de punta a punta: un emisor se autentica, entrega su e-CF y recibe el acuse', async () => {
  const { crearServidorReceptor } = require('../main/ecf/servidor-receptor');
  const { crearClienteContribuyente } = require('../main/ecf/dgii');
  const { db } = base();
  const servidor = crearServidorReceptor({ getDb: () => db });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  try {
    // Sin token no se recibe nada.
    const sinToken = crearClienteContribuyente({ urlRecepcion: url, urlAceptacion: url, firmar: (x) => firmarXml(x, certProveedor).xml });
    assert.equal((await sinToken.enviarEcf(ecfDeProveedor(), 'x.xml')).status, 401);

    const emisor = crearClienteContribuyente({ urlRecepcion: url, urlAceptacion: url, urlOpcional: url, firmar: (x) => firmarXml(x, certProveedor).xml });
    const r = await emisor.enviarEcf(ecfDeProveedor(), '101000009E310000000077.xml');
    assert.equal(r.status, 200);
    assert.match(r.cuerpo, /^<\?xml[^>]*><ARECF>.*<Estado>0<\/Estado>/);
    assert.equal(verificarFirma(r.cuerpo).valida, true);
    assert.equal(db.prepare("SELECT via FROM ecf_recibidos WHERE encf = 'E310000000077'").get().via, 'servicio');
    const repetido = await emisor.enviarEcf(ecfDeProveedor(), '101000009E310000000077.xml');
    assert.match(repetido.cuerpo, /<Estado>1<\/Estado><CodigoMotivoNoRecibido>3<\/CodigoMotivoNoRecibido>/);
    const aprobacionAjena = await emisor.enviarAprobacion('<ACECF/>', 'a.xml');
    assert.equal(aprobacionAjena.status, 400);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
});
