// Reportes personalizados (guardar, compartir, quién los cambia, baja lógica) y preferencias de
// columnas por usuario.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const rep = () => h.m('reportes');
const definicion = { fuente: 'ventas-periodo', periodo: 'este_mes', columnas: [{ id: 'periodo' }, { id: 'total', agregado: 'suma' }] };

test('reporte personalizado: se crea, se lista, se edita y se da de baja (lógica), con bitácora', () => {
  const db = h.nuevaBase();
  h.contexto(db);
  const id = h.tx(db, () => rep().guardarReportePersonalizado(db, { nombre: '  Ventas del mes  ', definicion }));
  let lista = rep().listarReportesPersonalizados(db);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nombre, 'Ventas del mes');
  assert.deepEqual(lista[0].definicion, definicion);
  assert.equal(lista[0].propio, true);

  h.tx(db, () => rep().guardarReportePersonalizado(db, { id, nombre: 'Ventas por mes', definicion: { ...definicion, limite: 10 }, compartido: true }));
  lista = rep().listarReportesPersonalizados(db);
  assert.equal(lista[0].nombre, 'Ventas por mes');
  assert.equal(lista[0].definicion.limite, 10);
  assert.equal(lista[0].compartido, true);

  h.tx(db, () => rep().eliminarReportePersonalizado(db, { id }));
  assert.equal(rep().listarReportesPersonalizados(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reportes_personalizados WHERE id = ? AND deleted_at IS NOT NULL').get(id).n, 1);
  assert.deepEqual(db.prepare("SELECT accion FROM bitacora_auditoria WHERE entidad = 'reportes_personalizados' ORDER BY created_at").all().map((r) => r.accion), ['crear', 'editar', 'eliminar']);
});

test('reporte personalizado: valida nombre, fuente y columnas', () => {
  const db = h.nuevaBase();
  h.contexto(db);
  assert.throws(() => rep().guardarReportePersonalizado(db, { nombre: ' ', definicion }), /nombre/);
  assert.throws(() => rep().guardarReportePersonalizado(db, { nombre: 'X', definicion: { columnas: [{ id: 'a' }] } }), /de dónde salen/);
  assert.throws(() => rep().guardarReportePersonalizado(db, { nombre: 'X', definicion: { fuente: 'f', columnas: [] } }), /al menos una columna/);
  assert.throws(() => rep().guardarReportePersonalizado(db, { nombre: 'X', definicion: { fuente: 'f', columnas: [{ id: 'x'.repeat(30000) }] } }), /demasiadas opciones/);
});

test('reporte personalizado: los privados son de su autor; los compartidos los ven todos pero solo el autor (o un administrador) los cambia', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const privado = h.tx(db, () => rep().guardarReportePersonalizado(db, { nombre: 'Privado', definicion }));
  const compartido = h.tx(db, () => rep().guardarReportePersonalizado(db, { nombre: 'Compartido', definicion, compartido: true }));

  const cajero = h.usuarioDeRol(db, 'Cajer');
  h.loginUsuario(db, cajero);
  const vistos = rep().listarReportesPersonalizados(db);
  assert.deepEqual(vistos.map((r) => r.nombre), ['Compartido']);
  assert.equal(vistos[0].propio, false);
  assert.throws(() => h.tx(db, () => rep().guardarReportePersonalizado(db, { id: compartido, nombre: 'Mío', definicion })), /Solo quien creó/);
  assert.throws(() => h.tx(db, () => rep().eliminarReportePersonalizado(db, { id: compartido })), /Solo quien creó/);
  assert.throws(() => h.tx(db, () => rep().eliminarReportePersonalizado(db, { id: privado })), /Solo quien creó/);
  // El cajero sí guarda los suyos.
  h.tx(db, () => rep().guardarReportePersonalizado(db, { nombre: 'Del cajero', definicion }));
  assert.equal(rep().listarReportesPersonalizados(db).length, 2);

  h.loginUsuario(db, ctx.usuarioId);
  assert.ok(!rep().listarReportesPersonalizados(db).some((r) => r.nombre === 'Del cajero'), 'el privado del cajero no lo ve el administrador en su lista');
});

test('preferencias: columnas por usuario, se reemplazan y null las borra', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  assert.equal(rep().obtenerPreferencia(db, { clave: 'columnas.existencias' }), null);
  h.tx(db, () => rep().guardarPreferencia(db, { clave: 'columnas.existencias', valor: ['descripcion', 'existencia_total'] }));
  h.tx(db, () => rep().guardarPreferencia(db, { clave: 'columnas.existencias', valor: ['codigo_interno', 'descripcion'] }));
  assert.deepEqual(rep().obtenerPreferencia(db, { clave: 'columnas.existencias' }), ['codigo_interno', 'descripcion']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM preferencias_usuario').get().n, 1);

  // Otro usuario no ve las de este.
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajer'));
  assert.equal(rep().obtenerPreferencia(db, { clave: 'columnas.existencias' }), null);

  h.loginUsuario(db, ctx.usuarioId);
  h.tx(db, () => rep().guardarPreferencia(db, { clave: 'columnas.existencias', valor: null }));
  assert.equal(rep().obtenerPreferencia(db, { clave: 'columnas.existencias' }), null);
  h.tx(db, () => rep().guardarPreferencia(db, { clave: 'columnas.existencias', valor: ['total'] }));
  assert.deepEqual(rep().obtenerPreferencia(db, { clave: 'columnas.existencias' }), ['total']);
  assert.throws(() => rep().obtenerPreferencia(db, { clave: '../../x y' }), /no válida/);
});

test('migración 018 es idempotente', () => {
  const db = h.nuevaBase();
  const mig = require('../main/db/migrations/018_reportes_personalizados');
  mig.up(db);
  mig.up(db);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'reportes_personalizados'").get());
});
