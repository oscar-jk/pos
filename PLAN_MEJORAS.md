# Plan de mejoras — Punto X

Plan de ejecución del prompt de mejoras (bloques A a G). Se actualiza al cerrar cada bloque.

## Punto de partida (verificado el 9 de octubre de 2026)

- La rama `auditoria/correcciones-criticas` (PR #1) **no está fusionada** en `main`. Se trabaja encima de ella.
- `npm test`: **26 de 26 pasan**, corriendo las pruebas con el Node de Electron. Con `node` directo fallan todas: `better-sqlite3` está compilado para Electron, no hay binario precompilado para Node 24 y en la máquina no hay compilador de C++. Ese es exactamente el problema de F2.
- El intento de recompilar para Node borró el binario de Electron; se restauró con `@electron/rebuild` y `npm start` vuelve a funcionar.
- Hay 14 pantallas HTML (11 `index.html` y 3 páginas extra de Ventas), 144 usos de `innerHTML` y 9 copias de la función de escape. No hay scripts ni manejadores (`onclick=`) en línea.

## Ramas y PRs

Como el PR #1 no está fusionado, las ramas van **apiladas**: cada bloque sale del anterior.

```
main ← auditoria/correcciones-criticas (PR #1) ← mejoras/a-seguridad ← mejoras/b-integridad ← mejoras/c-regresion ← …
```

Cada PR se abre contra la rama del bloque anterior. Cuando el PR #1 se fusione, se cambia la base del siguiente a `main`. Cada mejora es un commit propio con sus pruebas, y deja `npm test` en verde.

## Orden y alcance

| Bloque | Mejora | Qué se hace | Pruebas nuevas |
|---|---|---|---|
| **A** | A1 Cambio obligatorio de contraseña | Columna `usuarios.debe_cambiar_password` (migración 010a, 1 para el admin del seed), canal `auth:cambiarPassword` (actual + nueva de 8 o más, distinta). Con la marca activa, `seguro.js` y `requerirPermiso` rechazan toda operación; la app solo muestra la pantalla de cambio. | Con la marca activa no se puede facturar; el cambio valida y la quita. |
| | A2 CSP + escape | `renderer/shared/escape.js` único; las 9 copias pasan a usarlo; revisión de los 144 `innerHTML`; `<meta>` CSP en las 14 pantallas. | Prueba que lee cada HTML y exige la CSP; prueba que no quede ninguna función de escape propia; prueba de `escapar()`. |
| | A3 Permisos en vivo | Al editar los permisos de un rol se recargan los de la sesión activa si su usuario es de ese rol. | Quitar un permiso al rol activo bloquea la operación al instante. |
| **B** | B1 Migración 010 | `created_at`/`updated_at`/`deleted_at` en las 14 tablas que faltan, también en `schema.sql`. | Recorre `sqlite_master` y falla si alguna tabla no tiene las tres columnas; misma prueba sobre una base "vieja". |
| | B2 Pagos válidos | `crearFactura` rechaza al inicio pagos con monto ≤ 0, con mensaje claro. | Pago 0 y negativo rechazados con el mensaje propio. |
| | B3 Invariante global | Debe = haber; 1300 = valor del inventario (capas PEPS + existencia × promedio); 1400 = saldo CxC de todos los clientes; efectivo de cada turno abierto = fondo + movimientos. Se corre al final de cada suite. | Las propias invariantes. |
| **C** | Regresión perdida | Suites nuevas: cotización/conduce (1350), pedidos con reserva, promociones, cuentas abiertas, compras y notas (promedio y PEPS), 606 (caja chica y B04), CxP con cheques posdatados, conciliación, cierre y reapertura de periodo, transferencias con lote, conversión de producto. Cada una con flujo normal, anulación y cuadre (B3). | 12 suites. |
| **D** | D1 Atajos | F1 nueva venta, F2 precio, F3 cliente, F4 cantidad, F8 descuento, F10 cobrar, Esc cerrar, Supr quitar línea; Enter en el buscador agrega con cantidad 1. Leyenda visible. | Pruebas de interfaz con Electron sin ventana. |
| | D2 Modal de cobro | Cambio en vivo; botones 50, 100, 200, 500, 1000, 2000; la factura registra el monto exacto, el cambio solo se muestra. | Pago con billete de 1000 sobre 700: factura por 700, cambio 300. |
| | D3 Confirmar anulaciones | Número, total y qué se revierte (inventario, caja, CxC) antes de pedir el motivo con `pedirTexto`. | Por pantalla. |
| | D4 Estados | Vacío, cargando y error consistentes en las 14 pantallas (componente compartido). | Revisión por pantalla. |
| | D5 1100×700 | Sin desbordes; el carrito ocupa el espacio sobrante. | Captura a 1100×700 por pantalla. |
| **E** | E1 Comisiones | **Pregunta pendiente:** ¿sobre el subtotal sin ITBIS o sobre el total? No se toca hasta tener respuesta. | Según la respuesta. |
| | E2 Listas de precio | Pantalla de administración (el backend ya existe) + carrito con la regla acordada: categoría del cliente > sucursal > nivel. El precio de lista no cuenta como descuento manual (ajuste a la corrección 2 del PR #1). | Precio por lista con cajero no choca con su tope; prioridad de listas. |
| | E3 Conciliación por cuenta | Subcuenta contable por cuenta bancaria (o marca de cuenta bancaria en el asiento) y conciliación por cuenta. **Decisión contable: se pregunta antes de implementarla.** | Dos bancos se concilian por separado. |
| **F** | F1 Ícono e instalador | `assets/icon.ico` (256×256) y prueba de `npm run dist`. | Instalador generado y abierto. |
| | F2 Binario nativo | `test` corre con el Node de Electron (mismo binario que `npm start`): nada que recompilar. Además `rebuild:node` y `rebuild:electron` para quien quiera usar Node directo. | `npm test` sin pasos previos. |
| | F3 CI | GitHub Actions: `npm test` en cada PR, Windows y Linux. | El propio workflow. |
| **G** | Roadmap | Etiquetas de código de barras, reportes de inventario (valorización a fecha, reposición, sobre-stock, rotación), liquidación de importación, 607 y 608, flujo de caja, multi-sucursal real. | Por función. 607/608: se pregunta cualquier regla que no esté en la especificación. |

## Ajuste de orden

**F2 se adelanta al bloque A.** Sin él, `npm test` no corre con `node` y cada bloque dependería del truco del Node de Electron. Es un cambio de `package.json` y un script; va como primer commit de la rama A.

## Preguntas que se harán, una a la vez, al llegar a cada punto

1. E1: ¿las comisiones se calculan sobre el subtotal (sin ITBIS)?
2. E3: ¿cómo se separan los bancos en contabilidad: una subcuenta de 1200 por cuenta bancaria, o se mantiene 1200 y se concilia por la cuenta bancaria del documento?
3. G (607/608): las reglas de llenado que no estén en la especificación.

## Criterios de aceptación (cada entrega)

- `npm test` en verde, con pruebas nuevas que fallan sin el cambio.
- La invariante contable (B3) pasa.
- No se viola ninguna regla fija (offline, IPC, sync-ready, ITBIS incluido, anular = revertir, permisos en `main`, usuario de la sesión, fechas locales, sin `prompt()`).
- Si cambia el esquema: migración idempotente, probada sobre una copia de una base existente.
