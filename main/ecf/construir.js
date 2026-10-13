// Datos de cada e-CF según el "Formato Comprobante Fiscal Electrónico (e-CF) v1.0" de la DGII.
// Funciones puras: reciben el documento ya calculado por el sistema y devuelven el objeto que
// xml.js convierte en XML en el orden del XSD.
//
// Montos: el sistema guarda los precios con ITBIS incluido, así que el e-CF va con
// IndicadorMontoGravado = 1 (los montos de las líneas incluyen ITBIS). Los totales salen de los
// mismos montos que se cobraron y se asentaron: MontoTotal es exactamente el total del documento
// y la base gravada/ITBIS por tasa suman exactamente el subtotal y el ITBIS registrados (las
// diferencias de redondeo por línea quedan dentro de la tolerancia de la DGII, Informe Técnico §12).
const { fechaDgii, fechaHoraDgii, diasEntre } = require('./fechas');

const TIPOS_ECF = {
  31: 'Factura de Crédito Fiscal Electrónica',
  32: 'Factura de Consumo Electrónica',
  33: 'Nota de Débito Electrónica',
  34: 'Nota de Crédito Electrónica',
  41: 'Comprobante Electrónico de Compras',
  43: 'Comprobante Electrónico para Gastos Menores',
  44: 'Comprobante Electrónico para Regímenes Especiales',
  45: 'Comprobante Electrónico Gubernamental',
  46: 'Comprobante Electrónico para Exportaciones',
  47: 'Comprobante Electrónico para Pagos al Exterior',
};

// Tipo de e-CF de una venta según el comprobante que corresponde al cliente.
const TIPO_ECF_POR_COMPROBANTE = { consumo: 32, credito_fiscal: 31, gubernamental: 45, regimen_especial: 44 };
// Equivalencia NCF serie B → tipo de e-CF (Informe Técnico e-CF §6.1).
const TIPO_ECF_POR_CODIGO_B = { B01: 31, B02: 32, B03: 33, B04: 34, B14: 45, B15: 44 };

// Las facturas de consumo por debajo de este monto se reportan con el resumen (RFCE).
const TOPE_CONSUMO_RFCE = 250000;

// Tipos sin fecha de vencimiento de secuencia (Formato e-CF, campo 4; Descripción Técnica).
const SIN_VENCIMIENTO = new Set([32, 34]);

// Tabla "Forma de pago" del formato: 1 efectivo, 2 cheque/transferencia/depósito, 3 tarjeta,
// 4 venta a crédito, 5 bonos o certificados de regalo, 6 permuta, 7 nota de crédito, 8 otras.
const FORMA_PAGO_DGII = { efectivo: 1, cheque: 2, transferencia: 2, deposito: 2, tarjeta: 3, credito: 4, bono: 5, permuta: 6, nota_credito: 7 };

const CODIGO_MODIFICACION = {
  1: 'Anula el NCF modificado',
  2: 'Corrige texto del comprobante fiscal modificado',
  3: 'Corrige montos del NCF modificado',
  4: 'Reemplazo NCF emitido en contingencia',
  5: 'Referencia factura de consumo electrónica',
};

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

function rncValido(rnc) {
  const d = soloDigitos(rnc);
  return d.length === 9 || d.length === 11 ? d : null;
}

function telefonoDgii(tel) {
  const d = soloDigitos(tel);
  const diez = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return diez.length === 10 ? `${diez.slice(0, 3)}-${diez.slice(3, 6)}-${diez.slice(6)}` : null;
}

const recortar = (texto, max) => {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return [...t].length > max ? [...t].slice(0, max).join('') : t;
};

// Indicador de facturación por tasa: 1 = 18%, 2 = 16%, 3 = 0% gravado, 4 = exento.
// El sistema solo distingue "exenta" (0%): una tasa cero se reporta como exento.
function indicadorFacturacion(tasa) {
  const pct = Math.round(Number(tasa) * 100);
  if (pct === 18) return 1;
  if (pct === 16) return 2;
  if (pct === 0) return 4;
  throw new Error(`La tasa de ITBIS ${pct}% no está contemplada en el formato e-CF (solo 18%, 16% y exento)`);
}

