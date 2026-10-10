// Sustituto de "electron" para las pruebas (sin ventanas). safeStorage cifra de forma reversible
// para que el certificado digital se pueda guardar y leer como en la aplicación.
module.exports = {
  app: { getPath: () => require('os').tmpdir() },
  dialog: {},
  BrowserWindow: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (texto) => Buffer.from(`prueba:${texto}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^prueba:/, ''),
  },
};
