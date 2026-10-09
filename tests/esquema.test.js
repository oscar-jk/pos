// B1: esquema sync-ready en todas las tablas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { aplicarMigraciones } = require('../main/db/migrations');
const { TABLAS } = require('../main/db/migrations/011_columnas_sync');

const COLUMNAS = ['created_at', 'updated_at', 'deleted_at'];
const tablas = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
const columnas = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
function sinColumnas(db) {
  return tablas(db).flatMap((t) => COLUMNAS.filter((c) => !columnas(db, t).has(c)).map((c) => `${t}.${c}`));
}

test('B1: todas las tablas tienen created_at, updated_at y deleted_at (instalación nueva)', () => {
  assert.deepEqual(sinColumnas(h.nuevaBase()), []);
});

test('B1: migración 011 sobre una base existente: agrega, rellena y es idempotente', () => {
  const db = h.nuevaBase();
  h.loginComo(db);
  // Simula una base instalada antes de la 011: sin las columnas ni los triggers.
  for (const t of TABLAS) {
    db.exec(`DROP TRIGGER IF EXISTS trg_${t}_fechas`);
    for (const c of COLUMNAS) {
      if (t === 'bitacora_auditoria' && c === 'created_at') continue; // ya existían antes
      if (['kardex_movimientos', 'cxc_empleados_pagos', 'pagos_venta', 'recibos_ingreso_aplicaciones', 'pagos_proveedor_aplicaciones', 'movimientos_caja', 'migraciones_aplicadas'].includes(t) && c === 'created_at') continue;
      if (['parametros_negocio', 'existencias'].includes(t) && c === 'updated_at') continue;
      if (t === 'movimientos_caja' && c === 'deleted_at') continue;
      if (columnas(db, t).has(c)) {
        for (const idx of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql LIKE ?`).all(t, `%${c}%`)) db.exec(`DROP INDEX ${idx.name}`);
        db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
      }
    }
  }
  db.prepare("DELETE FROM migraciones_aplicadas WHERE id = '011_columnas_sync'").run();
  assert.notDeepEqual(sinColumnas(db), []);
  aplicarMigraciones(db);
  assert.deepEqual(sinColumnas(db), []);
  // Las filas que ya existían quedaron con fecha.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM unidades_medida WHERE created_at IS NULL OR updated_at IS NULL').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM parametros_negocio WHERE created_at IS NULL').get().n, 0);
  // Una fila nueva sin fechas las recibe del trigger.
  db.prepare("INSERT INTO unidades_medida (id, nombre, abreviatura) VALUES ('u-nueva', 'Galón', 'gal')").run();
  const fila = db.prepare("SELECT created_at, updated_at FROM unidades_medida WHERE id = 'u-nueva'").get();
  assert.ok(fila.created_at && fila.updated_at);
  aplicarMigraciones(db); // segunda vez no falla
  assert.deepEqual(sinColumnas(db), []);
});

test('B1: las operaciones normales siguen funcionando con las columnas nuevas', () => {
  const db = h.nuevaBase();
  const ctx = h.contexto(db);
  const p = h.producto(db, ctx);
  h.entrada(db, ctx, p, 5, 40);
  h.abrirTurno(db, ctx);
  h.facturar(db, ctx, [{ productoId: p, cantidad: 1 }], [{ formaPago: 'efectivo', monto: 118 }]);
  for (const t of ['kardex_movimientos', 'pagos_venta', 'movimientos_caja', 'asientos_contables_detalle', 'existencias', 'ajustes_inventario_detalle']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE created_at IS NULL OR updated_at IS NULL`).get().n, 0, t);
  }
  assert.ok(h.balanceCuadrado(db));
});