// Reparte un ajuste (descuento global, diferencia de redondeo) en la línea de mayor monto.
function ajustarMayor(valores, diferencia) {
  if (!valores.length || Math.abs(diferencia) < 0.005) return valores;
  let mayor = 0;
  valores.forEach((v, i) => { if (Math.abs(v) > Math.abs(valores[mayor])) mayor = i; });
  const copia = valores.slice();
  copia[mayor] = r2(copia[mayor] + diferencia);
  return copia;
}

// Líneas con su monto final (ya con el descuento global de la factura distribuido) y los
// totales por indicador de facturación, cuadrados con el documento.
function calcularMontos(documento, lineas) {
  const sumaLineas = r2(lineas.reduce((a, l) => a + l.totalLinea, 0));
  const factor = sumaLineas > 0 ? documento.total / sumaLineas : 1;
  let montos = lineas.map((l) => r2(l.totalLinea * factor));
  montos = ajustarMayor(montos, r2(documento.total - r2(montos.reduce((a, b) => a + b, 0))));

  const grupos = {};
  lineas.forEach((l, i) => {
    const ind = indicadorFacturacion(l.tasaItbis);
    const g = grupos[ind] || (grupos[ind] = { monto: 0, base: 0 });
    g.monto = r2(g.monto + montos[i]);
    g.base = r2(g.base + (ind === 4 ? montos[i] : l.baseImponible * factor));
  });
  // Base gravada por tasa: lo que se asentó como ingreso; el ITBIS es el resto del monto.
  const gravados = [1, 2, 3].filter((i) => grupos[i]);
  for (const i of gravados) grupos[i].base = r2(grupos[i].base);
  const exento = grupos[4] ? grupos[4].monto : 0;
  const baseTotal = r2(gravados.reduce((a, i) => a + grupos[i].base, 0) + exento);
  if (gravados.length && Math.abs(documento.subtotal - baseTotal) >= 0.005) {
    const bases = ajustarMayor(gravados.map((i) => grupos[i].base), r2(documento.subtotal - baseTotal));
    gravados.forEach((i, k) => { grupos[i].base = bases[k]; });
  }
  for (const i of gravados) grupos[i].itbis = r2(grupos[i].monto - grupos[i].base);
  return { montos, grupos };
}

function formasDePago(pagos) {
  const porCodigo = new Map();
  for (const p of pagos || []) {
    const codigo = FORMA_PAGO_DGII[p.formaPago] || 8;
    porCodigo.set(codigo, r2((porCodigo.get(codigo) || 0) + p.monto));
  }
  const filas = [...porCodigo.entries()].filter(([, m]) => m > 0).sort((a, b) => a[0] - b[0]);
  return filas.length ? { FormaDePago: filas.slice(0, 7).map(([FormaPago, MontoPago]) => ({ FormaPago: String(FormaPago), MontoPago })) } : null;
}

function totales(tipoEcf, grupos, documento) {
  const t = {};
  const tasas = { 1: 18, 2: 16, 3: 0 };
  const gravados = [1, 2, 3].filter((i) => grupos[i]);
  if (tipoEcf === 44 || tipoEcf === 43) {
    // Regímenes especiales y gastos menores: todo va exento (nota 50 del formato).
    t.MontoExento = documento.total;
  } else {
    if (gravados.length) t.MontoGravadoTotal = r2(gravados.reduce((a, i) => a + grupos[i].base, 0));
    for (const i of gravados) t[`MontoGravadoI${i}`] = grupos[i].base;
    if (grupos[4]) t.MontoExento = grupos[4].monto;
    for (const i of gravados) t[`ITBIS${i}`] = tasas[i];
    if (gravados.length) t.TotalITBIS = r2(gravados.reduce((a, i) => a + grupos[i].itbis, 0));
    for (const i of gravados) t[`TotalITBIS${i}`] = grupos[i].itbis;
  }
  t.MontoTotal = documento.total;
  return t;
}

