// Conciliación bancaria: cada partida del extracto se enlaza a la línea del libro (cuenta
// Bancos) con la que se concilia, o al asiento que la registró si era un cargo/crédito del banco
// que no estaba en el sistema. Además la tabla no tenía las columnas sync-ready.
// SQLite no permite ADD COLUMN con un default no constante (strftime), por eso created_at y
// updated_at se agregan sin default y el código siempre los llena al insertar.
module.exports = {
  id: '001_conciliacion_bancaria',
  up(db, { columnasDe }) {
    const columnas = columnasDe(db, 'conciliaciones_bancarias_detalle');
    const agregar = [
      ['asiento_detalle_id', 'TEXT REFERENCES asientos_contables_detalle(id)'],
      ['asiento_id', 'TEXT REFERENCES asientos_contables(id)'],
      ['created_at', 'TEXT'],
      ['updated_at', 'TEXT'],
      ['deleted_at', 'TEXT'],
    ];
    for (const [nombre, definicion] of agregar) {
      if (!columnas.has(nombre)) db.exec(`ALTER TABLE conciliaciones_bancarias_detalle ADD COLUMN ${nombre} ${definicion}`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_conciliacion_detalle_asiento ON conciliaciones_bancarias_detalle(asiento_detalle_id)');

    const columnasConciliacion = columnasDe(db, 'conciliaciones_bancarias');
    if (!columnasConciliacion.has('fecha_conciliada')) db.exec('ALTER TABLE conciliaciones_bancarias ADD COLUMN fecha_conciliada TEXT');
  },
};
