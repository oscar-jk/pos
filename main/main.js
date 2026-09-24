const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { getDb } = require('./db');
const session = require('./auth/session');
const authIpc = require('./ipc/auth');
const inventarioIpc = require('./ipc/inventario');
const cxcIpc = require('./ipc/cxc');
const cajaIpc = require('./ipc/caja');
const contabilidadIpc = require('./ipc/contabilidad');
const ventasIpc = require('./ipc/ventas');
const comprasIpc = require('./ipc/compras');
const cxpIpc = require('./ipc/cxp');
const configuracionIpc = require('./ipc/configuracion');

let mainWindow = null;

function registerCoreIpc() {
  ipcMain.handle('app:info', () => {
    const db = getDb();

    const sucursal = db.prepare('SELECT id, nombre FROM sucursales WHERE es_principal = 1').get();
    const almacen = db.prepare('SELECT id, nombre FROM almacenes WHERE deleted_at IS NULL LIMIT 1').get();
    const cajaPrincipal = db.prepare('SELECT id, nombre FROM cajas WHERE deleted_at IS NULL LIMIT 1').get();
    const monedaLocal = db.prepare('SELECT id, codigo FROM monedas WHERE es_local = 1').get();

    const parametros = db
      .prepare("SELECT clave, valor FROM parametros_negocio WHERE clave LIKE 'negocio_%'")
      .all();
    const negocio = {};
    for (const { clave, valor } of parametros) {
      if (clave === 'negocio_nombre') negocio.nombre = valor;
      if (clave === 'negocio_iniciales') negocio.iniciales = valor;
      if (clave === 'negocio_color_acento') negocio.colorAcento = valor;
    }

    const sesion = session.obtenerSesion();
    const usuario = sesion
      ? { id: sesion.usuarioId, nombreCompleto: sesion.nombreCompleto, rolId: sesion.rolId, rol: sesion.rolNombre, permisos: Array.from(sesion.permisos) }
      : null;

    return {
      version: app.getVersion(),
      sucursal: sucursal ? sucursal.nombre : null,
      sucursalId: sucursal ? sucursal.id : null,
      almacenId: almacen ? almacen.id : null,
      cajaId: cajaPrincipal ? cajaPrincipal.id : null,
      monedaId: monedaLocal ? monedaLocal.id : null,
      negocio,
      usuario,
    };
  });

  authIpc.register(ipcMain, getDb);
  inventarioIpc.register(ipcMain, getDb);
  cxcIpc.register(ipcMain, getDb);
  cajaIpc.register(ipcMain, getDb);
  contabilidadIpc.register(ipcMain, getDb);
  ventasIpc.register(ipcMain, getDb);
  comprasIpc.register(ipcMain, getDb);
  cxpIpc.register(ipcMain, getDb);
  configuracionIpc.register(ipcMain, getDb);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0F3D34',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login', 'index.html'));
  mainWindow.maximize();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  getDb(); // asegura que el esquema y los datos semilla existan antes de abrir ventana
  registerCoreIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    session.cerrarSesion();
    app.quit();
  }
});
