// Lógica pura del mostrador (sin DOM): cobro en efectivo con cambio y mapa de atajos de teclado.
// Se carga como script en la pantalla de Ventas y también se importa desde las pruebas.
(function () {
  const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Billetes de acceso rápido del modal de cobro.
  const BILLETES = [50, 100, 200, 500, 1000, 2000];

  // Lo que se factura en efectivo es lo que se debe, nunca el billete entregado: el cambio solo
  // se muestra. Si el cliente entrega menos de lo que falta, el efectivo es lo entregado y el
  // resto queda para otra forma de pago o crédito.
  //   total: total de la venta en la moneda del documento
  //   tarjeta, transferencia: ya digitados
  //   recibido: lo que entregó el cliente en efectivo
  function calcularCobroEfectivo({ total, tarjeta = 0, transferencia = 0, recibido = 0 }) {
    const pendiente = redondear(Math.max(0, total - tarjeta - transferencia));
    const entregado = Math.max(0, redondear(recibido));
    const efectivo = Math.min(pendiente, entregado);
    return { efectivo, cambio: redondear(Math.max(0, entregado - efectivo)), faltante: redondear(Math.max(0, pendiente - efectivo)) };
  }

  // Atajos de la pantalla de Ventas. Devuelve el nombre de la acción o null.
  const ATAJOS = {
    F1: 'nueva_venta',
    F2: 'consultar_precio',
    F3: 'cliente',
    F4: 'cantidad',
    F8: 'descuento',
    F10: 'cobrar',
    Delete: 'quitar_linea',
    Escape: 'cerrar',
  };

  function accionDeTecla(tecla, { enCampoDeTexto = false, modalAbierto = false } = {}) {
    const accion = ATAJOS[tecla] || null;
    if (!accion) return null;
    if (modalAbierto) return null; // dentro de un modal las teclas son del modal
    // Suprimir dentro de un campo borra texto, no la línea del carrito.
    if (accion === 'quitar_linea' && enCampoDeTexto) return null;
    return accion;
  }

  const api = { calcularCobroEfectivo, accionDeTecla, BILLETES, ATAJOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PuntoXCobro = api;
}());
