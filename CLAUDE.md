# Punto X — Sistema de Facturación (POS de escritorio)

Este archivo es el prompt maestro del proyecto. Léelo completo antes de escribir código, y vuelve a él cada vez que empieces un módulo nuevo.

## Qué es esto

Punto X es un sistema de Punto de Venta (POS) de escritorio para negocios dominicanos, creado por ODTeam X. Cubre el ciclo comercial completo: ventas/facturación, inventario, compras, cuentas por cobrar, cuentas por pagar, caja/tesorería y contabilidad — con partida doble generada automáticamente detrás de cada operación, sin que el usuario tenga que saber contabilidad.

**Documento fuente de verdad:** `Especificacion_Funcional_y_Arquitectura_POS.md`, en esta misma carpeta. Contiene, en orden:
1. Los 7 módulos con su objetivo, documentos, funcionalidades obligatorias, reglas de negocio y reportes — uno por uno, con el nivel de detalle exacto que hay que implementar. No inventes funcionalidad que no esté ahí, ni la resumas de menos.
2. Roles, permisos y configuración general (transversal a todos los módulos).
3. Arquitectura técnica: plataforma, base de datos, sincronización futura, vista web futura, estructura de carpetas.

**Antes de tocar un módulo, lee su sección completa en ese documento.** No arranques a codificar desde memoria de esta conversación — el documento es más largo y más preciso que este resumen.

## Estado del diseño visual

Ya existe un diseño de referencia (Dashboard + las 10 pantallas: Ventas, Inventario, Compras, CxC, CxP, Caja, Contabilidad, Reportes, Configuración) hecho como mockup, con sidebar verde oscuro (`#0F3D34`), acento `#146356`, tipografía Manrope/Sora, y un patrón de tarjetas + tablas ya definido. Ese diseño es la referencia visual — replica su estructura de layout (sidebar fijo, topbar con búsqueda/notificaciones, tarjetas de indicadores, tablas de datos) en las pantallas reales de Electron, adaptando el HTML/CSS a la app en vez de copiar el formato `.dc.html` del mockup (ese formato es solo del editor de diseño, no se usa en el producto final).

## Decisiones de arquitectura ya tomadas (no las reabras sin que el usuario lo pida)

- **Offline-first.** La app funciona 100% sin internet. Nada de esto se construye todavía: sincronización con Supabase, vista web en Vercel. Se preparan las bases (ver abajo) pero no se implementan.
- **Plataforma:** Electron + JavaScript vanilla (HTML/CSS/JS). Sin React/Vue/Next.js para la app de escritorio.
  - Proceso principal (`main/`, Node.js): única capa que toca la base de datos, la impresión y el ciclo de vida de ventanas.
  - Proceso de renderizado (`renderer/`): una carpeta por módulo, HTML/CSS/JS vanilla, comunicación con `main` exclusivamente por IPC (`ipcRenderer`/`ipcMain`). **La ventana nunca accede a SQLite directamente.**
  - Empaquetado con `electron-builder`.
- **Base de datos local:** SQLite vía `better-sqlite3`, un archivo `.sqlite` por instalación. Esquema "sync-ready" desde el día uno:
  - Clave primaria UUID (texto), nunca autoincremental.
  - Toda tabla lleva `created_at` y `updated_at`.
  - Borrado lógico con `deleted_at`; nunca `DELETE` físico — coherente con la regla de "nunca borrar, siempre anular" de cada módulo.
  - Nombres de tabla y columna en español, en snake_case, idénticos a los que tendría el futuro esquema en Supabase (para que el mapeo sea 1 a 1).
- **Sincronización con Supabase y vista web en Vercel:** diseñadas conceptualmente en el documento fuente, **no se implementan en esta fase**. No agregues dependencias de Supabase ni código de red todavía.

## Estructura de carpetas

```
punto-x/
├── main/
│   ├── main.js
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrations/
│   │   └── index.js
│   ├── ipc/
│   │   ├── ventas.js
│   │   ├── inventario.js
│   │   ├── compras.js
│   │   ├── cxc.js
│   │   ├── cxp.js
│   │   ├── caja.js
│   │   └── contabilidad.js
│   ├── printing/
│   └── sync/              # carpeta reservada, vacía por ahora
├── renderer/
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
│   └── shared/            # sidebar, topbar, estilos y componentes comunes
├── assets/
├── build/
└── package.json
```

Cada carpeta bajo `ipc/` y `renderer/` corresponde 1 a 1 con un módulo del documento fuente. Si necesitas ubicar dónde va algo, el nombre del módulo en el documento te dice la carpeta.

## Cómo trabajar

1. Empieza por `main/db/schema.sql`: modela las tablas de los 7 módulos siguiendo las reglas "sync-ready" de arriba. Antes de escribirlo, lee la sección de cada módulo en el documento fuente para saber qué documentos y campos necesita.
2. Construye módulo por módulo (no todo el esquema y luego toda la UI): esquema de ese módulo → handlers IPC → pantalla en `renderer/`.
3. Todo el texto de interfaz va en español, en el tono ya usado en el mockup (directo, sin adornos).
4. El ITBIS siempre se registra incluido en el precio; nunca se calcula por encima. Revisa el Módulo 1 antes de tocar precios o facturación.
5. Ninguna operación borra filas físicamente. Anulación y reversión, siempre.
6. Roles y permisos: implementa la matriz de la sección "Roles, Permisos y Configuración General" desde el principio, aunque el primer usuario real sea uno solo — no lo dejes para después.
7. No agregues Supabase, Vercel, ni ningún cliente de red — esa fase no ha empezado.

## Si algo no está claro

Si una regla de negocio no aparece en el documento fuente o parece contradictoria, pregunta antes de asumir — no improvises reglas contables o fiscales (ITBIS, NCF/e-CF) que no estén explícitas.
