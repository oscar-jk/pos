// Tema claro/oscuro. Sin elección guardada se sigue el del sistema (media query en styles.css);
// con elección, se fija data-theme en <html>. Se carga en todas las pantallas antes de pintar.
(function () {
  const CLAVE = 'puntox_tema';

  function guardado() {
    try { const v = localStorage.getItem(CLAVE); return v === 'light' || v === 'dark' ? v : null; } catch (e) { return null; }
  }

  function aplicar(tema) {
    if (tema) document.documentElement.setAttribute('data-theme', tema);
    else document.documentElement.removeAttribute('data-theme');
  }

  function actual() {
    return guardado() || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function alternar() {
    const nuevo = actual() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(CLAVE, nuevo); } catch (e) { /* sin almacenamiento: vale solo esta sesión */ }
    aplicar(nuevo);
    return nuevo;
  }

  // Color de marca elegido en Configuración → Negocio. Solo se usa si con texto blanco llega a
  // 4.5:1 (legibilidad) y en el tema claro; el oscuro conserva el verde azulado de Nodo.
  function luminancia(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const COLORES_BASE = ['#146356', '#0a6b68'];
  function aplicarColorMarca(hex) {
    const el = document.getElementById('puntox-color-marca');
    if (el) el.remove();
    if (!/^#[0-9a-f]{6}$/i.test(hex || '') || COLORES_BASE.includes(hex.toLowerCase())) return false;
    if (1.05 / (luminancia(hex) + 0.05) < 4.5) return false;
    const estilo = document.createElement('style');
    estilo.id = 'puntox-color-marca';
    const reglas = '--brand: ' + hex + '; --focus: ' + hex + '; --brand-tint: color-mix(in srgb, ' + hex + ' 16%, white); --brand-deep: color-mix(in srgb, ' + hex + ' 60%, black);';
    estilo.textContent = '@media (prefers-color-scheme: light) { :root:not([data-theme]) { ' + reglas + ' } } :root[data-theme="light"] { ' + reglas + ' }';
    document.head.appendChild(estilo);
    return true;
  }

  aplicar(guardado());
  window.PuntoXTema = { actual, alternar, aplicarColorMarca, luminancia };
})();
