// Conciliación por cuenta bancaria: cada línea del libro de Bancos (1200) puede llevar la cuenta
// bancaria a la que pertenece. Las bases con una sola cuenta asignan todo su historial a ella;
// con varias, lo que no se sabe de cuál es queda sin asignar para que el usuario lo asigne al
// conciliar. Idempotente.
module.exports = {
  id: '014_cuenta_bancaria_en_asientos',
  up(db, { columnasDe }) {
    if (!columnasDe(db, 'asientos_contables_detalle').has('cuenta_bancaria_id')) {
      db.exec('ALTER TABLE asientos_contables_detalle ADD COLUMN cuenta_bancaria_id TEXT REFERENCES cuentas_bancarias(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_asiento_detalle_cuenta_bancaria ON asientos_contables_detalle(cuenta_bancaria_id)');

    const lineasBancos = `SELECT d.id FROM asientos_contables_detalle d JOIN cuentas_contables c ON c.id = d.cuenta_id
                          WHERE c.codigo = '1200' AND d.cuenta_bancaria_id IS NULL`;
    // Depósitos y retiros caja-banco: el documento sabe su cuenta.
    db.exec(`UPDATE asientos_contables_detalle SET cuenta_bancaria_id = (
               SELECT t.cuenta_bancaria_id FROM asientos_contables a JOIN transferencias_caja_banco t ON t.id = a.origen_documento_id
               WHERE a.id = asientos_contables_detalle.asiento_id AND a.origen_documento_tipo = 'transferencias_caja_banco')
             WHERE id IN (${lineasBancos})
               AND asiento_id IN (SELECT id FROM asientos_contables WHERE origen_documento_tipo = 'transferencias_caja_banco')`);
    // Con una sola cuenta activa, todo el historial es de ella.
    const cuentas = db.prepare('SELECT id FROM cuentas_bancarias WHERE deleted_at IS NULL AND activo = 1').all();
    if (cuentas.length === 1) {
      db.prepare(`UPDATE asientos_contables_detalle SET cuenta_bancaria_id = ? WHERE id IN (${lineasBancos})`).run(cuentas[0].id);
    }
  },
};
