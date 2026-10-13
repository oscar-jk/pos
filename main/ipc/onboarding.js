// Asistente de configuración inicial. Reúne en un solo recorrido lo que un negocio nuevo debe
// dejar listo antes de vender: datos y logo, comprobantes (rangos de NCF), sucursal, módulos y
// primer equipo. No inventa reglas fiscales: los rangos de NCF los fija quien configura (son los
// autorizados por la DGII) y la facturación electrónica solo se orienta, no se activa aquí
// porque exige certificado y secuencias validados en su propia pantalla.
const session = require('../auth/session');
const configuracion = require('./configuracion');

const ahora = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function parametro(db, clave) {
  const fila = db.prepare('SELECT valor FROM parametros_negocio WHERE clave = ?').get(clave);
  return fila ? fila.valor : null;
}

function guardarParametro(db, clave, valor, descripcion) {
  db.prepare(
    `INSERT INTO parametros_negocio (clave, valor, descripcion, updated_at) VALUES (?, ?, ?, ${ahora})
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at`
  ).run(clave, valor, descripcion);
}

// Una base nueva nace con onboarding_completado = '0'. Una base anterior al asistente no tiene
// el parámetro: ya está en uso, así que no se le impone el recorrido.
function estadoOnboarding(db) {
  const valor = parametro(db, 'onboarding_completado');
  return {
    pendiente: valor === '0',
    completado: valor !== '0',
    omitido: parametro(db, 'onboarding_omitido') === '1',
  };
}

function soloDigitos(s) { return String(s || '').replace(/\D/g, ''); }

function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  const letras = (palabras.length > 1 ? palabras.slice(0, 2).map((p) => p[0]) : [...(palabras[0] || 'MN')].slice(0, 2)).join('');
  return letras.toUpperCase();
}

function datosAsistente(db) {
  session.requerirPermiso('configuracion.gestionar');
  const tiposNcf = db.prepare('SELECT * FROM tipos_ncf WHERE deleted_at IS NULL ORDER BY codigo').all()
    .map((t) => ({ ...t, emitidos: t.secuencia_actual > t.secuencia_desde }));
  const sucursal = db.prepare('SELECT id, nombre FROM sucursales WHERE es_principal = 1 AND deleted_at IS NULL').get() || null;
  return {
    estado: estadoOnboarding(db),
    negocio: configuracion.obtenerDatosNegocio(db),
    tiposNcf,
    modulos: configuracion.listarModulos(db),
    sucursal,
    roles: db.prepare('SELECT id, nombre FROM roles WHERE deleted_at IS NULL ORDER BY nombre').all(),
    usuarios: configuracion.listarUsuarios(db),
    facturacionElectronica: db.prepare("SELECT valor FROM parametros_negocio WHERE clave = 'ecf_modo'").get()?.valor || 'tradicional',
  };
}

function guardarNegocio(db, { nombre, iniciales, rnc, razonSocial, direccion, telefono }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  const nombreLimpio = String(nombre || '').trim();
  if (!nombreLimpio) throw new Error('Escribe el nombre del negocio');
  const rncLimpio = soloDigitos(rnc);
  if (rncLimpio && rncLimpio.length !== 9 && rncLimpio.length !== 11) throw new Error('El RNC debe tener 9 dígitos (o 11 si es una cédula)');
  const inicialesLimpias = String(iniciales || '').trim().toUpperCase().slice(0, 3) || inicialesDe(nombreLimpio);
  const actual = configuracion.obtenerDatosNegocio(db);
  configuracion.actualizarDatosNegocio(db, {
    nombre: nombreLimpio, iniciales: inicialesLimpias, colorAcento: actual.negocio_color_acento || '#0A6B68',
    rnc: rncLimpio, razonSocial: String(razonSocial || '').trim(), direccion: String(direccion || '').trim(), telefono: String(telefono || '').trim(),
  }, usuarioId);
}

// Fija el rango autorizado de un tipo de NCF. Solo mientras no se haya emitido ninguno de ese
// tipo: con comprobantes emitidos el rango solo se amplía (Configuración → Parámetros fiscales).
function configurarSecuenciaNcf(db, { tipoNcfId, desde, hasta, activo }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  const tipo = db.prepare('SELECT * FROM tipos_ncf WHERE id = ? AND deleted_at IS NULL').get(tipoNcfId);
  if (!tipo) throw new Error('Tipo de comprobante no encontrado');
  if (tipo.secuencia_actual > tipo.secuencia_desde) {
    throw new Error(`Ya se emitieron ${tipo.codigo}. Para ampliar el rango usa Configuración → Parámetros fiscales`);
  }
  const d = Number(desde);
  const h = Number(hasta);
  if (!Number.isInteger(d) || !Number.isInteger(h) || d < 1) throw new Error(`${tipo.codigo}: el rango debe ser de números enteros desde 1`);
  if (h < d) throw new Error(`${tipo.codigo}: el número final no puede ser menor al inicial`);
  if (h > 99999999) throw new Error(`${tipo.codigo}: el rango máximo es 99,999,999`);
  db.prepare(`UPDATE tipos_ncf SET secuencia_desde = ?, secuencia_hasta = ?, secuencia_actual = ?, activo = ?, updated_at = ${ahora} WHERE id = ?`)
    .run(d, h, d, activo === false ? 0 : 1, tipoNcfId);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'tipos_ncf', entidadId: tipoNcfId, accion: 'editar', detalle: { codigo: tipo.codigo, desde: d, hasta: h, activo: activo !== false, via: 'asistente' } });
}

function guardarSucursalPrincipal(db, { nombre }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  const limpio = String(nombre || '').trim();
  if (!limpio) throw new Error('Escribe el nombre de la sucursal');
  const sucursal = db.prepare('SELECT id FROM sucursales WHERE es_principal = 1 AND deleted_at IS NULL').get();
  if (!sucursal) throw new Error('No hay sucursal principal');
  db.prepare(`UPDATE sucursales SET nombre = ?, updated_at = ${ahora} WHERE id = ?`).run(limpio, sucursal.id);
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'sucursales', entidadId: sucursal.id, accion: 'editar', detalle: { nombre: limpio, via: 'asistente' } });
}

function finalizar(db, { omitido }, usuarioId) {
  session.requerirPermiso('configuracion.gestionar');
  guardarParametro(db, 'onboarding_completado', '1', 'Asistente de configuración inicial terminado');
  guardarParametro(db, 'onboarding_omitido', omitido ? '1' : '0', 'El asistente se omitió sin terminarlo');
  configuracion.registrarAuditoria(db, { usuarioId, modulo: 'configuracion', entidad: 'parametros_negocio', entidadId: 'onboarding', accion: omitido ? 'omitir' : 'completar' });
}

function register(ipcMain, getDb) {
  const escribir = (fn) => (event, payload = {}) => {
    const db = getDb();
    db.transaction(() => fn(db, payload, payload.usuarioId))();
    return datosAsistente(db);
  };
  ipcMain.handle('onboarding:datos', () => datosAsistente(getDb()));
  ipcMain.handle('onboarding:guardarNegocio', escribir(guardarNegocio));
  ipcMain.handle('onboarding:configurarNcf', escribir(configurarSecuenciaNcf));
  ipcMain.handle('onboarding:guardarSucursal', escribir(guardarSucursalPrincipal));
  ipcMain.handle('onboarding:finalizar', escribir(finalizar));
}

module.exports = { register, estadoOnboarding, datosAsistente, guardarNegocio, configurarSecuenciaNcf, guardarSucursalPrincipal, finalizar, inicialesDe };
