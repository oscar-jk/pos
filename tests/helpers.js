// Arnés de pruebas: base SQLite en memoria con el mismo arranque que main/db/index.js
// (schema → migraciones → seed → permisos), sin Electron.
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) {
  if (req === 'electron') return path.join(__dirname, 'electron-stub.js');
  return origResolve.call(this, req, ...a);
};
const Database = require('better-sqlite3');
const root = path.join(__dirname, '..');
const { seed, sincronizarPermisosFaltantes } = require(path.join(root, 'main/db/seed'));
const { aplicarMigraciones } = require(path.join(root, 'main/db/migrations'));
const session = require(path.join(root, 'main/auth/session'));
const m = (n) => require(path.join(root, 'main/ipc', n));

// Todas las bases que crea una suite: al terminar la suite se les revisan las invariantes.
const basesCreadas = [];

function nuevaBase() {
  const db = new Database(':memory:');
  // Para el reporte: la línea de la prueba que creó la base.
  const linea = new Error().stack.split('\n').filter((l) => /\.test\.js:\d+/.test(l)).pop() || '';
  db.origen = (linea.match(/[\w-]+\.test\.js:\d+/) || ['?'])[0];
  basesCreadas.push(db);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(root, 'main/db/schema.sql'), 'utf8'));
  aplicarMigraciones(db);
  seed(db);
  sincronizarPermisosFaltantes(db);
  return db;
}

function loginComo(db, rolNombreLike = 'Admin') {
  const u = db.prepare(`SELECT u.*, r.nombre rn FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre LIKE ?`).get(`%${rolNombreLike}%`)
    || db.prepare(`SELECT u.*, r.nombre rn FROM usuarios u JOIN roles r ON r.id=u.rol_id`).get();
  const permisos = db.prepare(`SELECT p.codigo FROM roles_permisos rp JOIN permisos p ON p.id=rp.permiso_id WHERE rp.rol_id=? AND rp.deleted_at IS NULL`).all(u.rol_id).map((r) => r.codigo);
  session.iniciarSesion({ usuarioId: u.id, nombreCompleto: u.nombre_completo, usuario: u.usuario, rolId: u.rol_id, rolNombre: u.rn, permisos: new Set(permisos) });
  return u;
}

function contexto(db) {
  const u = loginComo(db);
  const ids = {
    usuarioId: u.id,
    sucursalId: db.prepare('SELECT id FROM sucursales').get().id,
    almacenId: db.prepare('SELECT id FROM almacenes').get().id,
    cajaId: db.prepare('SELECT id FROM cajas').get().id,
    tasaItbisId: db.prepare('SELECT id FROM tasas_itbis WHERE es_default=1').get().id,
    unidadId: db.prepare('SELECT id FROM unidades_medida').get().id,
  };
  return ids;
}

const tx = (db, fn) => db.transaction(fn)();

function producto(db, ctx, over = {}) {
  const inv = m('inventario');
  const codigo = over.codigoInterno || 'P' + Math.random().toString(36).slice(2, 8);
  const r = tx(db, () => inv.guardarProducto(db, {
    codigoInterno: codigo, descripcion: 'Prod ' + codigo, unidadMedidaBaseId: ctx.unidadId,
    tasaItbisId: ctx.tasaItbisId, precioDetalle: 118, metodoValoracion: 'promedio_ponderado', ...over,
  }));
  return typeof r === 'string' ? r : (r && r.id) || db.prepare('SELECT id FROM productos WHERE codigo_interno=?').get(codigo).id;
}

function entrada(db, ctx, productoId, cantidad, costo, extra = {}) {
  return tx(db, () => m('inventario').crearAjuste(db, {
    almacenId: ctx.almacenId, tipo: 'entrada', motivo: 'Inventario inicial', usuarioId: ctx.usuarioId,
    lineas: [{ productoId, cantidad, costoUnitario: costo, ...extra }],
  }));
}

function abrirTurno(db, ctx, fondo = 1000) {
  return tx(db, () => m('caja').abrirTurno(db, { cajaId: ctx.cajaId, fondoInicial: fondo, usuarioId: ctx.usuarioId }));
}

function facturar(db, ctx, lineas, pagos, extra = {}) {
  return tx(db, () => m('ventas').crearFactura(db, {
    modoVenta: 'rapida', sucursalId: ctx.sucursalId, almacenId: ctx.almacenId, cajaId: ctx.cajaId,
    usuarioId: ctx.usuarioId, condicionPago: 'contado', nivelPrecio: 'detalle', lineas, pagos, ...extra,
  }));
}

function cliente(db, ctx, over = {}) {
  const r = tx(db, () => m('cxc').guardarCliente(db, {
    nombre: 'Cliente ' + Math.random().toString(36).slice(2, 6), rncCedula: '00100000001', limiteCredito: 100000, diasCredito: 30, ...over,
  }));
  return typeof r === 'string' ? r : r.id;
}

