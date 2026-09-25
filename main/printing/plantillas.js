// Plantillas HTML imprimibles: factura (carta/A4), tique (térmico 80mm) y arqueo de turno de
// caja (térmico 80mm). Funciones puras — reciben datos ya hidratados y devuelven un string HTML
// listo para cargar en una BrowserWindow oculta e imprimir con webContents.print().

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtMoneda(n) {
  return (n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFecha(iso) {
  return iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

const FORMAS_PAGO_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', cheque: 'Cheque' };

const ESTILO_BASE = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
`;

// --- ITBIS desglosado por tasa a partir de las líneas (el header de la factura solo trae el
// agregado total; DGII exige el desglose por tasa en el comprobante). ---
function desglosarItbisPorTasa(lineas) {
  const porTasa = new Map();
  for (const l of lineas) {
    const tasa = l.tasa_itbis || 0;
    const actual = porTasa.get(tasa) || { base: 0, itbis: 0 };
    actual.base += l.base_imponible || 0;
    actual.itbis += l.itbis_monto || 0;
    porTasa.set(tasa, actual);
  }
  return [...porTasa.entries()].sort((a, b) => b[0] - a[0]);
}

function encabezadoNegocio(negocio) {
  return `
    <div style="margin-bottom:12px;">
      <div style="font-size:20px; font-weight:800;">${escapar(negocio.nombre || 'Mi Negocio')}</div>
      ${negocio.rnc ? `<div>RNC: ${escapar(negocio.rnc)}</div>` : ''}
      ${negocio.direccion ? `<div>${escapar(negocio.direccion)}</div>` : ''}
      ${negocio.telefono ? `<div>Tel: ${escapar(negocio.telefono)}</div>` : ''}
    </div>
  `;
}

function plantillaFactura(factura, negocio) {
  const itbisPorTasa = desglosarItbisPorTasa(factura.lineas);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" />
    <title>Factura ${escapar(factura.numero)}</title>
    <style>
      ${ESTILO_BASE}
      @page { size: letter; margin: 14mm; }
      body { font-size: 13px; }
      .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
      .doc-header__meta { text-align: right; }
      .doc-header__meta .numero { font-size: 18px; font-weight: 800; }
      .cliente { margin-bottom: 14px; }
      th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 12px; }
      th { background: #f2f2f2; text-transform: uppercase; font-size: 10px; letter-spacing: 0.03em; }
      td.num, th.num { text-align: right; }
      .totales { width: 320px; margin-left: auto; margin-top: 14px; }
      .totales td { border: none; padding: 3px 8px; }
      .totales .total-final td { font-weight: 800; font-size: 15px; border-top: 2px solid #111; padding-top: 8px; }
      .pagos { margin-top: 16px; font-size: 12px; }
      .pie { margin-top: 30px; font-size: 10px; color: #666; text-align: center; }
    </style>
  </head><body>
    <div class="doc-header">
      ${encabezadoNegocio(negocio)}
      <div class="doc-header__meta">
        <div class="numero">FACTURA No. ${escapar(factura.numero)}</div>
        ${factura.ncf ? `<div>NCF: ${escapar(factura.ncf)}</div>` : ''}
        <div>Fecha: ${fmtFecha(factura.fecha)}</div>
        <div>Estado: ${factura.estado === 'anulado' ? 'ANULADA' : 'Vigente'}</div>
      </div>
    </div>

    <div class="cliente">
      <strong>Cliente:</strong> ${escapar(factura.cliente_nombre)}
      ${factura.vendedor_nombre ? ` &nbsp;·&nbsp; <strong>Vendedor:</strong> ${escapar(factura.vendedor_nombre)}` : ''}
    </div>

    <table>
      <thead><tr>
        <th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th>
        <th class="num">Desc.</th><th class="num">ITBIS</th><th class="num">Total</th>
      </tr></thead>
      <tbody>
        ${factura.lineas.map((l) => `
          <tr>
            <td>${escapar(l.codigo_interno)}</td>
            <td>${escapar(l.producto_descripcion)}</td>
            <td class="num">${l.cantidad}</td>
            <td class="num">${fmtMoneda(l.precio_unitario)}</td>
            <td class="num">${l.descuento_monto ? fmtMoneda(l.descuento_monto) : '—'}</td>
            <td class="num">${fmtMoneda(l.itbis_monto)}</td>
            <td class="num">${fmtMoneda(l.total_linea)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <table class="totales">
      <tr><td>Subtotal</td><td class="num">RD$ ${fmtMoneda(factura.subtotal)}</td></tr>
      ${factura.descuento_total > 0 ? `<tr><td>Descuento</td><td class="num">-RD$ ${fmtMoneda(factura.descuento_total)}</td></tr>` : ''}
      ${itbisPorTasa.map(([tasa, d]) => `<tr><td>ITBIS (${(tasa * 100).toFixed(0)}%)</td><td class="num">RD$ ${fmtMoneda(d.itbis)}</td></tr>`).join('')}
      ${factura.retencion_isr > 0 ? `<tr><td>Retención ISR</td><td class="num">-RD$ ${fmtMoneda(factura.retencion_isr)}</td></tr>` : ''}
      ${factura.retencion_itbis > 0 ? `<tr><td>Retención ITBIS</td><td class="num">-RD$ ${fmtMoneda(factura.retencion_itbis)}</td></tr>` : ''}
      <tr class="total-final"><td>Total</td><td class="num">RD$ ${fmtMoneda(factura.total)}</td></tr>
    </table>

    <div class="pagos">
      <strong>Forma de pago:</strong>
      ${(factura.pagos || []).map((p) => `${FORMAS_PAGO_LABEL[p.forma_pago] || p.forma_pago}: RD$ ${fmtMoneda(p.monto)}`).join(' &nbsp;·&nbsp; ') || '—'}
    </div>

    <div class="pie">Documento generado por Punto X</div>
  </body></html>`;
}

function plantillaTique(factura, negocio) {
  const itbisPorTasa = desglosarItbisPorTasa(factura.lineas);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" />
    <title>Tique ${escapar(factura.numero)}</title>
    <style>
      ${ESTILO_BASE}
      @page { margin: 3mm; } /* el ancho/largo del rollo lo define el driver de la tiquera */
      body { font-size: 11px; width: 74mm; }
      .centro { text-align: center; }
      hr { border: none; border-top: 1px dashed #111; margin: 6px 0; }
      table td { padding: 1px 0; font-size: 11px; vertical-align: top; }
      td.num { text-align: right; }
      .linea-desc { font-weight: 600; }
      .totales td { font-size: 12px; }
      .total-final td { font-weight: 800; font-size: 13px; }
      .pie { margin-top: 10px; font-size: 9px; text-align: center; }
    </style>
  </head><body>
    <div class="centro">
      <div style="font-size:14px; font-weight:800;">${escapar(negocio.nombre || 'Mi Negocio')}</div>
      ${negocio.rnc ? `<div>RNC: ${escapar(negocio.rnc)}</div>` : ''}
      ${negocio.direccion ? `<div>${escapar(negocio.direccion)}</div>` : ''}
      ${negocio.telefono ? `<div>Tel: ${escapar(negocio.telefono)}</div>` : ''}
    </div>
    <hr />
    <div>No. ${escapar(factura.numero)}${factura.ncf ? ` &nbsp;NCF: ${escapar(factura.ncf)}` : ''}</div>
    <div>${fmtFecha(factura.fecha)}</div>
    <div>Cliente: ${escapar(factura.cliente_nombre)}</div>
    <hr />
    <table>
      ${factura.lineas.map((l) => `
        <tr><td colspan="2" class="linea-desc">${escapar(l.producto_descripcion)}</td></tr>
        <tr><td>${l.cantidad} x ${fmtMoneda(l.precio_unitario)}</td><td class="num">${fmtMoneda(l.total_linea)}</td></tr>
      `).join('')}
    </table>
    <hr />
    <table class="totales">
      <tr><td>Subtotal</td><td class="num">${fmtMoneda(factura.subtotal)}</td></tr>
      ${factura.descuento_total > 0 ? `<tr><td>Descuento</td><td class="num">-${fmtMoneda(factura.descuento_total)}</td></tr>` : ''}
      ${itbisPorTasa.map(([tasa, d]) => `<tr><td>ITBIS (${(tasa * 100).toFixed(0)}%)</td><td class="num">${fmtMoneda(d.itbis)}</td></tr>`).join('')}
      <tr class="total-final"><td>TOTAL</td><td class="num">RD$ ${fmtMoneda(factura.total)}</td></tr>
    </table>
    <hr />
    <div>${(factura.pagos || []).map((p) => `${FORMAS_PAGO_LABEL[p.forma_pago] || p.forma_pago}: ${fmtMoneda(p.monto)}`).join('<br/>') || '—'}</div>
    <div class="pie">¡Gracias por su compra!<br/>Generado por Punto X</div>
  </body></html>`;
}

// Precuenta de una cuenta abierta: lo que lleva consumido, para mostrárselo al cliente antes de
// cobrar. No es comprobante fiscal (no tiene NCF) y lo dice claramente.
function plantillaPrecuenta(cuenta, negocio) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" />
    <title>Precuenta ${escapar(cuenta.nombre)}</title>
    <style>
      ${ESTILO_BASE}
      @page { margin: 3mm; }
      body { font-size: 11px; width: 74mm; }
      .centro { text-align: center; }
      hr { border: none; border-top: 1px dashed #111; margin: 6px 0; }
      table td { padding: 1px 0; font-size: 11px; vertical-align: top; }
      td.num { text-align: right; }
      .total-final td { font-weight: 800; font-size: 13px; }
      .aviso { margin-top: 8px; font-size: 10px; text-align: center; font-weight: 700; }
    </style>
  </head><body>
    <div class="centro">
      <div style="font-size:14px; font-weight:800;">${escapar(negocio.nombre || 'Mi Negocio')}</div>
      <div style="font-weight:700; margin-top:2px;">PRECUENTA — ${escapar(cuenta.nombre)}</div>
    </div>
    <hr />
    <div>Cuenta ${escapar(cuenta.numero)} · abierta ${fmtFecha(cuenta.created_at)}</div>
    <div>Impresa ${fmtFecha(new Date().toISOString())}</div>
    <hr />
    <table>
      ${cuenta.lineas.map((l) => `
        <tr><td colspan="2" style="font-weight:600;">${escapar(l.producto.descripcion)}${l.nota ? ` <span style="font-weight:400;">(${escapar(l.nota)})</span>` : ''}</td></tr>
        <tr><td>${l.cantidad} x ${fmtMoneda(l.precio_unitario)}</td><td class="num">${fmtMoneda(l.subtotal)}</td></tr>
      `).join('')}
    </table>
    <hr />
    <table><tr class="total-final"><td>TOTAL</td><td class="num">RD$ ${fmtMoneda(cuenta.total)}</td></tr></table>
    <div class="aviso">NO ES COMPROBANTE FISCAL</div>
  </body></html>`;
}

const TIPO_MOVIMIENTO_LABEL = {
  venta_efectivo: 'Venta en efectivo', cobro_cxc: 'Cobro CxC', entrada_manual: 'Entrada manual',
  salida_manual: 'Salida manual', gasto_caja_chica: 'Gasto caja chica', transferencia_banco: 'Transferencia a banco',
};

function plantillaArqueoTurno(turno, movimientos, negocio) {
  const totalEntradas = movimientos.filter((m) => m.monto > 0).reduce((acc, m) => acc + m.monto, 0);
  const totalSalidas = movimientos.filter((m) => m.monto < 0).reduce((acc, m) => acc + Math.abs(m.monto), 0);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" />
    <title>Arqueo de caja</title>
    <style>
      ${ESTILO_BASE}
      @page { margin: 3mm; } /* el ancho/largo del rollo lo define el driver de la tiquera */
      body { font-size: 11px; width: 74mm; }
      .centro { text-align: center; }
      hr { border: none; border-top: 1px dashed #111; margin: 6px 0; }
      table td { padding: 1px 0; font-size: 10px; }
      td.num { text-align: right; }
      .totales td { font-size: 12px; }
      .total-final td { font-weight: 800; font-size: 13px; }
      .pie { margin-top: 10px; font-size: 9px; text-align: center; }
    </style>
  </head><body>
    <div class="centro">
      <div style="font-size:14px; font-weight:800;">${escapar(negocio.nombre || 'Mi Negocio')}</div>
      <div style="font-weight:700;">Arqueo de Caja: ${escapar(turno.caja_nombre || '')}</div>
    </div>
    <hr />
    <div>Apertura: ${fmtFecha(turno.fecha_apertura)}</div>
    <div>Cierre: ${fmtFecha(turno.fecha_cierre)}</div>
    <div>Usuario: ${escapar(turno.usuario_nombre || '')}</div>
    <hr />
    <table class="totales">
      <tr><td>Fondo inicial</td><td class="num">${fmtMoneda(turno.fondo_inicial)}</td></tr>
      <tr><td>Entradas</td><td class="num">${fmtMoneda(totalEntradas)}</td></tr>
      <tr><td>Salidas</td><td class="num">-${fmtMoneda(totalSalidas)}</td></tr>
      <tr class="total-final"><td>Efectivo esperado</td><td class="num">${fmtMoneda(turno.efectivo_esperado)}</td></tr>
      <tr><td>Efectivo contado</td><td class="num">${fmtMoneda(turno.efectivo_contado)}</td></tr>
      <tr class="total-final"><td>Diferencia</td><td class="num">${turno.diferencia > 0 ? '+' : ''}${fmtMoneda(turno.diferencia)}</td></tr>
    </table>
    <hr />
    <div style="font-weight:700; margin-bottom:4px;">Movimientos del turno</div>
    <table>
      ${movimientos.map((m) => `
        <tr><td>${TIPO_MOVIMIENTO_LABEL[m.tipo] || m.tipo}</td><td class="num">${m.monto > 0 ? '+' : ''}${fmtMoneda(m.monto)}</td></tr>
      `).join('')}
    </table>
    <div class="pie">Generado por Punto X</div>
  </body></html>`;
}

module.exports = { plantillaFactura, plantillaTique, plantillaArqueoTurno, plantillaPrecuenta };
