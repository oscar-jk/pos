# Especificación Funcional de un POS Competitivo: Módulos, Roles y Permisos

2026-09-20 · @Someone

## Alcance y Metodología

Este documento define la especificación funcional completa de un sistema de Punto de Venta (POS) de escritorio, diseñado desde cero para gestionar el ciclo comercial completo de un negocio: ventas, inventario, compras, cuentas por cobrar, cuentas por pagar, caja/tesorería y contabilidad.

El diseño parte de los siguientes principios generales, transversales a todos los módulos:

- Todo documento comercial (factura, compra, ajuste, movimiento de caja) queda registrado de forma permanente; nada se borra físicamente, todo se anula o revierte con trazabilidad
- El precio de venta de cada producto se registra con el ITBIS ya incluido; el sistema desglosa internamente base imponible e impuesto, y lo muestra desglosado en cada factura
- Cada operación comercial genera automáticamente su contrapartida contable en partida doble, sin que el usuario registre asientos manuales para el flujo normal del negocio
- Los roles y permisos se definen por acción (crear, editar, anular, ver costos, aplicar descuentos, ver reportes financieros), no solo por módulo

A partir de estos principios, se definieron 7 módulos núcleo — cada uno detallado en las secciones siguientes — más una capa transversal de roles, permisos y configuración general:

1. Ventas y Facturación
2. Inventario y Almacenes
3. Compras y Proveedores
4. Cuentas por Cobrar y Clientes
5. Cuentas por Pagar
6. Caja y Tesorería
7. Contabilidad

Nómina y BI ejecutivo quedan fuera del núcleo por ahora: nómina es un dominio legal aparte (TSS, ISR, prestaciones laborales) y el BI ejecutivo depende del volumen real de datos que termine manejando el negocio. Se retoman si hacen falta.

## Módulo 1: Ventas y Facturación

**Objetivo:** front-end operativo de venta — captura la transacción comercial y dispara el resto del sistema (inventario, CxC, caja, contabilidad).

**Documentos que debe generar:**

- Cotización (sin compromiso; no afecta inventario ni CxC)
- Pedido/orden de venta (reserva inventario; todavía no factura)
- Factura de venta (al contado o a crédito)
- Nota de entrega/conduce (mueve inventario sin facturar, para entregas previas a la factura)
- Nota de crédito por devolución (reingresa inventario, reduce CxC o genera saldo a favor)
- Nota de débito de venta (cargos post-factura: flete, ajuste de precio)

**Funcionalidades obligatorias:**

- Búsqueda de producto por código, código de barras o descripción parcial con autocompletar
- Mínimo 3 niveles de precio por producto (detalle, mayorista, distribuidor), seleccionables por cliente o categoría de cliente
- Descuentos en tres niveles: por línea (manual, ingresable como porcentaje % o como monto fijo en RD$ — el sistema calcula el otro valor automáticamente), por promoción programada (producto/categoría, con fecha de inicio y fin), y descuento global a factura con tope máximo configurable por rol
- El ITBIS va incluido en el precio final que se registra en la ficha del producto (precio con impuesto incluido, no calculado por encima) — el sistema descompone internamente ese precio en base imponible más ITBIS según la tasa configurada. En la factura, las líneas muestran el precio final que paga el cliente, y al pie se desglosa el ITBIS total contenido en la venta, tal como exige el comprobante fiscal
- Condiciones de pago: contado, crédito (validando límite de crédito del cliente antes de guardar la factura), y pago mixto (efectivo + tarjeta + transferencia en la misma factura)
- Retención de impuestos cuando el cliente es agente de retención (% de ISR/ITBIS retenido)
- Selección de tipo de comprobante fiscal (NCF/e-CF) según el tipo de cliente: consumo, crédito fiscal, gubernamental, régimen especial
- Anulación de factura con motivo obligatorio y reversión automática de inventario, CxC y caja — nunca borrado físico
- Devolución parcial por líneas específicas, no solo devolución de la factura completa
- Dos modos de venta: rápida (mostrador, sin cliente registrado) y completa (con cliente, crédito, dirección de entrega)
- Delivery con repartidor asignado, dirección, tiempo estimado y estado (pendiente/en ruta/entregado)
- Multi-moneda con tasa de cambio del día, congelada en el momento de facturar
- Comisión de vendedor calculada automáticamente por línea o por factura según el % configurado en su ficha, acumulada en un reporte de comisiones pendientes de pago
- Consulta rápida de precio y existencia sin necesidad de crear un documento, para atención en mostrador

