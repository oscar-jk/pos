// Compras > e-CF recibidos: importar el XML de un proveedor, ver su acuse y dar la aprobación o
// el rechazo comercial (ACECF), que el proceso principal firma y envía a la DGII y al emisor.
(function () {
  const APROBACION = { 1: ['Aprobado', 'var(--color-success)'], 2: ['Rechazado', 'var(--color-danger)'] };
  const ENVIO = { pendiente: 'pendiente de envío', enviada: 'enviada a la DGII', error: 'la DGII no la aceptó' };
  let espera = null;

  const usuarioId = () => (state.info && state.info.usuario ? state.info.usuario.id : null);
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  function celdaAprobacion(r) {
    if (r.acuse_estado !== 0) return '—';
    if (!r.aprobacion_estado) {
      return `<span class="enlace-accion" data-aprobar="${esc(r.id)}">Aprobar</span> · <span class="enlace-accion" data-rechazar="${esc(r.id)}" style="color:var(--color-danger);">Rechazar</span>`;
    }
    const [texto, color] = APROBACION[r.aprobacion_estado];
    return `<span class="pill-estado" style="background:${esc(color)};">${esc(texto)}</span>
      <div style="font-size:11px; color:var(--color-text-muted); margin-top:3px;">${esc(ENVIO[r.aprobacion_envio] || '')}${r.aprobacion_error ? `: ${esc(r.aprobacion_error)}` : ''}</div>
      ${r.aprobacion_motivo ? `<div style="font-size:11px; color:var(--color-text-muted);">${esc(r.aprobacion_motivo)}</div>` : ''}`;
  }

  async function cargar() {
    const boton = document.getElementById('btn-importar-recibido');
    if (!window.puntoXEcf || !window.puntoXEcf.listarRecibidos) {
      if (boton) boton.remove();
      document.getElementById('recibidos-vacio').textContent = 'Los e-CF recibidos están disponibles en la aplicación de escritorio.';
      document.getElementById('recibidos-vacio').style.display = 'block';
      return;
    }
    if (boton && !boton.dataset.enlazado) { boton.dataset.enlazado = '1'; boton.addEventListener('click', importar); }
    const buscador = document.getElementById('buscar-recibidos');
    if (!buscador.dataset.enlazado) {
      buscador.dataset.enlazado = '1';
      buscador.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(cargar, 300); });
    }
    try {
      const lista = await window.puntoXEcf.listarRecibidos({ texto: buscador.value.trim() || undefined });
      document.getElementById('recibidos-vacio').style.display = lista.length ? 'none' : 'block';
      document.getElementById('recibidos-tbody').innerHTML = lista.map((r) => `
        <tr>
          <td><strong>${esc(r.encf)}</strong><div style="font-size:11px; color:var(--color-text-muted);">${esc(r.nombre_tipo || '')}${r.via === 'importado' ? ' · importado' : ''}</div></td>
          <td>${esc(r.proveedor_nombre || r.razon_social_emisor || '—')}<div style="font-size:11px; color:var(--color-text-muted);">RNC ${esc(r.rnc_emisor)}</div></td>
          <td>${esc(r.fecha_emision || '—')}</td>
          <td>${esc(fmt(r.monto_total))}</td>
          <td>${esc(fmt(r.total_itbis))}</td>
          <td><span class="pill-estado" style="background:${r.acuse_estado === 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${esc(r.acuse_texto)}</span>
            ${r.motivo_texto ? `<div style="font-size:11px; color:var(--color-text-muted); margin-top:3px;">${esc(r.motivo_texto)}</div>` : ''}</td>
          <td>${celdaAprobacion(r)}</td>
          <td><span class="enlace-accion" data-xml="${esc(r.id)}">XML</span></td>
        </tr>`).join('');
      document.querySelectorAll('[data-aprobar]').forEach((el) => el.addEventListener('click', () => decidir(el.dataset.aprobar, true)));
      document.querySelectorAll('[data-rechazar]').forEach((el) => el.addEventListener('click', () => decidir(el.dataset.rechazar, false)));
      document.querySelectorAll('[data-xml]').forEach((el) => el.addEventListener('click', () => verXml(el.dataset.xml)));
    } catch (err) { mostrarError(err.message); }
  }

  async function importar() {
    try {
      const r = await window.puntoXEcf.importarRecibido({ usuarioId: usuarioId() });
      if (!r || r.cancelado) return;
      const ok = r.resultados.filter((x) => x.recibido).length;
      const fallas = r.resultados.filter((x) => !x.recibido).map((x) => `${x.encf || x.archivo}: ${x.motivo}`);
      mostrarAviso(`${ok} e-CF recibido(s).${fallas.length ? ` No recibidos: ${fallas.join('; ')}.` : ''}`);
      cargar();
    } catch (err) { mostrarError(err.message); }
  }

  async function decidir(id, aprobado) {
    let motivo = null;
    if (!aprobado) {
      motivo = await window.PuntoXModal.pedirTexto('Motivo del rechazo comercial (lo recibe el proveedor y la DGII):', '', { obligatorio: true });
      if (!motivo) return;
    }
    try {
      await window.puntoXEcf.aprobarRecibido({ id, aprobado, motivo, usuarioId: usuarioId() });
      mostrarAviso(aprobado ? 'Aprobación comercial firmada; se envía a la DGII y al proveedor.' : 'Rechazo comercial firmado; se envía a la DGII y al proveedor.');
      cargar();
    } catch (err) { mostrarError(err.message); }
  }

  async function verXml(id) {
    try {
      const r = await window.puntoXEcf.obtenerXmlRecibido({ id });
      window.PuntoXModal.abrirModal(`e-CF ${r.encf}`, '<div id="xml-recibido" style="white-space:pre-wrap; word-break:break-all; font-family:Consolas, monospace; font-size:11px; max-height:60vh; overflow:auto;"></div>');
      document.getElementById('xml-recibido').textContent = r.xml.replace(/></g, '>\n<');
    } catch (err) { mostrarError(err.message); }
  }

  window.PuntoXEcfRecibidos = { cargar };
}());