function otraMoneda(tipoEcf, documento, tot) {
  if (!documento.monedaCodigo || !(documento.tasaCambio > 0) || documento.tasaCambio === 1) return null;
  const c = (v) => (v === undefined ? undefined : r2(v / documento.tasaCambio));
  const om = { TipoMoneda: documento.monedaCodigo, TipoCambio: Number(documento.tasaCambio.toFixed(4)) };
  if (tipoEcf !== 44 && tipoEcf !== 43) {
    om.MontoGravadoTotalOtraMoneda = c(tot.MontoGravadoTotal);
    om.MontoGravado1OtraMoneda = c(tot.MontoGravadoI1);
    om.MontoGravado2OtraMoneda = c(tot.MontoGravadoI2);
    om.MontoGravado3OtraMoneda = c(tot.MontoGravadoI3);
  }
  om.MontoExentoOtraMoneda = c(tot.MontoExento);
  if (tipoEcf !== 44 && tipoEcf !== 43) {
    om.TotalITBISOtraMoneda = c(tot.TotalITBIS);
    om.TotalITBIS1OtraMoneda = c(tot.TotalITBIS1);
    om.TotalITBIS2OtraMoneda = c(tot.TotalITBIS2);
    om.TotalITBIS3OtraMoneda = c(tot.TotalITBIS3);
  }
  om.MontoTotalOtraMoneda = c(tot.MontoTotal);
  return om;
}

function item(tipoEcf, linea, numero, monto) {
  const bruto = r2(linea.precioUnitario * linea.cantidad);
  const diferencia = r2(bruto - monto);
  const it = {
    NumeroLinea: numero,
    TablaCodigosItem: linea.codigo ? { CodigosItem: [{ TipoCodigo: 'Interna', CodigoItem: recortar(linea.codigo, 35) }] } : null,
    IndicadorFacturacion: tipoEcf === 44 || tipoEcf === 43 ? 4 : indicadorFacturacion(linea.tasaItbis),
    NombreItem: recortar(linea.nombre, 80) || 'Artículo',
    IndicadorBienoServicio: linea.esServicio ? 2 : 1,
    CantidadItem: linea.cantidad,
    PrecioUnitarioItem: linea.precioUnitario,
    MontoItem: monto,
  };
  if (diferencia > 0) {
    it.DescuentoMonto = diferencia;
    it.TablaSubDescuento = { SubDescuento: [{ TipoSubDescuento: '$', MontoSubDescuento: diferencia }] };
  } else if (diferencia < 0) {
    it.RecargoMonto = -diferencia;
    it.TablaSubRecargo = { SubRecargo: [{ TipoSubRecargo: '$', MontoSubRecargo: -diferencia }] };
  }
  return it;
}

