# Punto X — Documento completo del proyecto

POS de escritorio para negocios dominicanos, creado por ODTeam X. Cubre ventas y facturación, inventario, compras, cuentas por cobrar y por pagar, caja y contabilidad con partida doble automática.

- **Repositorio:** https://github.com/oscar-jk/pos (rama `main`)
- **Documentos fuente en la carpeta:** `CLAUDE.md` (reglas del proyecto) y `Especificacion_Funcional_y_Arquitectura_POS.md` (qué debe hacer cada módulo).
- **Último commit al escribir esto:** `a88064e`.

---

## 1. Stack y arquitectura

| Capa | Tecnología |
|---|---|
| Aplicación | Electron 32, JavaScript vanilla (sin React/Vue) |
| Base de datos | SQLite con `better-sqlite3`, un archivo `.sqlite` por instalación |
| Empaquetado | `electron-builder` (`npm run dist`) — **aún no probado** |
| Interfaz | HTML/CSS/JS vanilla, una carpeta por módulo |

**Reglas de arquitectura (no reabrir sin pedirlo):**

1. **Offline-first.** Todo funciona sin internet. No hay Supabase, Vercel ni código de red. `main/sync/` está reservada y vacía.
2. **La ventana nunca toca SQLite.** Solo el proceso principal (`main/`) accede a la base de datos, a la impresión y a las ventanas. El renderer se comunica por IPC a través de `main/preload.js` (`contextBridge`, objetos `window.puntoX*`).
3. **Esquema "sync-ready":** claves primarias UUID (texto), `created_at`/`updated_at`/`deleted_at` en toda tabla, **nunca `DELETE` físico**: se anula o se desactiva. Nombres de tabla y columna en español, snake_case.
4. **El ITBIS siempre va incluido en el precio**, nunca se calcula por encima.
5. **Anulación = reversión.** Toda anulación crea el asiento espejo, reingresa inventario en los mismos lotes y al mismo costo, y revierte caja/CxC.
6. **Permisos desde el inicio.** Se exigen en el proceso principal (`session.requerirPermiso`); la interfaz solo oculta botones con `data-permiso`.
7. Todo el texto de la interfaz va en español, tono directo.
8. No improvisar reglas fiscales o contables (ITBIS, NCF/e-CF): si no están en el documento fuente, se pregunta.

## 2. Estructura de carpetas

```
main/
  main.js                 arranque, ventanas, app:info
  preload.js              puente IPC → window.puntoX*
  auth/                   session.js (permisos), password.js
  db/
    index.js              abre la BD: schema → migraciones → seed → sincroniza permisos
    schema.sql            esquema COMPLETO (instalaciones nuevas)
    migrations/           001…009, idempotentes (bases ya instaladas)
    seed.js               permisos, roles, catálogo contable, parámetros, usuario admin
  ipc/                    un archivo por módulo: ventas, inventario, compras, cxc, cxp,
                          caja, contabilidad, configuracion, auth  (register(ipcMain, getDb))
  printing/               plantillas.js (HTML imprimible) + index.js (impresión)
  sync/                   reservada, vacía
renderer/
  <modulo>/               index.html + .js + .css por módulo
  shared/                 shell.js, sidebar.js, topbar.js, modal.js, styles.css
  shared/web/             "bridges" de la demo web (datos de prueba en el navegador)
assets/fonts/             tipografías;  build/ está vacía (falta el ícono)
```

Un archivo de `main/ipc/` define las funciones de negocio, las registra como canales `ipcMain.handle('modulo:accion')` y las exporta; el `preload.js` expone cada canal; el renderer llama `window.puntoXModulo.accion(...)`.

## 3. Cómo correrlo

```bash
npm install
npm start            # Electron
npm run dist         # instalador (pendiente de configurar/probar)
```

- Usuario inicial: `admin` / contraseña temporal `admin123` (cambiarla al entrar).
- La base real vive en `%APPDATA%\punto-x\punto-x.sqlite`.
- **Para pruebas con scripts de Electron:** llamar `app.setName('punto-x')` y `app.setPath('userData', <carpeta aislada>)`; si no, el script usa otra base distinta a la de `npm start` o pisa la real.

## 4. Base de datos

64 tablas. Por módulo:

