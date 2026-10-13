// Acceso por módulo a nivel de canal IPC. Cada función de escritura ya exige su permiso exacto;
// esto cubre las lecturas de los módulos que un rol no debe ver (un cajero no consulta la
// contabilidad, las compras ni lo que se debe a proveedores), aunque la pantalla ya los oculte.
// Un canal de esos módulos exige al menos un permiso de alguno de los prefijos indicados.
const REGLAS = [
  ['contabilidad:', ['contabilidad.']],
  ['compras:', ['compras.', 'cxp.']],
  ['cxp:', ['cxp.', 'compras.pago.aprobar']],
];

const MENSAJE = {
  'contabilidad:': 'No tienes acceso a Contabilidad',
  'compras:': 'No tienes acceso a Compras',
  'cxp:': 'No tienes acceso a Cuentas por Pagar',
};

function prefijosRequeridos(canal) {
  const regla = REGLAS.find(([prefijo]) => canal.startsWith(prefijo));
  return regla || null;
}

function tieneAlguno(permisos, prefijos) {
  for (const p of permisos) if (prefijos.some((pre) => p.startsWith(pre))) return true;
  return false;
}

// Lanza un error si la sesión no puede usar el canal. Sin sesión no se atiende ningún canal de
// estos módulos.
function verificarCanal(canal, sesion) {
  const regla = prefijosRequeridos(canal);
  if (!regla) return;
  if (!sesion) throw new Error('Inicia sesión para continuar');
  if (!tieneAlguno(sesion.permisos || new Set(), regla[1])) throw new Error(MENSAJE[regla[0]]);
}

module.exports = { verificarCanal, tieneAlguno, REGLAS };
