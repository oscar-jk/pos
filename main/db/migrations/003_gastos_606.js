// Datos fiscales del gasto de caja chica, para reportarlo en el Formato 606 de la DGII:
// RNC/cédula y NCF del suplidor, tipo de bienes y servicios (01–11), ITBIS facturado, y si el
// monto es de bienes o de servicios (columnas separadas en el 606).
module.exports = {
  id: '003_gastos_606',
  up(db, { columnasDe }) {
    const existentes = columnasDe(db, 'gastos_caja_chica');
    const columnas = [
      ['rnc_suplidor', 'TEXT'],
      ['ncf', 'TEXT'],
      ['tipo_bienes_servicios', 'TEXT'],
      ['itbis_facturado', 'REAL NOT NULL DEFAULT 0'],
      ['clase_monto', "TEXT NOT NULL DEFAULT 'bienes'"],
    ];
    for (const [nombre, definicion] of columnas) {
      if (!existentes.has(nombre)) db.exec(`ALTER TABLE gastos_caja_chica ADD COLUMN ${nombre} ${definicion}`);
    }
  },
};
