// Fechas de los e-CF en hora de República Dominicana (GMT-4, sin horario de verano), sin
// depender de la zona horaria configurada en el equipo.
const DESFASE_MS = -4 * 3600 * 1000;
const dos = (n) => String(n).padStart(2, '0');

function partesRD(fecha) {
  const d = new Date(new Date(fecha).getTime() + DESFASE_MS);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha no válida: ${fecha}`);
  return { dia: dos(d.getUTCDate()), mes: dos(d.getUTCMonth() + 1), anio: d.getUTCFullYear(), h: dos(d.getUTCHours()), m: dos(d.getUTCMinutes()), s: dos(d.getUTCSeconds()) };
}

// "AAAA-MM-DD" (fecha local ya calculada) o un instante ISO → "dd-MM-AAAA".
function fechaDgii(fecha) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [a, m, d] = fecha.split('-');
    return `${d}-${m}-${a}`;
  }
  const p = partesRD(fecha);
  return `${p.dia}-${p.mes}-${p.anio}`;
}

// Instante → "dd-MM-AAAA HH:mm:ss" en GMT-4 (FechaHoraFirma, ANECF, ACECF, ARECF).
function fechaHoraDgii(fecha = new Date()) {
  const p = partesRD(fecha);
  return `${p.dia}-${p.mes}-${p.anio} ${p.h}:${p.m}:${p.s}`;
}

// Instante → "AAAA-MM-DD" en hora de RD.
function fechaLocalRD(fecha = new Date()) {
  const p = partesRD(fecha);
  return `${p.anio}-${p.mes}-${p.dia}`;
}

function diasEntre(desdeIso, hastaIso) {
  const a = Date.parse(`${fechaLocalRD(desdeIso)}T00:00:00Z`);
  const b = Date.parse(`${fechaLocalRD(hastaIso)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

module.exports = { fechaDgii, fechaHoraDgii, fechaLocalRD, diasEntre };
