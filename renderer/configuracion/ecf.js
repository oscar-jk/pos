// Configuración > Facturación electrónica: modo de comprobantes, ambiente de la DGII,
// certificado digital, secuencias e-NCF y contingencia. Todo pasa por window.puntoXEcf (IPC);
// la validación de verdad la hace el proceso principal.
(function () {
  const TIPOS = {
    31: 'Factura de Crédito Fiscal', 32: 'Factura de Consumo', 33: 'Nota de Débito', 34: 'Nota de Crédito',
    41: 'Compras', 43: 'Gastos Menores', 44: 'Regímenes Especiales', 45: 'Gubernamental', 46: 'Exportaciones', 47: 'Pagos al Exterior',
  };
  const SIN_VENCIMIENTO = new Set([32, 34]);
  const AMBIENTES = {
    TesteCF: 'Pruebas (TesteCF) — sin validez fiscal',
    CerteCF: 'Certificación (CerteCF) — sin validez fiscal',
    eCF: 'Producción (eCF) — con validez fiscal',
  };
  const COLOR_ALERTA = { error: 'var(--color-danger)', aviso: 'var(--color-warning)' };

  const contenedor = () => document.getElementById('ecf-contenido');
  const usuarioId = () => (state.info && state.info.usuario ? state.info.usuario.id : null);
  const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const numero = (n) => Number(n).toLocaleString('es-DO');

  async function ejecutar(accion, exito) {
    try {
      const estado = await accion();
      if (exito) mostrarExito(exito);
      if (estado && estado.modo) pintar(estado);
      else await cargar();
    } catch (err) {
      mostrarError(err.message);
    }
  }

  function bloqueAlertas(alertas) {
    if (!alertas.length) return '';
    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="alert-list">
          ${alertas.map((a) => `
            <div class="alert-item">
              <span class="alert-item__bar" style="background:${esc(COLOR_ALERTA[a.nivel] || 'var(--color-info)')};"></span>
              <span class="alert-item__tag" style="color:${esc(COLOR_ALERTA[a.nivel] || 'var(--color-info)')};">${a.nivel === 'error' ? 'Atención' : 'Aviso'}</span>
              <span class="alert-item__text">${esc(a.texto)}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function bloqueModo(e) {
    const electronico = e.modo === 'electronico';
    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="card__header"><span class="card__title">Comprobantes fiscales</span>
          <span class="pill-estado" style="background:${electronico ? 'var(--color-success)' : 'var(--color-text-faint)'};">${electronico ? 'Emitiendo e-CF' : 'NCF tradicional (serie B)'}</span>
        </div>
        <p style="font-size:13px; color:var(--color-text-muted); margin:0 0 12px; max-width:720px;">
          En modo electrónico cada factura y nota se firma con el certificado digital y se envía a la DGII en segundo plano.
          Si no hay internet, la venta sigue: el comprobante queda firmado y se envía cuando vuelva la conexión (plazo de 72 horas).
        </p>
        <div class="form-grid" style="max-width:720px;">
          <div class="form-field"><label>Modo</label>
            <select id="ecf-modo" class="input-normal">
              <option value="tradicional" ${!electronico ? 'selected' : ''}>Tradicional (NCF serie B)</option>
              <option value="electronico" ${electronico ? 'selected' : ''}>Electrónico (e-CF)</option>
            </select>
          </div>
          <div class="form-field"><label>Ambiente de la DGII</label>
            <select id="ecf-ambiente" class="input-normal">
              ${Object.entries(AMBIENTES).map(([v, t]) => `<option value="${v}" ${e.ambiente === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <p style="font-size:12px; color:var(--color-text-muted); margin:10px 0 0;">
          Emisor: <strong>${esc(e.negocio.razonSocial || e.negocio.nombre || '—')}</strong> · RNC ${esc(e.negocio.rnc || '—')}
          (se editan en la pestaña Negocio).
        </p>
        <button class="btn btn-primario" id="ecf-guardar-modo" style="margin-top:14px;">Guardar</button>
      </div>`;
  }

  function bloqueCertificado(e) {
    const c = e.certificado;
    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="card__header"><span class="card__title">Certificado digital</span></div>
        ${c ? `
          <table class="data-table" style="max-width:720px;">
            <tbody>
              <tr><td>Titular</td><td>${esc(c.titular)}</td></tr>
              <tr><td>Identificación (SN)</td><td>${esc(c.identificacion || '—')}</td></tr>
              <tr><td>Emitido por</td><td>${esc(c.emisor || '—')}</td></tr>
              <tr><td>Vigencia</td><td>${fechaCorta(c.validoDesde)} al ${fechaCorta(c.validoHasta)}</td></tr>
              <tr><td>Archivo</td><td>${esc(c.nombreArchivo)}</td></tr>
            </tbody>
          </table>` : `
          <div class="empty-state">No hay certificado cargado. Necesita un certificado digital para procesos tributarios (.p12) emitido por una prestadora acreditada por INDOTEL.</div>`}
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn btn-secundario" id="ecf-cargar-cert">${c ? 'Reemplazar certificado' : 'Cargar certificado (.p12)'}</button>
          ${c ? '<button class="btn btn-secundario" id="ecf-probar">Probar conexión con la DGII</button>' : ''}
        </div>
        <p style="font-size:12px; color:var(--color-text-muted); margin:10px 0 0;">La contraseña se guarda cifrada por Windows en este equipo.</p>
      </div>`;
  }

  function bloqueSecuencias(e) {
    const filas = e.secuencias.map((s) => `
      <tr>
        <td><strong>${esc(s.codigo)}</strong> ${esc(TIPOS[s.tipo_ecf] || '')}</td>
        <td>${numero(s.secuencia_desde)} – ${numero(s.secuencia_hasta)}</td>
        <td>${s.disponibles > 0 ? esc(`${s.codigo}${String(s.secuencia_actual).padStart(10, '0')}`) : '—'}</td>
        <td>${numero(s.disponibles)}</td>
        <td>${SIN_VENCIMIENTO.has(s.tipo_ecf) ? 'No vence' : fechaCorta(s.vencimiento)}</td>
        <td><span class="pill-estado" style="background:${s.activo ? 'var(--color-success)' : 'var(--color-text-faint)'};">${s.activo ? 'Activa' : 'Inactiva'}</span></td>
        <td style="white-space:nowrap;">
          ${SIN_VENCIMIENTO.has(s.tipo_ecf) ? '' : `<span class="enlace-accion" data-vencimiento="${esc(s.id)}" data-valor="${esc(s.vencimiento || '')}">Vencimiento</span> · `}
          <span class="enlace-accion" data-activar="${esc(s.id)}" data-activo="${s.activo ? 1 : 0}">${s.activo ? 'Desactivar' : 'Activar'}</span>
        </td>
      </tr>`).join('');
    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="card__header"><span class="card__title">Secuencias e-NCF autorizadas</span>
          <button class="btn btn-secundario btn-chico" id="ecf-nueva-secuencia">+ Registrar secuencia</button>
        </div>
        <p style="font-size:13px; color:var(--color-text-muted); margin:0 0 12px; max-width:720px;">
          Registre los rangos que autorizó la DGII en la Oficina Virtual. Para emitir se necesitan al menos E31, E32, E33 y E34;
          E44 y E45 si vende a regímenes especiales o al gobierno.
        </p>
        ${filas ? `<table class="data-table"><thead><tr><th>Tipo</th><th>Rango</th><th>Próximo</th><th>Disponibles</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table>`
          : '<div class="empty-state">Aún no hay secuencias e-NCF registradas.</div>'}
      </div>`;
  }

  function bloqueContingencia(e) {
    const activa = Boolean(e.contingenciaDesde);
    return `
      <div class="card">
        <div class="card__header"><span class="card__title">Contingencia</span>
          ${activa ? `<span class="pill-estado" style="background:var(--color-warning);">Activa desde ${fechaCorta(e.contingenciaDesde)}</span>` : ''}
        </div>
        <p style="font-size:13px; color:var(--color-text-muted); margin:0 0 12px; max-width:720px;">
          Úsela solo si el sistema no puede generar ni firmar e-CF (por ejemplo, sin certificado vigente). Mientras esté activa se
          factura con las secuencias NCF serie B registradas en Parámetros fiscales. Debe notificarla a la DGII; dura hasta 15 días
          y, al terminar, tiene 30 días para emitir los e-CF que reemplazan esos comprobantes.
          La falta de internet <strong>no</strong> es contingencia: los e-CF se siguen emitiendo y se envían después.
        </p>
        ${e.modo === 'electronico' || activa ? `<button class="btn ${activa ? 'btn-primario' : 'btn-peligro'}" id="ecf-contingencia">${activa ? 'Terminar contingencia y volver a e-CF' : 'Activar contingencia'}</button>` : ''}
      </div>`;
  }

  function pintar(e) {
    if (!contenedor()) return;
    contenedor().innerHTML = bloqueAlertas(e.alertas) + bloqueModo(e) + bloqueCertificado(e) + bloqueSecuencias(e) + bloqueContingencia(e);
    conectar(e);
  }

  function conectar(e) {
    document.getElementById('ecf-guardar-modo').addEventListener('click', async () => {
      const modo = document.getElementById('ecf-modo').value;
      const ambiente = document.getElementById('ecf-ambiente').value;
      if (modo === 'electronico' && ambiente === 'eCF' && !(e.modo === 'electronico' && e.ambiente === 'eCF')) {
        const confirmacion = await window.PuntoXModal.pedirTexto(
          'Va a emitir en PRODUCCIÓN: cada comprobante tendrá validez fiscal ante la DGII. Escriba PRODUCCION para confirmar.', '', { obligatorio: true }
        );
        if (!confirmacion) return;
        if (confirmacion.trim().toUpperCase() !== 'PRODUCCION') { mostrarError('No se cambió el ambiente: la confirmación no coincide.'); return; }
      }
      ejecutar(() => window.puntoXEcf.guardarModo({ modo, ambiente, usuarioId: usuarioId() }), 'Configuración de comprobantes guardada.');
    });
    document.getElementById('ecf-cargar-cert').addEventListener('click', async () => {
      const password = await window.PuntoXModal.pedirTexto('Contraseña del certificado digital (.p12). Luego elija el archivo:', '', { tipo: 'password', obligatorio: true });
      if (!password) return;
      try {
        const r = await window.puntoXEcf.cargarCertificado({ password, usuarioId: usuarioId() });
        if (r && r.cancelado) return;
        mostrarExito('Certificado cargado.');
        pintar(r);
      } catch (err) { mostrarError(err.message); }
    });
    const probar = document.getElementById('ecf-probar');
    if (probar) {
      probar.addEventListener('click', async () => {
        probar.disabled = true;
        probar.textContent = 'Conectando…';
        try {
          const r = await window.puntoXEcf.probarConexion();
          mostrarExito(`Conexión correcta: la DGII autenticó el certificado en el ambiente ${r.ambiente}.`);
        } catch (err) { mostrarError(err.message); }
        probar.disabled = false;
        probar.textContent = 'Probar conexión con la DGII';
      });
    }
    document.getElementById('ecf-nueva-secuencia').addEventListener('click', abrirNuevaSecuencia);
    document.querySelectorAll('[data-vencimiento]').forEach((el) => el.addEventListener('click', async () => {
      const valor = await window.PuntoXModal.pedirTexto('Fecha de vencimiento de la secuencia:', el.dataset.valor, { tipo: 'date', obligatorio: true });
      if (!valor) return;
      ejecutar(() => window.puntoXEcf.actualizarSecuencia({ tipoNcfId: el.dataset.vencimiento, vencimiento: valor, usuarioId: usuarioId() }), 'Vencimiento actualizado.');
    }));
    document.querySelectorAll('[data-activar]').forEach((el) => el.addEventListener('click', () => {
      ejecutar(() => window.puntoXEcf.actualizarSecuencia({ tipoNcfId: el.dataset.activar, activo: el.dataset.activo !== '1', usuarioId: usuarioId() }));
    }));
    const cont = document.getElementById('ecf-contingencia');
    if (cont) {
      cont.addEventListener('click', async () => {
        if (e.contingenciaDesde) {
          try {
            const r = await window.puntoXEcf.cambiarContingencia({ activar: false, usuarioId: usuarioId() });
            const reg = r.regularizacion || { regularizadas: 0, notasPorRevisar: 0 };
            mostrarExito(`Contingencia terminada. Se emitieron ${reg.regularizadas} e-CF que reemplazan los NCF serie B${reg.notasPorRevisar ? `; revise con su contador ${reg.notasPorRevisar} notas emitidas en contingencia` : ''}.`);
            pintar(r);
          } catch (err) { mostrarError(err.message); }
          return;
        }
        const motivo = await window.PuntoXModal.pedirTexto('Motivo de la contingencia (quedará en la bitácora):', '', { obligatorio: true });
        if (!motivo) return;
        ejecutar(() => window.puntoXEcf.cambiarContingencia({ activar: true, motivo, usuarioId: usuarioId() }), 'Contingencia activada: se factura con NCF serie B.');
      });
    }
  }

  function abrirNuevaSecuencia() {
    window.PuntoXModal.abrirModal('Registrar secuencia e-NCF', `
      <div class="form-grid">
        <div class="form-field" style="grid-column: span 2;"><label>Tipo de comprobante *</label>
          <select id="sec-tipo">${Object.entries(TIPOS).map(([t, n]) => `<option value="${t}">E${t} — ${n}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>Desde (número) *</label><input id="sec-desde" type="number" min="1" step="1" value="1" /></div>
        <div class="form-field"><label>Hasta (número) *</label><input id="sec-hasta" type="number" min="1" step="1" /></div>
        <div class="form-field" id="sec-venc-campo"><label>Fecha de vencimiento *</label><input id="sec-venc" type="date" /></div>
      </div>
      <p style="font-size:12px; color:var(--color-text-muted);">Use exactamente el rango y la fecha que muestra la autorización de la DGII.</p>
      <div class="form-seccion" style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secundario" id="sec-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primario" id="sec-guardar">Registrar</button>
      </div>`);
    const tipo = document.getElementById('sec-tipo');
    const actualizarVencimiento = () => {
      document.getElementById('sec-venc-campo').style.display = SIN_VENCIMIENTO.has(Number(tipo.value)) ? 'none' : '';
    };
    tipo.addEventListener('change', actualizarVencimiento);
    actualizarVencimiento();
    document.getElementById('sec-cancelar').addEventListener('click', window.PuntoXModal.cerrarModal);
    document.getElementById('sec-guardar').addEventListener('click', async () => {
      try {
        const estado = await window.puntoXEcf.registrarSecuencia({
          tipoEcf: Number(tipo.value),
          desde: Number(document.getElementById('sec-desde').value),
          hasta: Number(document.getElementById('sec-hasta').value),
          vencimiento: document.getElementById('sec-venc').value || undefined,
          usuarioId: usuarioId(),
        });
        window.PuntoXModal.cerrarModal();
        mostrarExito('Secuencia registrada.');
        pintar(estado);
      } catch (err) { mostrarError(err.message); }
    });
  }

  async function cargar() {
    if (!window.puntoXEcf) {
      contenedor().innerHTML = '<div class="empty-state">La facturación electrónica solo está disponible en la aplicación de escritorio.</div>';
      return;
    }
    try {
      pintar(await window.puntoXEcf.estado());
    } catch (err) { mostrarError(err.message); }
  }

  window.PuntoXConfigEcf = { cargar };
}());
