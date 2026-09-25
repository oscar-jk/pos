const crypto = require('node:crypto');
const { BrowserWindow } = require('electron');

const session = require('../auth/session');
const ventas = require('../ipc/ventas');
const caja = require('../ipc/caja');
const configuracion = require('../ipc/configuracion');
const { plantillaFactura, plantillaTique, plantillaArqueoTurno, plantillaPrecuenta } = require('./plantillas');

const TIPOS_IMPRESORA = ['factura', 'tique', 'etiqueta'];

// =========================================================================
// Configuración de impresoras (tabla impresoras_config)
// =========================================================================

function deserializar(fila) {
  let config = {};
  try { config = fila.configuracion ? JSON.parse(fila.configuracion) : {}; } catch { config = {}; }
  return { ...fila, deviceName: config.deviceName || null, copias: config.copias || 1 };
}

function listarImpresoras(db) {
  return db.prepare('SELECT * FROM impresoras_config WHERE deleted_at IS NULL ORDER BY tipo, nombre').all().map(deserializar);
}

function guardarImpresora(db, { impresoraId, sucursalId, nombre, tipo, deviceName, copias, activo }, usuarioId) {
  session.requerirPermiso('configuracion.impresoras.gestionar');
  if (!nombre || !nombre.trim()) throw new Error('El nombre de la impresora es obligatorio');
  if (!TIPOS_IMPRESORA.includes(tipo)) throw new Error('Tipo de impresora inválido');
  const configuracionJson = JSON.stringify({ deviceName: deviceName || null, copias: Math.max(1, parseInt(copias, 10) || 1) });

  let id = impresoraId;
  if (id) {
    db.prepare(
      `UPDATE impresoras_config SET sucursal_id = ?, nombre = ?, tipo = ?, configuracion = ?, activo = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(sucursalId || null, nombre.trim(), tipo, configuracionJson, activo === false ? 0 : 1, id);
    configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'impresoras_config', entidadId: id, accion: 'editar', detalle: { nombre, tipo, deviceName } });
  } else {
    id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO impresoras_config (id, sucursal_id, nombre, tipo, configuracion, activo) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(id, sucursalId || null, nombre.trim(), tipo, configuracionJson);
    configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'impresoras_config', entidadId: id, accion: 'crear', detalle: { nombre, tipo, deviceName } });
  }
  return id;
}

function eliminarImpresora(db, { impresoraId }, usuarioId) {
  session.requerirPermiso('configuracion.impresoras.gestionar');
  db.prepare("UPDATE impresoras_config SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), activo = 0 WHERE id = ?").run(impresoraId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'impresoras_config', entidadId: impresoraId, accion: 'eliminar' });
}

function impresoraPorTipo(db, tipo) {
  const fila = db
    .prepare('SELECT * FROM impresoras_config WHERE tipo = ? AND activo = 1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1')
    .get(tipo);
  return fila ? deserializar(fila) : null;
}

function datosNegocio(db) {
  const d = configuracion.obtenerDatosNegocio(db);
  return { nombre: d.negocio_nombre, rnc: d.negocio_rnc, direccion: d.negocio_direccion, telefono: d.negocio_telefono };
}

// =========================================================================
// Impresión: carga el HTML en una ventana oculta y abre el diálogo nativo de impresión.
// silent:false a propósito — el usuario elige impresora o "Guardar como PDF" en el diálogo de
// Windows; la impresora configurada solo se preselecciona (deviceName), no se fuerza.
// =========================================================================

function imprimirHtml(html, impresora) {
  return new Promise((resolve, reject) => {
    const ventana = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    ventana.webContents.once('did-fail-load', (event, codigo, descripcion) => {
      ventana.destroy();
      reject(new Error(`No se pudo preparar el documento para imprimir: ${descripcion}`));
    });
    ventana.webContents.once('did-finish-load', () => {
      const opciones = { silent: false, printBackground: true, copies: impresora ? impresora.copias : 1 };
      if (impresora && impresora.deviceName) opciones.deviceName = impresora.deviceName;
      ventana.webContents.print(opciones, (exito, motivo) => {
        ventana.destroy();
        // "cancelled" = el usuario cerró el diálogo sin imprimir; no es un error del sistema.
        if (exito || motivo === 'cancelled') resolve({ impreso: exito, cancelado: motivo === 'cancelled' });
        else reject(new Error(`La impresión falló: ${motivo}`));
      });
    });
    ventana.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

function htmlFactura(db, documentoId, formato) {
  const factura = ventas.obtenerFactura(db, documentoId);
  if (!factura) throw new Error('Factura no encontrada');
  const negocio = datosNegocio(db);
  return formato === 'tique' ? plantillaTique(factura, negocio) : plantillaFactura(factura, negocio);
}

function htmlArqueo(db, turnoId) {
  const turno = db
    .prepare(
      `SELECT t.*, c.nombre AS caja_nombre, u.nombre_completo AS usuario_nombre
       FROM turnos_caja t JOIN cajas c ON c.id = t.caja_id LEFT JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.id = ?`
    )
    .get(turnoId);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'cerrado') throw new Error('Solo se puede imprimir el arqueo de un turno cerrado');
  const movimientos = caja.movimientosDeTurno(db, turnoId);
  return plantillaArqueoTurno(turno, movimientos, datosNegocio(db));
}

function htmlPrecuenta(db, cuentaId) {
  configuracion.exigirModulo(db, 'cuentas_abiertas');
  const cuenta = ventas.obtenerCuentaAbierta(db, cuentaId);
  if (!cuenta) throw new Error('Cuenta no encontrada');
  if (cuenta.lineas.length === 0) throw new Error('La cuenta no tiene productos');
  return plantillaPrecuenta(cuenta, datosNegocio(db));
}

// =========================================================================
// IPC
// =========================================================================

function register(ipcMain, getDb) {
  ipcMain.handle('impresion:listarImpresoras', () => listarImpresoras(getDb()));
  ipcMain.handle('impresion:guardarImpresora', (event, { payload, usuarioId }) => {
    const db = getDb();
    db.transaction(() => guardarImpresora(db, payload, usuarioId))();
    return listarImpresoras(db);
  });
  ipcMain.handle('impresion:eliminarImpresora', (event, { impresoraId, usuarioId }) => {
    const db = getDb();
    db.transaction(() => eliminarImpresora(db, { impresoraId }, usuarioId))();
    return listarImpresoras(db);
  });
  ipcMain.handle('impresion:listarDispositivos', async (event) => {
    const dispositivos = await event.sender.getPrintersAsync();
    return dispositivos.map((d) => ({ nombre: d.name, nombreVisible: d.displayName || d.name, esPredeterminada: Boolean(d.isDefault) }));
  });

  ipcMain.handle('impresion:imprimirFactura', async (event, { documentoId, formato }) => {
    session.requerirPermiso('ventas.factura.imprimir');
    const db = getDb();
    const tipo = formato === 'tique' ? 'tique' : 'factura';
    return imprimirHtml(htmlFactura(db, documentoId, tipo), impresoraPorTipo(db, tipo));
  });

  ipcMain.handle('impresion:imprimirPrecuenta', async (event, { cuentaId }) => {
    session.requerirAlgunPermiso('ventas.cuenta_abierta.gestionar', 'ventas.factura.imprimir');
    const db = getDb();
    return imprimirHtml(htmlPrecuenta(db, cuentaId), impresoraPorTipo(db, 'tique'));
  });

  ipcMain.handle('impresion:imprimirArqueo', async (event, { turnoId }) => {
    session.requerirPermiso('caja.tique.imprimir');
    const db = getDb();
    return imprimirHtml(htmlArqueo(db, turnoId), impresoraPorTipo(db, 'tique'));
  });
}

module.exports = { register, listarImpresoras, guardarImpresora, eliminarImpresora, htmlFactura, htmlArqueo, htmlPrecuenta };
