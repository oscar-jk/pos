// Cambio obligatorio de contraseña: usuarios.debe_cambiar_password. En una base existente se
// activa solo para el admin que todavía tiene la contraseña de fábrica (admin123); a quien ya
// la cambió no se le obliga otra vez.
const { verifyPassword } = require('../../auth/password');

module.exports = {
  id: '010_cambio_password',
  up(db, { columnasDe }) {
    if (!columnasDe(db, 'usuarios').has('debe_cambiar_password')) {
      db.exec('ALTER TABLE usuarios ADD COLUMN debe_cambiar_password INTEGER NOT NULL DEFAULT 0');
    }
    const admin = db.prepare("SELECT id, password_hash FROM usuarios WHERE usuario = 'admin' AND deleted_at IS NULL").get();
    if (admin && verifyPassword('admin123', admin.password_hash)) {
      db.prepare('UPDATE usuarios SET debe_cambiar_password = 1 WHERE id = ?').run(admin.id);
    }
  },
};