// Datos del e-CF. Ver el encabezado del archivo para la convención de montos.
//   emisor: { rnc, razonSocial, nombreComercial, direccion, telefono }
//   comprador: { rnc, nombre } | null
//   documento: { numero, fecha (ISO), total, subtotal, condicion, diasCredito, monedaCodigo, tasaCambio }
//   lineas: [{ codigo, nombre, esServicio, cantidad, precioUnitario, totalLinea, baseImponible, tasaItbis }]
//   pagos: [{ formaPago, monto }]
//   referencia (33/34): { ncf, fecha (ISO), codigoModificacion, razon }
function construirEcf({ tipoEcf, encf, vencimientoSecuencia, emisor, comprador, documento, lineas, pagos, referencia, fechaFirma = new Date() }) {
  if (!TIPOS_ECF[tipoEcf]) throw new Error(`Tipo de e-CF desconocido: ${tipoEcf}`);
  if (!lineas.length) throw new Error('El comprobante debe tener al menos una línea');
  const maxLineas = tipoEcf === 32 && documento.total < TOPE_CONSUMO_RFCE ? 10000 : 1000;
  if (lineas.length > maxLineas) throw new Error(`El e-CF admite hasta ${maxLineas} líneas`);
  const rncEmisor = rncValido(emisor.rnc);
  if (!rncEmisor) throw new Error('Configure el RNC del negocio (9 u 11 dígitos) en Configuración > Datos del negocio');
  if (!String(emisor.direccion || '').trim()) throw new Error('Configure la dirección del negocio en Configuración > Datos del negocio: es obligatoria en el e-CF');

  const { montos, grupos } = calcularMontos(documento, lineas);
  const hayGravado = [1, 2, 3].some((i) => grupos[i]);
  if ((tipoEcf === 44 || tipoEcf === 43) && hayGravado) {
    throw new Error(`El ${TIPOS_ECF[tipoEcf]} solo admite partidas exentas de ITBIS; este documento tiene ITBIS`);
  }

  const credito = documento.condicion === 'credito' || documento.condicion === 'mixto';
  const fechaEmision = fechaDgii(documento.fecha);
  const idDoc = {
    TipoeCF: String(tipoEcf),
    eNCF: encf,
    FechaVencimientoSecuencia: SIN_VENCIMIENTO.has(tipoEcf) ? null : fechaDgii(vencimientoSecuencia),
    IndicadorNotaCredito: tipoEcf === 34 ? (diasEntre(referencia.fecha, documento.fecha) > 30 ? 1 : 0) : null,
    IndicadorMontoGravado: hayGravado && tipoEcf !== 43 && tipoEcf !== 44 ? 1 : null,
    TipoIngresos: [41, 43].includes(tipoEcf) ? null : '01',
    TipoPago: credito ? 2 : 1,
    FechaLimitePago: credito ? fechaDgii(new Date(Date.parse(documento.fecha) + (documento.diasCredito || 0) * 86400000).toISOString()) : null,
    // Sin acentos: el patrón del XSD es [\s\d\w]{1,15} y \w no incluye letras acentuadas en JS.
    TerminoPago: credito && documento.diasCredito ? `${documento.diasCredito} dias` : null,
    TablaFormasPago: tipoEcf === 34 ? null : formasDePago(pagos),
  };
  if (tipoEcf !== 34 && !SIN_VENCIMIENTO.has(tipoEcf) && !vencimientoSecuencia) {
    throw new Error(`La secuencia ${encf.slice(0, 3)} no tiene fecha de vencimiento registrada`);
  }

  const emisorXml = {
    RNCEmisor: rncEmisor,
    RazonSocialEmisor: recortar(emisor.razonSocial || emisor.nombreComercial, 150),
    NombreComercial: emisor.nombreComercial && emisor.nombreComercial !== emisor.razonSocial ? recortar(emisor.nombreComercial, 150) : null,
    DireccionEmisor: recortar(emisor.direccion, 100),
    TablaTelefonoEmisor: telefonoDgii(emisor.telefono) ? { TelefonoEmisor: [telefonoDgii(emisor.telefono)] } : null,
    NumeroFacturaInterna: documento.numero ? recortar(documento.numero, 20) : null,
    FechaEmision: fechaEmision,
  };

  const rncComprador = comprador ? rncValido(comprador.rnc) : null;
  const compradorXml = rncComprador || (comprador && comprador.nombre)
    ? { RNCComprador: rncComprador, RazonSocialComprador: comprador && comprador.nombre ? recortar(comprador.nombre, 150) : null }
    : null;
  if ([31, 45].includes(tipoEcf) && !rncComprador) {
    throw new Error(`El ${TIPOS_ECF[tipoEcf]} requiere el RNC o la cédula del cliente`);
  }
  if (tipoEcf === 32 && documento.total >= TOPE_CONSUMO_RFCE && !rncComprador) {
    throw new Error('Las facturas de consumo de RD$250,000 o más requieren el RNC o la cédula del cliente');
  }

  const tot = totales(tipoEcf, grupos, documento);
  const datos = {
    Encabezado: {
      Version: '1.0',
      IdDoc: idDoc,
      Emisor: emisorXml,
      Comprador: compradorXml,
      Totales: tot,
      OtraMoneda: otraMoneda(tipoEcf, documento, tot),
    },
    DetallesItems: { Item: lineas.map((l, i) => item(tipoEcf, l, i + 1, montos[i])) },
    InformacionReferencia: referencia ? {
      NCFModificado: referencia.ncf,
      FechaNCFModificado: fechaDgii(referencia.fecha),
      CodigoModificacion: String(referencia.codigoModificacion),
      RazonModificacion: tipoEcf === 33 || tipoEcf === 34 ? recortar(referencia.razon, 90) || null : null,
    } : null,
    FechaHoraFirma: fechaHoraDgii(fechaFirma),
  };
  if ((tipoEcf === 33 || tipoEcf === 34) && !referencia) throw new Error('Las notas de crédito y débito electrónicas deben referenciar el comprobante que modifican');

  return {
    formato: `ECF${tipoEcf}`,
    datos,
    resumen: {
      tipoEcf, encf, rncEmisor, rncComprador, fechaEmision, fechaFirma: datos.FechaHoraFirma,
      montoTotal: documento.total, totalItbis: tot.TotalITBIS || 0,
      via: tipoEcf === 32 && documento.total < TOPE_CONSUMO_RFCE ? 'rfce' : 'recepcion',
    },
  };
}

