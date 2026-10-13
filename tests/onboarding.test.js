// Asistente de configuración inicial.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');

const onb = () => h.m('onboarding');
const guardar = (db, fn) => h.tx(db, fn);

test('base nueva: asistente pendiente; base anterior sin el parámetro: no se impone', () => {
  const db = h.nuevaBase();
  h.contexto(db);
  assert.deepEqual(onb().estadoOnboarding(db), { pendiente: true, completado: false, omitido: false });
  db.prepare("DELETE FROM parametros_negocio WHERE clave = 'onboarding_completado'").run();
  assert.equal(onb().estadoOnboarding(db).pendiente, false, 'una base ya en uso no pasa por el asistente');
});

test('datos del asistente: negocio, comprobantes, sucursal, módulos, roles y usuarios', () => {
  const db = h.nuevaBase();
  h.contexto(db);
  const d = onb().datosAsistente(db);
  assert.equal(d.negocio.negocio_nombre, 'Mi Negocio');
  assert.deepEqual(d.tiposNcf.map((t) => t.codigo), ['B01', 'B02', 'B14', 'B15']);
  assert.ok(d.tiposNcf.every((t) => t.emitidos === false));
  assert.ok(d.sucursal.nombre);
  assert.ok(d.modulos.length >= 1);
  assert.ok(d.roles.some((r) => /cajero/i.test(r.nombre)));
  assert.equal(d.usuarios.length, 1);
  assert.equal(d.facturacionElectronica, 'tradicional');
});

test('negocio: valida nombre y RNC, deduce iniciales y conserva el color de marca', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  assert.throws(() => guardar(db, () => onb().guardarNegocio(db, { nombre: '  ' }, ctx.usuarioId)), /nombre del negocio/);
  assert.throws(() => guardar(db, () => onb().guardarNegocio(db, { nombre: 'Colmado Rosa', rnc: '12345' }, ctx.usuarioId)), /9 dígitos/);
  guardar(db, () => onb().guardarNegocio(db, { nombre: 'Colmado Rosa', rnc: '1-31-88073-8', telefono: '809-555-1234', direccion: 'Calle 1', razonSocial: 'Rosa SRL' }, ctx.usuarioId));
  const n = h.m('configuracion').obtenerDatosNegocio(db);
  assert.equal(n.negocio_nombre, 'Colmado Rosa');
  assert.equal(n.negocio_iniciales, 'CR');
  assert.equal(n.negocio_rnc, '131880738');
  assert.equal(n.negocio_razon_social, 'Rosa SRL');
  assert.equal(n.negocio_color_acento, '#0A6B68');
  assert.equal(onb().inicialesDe('Farmacia'), 'FA');
});

test('NCF: fija el rango autorizado, rechaza rangos inválidos y no toca lo ya emitido', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const tipo = (codigo) => db.prepare('SELECT * FROM tipos_ncf WHERE codigo = ?').get(codigo);
  const b02 = tipo('B02').id;
  guardar(db, () => onb().configurarSecuenciaNcf(db, { tipoNcfId: b02, desde: 101, hasta: 600, activo: true }, ctx.usuarioId));
  const t = tipo('B02');
  assert.deepEqual([t.secuencia_desde, t.secuencia_hasta, t.secuencia_actual], [101, 600, 101]);
  assert.throws(() => guardar(db, () => onb().configurarSecuenciaNcf(db, { tipoNcfId: b02, desde: 50, hasta: 10 }, ctx.usuarioId)), /no puede ser menor/);
  assert.throws(() => guardar(db, () => onb().configurarSecuenciaNcf(db, { tipoNcfId: b02, desde: 0, hasta: 10 }, ctx.usuarioId)), /enteros desde 1/);
  assert.throws(() => guardar(db, () => onb().configurarSecuenciaNcf(db, { tipoNcfId: b02, desde: 1, hasta: 100000000 }, ctx.usuarioId)), /máximo/);
  // La primera venta consume B02000000101: el rango ya no se puede reescribir desde el asistente.
  const p = h.producto(db, ctx, { precioDetalle: 118 });
  h.entrada(db, ctx, p, 5, 40);
  h.abrirTurno(db, ctx, 0);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  assert.equal(onb().datosAsistente(db).tiposNcf.find((x) => x.codigo === 'B02').emitidos, true);
  assert.throws(() => guardar(db, () => onb().configurarSecuenciaNcf(db, { tipoNcfId: b02, desde: 1, hasta: 900 }, ctx.usuarioId)), /Ya se emitieron B02/);
  // Desactivar un tipo no emitido.
  guardar(db, () => onb().configurarSecuenciaNcf(db, { tipoNcfId: tipo('B15').id, desde: 1, hasta: 500, activo: false }, ctx.usuarioId));
  assert.equal(tipo('B15').activo, 0);
});

test('sucursal principal y finalizar (completo u omitido)', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  assert.throws(() => guardar(db, () => onb().guardarSucursalPrincipal(db, { nombre: '' }, ctx.usuarioId)), /nombre de la sucursal/);
  guardar(db, () => onb().guardarSucursalPrincipal(db, { nombre: 'Local Gascue' }, ctx.usuarioId));
  assert.equal(db.prepare('SELECT nombre FROM sucursales WHERE es_principal = 1').get().nombre, 'Local Gascue');
  guardar(db, () => onb().finalizar(db, { omitido: true }, ctx.usuarioId));
  assert.deepEqual(onb().estadoOnboarding(db), { pendiente: false, completado: true, omitido: true });
  guardar(db, () => onb().finalizar(db, { omitido: false }, ctx.usuarioId));
  assert.equal(onb().estadoOnboarding(db).omitido, false);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM bitacora_auditoria WHERE entidad_id = 'onboarding'").get().n >= 2);
});

test('el asistente exige permiso de configuración', () => {
  const db = h.nuevaBase();
  h.contexto(db);
  const cajero = h.usuarioDeRol(db, 'Cajero');
  h.loginUsuario(db, cajero);
  assert.throws(() => onb().datosAsistente(db), /permiso/i);
  assert.throws(() => guardar(db, () => onb().guardarNegocio(db, { nombre: 'X' }, cajero)), /permiso/i);
  assert.throws(() => guardar(db, () => onb().finalizar(db, { omitido: true }, cajero)), /permiso/i);
});

test('pantalla: la tienen el shell (redirección) y la configuración (reabrir)', () => {
  const raiz = path.join(__dirname, '..', 'renderer');
  assert.match(fs.readFileSync(path.join(raiz, 'shared', 'shell.js'), 'utf8'), /onboarding\.pendiente[\s\S]*onboarding\/index\.html/);
  assert.match(fs.readFileSync(path.join(raiz, 'configuracion', 'index.html'), 'utf8'), /href="\.\.\/onboarding\/index\.html"/);
  const html = fs.readFileSync(path.join(raiz, 'onboarding', 'index.html'), 'utf8');
  for (const s of ['escape', 'estados', 'tema', 'logo', 'iconos']) assert.ok(html.includes(`shared/${s}.js`), s);
});