**Reglas de negocio críticas:**

- No se factura por debajo de la existencia disponible salvo permiso explícito de "venta en negativo"
- Toda factura a crédito valida saldo disponible (límite − saldo actual) antes de permitir guardar
- Una factura anulada nunca reutiliza su número; queda visible como anulada en el historial

**Reportes:**

- Ventas por Período: filtrable por rango de fecha, sucursal, vendedor, cliente y tipo de comprobante; agrupable por día, semana o mes; muestra subtotal, descuentos, ITBIS y total neto
- Ventas por Vendedor: ranking por monto vendido y número de facturas en el periodo
- Ventas por Artículo: cantidad vendida e ingreso generado por producto, ordenable por más vendido o mayor margen
- Comisiones por Vendedor: comisión generada, pagada y pendiente por periodo, exportable para el proceso de pago
- Historial de Facturas y Anulaciones: estado, motivo de anulación cuando aplique, y usuario que anuló
- Margen de Beneficio por Factura: costo vs. precio de venta línea por línea, con % de margen y utilidad bruta
- Resumen de Cobros del Día: total facturado vs. total cobrado por efectivo, tarjeta, transferencia y crédito, para cruzar contra caja
- Productos Más y Menos Vendidos: ranking ascendente/descendente por cantidad o por ingreso
- Tiempo de Entrega (Delivery): promedio entre creación del pedido y entrega, por repartidor y por zona
- ITBIS Generado en Ventas: total cobrado en el periodo, desglosado por tasa, como insumo directo para la declaración mensual ante DGII

## Módulo 2: Inventario y Almacenes

**Objetivo:** control físico y valorativo de existencias en tiempo real, en uno o varios almacenes/sucursales.

**Funcionalidades obligatorias:**

- Ficha de producto: código interno, uno o varios códigos de barra (presentaciones distintas del mismo ítem), unidad de medida base y unidades alternativas con factor de conversión (ej: caja = 24 unidades), tasa de ITBIS asignada (18%/reducida/exenta) y precio de venta con el ITBIS ya incluido — el sistema calcula y guarda por separado la base imponible y el impuesto contenido
- Kits/combos: producto compuesto por otros productos, que descuenta inventario de cada componente al vender el kit, no del kit como ítem independiente
- Múltiples almacenes con existencia independiente por almacén
- Transferencia entre almacenes (documento con origen/destino, afecta ambos en tiempo real)
- Ajuste de inventario (entrada o salida manual) con motivo obligatorio: conteo físico, merma, corrección de sistema
- Registro de averías/mermas como movimiento distinto al ajuste general, para reportar pérdida por daño separada de pérdida por error de conteo
- Control de lotes y fecha de vencimiento, configurable por producto (no obligatorio para todos)
- Alertas automáticas: stock mínimo alcanzado, stock máximo excedido, productos próximos a vencer (ventana configurable, ej. 30 días)
- Método de valoración configurable por producto o global: Promedio Ponderado (recalcula costo unitario en cada compra) o PEPS (mantiene capas de costo por lote de entrada)
- Kardex por producto: historial cronológico de entradas, salidas, saldo y costo, consultable por rango de fecha
- Conversión de producto (ej: 1 saco de 50kg en 50 unidades de 1kg) con trazabilidad del producto origen y destino
- Impresión de etiquetas de código de barra y precio, individual o en lote, para anaquel y para caja
- Listas de precio como configuraciones nombradas y reutilizables, asignables por sucursal y por categoría de cliente

**Reportes que debe producir:**

- Existencia por Almacén y Consolidada: cantidad disponible, comprometida en pedidos abiertos y disponible real, por almacén y a nivel de negocio
- Valorización de Inventario a Fecha: costo total según el método de valoración configurado, comparable entre dos fechas
- Kardex por Producto: movimientos cronológicos (entrada, salida, ajuste, transferencia) con saldo y costo tras cada movimiento, filtrable por fecha y tipo
- Reposición Sugerida: productos bajo su punto de reorden, con cantidad sugerida según consumo histórico
- Sobre-stock: productos con exceso de inventario, útil para promociones de liquidación
- Vencimientos Próximos: productos por lote dentro de la ventana de alerta, ordenados por urgencia
- Mermas y Averías: pérdida por daño en el periodo, valorizada al costo, por producto y almacén
- Bitácora de Movimientos: log completo de entradas, salidas, transferencias y ajustes con usuario y hora
- Rotación de Inventario: índice de rotación por producto o categoría (costo de ventas ÷ inventario promedio), para detectar baja rotación