// Suma de saldos por cuenta contable (debe - haber), solo asientos confirmados.
function saldoCuenta(db, codigo) {
  return Math.round(db.prepare(`SELECT COALESCE(SUM(d.debe-d.haber),0) s FROM asientos_contables_detalle d
    JOIN asientos_contables a ON a.id=d.asiento_id JOIN cuentas_contables c ON c.id=d.cuenta_id
    WHERE c.codigo=? AND a.estado='confirmado'`).get(codigo).s * 100) / 100;
}
function existencia(db, ctx, productoId) {
  const r = db.prepare('SELECT cantidad_disponible cantidad FROM existencias WHERE producto_id=? AND almacen_id=?').get(productoId, ctx.almacenId);
  return r ? r.cantidad : 0;
}
// Valor del inventario en capas/promedio vs saldo contable 1300.
function balanceCuadrado(db) {
  const r = db.prepare(`SELECT ROUND(SUM(d.debe),2) d, ROUND(SUM(d.haber),2) h FROM asientos_contables_detalle d JOIN asientos_contables a ON a.id=d.asiento_id`).get();
  return Math.abs((r.d || 0) - (r.h || 0)) < 0.01;
}

function usuarioDeRol(db, rolLike) {
  const rol = db.prepare('SELECT id FROM roles WHERE nombre LIKE ?').get(`%${rolLike}%`);
  const usuario = 'u_' + Math.random().toString(36).slice(2, 7);
  tx(db, () => m('configuracion').crearUsuario(db, { nombreCompleto: usuario, usuario, password: 'secreto1', rolId: rol.id,
    sucursalId: db.prepare('SELECT id FROM sucursales').get().id }));
  return db.prepare('SELECT id FROM usuarios WHERE usuario=?').get(usuario).id;
}
function loginUsuario(db, usuarioId) {
  const u = db.prepare('SELECT u.*, r.nombre rn FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=?').get(usuarioId);
  const permisos = db.prepare('SELECT p.codigo FROM roles_permisos rp JOIN permisos p ON p.id=rp.permiso_id WHERE rp.rol_id=? AND rp.deleted_at IS NULL').all(u.rol_id).map((r) => r.codigo);
  session.iniciarSesion({ usuarioId: u.id, nombreCompleto: u.nombre_completo, usuario: u.usuario, rolId: u.rol_id, rolNombre: u.rn, permisos: new Set(permisos) });
}

// =========================================================================
// B3: invariantes contables globales. Se revisan sobre cada base creada en la suite, al final.
// =========================================================================

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const TOLERANCIA = 0.02;

function valorInventario(db) {
  const inv = m('inventario');
  return db.prepare('SELECT * FROM productos WHERE es_kit = 0 AND deleted_at IS NULL').all().reduce((total, p) => {
    if (inv.metodoValoracion(db, p) === 'peps') {
      return total + db.prepare('SELECT COALESCE(SUM(cantidad * costo_unitario), 0) v FROM lotes WHERE producto_id = ? AND deleted_at IS NULL AND cantidad > 0').get(p.id).v;
    }
    const existencia = db.prepare('SELECT COALESCE(SUM(cantidad_disponible), 0) t FROM existencias WHERE producto_id = ?').get(p.id).t;
    return total + existencia * (p.costo_promedio || 0);
  }, 0);
}

function invariantes(db) {
  const fallas = [];
  const sumas = db.prepare(`SELECT COALESCE(SUM(d.debe), 0) d, COALESCE(SUM(d.haber), 0) h FROM asientos_contables_detalle d
    JOIN asientos_contables a ON a.id = d.asiento_id WHERE a.estado = 'confirmado'`).get();
  if (Math.abs(sumas.d - sumas.h) > TOLERANCIA) fallas.push(`debe ${r2(sumas.d)} ≠ haber ${r2(sumas.h)}`);

  const inventario = r2(valorInventario(db));
  if (Math.abs(saldoCuenta(db, '1300') - inventario) > TOLERANCIA) fallas.push(`1300 = ${saldoCuenta(db, '1300')} pero el inventario vale ${inventario}`);

  const cxc = m('cxc');
  const clientes = r2(db.prepare('SELECT id FROM clientes WHERE deleted_at IS NULL').all().reduce((a, c) => a + cxc.saldoPendienteCliente(db, c.id), 0));
  if (Math.abs(saldoCuenta(db, '1400') - clientes) > TOLERANCIA) fallas.push(`1400 = ${saldoCuenta(db, '1400')} pero los clientes deben ${clientes}`);

  for (const t of db.prepare('SELECT * FROM turnos_caja').all()) {
    const movimientos = db.prepare('SELECT COALESCE(SUM(monto), 0) s FROM movimientos_caja WHERE turno_caja_id = ? AND deleted_at IS NULL').get(t.id).s;
    const esperado = r2(t.fondo_inicial + movimientos);
    const registrado = t.estado === 'abierto' ? m('caja').efectivoEsperado(db, t) : t.efectivo_esperado;
    if (Math.abs(registrado - esperado) > TOLERANCIA) fallas.push(`turno ${t.estado} ${t.id.slice(0, 8)}: efectivo ${registrado} ≠ fondo + movimientos ${esperado}`);
  }
  return fallas;
}

// Se registra una vez por suite (cada archivo de prueba corre en su propio proceso).
const { after } = require('node:test');
after(() => {
  const fallas = basesCreadas.flatMap((db, i) => {
    if (!db.open) return [];
    try { return invariantes(db).map((f) => `base ${i + 1} (${db.origen}): ${f}`); } catch (e) { return [`base ${i + 1}: no se pudo revisar (${e.message})`]; }
  });
  if (fallas.length) throw new Error('Invariantes contables rotas:\n' + fallas.join('\n'));
});

module.exports = { invariantes, valorInventario, usuarioDeRol, loginUsuario, nuevaBase, contexto, loginComo, m, tx, producto, entrada, abrirTurno, facturar, cliente, saldoCuenta, existencia, balanceCuadrado, session };
