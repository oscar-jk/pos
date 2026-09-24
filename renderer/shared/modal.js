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

window.PuntoXModal = { abrirModal, cerrarModal };
