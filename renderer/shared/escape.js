// Escape de HTML compartido por todas las pantallas. Todo dato que venga de la base (nombres,
// descripciones, motivos, notas, números de documento...) y se inserte con innerHTML pasa por
// esc(). Se carga primero en cada página, antes que cualquier otro script.
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.PuntoXEscape = { esc };