- **Base:** `roles`, `permisos`, `roles_permisos`, `usuarios`, `sucursales`, `parametros_negocio`, `bitacora_auditoria`, `tasas_itbis`, `tipos_ncf`, `monedas`, `tasas_cambio`, `impresoras_config`.
- **Inventario:** `productos`, `productos_codigos_barra`, `productos_unidades_alternativas`, `kits_componentes`, `categorias_producto`, `unidades_medida`, `almacenes`, `existencias`, `lotes` (capas de costo y vencimiento), `kardex_movimientos`, `transferencias_almacen(+detalle)`, `ajustes_inventario(+detalle)`, `mermas_averias`, `conversiones_producto`, `listas_precio(+detalle)`.
- **Ventas:** `documentos_venta` (un solo documento para factura, cotización, pedido, conduce, nota de crédito y nota de débito, según `tipo`), `documentos_venta_detalle`, `pagos_venta`, `promociones`, `cuentas_abiertas(+detalle)`, `comisiones_vendedor`.
- **CxC:** `clientes`, `categorias_cliente`, `recibos_ingreso(+aplicaciones)`, `gestion_cobros`, `cxc_empleados(+pagos)`.
- **Compras / CxP:** `proveedores`, `documentos_compra(+detalle)`, `pagos_proveedor(+aplicaciones)`, `cuentas_bancarias`, `liquidaciones_importacion(+detalle)` *(tabla creada, sin código)*.
- **Caja:** `cajas`, `turnos_caja`, `movimientos_caja`, `caja_chica`, `gastos_caja_chica`, `transferencias_caja_banco`, `conciliaciones_bancarias(+detalle)`.
- **Contabilidad:** `cuentas_contables`, `periodos_contables`, `asientos_contables(+detalle)`.

### Migraciones (cada una también está reflejada en `schema.sql`)

| Id | Contenido |
|---|---|
| 001 | Conciliación bancaria |
| 002 | Notas de crédito/débito de compra |
| 003 | Gastos de caja chica con datos del 606 |
| 004 | Cuentas abiertas |
| 005 | Cotización/conduce (`valida_hasta`, `facturado_en_id`) |
| 006 | Promociones (`nombre`, `promocion_id` en la línea) |
| 007 | Retenciones en recibos de cobro |
| 008 | Multimoneda (columnas sync-ready, USD) |
| 009 | Conversión de producto (`costo_total`) y listas de precio (categoría de cliente, % sobre detalle) |

**Cómo agregar un cambio de esquema:** editar `schema.sql` **y** crear una migración idempotente (`ALTER TABLE` solo si falta la columna) registrada en `migrations/index.js`. Las cuentas contables, permisos y parámetros nuevos se agregan en `seed.js`; `sincronizarPermisosFaltantes` los inserta al arrancar en bases existentes.

### Catálogo contable principal

`1100` Caja · `1200` Bancos · `1300` Inventario · `1350` Mercancía entregada por facturar · `1400` Clientes (CxC) · `1500` ITBIS pagado · `1510` ISR retenido por terceros · `1520` ITBIS retenido por terceros · `2100` Proveedores · `2200` ITBIS por pagar · `4100` Ingresos por ventas · `5100` Costo de ventas · `6100` Gastos operativos · `6200` Pérdida por mermas y averías · `6300` Diferencias de inventario.

## 5. Roles y permisos

Seis roles de fábrica, con permisos por acción (`modulo.entidad.accion`): **Administrador/Dueño** (todo), **Cajero/Vendedor** (límite de descuento 10 %, sin costos), **Encargado de Inventario/Almacén**, **Comprador**, **Contador**, **Cobrador/Gestor de cartera**. Se editan en Configuración → Roles y permisos. El límite de descuento por rol limita solo el descuento manual (no las promociones ni lo ya autorizado en una cotización/conduce/pedido).

## 6. Módulos: qué hace cada uno hoy

### Ventas y facturación
- Venta rápida (mostrador) y completa (cliente, crédito). Búsqueda por código, barras o descripción.
- Tres niveles de precio, ITBIS incluido, descuento por línea en % o en RD$, promociones y descuento global con tope por rol.
- Pago mixto (efectivo/tarjeta/transferencia/crédito) y validación del límite de crédito.
- **Documentos** (selector en Ventas): factura, cotización (con validez), **pedido** (reserva existencia), conduce (entrega sin facturar, cuenta puente 1350). Se factura desde cotización, pedido o uno o varios conduces del mismo cliente; anular la factura devuelve el origen a pendiente.
- Notas de crédito (devolución parcial por línea) y de débito; anulación con motivo.
- **Cuentas abiertas tipo bar/mesa** (módulo opcional, se activa en Configuración → Módulos).
- **Promociones** programadas (producto o categoría, % o RD$ por unidad, fechas); gana la mayor entre promoción y descuento manual.
- **Multimoneda:** factura en USD con la tasa del día congelada; montos en RD$ en libros.
- NCF por tipo de comprobante, retención esperada en la factura, comisión de vendedor.
- Consulta rápida de precio y existencia (buscador superior, **F2**).
- Impresión: factura (carta), tique (80 mm), cotización, pedido, conduce, precuenta, arqueo.
- Reportes: ventas por período/vendedor/artículo, comisiones, margen por factura, cobros del día, ITBIS generado, historial.

