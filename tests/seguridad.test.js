const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const auth = () => h.m('auth');
const { aplicarMigraciones } = require('../main/db/migrations');
const { protegerIpc } = require('../main/ipc/seguro');

// Base con producto, existencia y turno abierto, para probar una venta.
function base() {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 10, 50);
  h.abrirTurno(db, ctx);
  h.session.cerrarSesion();
  return { db, ctx, p };
}
const venta = (db, ctx, p) => h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);

test('A1: el admin del seed entra obligado a cambiar la contraseña', () => {
  const { db } = base();
  assert.equal(db.prepare("SELECT debe_cambiar_password d FROM usuarios WHERE usuario = 'admin'").get().d, 1);
  const sesion = h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'admin123' }));
  assert.equal(sesion.debeCambiarPassword, true);
});

test('A1: con la marca activa ninguna operación funciona (facturar)', () => {
  const { db, ctx, p } = base();
  h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'admin123' }));
  assert.throws(() => venta(db, ctx, p), /Debe cambiar su contraseña/);
  assert.equal(h.session.tienePermiso('ventas.factura.crear'), false);
});

test('A1: por IPC solo responden los canales auth:* mientras la marca esté activa', () => {
  const { db } = base();
  h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'admin123' }));
  const canales = new Map();
  const ipcFalso = { handle: (canal, fn) => canales.set(canal, fn) };
  const seguro = protegerIpc(ipcFalso);
  seguro.handle('ventas:listarFacturas', () => 'datos');
  seguro.handle('auth:sesionActual', () => 'sesion');
  assert.throws(() => canales.get('ventas:listarFacturas')({}, {}), /Debe cambiar su contraseña/);
  assert.equal(canales.get('auth:sesionActual')({}, {}), 'sesion');
});

test('A1: el cambio exige la contraseña actual, 8 caracteres y que sea distinta', () => {
  const { db } = base();
  h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'admin123' }));
  const cambiar = (actual, nueva) => h.tx(db, () => auth().cambiarPassword(db, { actual, nueva }));
  assert.throws(() => cambiar('otra', 'NuevaClave1'), /actual no es correcta/);
  assert.throws(() => cambiar('admin123', 'corta'), /al menos 8/);
  assert.throws(() => cambiar('admin123', 'admin123'), /distinta/);
  assert.equal(db.prepare("SELECT debe_cambiar_password d FROM usuarios WHERE usuario = 'admin'").get().d, 1);
});

test('A1: cambiada la contraseña se quita la marca y se puede facturar', () => {
  const { db, ctx, p } = base();
  h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'admin123' }));
  const sesion = h.tx(db, () => auth().cambiarPassword(db, { actual: 'admin123', nueva: 'ClaveSegura2026' }));
  assert.equal(sesion.debeCambiarPassword, false);
  assert.equal(db.prepare("SELECT debe_cambiar_password d FROM usuarios WHERE usuario = 'admin'").get().d, 0);
  venta(db, ctx, p);
  h.session.cerrarSesion();
  assert.throws(() => h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'admin123' })), /incorrectos/);
  assert.equal(h.tx(db, () => auth().login(db, { usuario: 'admin', password: 'ClaveSegura2026' })).debeCambiarPassword, false);
  assert.ok(db.prepare("SELECT 1 FROM bitacora_auditoria WHERE accion = 'cambiar_password'").get());
});

test('A1: la contraseña que pone el administrador obliga a cambiarla', () => {
  const { db } = base();
  h.loginComo(db);
  const id = h.usuarioDeRol(db, 'Cajero');
  assert.equal(db.prepare('SELECT debe_cambiar_password d FROM usuarios WHERE id = ?').get(id).d, 1);
  assert.throws(() => h.tx(db, () => h.m('configuracion').crearUsuario(db, { nombreCompleto: 'X', usuario: 'x1', password: 'corta1', rolId: db.prepare('SELECT rol_id FROM usuarios WHERE id = ?').get(id).rol_id })), /al menos 8/);
});

test('A1: migración 010 sobre una base existente (idempotente, solo admin con clave de fábrica)', () => {
  const db = h.nuevaBase();
  // Simula una base instalada antes de la 010.
  db.exec('ALTER TABLE usuarios DROP COLUMN debe_cambiar_password');
  db.prepare("DELETE FROM migraciones_aplicadas WHERE id = '010_cambio_password'").run();
  aplicarMigraciones(db);
  assert.equal(db.prepare("SELECT debe_cambiar_password d FROM usuarios WHERE usuario = 'admin'").get().d, 1);
  aplicarMigraciones(db); // segunda vez: no falla ni duplica
  // Un admin que ya cambió su clave no queda obligado.
  const otra = h.nuevaBase();
  otra.exec('ALTER TABLE usuarios DROP COLUMN debe_cambiar_password');
  otra.prepare("DELETE FROM migraciones_aplicadas WHERE id = '010_cambio_password'").run();
  otra.prepare("UPDATE usuarios SET password_hash = ? WHERE usuario = 'admin'").run(require('../main/auth/password').hashPassword('YaLaCambie1'));
  aplicarMigraciones(otra);
  assert.equal(otra.prepare("SELECT debe_cambiar_password d FROM usuarios WHERE usuario = 'admin'").get().d, 0);
});