## Módulo 3: Compras y Proveedores

**Objetivo:** abastecimiento — desde la necesidad de compra hasta la actualización de costo e inventario.

**Documentos:**

- Orden de compra (compromiso con el proveedor; no afecta inventario)
- Recepción/entrada de mercancía (sí afecta inventario; puede ser parcial contra una orden de compra)
- Factura de compra (registra el costo y genera CxP si es a crédito)
- Liquidación de mercancía importada (distribuye flete, seguro y aranceles proporcionalmente entre los productos de una o varias entradas, recalculando el costo real)
- Nota de crédito/débito de compra (devolución a proveedor o ajuste de costo)

**Funcionalidades obligatorias:**

- Comparación de mejor costo histórico por proveedor para el mismo producto
- Recepción parcial de una orden de compra (si llega el 60% del pedido, el 40% queda pendiente)
- Actualización automática del costo del producto según el método de valoración configurado
- Registro del NCF del proveedor recibido, para deducción fiscal y reporte 606 de DGII
- Términos de compra: contado o crédito con días, con validación de vencimiento
- Presupuesto/cotización de compra sin compromiso, para comparar precios antes de ordenar
- Devolución a proveedor con reversión de inventario y generación de nota de crédito a favor

**Reglas de negocio:**

- Solo la entrada de mercancía mueve inventario; la orden de compra y el presupuesto son documentos de intención
- El costo del producto se actualiza únicamente con la entrada real, nunca con la orden de compra

**Reportes:**

- Historial de Compras: por proveedor y periodo, con estado (pagada, pendiente, parcial)
- Comparación de Mejor Costo: mismo producto entre distintos proveedores, con fecha de última compra y variación de precio
- Compras por Producto: cantidad comprada y costo acumulado en un periodo, para negociar volumen
- Órdenes de Compra Pendientes de Recepción: parcial o total, con porcentaje ya recibido
- Compras 606: reporte formateado para el envío mensual del formato 606 de compras a DGII

## Módulo 4: Cuentas por Cobrar y Clientes

**Objetivo:** gestionar el crédito otorgado a clientes y su cobro.

**Funcionalidades obligatorias:**

- Ficha de cliente: límite de crédito, días de crédito por defecto, categoría (para lista de precio automática)
- Recibo de ingreso (cobro) aplicado a una o varias facturas específicas, no solo a un monto genérico contra el saldo total
- Pago parcial dejando balance abierto por factura individual, no promediado entre todas las facturas del cliente
- Nota de crédito a favor del cliente (devolución, descuento post-facturación, corrección de error)
- Nota de débito (cargo adicional: interés por mora, flete no facturado)
- Gestión de cobros: seguimiento de llamadas y gestiones de cobranza, con fecha de próximo contacto y notas de cada interacción
- Antigüedad de saldos (0-30, 31-60, 61-90, +90 días) para priorizar cobranza
- Bloqueo automático de nuevas facturas a crédito cuando el cliente supera su límite o tiene facturas vencidas más allá de X días configurables
- Estado de cuenta por cliente, exportable e imprimible
- Cuentas por cobrar a empleados: registro de consumos en el local, préstamos y anticipos por empleado, con saldo pendiente visible en su ficha y descuento sugerido para la próxima nómina — así ese monto no se pierde aunque la nómina en sí quede fuera del núcleo por ahora

**Reportes:**

- Listado de CxC: saldo actual por cliente, filtrable por vendedor, sucursal o categoría
- Antigüedad de Saldos (Aging): tramos 0-30, 31-60, 61-90 y +90 días, con monto y % del total por tramo
- Facturas Vencidas: ordenadas por días de mora, con datos de contacto del cliente
- Gestión de Cobros: historial de contactos, próxima fecha de seguimiento y resultado de la última gestión
- Historial de Pagos: por cliente y por vendedor, para medir efectividad de cobranza
- Notas de Crédito y Débito Emitidas: motivo y monto, para controlar por qué se ajustó el saldo de un cliente
- Proyección de Cobros: monto esperado por periodo futuro según las fechas de vencimiento de las facturas a crédito
- CxC de Empleados: saldo pendiente por préstamos, anticipos y consumos, con sugerencia de descuento a aplicar en la próxima nómina

## Módulo 5: Cuentas por Pagar

**Objetivo:** gestionar las obligaciones con proveedores y su pago oportuno.

**Funcionalidades obligatorias:**

