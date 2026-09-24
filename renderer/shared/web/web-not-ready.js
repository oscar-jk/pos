// Colócalo como el ÚLTIMO <script> de una pantalla que todavía no está portada a la versión
// web (Compras, Contabilidad, Reportes, Configuración). En Electron no hace nada. En un
// navegador normal, reemplaza la pantalla (ya renderizada, rota, porque falta su bridge) por
// un aviso claro en vez de dejar una página en blanco o llena de errores de consola.
(function () {
  if (window.puntoX) return;
  document.body.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; min-height:100vh; font-family:'Manrope', system-ui, sans-serif; text-align:center; padding:24px; background:#f4f5f1;">
      <div style="max-width:420px;">
        <div style="font-size:40px; margin-bottom:12px;">🚧</div>
        <h1 style="font-size:19px; margin:0 0 10px; color:#1e2624;">Este módulo aún no está en la versión web de prueba</h1>
        <p style="color:#6b7674; font-size:14px; line-height:1.5;">Ya funciona completo en la app de escritorio. Se irá agregando aquí en las próximas actualizaciones.</p>
        <a href="../dashboard/index.html" style="display:inline-block; margin-top:16px; color:#146356; font-weight:700; text-decoration:none;">← Volver al Dashboard</a>
      </div>
    </div>`;
})();
