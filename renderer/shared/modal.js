// Modal genérico compartido. abrirModal(tituloHtml, contenidoHtml) inserta el overlay en el
// body; cada módulo arma su propio formulario como HTML y engancha sus propios listeners
// después de llamar a esta función.
function abrirModal(titulo, contenidoHtml) {
  cerrarModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay-compartido';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-box__header">
        <h2>${titulo}</h2>
        <button class="modal-cerrar" id="modal-btn-cerrar">✕</button>
      </div>
      <div id="modal-contenido">${contenidoHtml}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('modal-btn-cerrar').addEventListener('click', cerrarModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModal(); });
  return document.getElementById('modal-contenido');
}

function cerrarModal() {
  const existente = document.getElementById('modal-overlay-compartido');
  if (existente) existente.remove();
}

function escModal(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Reemplazo de window.prompt(), que Electron no implementa (devuelve vacío sin mostrar nada).
// Usa su propia capa, encima de cualquier modal abierto (p.ej. pedir una categoría desde la
// ficha de producto). Devuelve el texto escrito, o null si se cancela.
function pedirTexto(mensaje, valorInicial = '', { tipo = 'text', obligatorio = true } = {}) {
  return new Promise((resolve) => {
    const capa = document.createElement('div');
    capa.className = 'modal-overlay';
    capa.style.zIndex = '2000';
    capa.innerHTML = `
      <form class="modal-box" style="max-width:440px">
        <div class="modal-box__header"><h2>${escModal(mensaje)}</h2></div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
          <input class="input-normal" style="width:100%" name="valor" type="${tipo}" ${tipo === 'number' ? 'step="any"' : ''} value="${escModal(valorInicial)}" autocomplete="off">
          <p class="pedir-error" style="color:#b42318;font-size:13px;margin:0;display:none">Este dato es obligatorio.</p>
          <div style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" class="btn btn-secundario" data-cancelar>Cancelar</button>
            <button type="submit" class="btn btn-primario">Aceptar</button>
          </div>
        </div>
      </form>`;
    document.body.appendChild(capa);
    const input = capa.querySelector('input');
    input.focus();
    input.select();
    const terminar = (valor) => { capa.remove(); document.removeEventListener('keydown', onKey, true); resolve(valor); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); terminar(null); } };
    document.addEventListener('keydown', onKey, true);
    capa.querySelector('[data-cancelar]').addEventListener('click', () => terminar(null));
    capa.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (obligatorio && !v) { capa.querySelector('.pedir-error').style.display = 'block'; input.focus(); return; }
      terminar(v);
    });
  });
}

window.PuntoXModal = { abrirModal, cerrarModal, pedirTexto };