- Registro automático del pasivo al confirmar una compra a crédito, sin paso manual adicional
- Programación de pagos con fecha de vencimiento y prioridad
- Pago a proveedor: efectivo, transferencia, o cheque — incluyendo cheque posdatado con seguimiento de cuándo se hace efectivo, algo muy usado en pagos B2B en RD
- Pago parcial contra una factura de compra específica, con balance abierto trazable
- Antigüedad de saldos por pagar
- Alertas de facturas proximas a vencer, para evitar mora o pérdida de descuento por pago pronto

**Reportes:**

- Listado de CxP: saldo por proveedor, filtrable por antigüedad o urgencia
- Antigüedad de Saldos por Pagar: tramos por días de mora, con monto por tramo
- Facturas Próximas a Vencer: días restantes, para priorizar pago y aprovechar descuentos por pago pronto
- Cheques Posdatados Pendientes: fecha de emisión, fecha de cobro, banco y estado
- Flujo de Pagos Proyectado: monto a pagar por semana o mes según vencimientos

## Módulo 6: Caja y Tesorería

**Objetivo:** control del efectivo y equivalentes de efectivo, y su conciliación con lo que el sistema espera.

**Funcionalidades obligatorias:**

- Apertura de caja con fondo inicial registrado antes de la primera venta del día
- Cierre de caja: efectivo físico contado contra efectivo esperado (ventas en efectivo del turno + fondo inicial — gastos de caja chica pagados en efectivo), registrando automáticamente sobrante o faltante
- Caja chica independiente de la caja de ventas, con reposición periódica y comprobante de gasto obligatorio
- Movimientos manuales de caja (entrada/salida) con concepto obligatorio
- Transferencia entre caja y cuenta bancaria (depósito de efectivo)
- Conciliación bancaria: comparar movimientos del sistema contra el estado de cuenta real, marcando partidas conciliadas y detectando diferencias (cheques en tránsito, cargos bancarios no registrados)
- Soporte de múltiples cajas si el negocio tiene más de un punto de cobro

**Reportes:**

- Arqueo de Caja por Turno/Día: efectivo esperado vs. contado, diferencia y usuario responsable
- Historial de Sobrantes/Faltantes: acumulado por usuario y por caja, para detectar patrones
- Movimientos de Caja Chica: gasto por categoría/concepto, con comprobante adjunto
- Conciliación Bancaria: partidas conciliadas vs. pendientes, por cuenta y periodo
- Flujo de Caja Diario/Semanal: entradas y salidas de efectivo consolidadas de todas las cajas

## Módulo 7: Contabilidad

**Objetivo:** consolidar en partida doble todo lo que ocurre en los módulos anteriores, sin que el usuario tenga que registrar asientos manuales para la operación normal.

**Funcionalidades obligatorias:**

- Catálogo de cuentas configurable, con cuentas mínimas: Caja, Bancos, Inventario, Clientes (CxC), Proveedores (CxP), Ingresos por ventas, Costo de ventas, Gastos operativos, ITBIS por pagar, ITBIS pagado (crédito fiscal), Capital/Patrimonio
- Generación automatica de asiento contable detras de cada operación: venta, compra, cobro, pago, ajuste de inventario, movimiento de caja
- Asientos manuales solo para casos sin módulo origen: depreciación, provisiones, corrección contable
- Libro diario y libro mayor consultables por cuenta y periodo
- Balance de comprobación (sumas y saldos)
- Estados financieros (Estado de Resultados y Balance General) generados a partir de los asientos, no capturados aparte
- Cierre de periodo mensual/anual que bloquea la edición de transacciones ya cerradas, salvo reapertura explícita con permiso elevado

**Regla de diseño clave:** el usuario del POS nunca ve "debe/haber" en su flujo normal — factura, cobra, compra, paga — y el sistema traduce eso a partida doble por debajo. Solo un perfil contable accede directamente al libro mayor y a los asientos manuales.

## Roles, Permisos y Configuración General

**Roles propuestos** (definir esto ahora evita rehacer la seguridad después, aunque el sistema termine siendo mono-usuario en su primera versión):

1. **Administrador/Dueño** — acceso total: configuración de impuestos, catálogo contable, reapertura de periodos cerrados.
2. **Cajero/Vendedor** — factura, cobra, consulta inventario en solo lectura, no ve costos de producto, no accede a contabilidad ni a compras.
3. **Encargado de Inventario/Almacén** — ajustes de inventario, transferencias, recepción de mercancía, ve costos, no factura ni cobra.
4. **Comprador** — crea órdenes de compra y registra facturas de compra, no aprueba pagos.
5. **Contador** — solo lectura en todos los módulos operativos, acceso completo a contabilidad, cierre de periodos y asientos manuales.
6. **Cobrador/Gestor de cartera** — solo el módulo de CxC: recibos de ingreso, gestión de llamadas, no factura.

