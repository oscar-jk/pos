// Estados de las tablas, iguales en todas las pantallas:
//  - cargando: cada tabla con cuerpo vacío muestra "Cargando…" hasta que la pantalla la llena;
//  - error: si una carga falla (promesa rechazada sin atender), las tablas que seguían cargando
//    pasan a "No se pudo cargar" con un enlace para reintentar, y se avisa arriba;
//  - vacío: lo sigue mostrando cada pantalla con su propio mensaje (.empty-state).
(function () {
  const LIMITE_CARGANDO_MS = 6000;

  function columnas(tbody) {
    const tabla = tbody.closest('table');
    const n = tabla ? tabla.querySelectorAll('thead th').length : 1;
    return n || 1;
  }

  function filaEstado(tbody, clase, contenido) {
    const tr = document.createElement('tr');
    tr.className = `estado-fila ${clase}`;
    const td = document.createElement('td');
    td.colSpan = columnas(tbody);
    td.append(contenido);
    tr.append(td);
    return tr;
  }

  function marcarCargando(tbody) {
    if (tbody.children.length > 0) return;
    const fila = filaEstado(tbody, 'estado-fila--cargando', document.createTextNode('Cargando…'));
    tbody.append(fila);
    // En cuanto la pantalla pone contenido, la fila se reemplaza sola; si nunca llega nada
    // (lista vacía que la pantalla no pinta), se quita pasado un tiempo.
    const observador = new MutationObserver(() => {
      if (!tbody.querySelector('.estado-fila--cargando') || tbody.children.length > 1) observador.disconnect();
    });
    observador.observe(tbody, { childList: true });
    setTimeout(() => { fila.remove(); observador.disconnect(); }, LIMITE_CARGANDO_MS);
  }

  function mostrarErrorGlobal(mensaje) {
    const caja = document.getElementById('mensaje-error');
    if (!caja) return;
    caja.textContent = String(mensaje || 'No se pudo completar la operación').replace(/^Error invoking remote method '.*?': Error: /, '');
    caja.style.display = 'block';
  }

  function aErrorEnTablas() {
    document.querySelectorAll('tbody .estado-fila--cargando').forEach((fila) => {
      const tbody = fila.parentElement;
      const contenido = document.createElement('span');
      contenido.append('No se pudo cargar esta lista. ');
      const enlace = document.createElement('a');
      enlace.href = '#';
      enlace.textContent = 'Reintentar';
      enlace.addEventListener('click', (e) => { e.preventDefault(); window.location.reload(); });
      contenido.append(enlace);
      fila.replaceWith(filaEstado(tbody, 'estado-fila--error', contenido));
    });
  }

  window.addEventListener('unhandledrejection', (e) => {
    const razon = e.reason && e.reason.message ? e.reason.message : e.reason;
    aErrorEnTablas();
    mostrarErrorGlobal(razon);
  });

  function iniciar() {
    document.querySelectorAll('tbody[id$="-tbody"]').forEach(marcarCargando);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  window.PuntoXEstados = { marcarCargando, aErrorEnTablas, mostrarErrorGlobal };
}());
