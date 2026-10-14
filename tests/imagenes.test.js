// Fotos: foto de cada sucursal (local) y galería de fotos por producto, con miniatura en las
// listas, la búsqueda del mostrador y la cuadrícula táctil.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const config = () => h.m('configuracion');
const inv = () => h.m('inventario');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const png = `data:image/png;base64,${PNG_1X1}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString('base64')}`;
const falso = `data:image/png;base64,${Buffer.from('no soy una imagen').toString('base64')}`;

test('sucursal: se crea con foto, se edita y se le quita la foto, con bitácora', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const id = h.tx(db, () => config().crearSucursal(db, { nombre: 'Local Naco', telefono: '809-555-0101', imagen: png }, ctx.usuarioId));
  let s = config().listarSucursales(db).find((x) => x.id === id);
  assert.equal(s.imagen, png);

  // Sin el campo imagen, la foto se conserva.
  h.tx(db, () => config().actualizarSucursal(db, id, { nombre: 'Local Naco II', direccion: 'Av. Tiradentes' }, ctx.usuarioId));
  s = config().listarSucursales(db).find((x) => x.id === id);
  assert.equal(s.nombre, 'Local Naco II');
  assert.equal(s.direccion, 'Av. Tiradentes');
  assert.equal(s.imagen, png);

  h.tx(db, () => config().actualizarSucursal(db, id, { nombre: 'Local Naco II', imagen: '' }, ctx.usuarioId));
  assert.equal(config().listarSucursales(db).find((x) => x.id === id).imagen, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bitacora_auditoria WHERE entidad = 'sucursales' AND entidad_id = ?").get(id).n, 3);
});

test('sucursal: rechaza archivos que no son imagen y nombres vacíos', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  assert.throws(() => h.tx(db, () => config().crearSucursal(db, { nombre: 'X', imagen: falso }, ctx.usuarioId)), /no es una imagen válida/);
  assert.throws(() => h.tx(db, () => config().crearSucursal(db, { nombre: 'X', imagen: 'data:text/html;base64,PGI+' }, ctx.usuarioId)), /PNG, JPG o WebP/);
  const id = h.tx(db, () => config().crearSucursal(db, { nombre: 'Y' }, ctx.usuarioId));
  assert.throws(() => h.tx(db, () => config().actualizarSucursal(db, id, { nombre: '  ' }, ctx.usuarioId)), /obligatorio/);
});

test('sucursal: editar exige configuracion.gestionar', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const id = h.tx(db, () => config().crearSucursal(db, { nombre: 'Z' }, ctx.usuarioId));
  h.loginUsuario(db, h.usuarioDeRol(db, 'Cajer'));
  assert.throws(() => h.tx(db, () => config().actualizarSucursal(db, id, { nombre: 'Otro' }, ctx.usuarioId)), /permiso/i);
});

test('producto: fotos en orden, la primera es la miniatura de listas, búsqueda y cuadrícula', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const id = h.producto(db, ctx, { codigoInterno: 'CAFE1', descripcion: 'Café molido', imagenes: [{ imagen: png, miniatura: png }, { imagen: jpeg, miniatura: jpeg }] });
  let ficha = inv().obtenerProductoCompleto(db, id);
  assert.equal(ficha.imagenes.length, 2);
  assert.deepEqual(ficha.imagenes.map((f) => f.orden), [0, 1]);

  assert.equal(inv().listarProductos(db, { texto: 'CAFE1' })[0].imagen_miniatura, png);
  assert.equal(inv().buscarProductos(db, { texto: 'Café', almacenId: ctx.almacenId })[0].imagen_miniatura, png);
  assert.equal(inv().productosRapidos(db, { almacenId: ctx.almacenId }).find((p) => p.id === id).imagen_miniatura, png);

  // Reordenar (la segunda pasa a principal) conserva las filas: solo cambia el orden.
  const [a, b] = ficha.imagenes;
  h.tx(db, () => inv().guardarProducto(db, { codigoInterno: 'CAFE1', descripcion: 'Café molido', unidadMedidaBaseId: ctx.unidadId, tasaItbisId: ctx.tasaItbisId, precioDetalle: 118, imagenes: [{ id: b.id }, { id: a.id }] }, id));
  ficha = inv().obtenerProductoCompleto(db, id);
  assert.deepEqual(ficha.imagenes.map((f) => f.id), [b.id, a.id]);
  assert.equal(inv().listarProductos(db, { texto: 'CAFE1' })[0].imagen_miniatura, jpeg);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM productos_imagenes WHERE producto_id = ?').get(id).n, 2);

  // Quitar una: baja lógica, nunca DELETE.
  h.tx(db, () => inv().guardarProducto(db, { codigoInterno: 'CAFE1', descripcion: 'Café molido', unidadMedidaBaseId: ctx.unidadId, tasaItbisId: ctx.tasaItbisId, precioDetalle: 118, imagenes: [{ id: a.id }] }, id));
  assert.equal(inv().obtenerProductoCompleto(db, id).imagenes.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM productos_imagenes WHERE producto_id = ? AND deleted_at IS NOT NULL').get(id).n, 1);

  // Guardar sin el campo imagenes no toca las fotos.
  h.tx(db, () => inv().guardarProducto(db, { codigoInterno: 'CAFE1', descripcion: 'Café molido fino', unidadMedidaBaseId: ctx.unidadId, tasaItbisId: ctx.tasaItbisId, precioDetalle: 118 }, id));
  assert.equal(inv().obtenerProductoCompleto(db, id).imagenes.length, 1);
});

test('producto: sin foto la miniatura es null; valida tipo y máximo de 6', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const id = h.producto(db, ctx, { codigoInterno: 'SINF' });
  assert.equal(inv().listarProductos(db, { texto: 'SINF' })[0].imagen_miniatura, null);
  assert.throws(() => h.producto(db, ctx, { codigoInterno: 'MAL1', imagenes: [{ imagen: falso, miniatura: png }] }), /no es una imagen válida/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM productos WHERE codigo_interno = 'MAL1'").get().n, 0, 'la transacción se revierte');
  const siete = Array.from({ length: 7 }, () => ({ imagen: png, miniatura: png }));
  assert.throws(() => h.producto(db, ctx, { codigoInterno: 'MUCHAS', imagenes: siete }), /hasta 6 fotos/);
  assert.ok(id);
});

test('migración 017 es idempotente', () => {
  const db = h.nuevaBase();
  const mig = require('../main/db/migrations/017_imagenes');
  const columnasDe = (d, t) => new Set(d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  mig.up(db, { columnasDe });
  mig.up(db, { columnasDe });
  assert.ok(columnasDe(db, 'sucursales').has('imagen'));
  assert.ok(columnasDe(db, 'productos_imagenes').has('miniatura'));
});