### Inventario
- Ficha con códigos de barra múltiples, unidades alternativas, kits, categorías (se pueden crear desde la ficha), stock mínimo/máximo.
- Múltiples almacenes; ajustes (entrada/salida con motivo), mermas, transferencias (el lote viaja con su vencimiento).
- **Valoración promedio ponderado o PEPS** (global en Configuración o por producto). Con PEPS o lote, la existencia se lleva en capas (`lotes`) y cada salida consume capas y registra el costo real.
- **Lotes y vencimientos** (por producto): salida primero por el que vence antes; pestaña Lotes y vencimientos; alertas con ventana configurable.
- **Conversión de producto** (saco → libras): costo y lote pasan al destino, sin asiento.
- Kardex por producto con lote; ajustes y mermas generan asiento (6300 / 6200).
- Existencia libre = existencia − reservada en pedidos.

### Compras y proveedores
- Proveedores, órdenes de compra, facturas/recepciones (con lote y vencimiento), comparación de costos.
- Notas de crédito (devolución a proveedor) y de débito (ajuste de precio), con efecto en costo promedio o en capas PEPS.
- Formato **606** de la DGII (pantalla, TXT y Excel).

### Cuentas por cobrar
- Clientes, límite y días de crédito, bloqueo por mora, estado de cuenta, antigüedad de saldos, facturas vencidas, gestión de cobros, CxC de empleados.
- **Cobro con retenciones:** si el cliente es agente de retención se registra el ISR/ITBIS retenido; salda la factura y va a 1510/1520; la caja recibe solo el dinero.

### Cuentas por pagar
- Facturas, pagos aplicados, antigüedad, próximas a vencer, cheques posdatados, saldo a favor y reembolsos de proveedor.

### Caja y tesorería
- Turnos (apertura, cierre, arqueo), movimientos, caja chica con gastos fiscales, transferencias a banco, **conciliación bancaria** (usa la cuenta 1200 completa: se asume un solo banco).

### Contabilidad
- Catálogo de cuentas, libro diario, mayor, balance de comprobación, estados financieros, periodos (cierre/reapertura), asientos manuales. Todo asiento automático se genera con `contabilidad.generarAsiento`.

### Configuración
- Negocio (nombre, RNC, dirección, teléfono, color), usuarios, roles y permisos, parámetros fiscales (tasas ITBIS, rangos NCF), parámetros de negocio, sucursales/almacenes, **impresoras**, **monedas y tasa del día**, **módulos opcionales**, bitácora de auditoría.

### Dashboard y reportes
Dashboard con indicadores y centro de alertas (stock bajo, vencimientos). Pantalla de Reportes con ventas, inventario, caja, etc.

## 7. Convenciones importantes del código

- **Costos en ventas:** nunca usar `costo_promedio` para costear una salida; usar el valor que devuelve `inventario.registrarMovimientoInventario` / `moverInventarioPorVenta` (con PEPS es el de las capas).
- **Reversiones:** usar `reingresarDocumento` / `reingresarVenta` / `retirarEntradas` para devolver mercancía a los mismos lotes y costo.
- **Transacciones:** cada canal IPC de escritura envuelve la operación en `db.transaction`.
- **Fechas:** las fechas "de día" (cortes, vencimientos) se manejan en hora local; los asientos se guardan en UTC. Usar `hoyLocal()` y `date(fecha,'localtime')`.
- **Errores:** mensajes en español, claros, sin códigos.
- **Demo web:** `renderer/shared/web/` simula el backend con datos de prueba; cada pantalla nueva debe degradarse con un mensaje cuando una API no existe en la web (`if (!window.puntoX….funcion)`).
- **Edición de archivos por script:** nunca pasar texto con `RD$`/`US$` a `String.replace` como cadena (usar `replace(a, () => b)`); nunca reescribir fuentes con `Set-Content` de PowerShell (daña acentos).

## 8. Estado del proyecto

### Hecho y probado
Ventas completas (incluye cotización, pedido, conduce, cuentas abiertas, promociones, multimoneda, impresión), inventario con PEPS/lotes/conversión/mermas, compras con notas y 606, CxC con retenciones, CxP, caja con conciliación, contabilidad, permisos, bitácora, módulos opcionales.

### Facturación electrónica (e-CF, Ley 32-23)
Rama `fe/facturacion-electronica`. Detalle completo en `docs/FACTURACION_ELECTRONICA.md`.

**Como emisor:**
- Comprobantes E31, E32, E33, E34, E44 y E45, firmados con el certificado `.p12` y validados contra los XSD oficiales.
- Resumen RFCE para el consumo menor a RD$250,000.
- Cola de envío a la DGII que funciona sin internet (contingencia de 72 horas).
- Anulación de secuencias (ANECF).
- Representación impresa con QR y código de seguridad.
- Entrega al comprador electrónico.
- Contingencia con serie B y su regularización al terminarla.