// --- A3: permisos de la sesión al editar roles ---
const { sincronizarPermisosFaltantes } = require('../main/db/seed');
const idsPermisos = (db, rolId) => db.prepare('SELECT permiso_id FROM roles_permisos WHERE rol_id = ? AND deleted_at IS NULL').all(rolId).map((r) => r.permiso_id);
const idPermiso = (db, codigo) => db.prepare('SELECT id FROM permisos WHERE codigo = ?').get(codigo).id;

test('A3: quitar un permiso al rol del usuario conectado lo bloquea al instante', () => {
  const { db } = base();
  const admin = h.loginComo(db);
  const cotizar = () => h.tx(db, () => h.m('ventas').crearCotizacion(db, {
    sucursalId: db.prepare('SELECT id FROM sucursales').get().id, almacenId: db.prepare('SELECT id FROM almacenes').get().id,
    usuarioId: admin.id, nivelPrecio: 'detalle', lineas: [{ productoId: db.prepare('SELECT id FROM productos').get().id, cantidad: 1 }],
  }));
  cotizar();
  const sinCotizar = idsPermisos(db, admin.rol_id).filter((id) => id !== idPermiso(db, 'ventas.cotizacion.crear'));
  h.tx(db, () => h.m('configuracion').actualizarPermisosRol(db, admin.rol_id, sinCotizar, admin.id));
  assert.equal(h.session.tienePermiso('ventas.cotizacion.crear'), false);
  assert.throws(cotizar, /no tiene permiso/);
});

test('A3: editar otro rol no cambia los permisos de la sesión', () => {
  const { db } = base();
  const admin = h.loginComo(db);
  const cajero = db.prepare("SELECT id FROM roles WHERE nombre LIKE '%Cajero%'").get().id;
  const antes = h.session.obtenerSesion().permisos.size;
  h.tx(db, () => h.m('configuracion').actualizarPermisosRol(db, cajero, [], admin.id));
  assert.equal(h.session.obtenerSesion().permisos.size, antes);
});

test('A3: nadie puede quitarle a su propio rol el permiso de configuración', () => {
  const { db } = base();
  const admin = h.loginComo(db);
  const sinConfig = idsPermisos(db, admin.rol_id).filter((id) => id !== idPermiso(db, 'configuracion.gestionar'));
  assert.throws(() => h.tx(db, () => h.m('configuracion').actualizarPermisosRol(db, admin.rol_id, sinConfig, admin.id)), /propio rol/);
});

test('A3: cambiar el rol del usuario conectado aplica los permisos del nuevo rol', () => {
  const { db } = base();
  const admin = h.loginComo(db);
  const cajero = db.prepare("SELECT id FROM roles WHERE nombre LIKE '%Cajero%'").get().id;
  h.tx(db, () => h.m('configuracion').actualizarUsuario(db, admin.id, { nombreCompleto: 'Administrador', rolId: cajero }, admin.id));
  assert.equal(h.session.obtenerSesion().rolId, cajero);
  assert.equal(h.session.tienePermiso('configuracion.gestionar'), false);
});

test('A3: al reiniciar no se devuelven los permisos que el administrador quitó', () => {
  const db = h.nuevaBase();
  const admin = h.loginComo(db);
  const cajero = db.prepare("SELECT id FROM roles WHERE nombre LIKE '%Cajero%'").get().id;
  const descuento = idPermiso(db, 'ventas.descuento.aplicar');
  assert.ok(idsPermisos(db, cajero).includes(descuento));
  h.tx(db, () => h.m('configuracion').actualizarPermisosRol(db, cajero, idsPermisos(db, cajero).filter((id) => id !== descuento), admin.id));
  sincronizarPermisosFaltantes(db); // lo que hace cada arranque
  assert.equal(idsPermisos(db, cajero).includes(descuento), false);
  // Un permiso nuevo de una versión posterior sí se agrega.
  db.prepare("DELETE FROM roles_permisos WHERE permiso_id = (SELECT id FROM permisos WHERE codigo = 'ventas.pedido.crear')").run();
  db.prepare("DELETE FROM permisos WHERE codigo = 'ventas.pedido.crear'").run();
  sincronizarPermisosFaltantes(db);
  assert.ok(idsPermisos(db, cajero).includes(idPermiso(db, 'ventas.pedido.crear')));
});
