// Cuentas por Pagar: el módulo completo (Compras y Proveedores) todavía no está portado a la
// versión web. Este stub solo evita que el Dashboard truene al pedir estos dos reportes —
// siempre devuelve "sin datos", porque en la web no hay documentos de compra todavía.
(function () {
  if (window.__PUNTOX_ES_ELECTRON) return;
  window.puntoXCxp = {
    antiguedadSaldos: async () => [],
    facturasProximasAVencer: async () => [],
    chequesPosdatadosPendientes: async () => [],
    facturasAbiertas: async () => [],
    listarPagos: async () => [],
    crearPago: async () => { throw new Error('Cuentas por Pagar aún no está disponible en la versión web de prueba'); },
    anularPago: async () => { throw new Error('Cuentas por Pagar aún no está disponible en la versión web de prueba'); },
    marcarChequeCobrado: async () => {},
  };
})();