**Como receptor:**
- Acuse de recibo (ARECF).
- Aprobación comercial (ACECF).
- Importación del XML de los proveedores.

**Pendiente:**
- Publicar en internet los servicios del receptor, que la DGII exige para certificar.
- Cuatro decisiones fiscales, listadas en el documento: E44 exento, nota de crédito después de 30 días, retenciones en el E31, E41/E43.

### Parcial (hay código pero falta cerrar)
- **Listas de precio:** el backend existe (`inventario.js`: crear/editar/desactivar, `listasParaVenta`, `precioSegunListas`; regla acordada: **lista de la categoría del cliente > lista de la sucursal > nivel de precio normal**) y está probado. **Falta:** la pantalla para administrarlas y conectarlas al carrito de Ventas (aplicar el precio y mostrarlo).
- **Conversión de producto:** backend y pestaña listos; la pestaña no tiene prueba de interfaz.
- **Liquidación de importación:** solo existen las tablas.

### Pendiente (en el orden acordado)
1. Listas de precio: pantalla + integración con Ventas.
2. **Etiquetas** de código de barra y precio (individual y en lote) — permiso `inventario.etiqueta.imprimir` ya creado.
3. **Reportes de inventario:** valorización a fecha (comparable entre dos fechas), reposición sugerida, sobre-stock, bitácora de movimientos, rotación.
4. **Compras:** liquidación de importación, presupuesto de compra, recepción sin factura.
5. **Proyecciones** de cobros y pagos, flujo de caja, historial de cobros por vendedor.
6. **Multi-sucursal real** (hoy hay sucursales y almacenes, pero el flujo es de una).
7. Formatos **607** y **608** de la DGII (acordado incluirlos).
8. **Instalador:** `electron-builder` configurado, pero falta `assets/icon.ico` / ícono en `build/` y probar `npm run dist`.
9. Fuera de alcance acordado: **delivery** (se decidió no incluirlo) y sincronización con Supabase/Vercel (fase futura).

### Decisiones tomadas con el usuario
- Cuentas abiertas: tipo bar/mesa, módulo opcional.
- Conduce: cuenta puente 1350; se factura uno o varios del mismo cliente, completos.
- Mermas y ajustes: cuentas separadas 6200 y 6300.
- Retenciones: se registran **al cobrar** (no al facturar).
- Multimoneda: facturar en USD con libros en RD$; sin diferencial cambiario por ahora; cotizaciones/pedidos/conduces solo en RD$.
- Promociones: se aplica la mayor entre promoción y descuento manual.
- 606 incluye caja chica y notas B04 como línea propia.

## 9. Pruebas — aviso importante

Durante el desarrollo se verificó cada módulo con **scripts de Electron sin ventana** (backend con la base real aislada + pruebas de interfaz con ventana oculta): unas 25 suites con más de 600 comprobaciones, todas en verde al cierre de cada entrega (cotización/conduce, lotes/PEPS, promociones, pedidos, retenciones, multimoneda, conversiones, impresión, conciliación, notas de compra, 606, cuentas abiertas).

**Esos scripts vivían en la carpeta temporal de la sesión y se perdieron; no están en el repositorio.** La última entrega (conversión de producto y listas de precio) sí se probó (14 comprobaciones) y las migraciones se verificaron sobre una copia de la base real, pero la regresión completa no se pudo repetir después. Recomendación: recrear un set de pruebas dentro del repo (carpeta `tests/`) antes de seguir añadiendo funciones.

Cómo se probaba, para replicarlo: script con `app.setName('punto-x')` + `app.setPath('userData', carpeta_aislada)`; para el backend, `require('main/db')`, iniciar sesión con `session.iniciarSesion` y llamar las funciones de `main/ipc/*.js` dentro de `db.transaction`; para la interfaz, `BrowserWindow` oculto con `preload.js`, registrar los `register(ipcMain, getDb)` y manejar `app:info` (replica de `main.js`), y `executeJavaScript` para interactuar. Las capturas con ventana oculta salen desfasadas; usar `offscreen: true`.

## 10. Puntos de atención para mejorar

- **Seguridad:** cambiar `admin123`; el hash de contraseña está en `main/auth/password.js`; no hay bloqueo por intentos fallidos.
- **Reapertura de periodos contables y bitácora:** probadas, pero revisar permisos finos con un contador real.
- **Conciliación bancaria** asume un solo banco (1200 completo); lo natural es conciliar por cuenta bancaria.
- **Impresión:** usa el diálogo nativo (`silent:false`); no se probó con impresora térmica real.
- **Ícono/instalador** pendientes; **auto-actualización** no considerada.
- **Demo web** (`renderer/shared/web`) cubre solo lo básico; no replica PEPS, promociones ni multimoneda.
- Warnings de Git por finales de línea (LF/CRLF): conviene fijar un `.gitattributes`.
