// Retenciones al cobrar (Módulo 4): lo que el cliente agente de retención retuvo al pagar.
// El recibo salda las facturas con el dinero recibido más lo retenido.
module.exports = {
  id: '007_retenciones_cobro',
  up(db, { columnasDe }) {
    const columnas = columnasDe(db, 'recibos_ingreso');
    if (!columnas.has('retencion_isr')) db.exec('ALTER TABLE recibos_ingreso ADD COLUMN retencion_isr REAL NOT NULL DEFAULT 0');
    if (!columnas.has('retencion_itbis')) db.exec('ALTER TABLE recibos_ingreso ADD COLUMN retencion_itbis REAL NOT NULL DEFAULT 0');
  },
};