// Resumen de Factura de Consumo Electrónica (< RD$250,000): las informaciones principales del
// e-CF 32 más su código de seguridad. El e-CF completo se conserva en el sistema.
function construirRfce(datosEcf, codigoSeguridad) {
  const e = datosEcf.Encabezado;
  const t = e.Totales;
  return {
    Encabezado: {
      Version: '1.0',
      IdDoc: { TipoeCF: '32', eNCF: e.IdDoc.eNCF, TipoIngresos: e.IdDoc.TipoIngresos, TipoPago: e.IdDoc.TipoPago, TablaFormasPago: e.IdDoc.TablaFormasPago },
      Emisor: { RNCEmisor: e.Emisor.RNCEmisor, RazonSocialEmisor: e.Emisor.RazonSocialEmisor, FechaEmision: e.Emisor.FechaEmision },
      Comprador: e.Comprador ? { RNCComprador: e.Comprador.RNCComprador, RazonSocialComprador: e.Comprador.RazonSocialComprador } : {},
      Totales: {
        MontoGravadoTotal: t.MontoGravadoTotal, MontoGravadoI1: t.MontoGravadoI1, MontoGravadoI2: t.MontoGravadoI2, MontoGravadoI3: t.MontoGravadoI3,
        MontoExento: t.MontoExento, TotalITBIS: t.TotalITBIS, TotalITBIS1: t.TotalITBIS1, TotalITBIS2: t.TotalITBIS2, TotalITBIS3: t.TotalITBIS3,
        MontoTotal: t.MontoTotal,
      },
      CodigoSeguridadeCF: codigoSeguridad,
    },
  };
}

// Anulación de secuencias e-NCF (ANECF): rangos no usados o e-CF firmados que no se enviaron.
//   rangos: [{ tipoEcf, desde, hasta }] con e-NCF completos (E310000000001).
function construirAnecf({ rncEmisor, rangos, fecha = new Date() }) {
  const porTipo = new Map();
  for (const r of rangos) {
    if (!porTipo.has(r.tipoEcf)) porTipo.set(r.tipoEcf, []);
    porTipo.get(r.tipoEcf).push(r);
  }
  const cantidad = (r) => Number(r.hasta.slice(3)) - Number(r.desde.slice(3)) + 1;
  const total = rangos.reduce((a, r) => a + cantidad(r), 0);
  return {
    Encabezado: { Version: '1.0', RncEmisor: rncValido(rncEmisor), CantidadeNCFAnulados: total, FechaHoraAnulacioneNCF: fechaHoraDgii(fecha) },
    DetalleAnulacion: {
      Anulacion: [...porTipo.entries()].map(([tipo, lista], i) => ({
        NoLinea: i + 1,
        TipoeCF: String(tipo),
        TablaRangoSecuenciasAnuladaseNCF: { Secuencias: lista.map((r) => ({ SecuenciaeNCFDesde: r.desde, SecuenciaeNCFHasta: r.hasta })) },
        CantidadeNCFAnulados: lista.reduce((a, r) => a + cantidad(r), 0),
      })),
    },
  };
}

module.exports = {
  construirEcf, construirRfce, construirAnecf, calcularMontos, indicadorFacturacion, rncValido, telefonoDgii,
  TIPOS_ECF, TIPO_ECF_POR_COMPROBANTE, TIPO_ECF_POR_CODIGO_B, TOPE_CONSUMO_RFCE, SIN_VENCIMIENTO, CODIGO_MODIFICACION, FORMA_PAGO_DGII,
};
