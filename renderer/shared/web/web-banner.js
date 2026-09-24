// Aviso fijo en la versión web de prueba: dejar clarísimo que esto no es la app real (los
// datos viven solo en este navegador) y dar un botón para reiniciar la demo desde cero.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#146356; color:#fff; font-size:12px; padding:6px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; font-family:Manrope, system-ui, sans-serif;';
    banner.innerHTML = `
      <span>🧪 Versión web de prueba de Punto X — los datos se guardan solo en este navegador, no en un servidor.</span>
      <button id="__puntox-reset-demo" style="background:rgba(255,255,255,0.15); color:#fff; border:1px solid rgba(255,255,255,0.4); border-radius:6px; padding:3px 10px; font-size:11px; cursor:pointer;">Reiniciar datos de prueba</button>
    `;
    document.body.prepend(banner);
    document.getElementById('__puntox-reset-demo').addEventListener('click', () => {
      if (confirm('¿Borrar todos los datos de prueba de este navegador y empezar de nuevo?')) {
        window.PuntoXWebStore.reiniciar();
        sessionStorage.removeItem('punto-x-web-sesion');
        window.location.href = '../login/index.html';
      }
    });
  });
})();
