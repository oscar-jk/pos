// Notas de crédito/débito de compra (devolución a proveedor y ajuste de costo).
// documentos_compra: tipo_ajuste (devolucion | ajuste_costo) y concepto (motivo de la nota).
// documentos_compra_detalle: la línea de la factura a la que se refiere cada línea de la nota,
// su base imponible (una línea de ajuste de costo no tiene cantidad × costo), y cuánto del
// ajuste fue a Inventario y cuánto a Costo de Ventas (para poder revertirlo exacto al anular).
module.exports = {
  id: '002_notas_compra',
  up(db, { columnasDe }) {
    const agregar = (tabla, columnas) => {
      const existentes = columnasDe(db, tabla);
      for (const [nombre, definicion] of columnas) {
        if (!existentes.has(nombre)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${definicion}`);
      }
    };
    agregar('documentos_compra', [
      ['tipo_ajuste', 'TEXT'],
      ['concepto', 'TEXT'],
    ]);
    agregar('documentos_compra_detalle', [
      ['detalle_referencia_id', 'TEXT REFERENCES documentos_compra_detalle(id)'],
      ['base_imponible', 'REAL'],
      ['monto_inventario', 'REAL'],
      ['monto_costo_ventas', 'REAL'],
    ]);
    db.exec('CREATE INDEX IF NOT EXISTS idx_doccompra_detalle_referencia ON documentos_compra_detalle(detalle_referencia_id)');
  },
};