**Permisos a nivel de acción, no solo de módulo:** cada rol necesita permisos independientes para crear, editar, anular, ver costos (frente a solo ver precio de venta), aplicar descuentos por encima de un límite, y ver reportes financieros. Un cajero puede necesitar "crear factura" pero nunca "anular factura" — eso exige un rol superior o una autorización puntual.

**Configuración general que esto requiere:**

- Parámetros fiscales: tasas de ITBIS por categoría de producto, tipos de NCF/e-CF disponibles y su numeración
- Parámetros de negocio: días de crédito por defecto, límite de descuento por rol, ventana de alerta de vencimiento de inventario
- Bitácora de auditoría transversal — quién creó, editó o anuló qué documento y cuándo, en todos los módulos, no solo en facturación
- Multi-sucursal si aplica: cada sucursal con su propia caja e inventario, con reportes consolidados a nivel de negocio
- Configuración de impresoras y formatos de impresión: factura, tique y etiqueta de código de barra/precio
- Motor de alertas centralizado en el dashboard: productos próximos a vencer o bajo mínimo (Módulo 2), facturas de clientes vencidas o pagadas fuera de plazo (Módulo 4), facturas por pagar próximas a vencer (Módulo 5) y empleados con saldo de préstamo/consumo pendiente — cada alerta enlaza directo al registro que la origina

## Arquitectura Técnica

El sistema se diseña **offline-first**: la aplicación de escritorio funciona por completo sin conexión a internet, con su propia base de datos local. La nube (Supabase) y la vista web (Vercel) son capas que se agregan después, sin cambiar el motor local. Por ahora se construye y se prueba todo en local; la sincronización queda diseñada desde ya pero no se implementa en esta fase.

Componentes del sistema completo:

1. Aplicación de escritorio — offline, motor principal, única fuente de verdad mientras no hay sincronización
2. Base de datos local (SQLite)
3. Módulo de sincronización — fase futura, hacia Supabase
4. Vista web de solo lectura — fase futura, en Vercel, alimentada por Supabase una vez exista sincronización

## Plataforma de Escritorio y Lenguaje

Propuesta: **Electron + JavaScript vanilla** (HTML/CSS/JS, el mismo stack que ya usas), en lugar de introducir React, Vue o un framework nuevo solo para esto.

¿Por qué Electron y no Tauri? Tauri produce instaladores más livianos, pero su capa nativa está en Rust — cualquier lógica que no sea interfaz pura (acceso a archivos, SQLite, impresión de tickets) termina necesitando código Rust o un plugin de terceros. Electron es Chromium + Node.js: interfaz y lógica de negocio se escriben enteramente en JavaScript, y el ecosistema npm da acceso directo a `better-sqlite3` para la base de datos local sin fricción ni lenguaje adicional que aprender.

Estructura interna de la aplicación:

- **Proceso principal** (`main`, Node.js): acceso a SQLite, impresión de facturas y etiquetas, ciclo de vida de ventanas.
- **Proceso de renderizado** (`renderer`): las pantallas ya diseñadas (Dashboard, Ventas, Inventario, etc.) en HTML/CSS/JS vanilla, comunicándose con el proceso principal por IPC (`ipcRenderer` / `ipcMain`) — la ventana nunca toca la base de datos directamente, para mantener una sola fuente de verdad y una sola capa de validación de reglas de negocio.
- **Empaquetado**: `electron-builder`, genera un instalador `.exe` para Windows (y `.dmg` si algún día hace falta Mac).

Si más adelante el proyecto crece y la cantidad de estado en pantalla se vuelve difícil de manejar en JS puro, Alpine.js es la vía de menor fricción para agregar reactividad sin cambiar de paradigma ni de build tooling — se evalúa si realmente hace falta, no se agrega por defecto.

## Base de Datos Local y Esquema "Sync-Ready"

**SQLite** como motor local: cero configuración, un solo archivo, transaccional (ACID), y ya es parte de tu stack habitual. Cada instalación del sistema en una computadora tiene su propio archivo `.sqlite`.

