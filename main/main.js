const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { protegerIpc } = require('./ipc/seguro');

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
const impresion = require('./printing');
const ecfIpc = require('./ipc/ecf');
const colaEcf = require('./ecf/cola');
const ecfEmision = require('./ecf/emision');

let mainWindow = null;

function registerCoreIpc() {
  const ipcSeguro = protegerIpc(ipcMain);
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
      ? {
        id: sesion.usuarioId, nombreCompleto: sesion.nombreCompleto, rolId: sesion.rolId, rol: sesion.rolNombre,
        permisos: Array.from(sesion.permisos), debeCambiarPassword: Boolean(sesion.debeCambiarPassword),
      }
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
      modulos: configuracionIpc.modulosActivos(db),
      // Comprobantes que emite la caja: e-CF (E31, E32...) o NCF serie B (tradicional o contingencia).
      fiscal: { modo: ecfEmision.modoEcf(db), contingencia: Boolean(ecfEmision.contingenciaDesde(db)), emiteEcf: ecfEmision.usaEcf(db) },
    };
  });

  authIpc.register(ipcSeguro, getDb);
  inventarioIpc.register(ipcSeguro, getDb);
  cxcIpc.register(ipcSeguro, getDb);
  cajaIpc.register(ipcSeguro, getDb);
  contabilidadIpc.register(ipcSeguro, getDb);
  ventasIpc.register(ipcSeguro, getDb);
  comprasIpc.register(ipcSeguro, getDb);
  cxpIpc.register(ipcSeguro, getDb);
  configuracionIpc.register(ipcSeguro, getDb);
  impresion.register(ipcSeguro, getDb);
  ecfIpc.register(ipcSeguro, getDb);
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
  // e-CF firmados pendientes: se envían a la DGII en segundo plano cuando hay conexión.
  colaEcf.iniciar(getDb);
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
    colaEcf.detener();
    app.quit();
  }
});