Para que el salto a Supabase (Postgres) sea mecánico y no una reescritura, el esquema local se diseña desde ahora siguiendo reglas "sync-ready":

- **Identificadores UUID** (texto) como clave primaria, en vez de autoincremental — un ID autoincremental generado en dos computadoras distintas puede colisionar al sincronizar; un UUID generado localmente nunca colisiona.
- **Marcas de tiempo obligatorias en toda tabla**: `created_at`, `updated_at` — base de cualquier estrategia de sincronización por "el más reciente gana" o por cola de cambios.
- **Borrado lógico, nunca físico**: columna `deleted_at` en vez de `DELETE` — coherente con la regla de trazabilidad ya establecida en cada módulo (anulación, no borrado).
- **Nombres de tablas y columnas idénticos** a los que tendrá Supabase, para que el mapeo sea 1 a 1 y no haga falta una capa de traducción.

Los 7 módulos ya definidos (Ventas, Inventario, Compras, CxC, CxP, Caja, Contabilidad) se traducen en igual número de grupos de tablas relacionadas, más un catálogo contable y una tabla de auditoría transversal.

## Sincronización con Supabase (fase futura, no ahora)

Cuando llegue el momento de conectar con la nube, el patrón recomendado es:

- **Cola de cambios pendientes**: cada escritura local (insert/update) agrega una fila a una tabla local `sync_queue` con el nombre de la tabla, el id afectado y la operación. Un proceso de sincronización, cuando hay internet, envía esa cola a Supabase y la limpia al confirmar.
- **Autenticación de la sincronización por instalación**, no por usuario individual — una API key de Supabase por negocio/computadora, ya que el sistema es de un solo usuario/administrador por ahora.
- **Conflictos**: mientras solo haya una computadora escribiendo por negocio, no hay conflictos reales de escritura concurrente que resolver — "el más reciente gana" por `updated_at` es suficiente.

No se construye nada de esto todavía. El objetivo de esta fase es que el esquema local ya esté preparado para que, cuando se implemente la sincronización, sea agregar un módulo nuevo y no reescribir el existente.

## Vista Web en Vercel

Esta vista solo tiene sentido una vej haya datos en Supabase — antes de eso no hay nada que mostrarle a un link público, porque la fuente de la verdad es el archivo SQLite local de cada computadora, y ese archivo no está expuesto a internet.

Cuando llegue esa fase: un proyecto separado (no el mismo código de Electron), en HTML/CSS/JS vanilla o Next.js, desplegado en Vercel, de solo lectura, consultando Supabase directamente con su cliente JS y una API key de solo lectura (con RLS de Supabase limitando qué puede ver esa key). Pensado para que el dueño del negocio revise ventas del día, caja y alertas desde el teléfono sin instalar nada — nunca para facturar ni editar datos; eso sigue siendo exclusivo de la aplicación de escritorio.

## Estructura de Carpetas del Proyecto

```
punto-x/
├── main/                     # Proceso principal de Electron (Node.js)
│   ├── main.js                # Punto de entrada, ventanas, ciclo de vida
│   ├── db/
│   │   ├── schema.sql          # Definición de tablas (sync-ready)
│   │   ├── migrations/         # Cambios incrementales al esquema
│   │   └── index.js            # Conexión better-sqlite3 y queries
│   ├── ipc/                    # Manejadores IPC, uno por módulo
│   │   ├── ventas.js
│   │   ├── inventario.js
│   │   ├── compras.js
│   │   ├── cxc.js
│   │   ├── cxp.js
│   │   ├── caja.js
│   │   └── contabilidad.js
│   ├── printing/               # Impresión de facturas y etiquetas
│   └── sync/                   # (fase futura) cola y cliente Supabase
├── renderer/                  # Interfaz — lo que ya diseñamos
│   ├── dashboard/
│   ├── ventas/
│   ├── inventario/
│   ├── compras/
│   ├── cuentas-por-cobrar/
│   ├── cuentas-por-pagar/
│   ├── caja/
│   ├── contabilidad/
│   ├── reportes/
│   ├── configuracion/
│   └── shared/                 # sidebar, topbar, componentes comunes, estilos
├── assets/                    # Logo por defecto, iconos, fuentes
├── build/                     # Config de electron-builder (instalador)
└── package.json
```

Cada carpeta bajo `ipc/` y `renderer/` corresponde 1 a 1 con los módulos ya detallados en este documento — así un `CLAUDE.md` en Claude Code puede referenciar directamente "el módulo de Ventas" y apuntar a una carpeta concreta, sin ambigüedad.
