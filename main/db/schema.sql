-- Punto X — Esquema de base de datos local (SQLite / better-sqlite3)
--
-- Reglas sync-ready (ver CLAUDE.md):
--   - Clave primaria TEXT (UUID v4), generada en la aplicación (Node), nunca autoincremental.
--   - Toda tabla lleva created_at / updated_at (TEXT, ISO 8601 UTC).
--   - Borrado lógico con deleted_at; nunca DELETE físico.
--   - Nombres de tabla y columna en español, snake_case, iguales al futuro esquema Supabase.
--
-- Este archivo se ejecuta completo en una base de datos nueva. Cambios posteriores
-- van como archivos incrementales en main/db/migrations/.

PRAGMA foreign_keys = ON;

-- =========================================================================
-- TRANSVERSAL: usuarios, roles y permisos
-- =========================================================================

CREATE TABLE roles (
  id              TEXT PRIMARY KEY,
  nombre          TEXT NOT NULL UNIQUE,
  descripcion     TEXT,
  es_rol_sistema  INTEGER NOT NULL DEFAULT 0, -- 1 = uno de los 6 roles base del documento fuente
  limite_descuento_pct REAL NOT NULL DEFAULT 0, -- tope de descuento global a factura permitido a este rol
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);

-- Catálogo de acciones permisibles (crear, editar, anular, ver_costos, aplicar_descuentos, ver_reportes_financieros, ...)
-- por módulo. codigo es único y estable, p.ej. "ventas.factura.anular".
CREATE TABLE permisos (
  id          TEXT PRIMARY KEY,
  modulo      TEXT NOT NULL, -- ventas, inventario, compras, cxc, cxp, caja, contabilidad, configuracion
  codigo      TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE roles_permisos (
  id          TEXT PRIMARY KEY,
  rol_id      TEXT NOT NULL REFERENCES roles(id),
  permiso_id  TEXT NOT NULL REFERENCES permisos(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  UNIQUE (rol_id, permiso_id)
);

CREATE TABLE sucursales (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  direccion   TEXT,
  telefono    TEXT,
  es_principal INTEGER NOT NULL DEFAULT 0,
  activo      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE usuarios (
  id              TEXT PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  usuario         TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  rol_id          TEXT NOT NULL REFERENCES roles(id),
  sucursal_id     TEXT REFERENCES sucursales(id),
  pct_comision    REAL NOT NULL DEFAULT 0, -- % de comisión de vendedor, aplica solo a roles que venden
  activo          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);
CREATE INDEX idx_usuarios_rol ON usuarios(rol_id);

-- Bitácora de auditoría transversal: quién creó, editó o anuló qué documento y cuándo, en todos los módulos.
CREATE TABLE bitacora_auditoria (
  id            TEXT PRIMARY KEY,
  usuario_id    TEXT REFERENCES usuarios(id),
  modulo        TEXT NOT NULL,
  entidad       TEXT NOT NULL,     -- nombre de tabla afectada
  entidad_id    TEXT NOT NULL,
  accion        TEXT NOT NULL,     -- crear, editar, anular, cerrar, reabrir, etc.
  detalle       TEXT,              -- JSON con antes/después o notas
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bitacora_entidad ON bitacora_auditoria(entidad, entidad_id);
CREATE INDEX idx_bitacora_usuario ON bitacora_auditoria(usuario_id);

-- =========================================================================
-- TRANSVERSAL: configuración general
-- =========================================================================

-- Parámetros de negocio sueltos, tipo llave/valor (días de crédito por defecto,
-- ventana de alerta de vencimiento de inventario, días de mora para bloqueo de CxC, etc.)
CREATE TABLE parametros_negocio (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  descripcion TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tasas_itbis (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,       -- "18%", "Reducida", "Exenta"
  porcentaje  REAL NOT NULL,       -- 0.18, 0.16, 0
  es_default  INTEGER NOT NULL DEFAULT 0,
  activo      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

-- Tipos de comprobante fiscal (NCF/e-CF) y su numeración vigente.
CREATE TABLE tipos_ncf (
  id                TEXT PRIMARY KEY,
  codigo            TEXT NOT NULL,     -- B01, B02, B14, B15, e32, etc.
  nombre            TEXT NOT NULL,     -- Crédito Fiscal, Consumo, Gubernamental, Régimen Especial
  aplica_cliente    TEXT NOT NULL,     -- consumo | credito_fiscal | gubernamental | regimen_especial
  secuencia_desde   INTEGER NOT NULL,
  secuencia_hasta   INTEGER NOT NULL,
  secuencia_actual  INTEGER NOT NULL,
  vencimiento       TEXT,
  activo            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);

CREATE TABLE monedas (
  id          TEXT PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE, -- DOP, USD
  nombre      TEXT NOT NULL,
  es_local    INTEGER NOT NULL DEFAULT 0,
  activo      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tasas_cambio (
  id          TEXT PRIMARY KEY,
  moneda_id   TEXT NOT NULL REFERENCES monedas(id),
  fecha       TEXT NOT NULL, -- fecha del día (YYYY-MM-DD)
  tasa        REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (moneda_id, fecha)
);

CREATE TABLE impresoras_config (
  id            TEXT PRIMARY KEY,
  sucursal_id   TEXT REFERENCES sucursales(id),
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL, -- factura | tique | etiqueta
  configuracion TEXT,          -- JSON: ancho de papel, driver, copias, etc.
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);

-- =========================================================================
-- MÓDULO 2: Inventario y Almacenes
-- (se modela antes que Ventas y Compras porque ambos dependen de producto/almacén)
-- =========================================================================

CREATE TABLE categorias_producto (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE unidades_medida (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  abreviatura TEXT NOT NULL
);

CREATE TABLE categorias_cliente (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL, -- Detalle, Mayorista, Distribuidor, ...
  nivel_precio  TEXT NOT NULL, -- detalle | mayorista | distribuidor
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);

-- Ficha de producto. Los tres niveles de precio y el precio de lista van con ITBIS incluido;
-- base_imponible / itbis se derivan en la aplicación a partir de precio y tasa_itbis_id,
-- nunca se calculan por encima del precio mostrado al cliente.
CREATE TABLE productos (
  id                    TEXT PRIMARY KEY,
  codigo_interno        TEXT NOT NULL UNIQUE,
  descripcion           TEXT NOT NULL,
  categoria_id          TEXT REFERENCES categorias_producto(id),
  unidad_medida_base_id TEXT NOT NULL REFERENCES unidades_medida(id),
  tasa_itbis_id         TEXT NOT NULL REFERENCES tasas_itbis(id),
  precio_detalle        REAL NOT NULL DEFAULT 0,      -- ITBIS incluido
  precio_mayorista      REAL NOT NULL DEFAULT 0,      -- ITBIS incluido
  precio_distribuidor   REAL NOT NULL DEFAULT 0,      -- ITBIS incluido
  costo_promedio        REAL NOT NULL DEFAULT 0,      -- recalculado por kardex según método de valoración
  metodo_valoracion     TEXT NOT NULL DEFAULT 'heredado', -- heredado | promedio_ponderado | peps
  es_kit                INTEGER NOT NULL DEFAULT 0,
  permite_venta_negativo INTEGER NOT NULL DEFAULT 0,
  controla_lote         INTEGER NOT NULL DEFAULT 0,
  stock_minimo          REAL NOT NULL DEFAULT 0,
  stock_maximo          REAL,
  dias_alerta_vencimiento INTEGER, -- override de parametros_negocio.ventana_alerta_vencimiento
  activo                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at             TEXT
);
CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_productos_descripcion ON productos(descripcion);

-- Códigos de barra: un producto puede tener varios (presentaciones distintas del mismo ítem).
CREATE TABLE productos_codigos_barra (
  id                TEXT PRIMARY KEY,
  producto_id       TEXT NOT NULL REFERENCES productos(id),
  codigo_barra      TEXT NOT NULL UNIQUE,
  presentacion      TEXT NOT NULL DEFAULT 'unidad', -- unidad, caja, paquete, ...
  factor_conversion REAL NOT NULL DEFAULT 1,        -- unidades base por esta presentación
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_codigos_barra_producto ON productos_codigos_barra(producto_id);

-- Unidades alternativas de un producto (ej: caja = 24 unidades) además de sus códigos de barra.
CREATE TABLE productos_unidades_alternativas (
  id                TEXT PRIMARY KEY,
  producto_id       TEXT NOT NULL REFERENCES productos(id),
  unidad_id         TEXT NOT NULL REFERENCES unidades_medida(id),
  factor_conversion REAL NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);

-- Kits/combos: componentes que se descuentan del inventario al vender el kit.
CREATE TABLE kits_componentes (
  id                    TEXT PRIMARY KEY,
  kit_producto_id       TEXT NOT NULL REFERENCES productos(id),
  componente_producto_id TEXT NOT NULL REFERENCES productos(id),
  cantidad              REAL NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at            TEXT
);
CREATE INDEX idx_kits_kit ON kits_componentes(kit_producto_id);

CREATE TABLE almacenes (
  id          TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  nombre      TEXT NOT NULL,
  activo      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

-- Lotes con fecha de vencimiento (solo para productos con controla_lote = 1).
CREATE TABLE lotes (
  id                TEXT PRIMARY KEY,
  producto_id       TEXT NOT NULL REFERENCES productos(id),
  almacen_id        TEXT NOT NULL REFERENCES almacenes(id),
  numero_lote       TEXT NOT NULL,
  fecha_vencimiento TEXT,
  cantidad          REAL NOT NULL DEFAULT 0,
  costo_unitario    REAL NOT NULL DEFAULT 0, -- capa de costo PEPS
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_lotes_producto_almacen ON lotes(producto_id, almacen_id);
CREATE INDEX idx_lotes_vencimiento ON lotes(fecha_vencimiento);

-- Existencia consolidada por producto/almacén (se mantiene sincronizada desde el kardex).
CREATE TABLE existencias (
  id                    TEXT PRIMARY KEY,
  producto_id           TEXT NOT NULL REFERENCES productos(id),
  almacen_id            TEXT NOT NULL REFERENCES almacenes(id),
  cantidad_disponible   REAL NOT NULL DEFAULT 0,
  cantidad_comprometida REAL NOT NULL DEFAULT 0, -- reservada en pedidos abiertos
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (producto_id, almacen_id)
);

-- Kardex: historial cronológico de todo movimiento de inventario, con saldo y costo tras cada uno.
CREATE TABLE kardex_movimientos (
  id                    TEXT PRIMARY KEY,
  producto_id           TEXT NOT NULL REFERENCES productos(id),
  almacen_id            TEXT NOT NULL REFERENCES almacenes(id),
  lote_id               TEXT REFERENCES lotes(id),
  tipo_movimiento       TEXT NOT NULL, -- entrada_compra | salida_venta | ajuste_entrada | ajuste_salida
                                        -- | transferencia_entrada | transferencia_salida | merma | conversion
  documento_origen_tipo TEXT,          -- nombre de la tabla/documento que originó el movimiento
  documento_origen_id   TEXT,
  cantidad              REAL NOT NULL, -- positiva = entrada, negativa = salida
  costo_unitario        REAL NOT NULL,
  saldo_cantidad        REAL NOT NULL, -- saldo del producto/almacén después de este movimiento
  saldo_costo           REAL NOT NULL, -- costo unitario vigente después de este movimiento
  usuario_id            TEXT REFERENCES usuarios(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_kardex_producto_almacen ON kardex_movimientos(producto_id, almacen_id, created_at);
CREATE INDEX idx_kardex_origen ON kardex_movimientos(documento_origen_tipo, documento_origen_id);

CREATE TABLE transferencias_almacen (
  id                  TEXT PRIMARY KEY,
  numero              TEXT NOT NULL UNIQUE,
  almacen_origen_id   TEXT NOT NULL REFERENCES almacenes(id),
  almacen_destino_id  TEXT NOT NULL REFERENCES almacenes(id),
  fecha               TEXT NOT NULL,
  estado              TEXT NOT NULL DEFAULT 'confirmada', -- confirmada | anulada
  motivo_anulacion    TEXT,
  usuario_id          TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id    TEXT REFERENCES usuarios(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);

CREATE TABLE transferencias_almacen_detalle (
  id                TEXT PRIMARY KEY,
  transferencia_id  TEXT NOT NULL REFERENCES transferencias_almacen(id),
  producto_id       TEXT NOT NULL REFERENCES productos(id),
  lote_id           TEXT REFERENCES lotes(id),
  cantidad          REAL NOT NULL
);
CREATE INDEX idx_transf_detalle_transferencia ON transferencias_almacen_detalle(transferencia_id);

-- Ajuste de inventario manual (entrada o salida), motivo obligatorio: conteo físico, corrección de sistema.
-- Las averías/mermas van en su propia tabla (mermas_averias), no aquí.
CREATE TABLE ajustes_inventario (
  id                TEXT PRIMARY KEY,
  numero            TEXT NOT NULL UNIQUE,
  almacen_id        TEXT NOT NULL REFERENCES almacenes(id),
  tipo               TEXT NOT NULL, -- entrada | salida
  motivo            TEXT NOT NULL, -- conteo_fisico | correccion_sistema | otro
  motivo_detalle    TEXT,
  fecha             TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'confirmado', -- confirmado | anulado
  motivo_anulacion  TEXT,
  usuario_id        TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id  TEXT REFERENCES usuarios(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);

CREATE TABLE ajustes_inventario_detalle (
  id              TEXT PRIMARY KEY,
  ajuste_id       TEXT NOT NULL REFERENCES ajustes_inventario(id),
  producto_id     TEXT NOT NULL REFERENCES productos(id),
  lote_id         TEXT REFERENCES lotes(id),
  cantidad        REAL NOT NULL,
  costo_unitario  REAL NOT NULL
);
CREATE INDEX idx_ajuste_detalle_ajuste ON ajustes_inventario_detalle(ajuste_id);

-- Averías/mermas: pérdida por daño, reportada separada del ajuste general de conteo.
CREATE TABLE mermas_averias (
  id                TEXT PRIMARY KEY,
  numero            TEXT NOT NULL UNIQUE,
  almacen_id        TEXT NOT NULL REFERENCES almacenes(id),
  producto_id       TEXT NOT NULL REFERENCES productos(id),
  lote_id           TEXT REFERENCES lotes(id),
  cantidad          REAL NOT NULL,
  costo_unitario    REAL NOT NULL,
  motivo            TEXT NOT NULL,
  fecha             TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'confirmada', -- confirmada | anulada
  motivo_anulacion  TEXT,
  usuario_id        TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id  TEXT REFERENCES usuarios(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_mermas_producto_almacen ON mermas_averias(producto_id, almacen_id);

-- Conversión de producto (ej: 1 saco de 50kg -> 50 unidades de 1kg), con trazabilidad origen/destino.
CREATE TABLE conversiones_producto (
  id                      TEXT PRIMARY KEY,
  numero                  TEXT NOT NULL UNIQUE,
  almacen_id              TEXT NOT NULL REFERENCES almacenes(id),
  producto_origen_id      TEXT NOT NULL REFERENCES productos(id),
  cantidad_origen         REAL NOT NULL,
  producto_destino_id     TEXT NOT NULL REFERENCES productos(id),
  cantidad_destino        REAL NOT NULL,
  fecha                   TEXT NOT NULL,
  estado                  TEXT NOT NULL DEFAULT 'confirmada', -- confirmada | anulada
  motivo_anulacion        TEXT,
  usuario_id              TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id        TEXT REFERENCES usuarios(id),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at              TEXT
);

-- Listas de precio nombradas y reutilizables, asignables por sucursal y categoría de cliente.
CREATE TABLE listas_precio (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  sucursal_id TEXT REFERENCES sucursales(id),
  activo      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE listas_precio_detalle (
  id          TEXT PRIMARY KEY,
  lista_id    TEXT NOT NULL REFERENCES listas_precio(id),
  producto_id TEXT NOT NULL REFERENCES productos(id),
  precio      REAL NOT NULL, -- ITBIS incluido
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  UNIQUE (lista_id, producto_id)
);

-- =========================================================================
-- MÓDULO 4: Cuentas por Cobrar y Clientes
-- (clientes se modela antes que Ventas porque documentos_venta lo referencia)
-- =========================================================================

CREATE TABLE clientes (
  id                    TEXT PRIMARY KEY,
  nombre                TEXT NOT NULL,
  rnc_cedula            TEXT,
  categoria_id          TEXT REFERENCES categorias_cliente(id),
  limite_credito        REAL NOT NULL DEFAULT 0,
  dias_credito          INTEGER NOT NULL DEFAULT 0,
  tipo_comprobante_default TEXT, -- consumo | credito_fiscal | gubernamental | regimen_especial
  es_agente_retencion   INTEGER NOT NULL DEFAULT 0,
  pct_retencion_isr     REAL NOT NULL DEFAULT 0,
  pct_retencion_itbis   REAL NOT NULL DEFAULT 0,
  direccion             TEXT,
  telefono              TEXT,
  email                 TEXT,
  bloqueado             INTEGER NOT NULL DEFAULT 0, -- bloqueo automático por límite/mora, o manual
  motivo_bloqueo        TEXT,
  activo                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at            TEXT
);
CREATE INDEX idx_clientes_nombre ON clientes(nombre);
CREATE INDEX idx_clientes_categoria ON clientes(categoria_id);

CREATE TABLE gestion_cobros (
  id                    TEXT PRIMARY KEY,
  cliente_id            TEXT NOT NULL REFERENCES clientes(id),
  fecha_contacto        TEXT NOT NULL,
  tipo_contacto         TEXT NOT NULL, -- llamada | visita | email | otro
  notas                 TEXT,
  resultado             TEXT,
  proxima_fecha_contacto TEXT,
  usuario_id            TEXT NOT NULL REFERENCES usuarios(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at            TEXT
);
CREATE INDEX idx_gestion_cobros_cliente ON gestion_cobros(cliente_id);

-- CxC de empleados: préstamos, anticipos y consumos en el local. La nómina en sí queda fuera del núcleo.
CREATE TABLE cxc_empleados (
  id                      TEXT PRIMARY KEY,
  usuario_id              TEXT NOT NULL REFERENCES usuarios(id),
  tipo                    TEXT NOT NULL, -- prestamo | anticipo | consumo
  monto                   REAL NOT NULL,
  saldo_pendiente         REAL NOT NULL,
  descuento_sugerido_nomina REAL NOT NULL DEFAULT 0,
  fecha                   TEXT NOT NULL,
  notas                   TEXT,
  estado                  TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagado | anulado
  motivo_anulacion        TEXT,
  usuario_registro_id     TEXT NOT NULL REFERENCES usuarios(id),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at              TEXT
);
CREATE INDEX idx_cxc_empleados_usuario ON cxc_empleados(usuario_id);

CREATE TABLE cxc_empleados_pagos (
  id              TEXT PRIMARY KEY,
  cxc_empleado_id TEXT NOT NULL REFERENCES cxc_empleados(id),
  monto           REAL NOT NULL,
  fecha           TEXT NOT NULL,
  referencia      TEXT, -- p.ej. referencia a la nómina o recibo de caja
  usuario_id      TEXT NOT NULL REFERENCES usuarios(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- =========================================================================
-- MÓDULO 1: Ventas y Facturación
-- =========================================================================

CREATE TABLE promociones (
  id                TEXT PRIMARY KEY,
  producto_id       TEXT REFERENCES productos(id),
  categoria_id      TEXT REFERENCES categorias_producto(id),
  tipo_descuento    TEXT NOT NULL, -- porcentaje | monto
  valor             REAL NOT NULL,
  fecha_inicio      TEXT NOT NULL,
  fecha_fin         TEXT NOT NULL,
  activo            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT,
  CHECK ((producto_id IS NOT NULL) OR (categoria_id IS NOT NULL))
);
CREATE INDEX idx_promociones_vigencia ON promociones(fecha_inicio, fecha_fin);

-- Documento único para todo el ciclo de ventas: cotización, pedido, factura, conduce,
-- nota de crédito y nota de débito. El "tipo" determina qué reglas de negocio aplican.
CREATE TABLE documentos_venta (
  id                      TEXT PRIMARY KEY,
  tipo                    TEXT NOT NULL, -- cotizacion | pedido | factura | conduce | nota_credito | nota_debito
  numero                  TEXT NOT NULL,
  ncf                     TEXT,
  tipo_ncf_id             TEXT REFERENCES tipos_ncf(id),
  sucursal_id             TEXT NOT NULL REFERENCES sucursales(id),
  almacen_id              TEXT NOT NULL REFERENCES almacenes(id),
  cliente_id              TEXT REFERENCES clientes(id), -- NULL = venta rápida de mostrador
  vendedor_id             TEXT REFERENCES usuarios(id),
  modo_venta              TEXT NOT NULL DEFAULT 'completa', -- rapida | completa
  condicion_pago          TEXT NOT NULL DEFAULT 'contado',  -- contado | credito | mixto
  moneda_id               TEXT NOT NULL REFERENCES monedas(id),
  tasa_cambio             REAL NOT NULL DEFAULT 1, -- congelada al momento de facturar
  documento_referencia_id TEXT REFERENCES documentos_venta(id), -- factura que origina una nota_credito/nota_debito, o pedido que origina una factura
  fecha                   TEXT NOT NULL,
  subtotal                REAL NOT NULL DEFAULT 0,     -- suma de base_imponible de las líneas
  descuento_total         REAL NOT NULL DEFAULT 0,     -- descuento global adicional a factura
  itbis_total             REAL NOT NULL DEFAULT 0,
  retencion_isr           REAL NOT NULL DEFAULT 0,
  retencion_itbis         REAL NOT NULL DEFAULT 0,
  total                   REAL NOT NULL DEFAULT 0,
  estado                  TEXT NOT NULL DEFAULT 'abierto', -- abierto | confirmado | facturado | entregado | anulado
  concepto                TEXT, -- motivo libre de nota_credito (devolución) o nota_debito (flete, ajuste, mora...)
  motivo_anulacion        TEXT,
  usuario_anulo_id        TEXT REFERENCES usuarios(id),
  -- Delivery
  es_delivery             INTEGER NOT NULL DEFAULT 0,
  repartidor_id           TEXT REFERENCES usuarios(id),
  direccion_entrega       TEXT,
  tiempo_estimado_min     INTEGER,
  estado_delivery         TEXT, -- pendiente | en_ruta | entregado
  fecha_entrega_real      TEXT,
  usuario_id              TEXT NOT NULL REFERENCES usuarios(id), -- quien creó el documento
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at              TEXT,
  UNIQUE (tipo, numero)
);
CREATE INDEX idx_docventa_cliente ON documentos_venta(cliente_id);
CREATE INDEX idx_docventa_vendedor ON documentos_venta(vendedor_id);
CREATE INDEX idx_docventa_fecha ON documentos_venta(fecha);
CREATE INDEX idx_docventa_tipo_estado ON documentos_venta(tipo, estado);
CREATE INDEX idx_docventa_referencia ON documentos_venta(documento_referencia_id);

CREATE TABLE documentos_venta_detalle (
  id                TEXT PRIMARY KEY,
  documento_id      TEXT NOT NULL REFERENCES documentos_venta(id),
  producto_id       TEXT NOT NULL REFERENCES productos(id),
  lote_id           TEXT REFERENCES lotes(id),
  cantidad          REAL NOT NULL,
  precio_unitario   REAL NOT NULL,       -- ITBIS incluido, al nivel de precio aplicado
  descuento_pct     REAL NOT NULL DEFAULT 0,
  descuento_monto   REAL NOT NULL DEFAULT 0,
  tasa_itbis        REAL NOT NULL,       -- % vigente al momento de facturar
  base_imponible    REAL NOT NULL,       -- precio sin ITBIS x cantidad, tras descuentos
  itbis_monto       REAL NOT NULL,
  total_linea       REAL NOT NULL,
  costo_unitario    REAL NOT NULL DEFAULT 0, -- costo al momento de la venta, para margen
  cantidad_devuelta REAL NOT NULL DEFAULT 0, -- acumulado de devoluciones parciales sobre esta línea
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_docventa_detalle_documento ON documentos_venta_detalle(documento_id);
CREATE INDEX idx_docventa_detalle_producto ON documentos_venta_detalle(producto_id);

-- Pago mixto: una factura puede tener varias filas (efectivo + tarjeta + transferencia).
CREATE TABLE pagos_venta (
  id            TEXT PRIMARY KEY,
  documento_id  TEXT NOT NULL REFERENCES documentos_venta(id),
  forma_pago    TEXT NOT NULL, -- efectivo | tarjeta | transferencia | credito
  monto         REAL NOT NULL,
  referencia    TEXT,          -- últimos dígitos de tarjeta, número de transferencia, etc.
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_pagos_venta_documento ON pagos_venta(documento_id);

CREATE TABLE comisiones_vendedor (
  id                TEXT PRIMARY KEY,
  vendedor_id       TEXT NOT NULL REFERENCES usuarios(id),
  documento_venta_id TEXT NOT NULL REFERENCES documentos_venta(id),
  monto_comision    REAL NOT NULL,
  pagada            INTEGER NOT NULL DEFAULT 0,
  fecha_pago        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_comisiones_vendedor ON comisiones_vendedor(vendedor_id, pagada);

-- Recibo de ingreso (cobro), aplicado a una o varias facturas específicas.
CREATE TABLE recibos_ingreso (
  id                TEXT PRIMARY KEY,
  numero            TEXT NOT NULL UNIQUE,
  cliente_id        TEXT NOT NULL REFERENCES clientes(id),
  fecha             TEXT NOT NULL,
  forma_pago        TEXT NOT NULL, -- efectivo | tarjeta | transferencia | cheque
  monto_total       REAL NOT NULL,
  referencia        TEXT,
  estado            TEXT NOT NULL DEFAULT 'confirmado', -- confirmado | anulado
  motivo_anulacion  TEXT,
  usuario_id        TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id  TEXT REFERENCES usuarios(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_recibos_cliente ON recibos_ingreso(cliente_id);

CREATE TABLE recibos_ingreso_aplicaciones (
  id                  TEXT PRIMARY KEY,
  recibo_id           TEXT NOT NULL REFERENCES recibos_ingreso(id),
  documento_venta_id  TEXT NOT NULL REFERENCES documentos_venta(id),
  monto_aplicado      REAL NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_recibo_aplicaciones_recibo ON recibos_ingreso_aplicaciones(recibo_id);
CREATE INDEX idx_recibo_aplicaciones_documento ON recibos_ingreso_aplicaciones(documento_venta_id);

-- =========================================================================
-- MÓDULO 3: Compras y Proveedores
-- =========================================================================

CREATE TABLE proveedores (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  rnc           TEXT,
  dias_credito  INTEGER NOT NULL DEFAULT 0,
  direccion     TEXT,
  telefono      TEXT,
  email         TEXT,
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);
CREATE INDEX idx_proveedores_nombre ON proveedores(nombre);

-- Documento único para el ciclo de compras: presupuesto, orden de compra, entrada de mercancía,
-- factura de compra, nota de crédito y nota de débito de compra.
-- Solo "entrada_mercancia" afecta inventario; solo "factura_compra" actualiza costo y genera CxP.
CREATE TABLE documentos_compra (
  id                      TEXT PRIMARY KEY,
  tipo                    TEXT NOT NULL, -- presupuesto | orden_compra | entrada_mercancia | factura_compra | nota_credito | nota_debito
  numero                  TEXT NOT NULL,
  proveedor_id            TEXT NOT NULL REFERENCES proveedores(id),
  almacen_id              TEXT REFERENCES almacenes(id),
  ncf_proveedor           TEXT, -- para deducción fiscal y reporte 606
  documento_referencia_id TEXT REFERENCES documentos_compra(id), -- orden de compra que origina la entrada/factura
  fecha                   TEXT NOT NULL,
  condicion_pago          TEXT NOT NULL DEFAULT 'contado', -- contado | credito
  dias_credito            INTEGER NOT NULL DEFAULT 0,
  fecha_vencimiento       TEXT,
  subtotal                REAL NOT NULL DEFAULT 0,
  itbis_total             REAL NOT NULL DEFAULT 0,
  total                   REAL NOT NULL DEFAULT 0,
  estado                  TEXT NOT NULL DEFAULT 'abierto', -- abierto | recibido_parcial | recibido_total | facturado | anulado
  motivo_anulacion        TEXT,
  usuario_anulo_id        TEXT REFERENCES usuarios(id),
  usuario_id              TEXT NOT NULL REFERENCES usuarios(id),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at              TEXT,
  UNIQUE (tipo, numero)
);
CREATE INDEX idx_doccompra_proveedor ON documentos_compra(proveedor_id);
CREATE INDEX idx_doccompra_tipo_estado ON documentos_compra(tipo, estado);
CREATE INDEX idx_doccompra_referencia ON documentos_compra(documento_referencia_id);

CREATE TABLE documentos_compra_detalle (
  id                  TEXT PRIMARY KEY,
  documento_id        TEXT NOT NULL REFERENCES documentos_compra(id),
  producto_id         TEXT NOT NULL REFERENCES productos(id),
  lote_id             TEXT REFERENCES lotes(id),
  cantidad            REAL NOT NULL,
  cantidad_recibida   REAL NOT NULL DEFAULT 0, -- para recepción parcial contra orden de compra
  costo_unitario      REAL NOT NULL,
  tasa_itbis          REAL NOT NULL,
  itbis_monto         REAL NOT NULL,
  total_linea         REAL NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
CREATE INDEX idx_doccompra_detalle_documento ON documentos_compra_detalle(documento_id);
CREATE INDEX idx_doccompra_detalle_producto ON documentos_compra_detalle(producto_id);

-- Liquidación de mercancía importada: distribuye flete/seguro/aranceles entre productos de una o varias entradas.
CREATE TABLE liquidaciones_importacion (
  id          TEXT PRIMARY KEY,
  numero      TEXT NOT NULL UNIQUE,
  fecha       TEXT NOT NULL,
  flete       REAL NOT NULL DEFAULT 0,
  seguro      REAL NOT NULL DEFAULT 0,
  aranceles   REAL NOT NULL DEFAULT 0,
  estado      TEXT NOT NULL DEFAULT 'confirmada', -- confirmada | anulada
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE liquidaciones_importacion_detalle (
  id                        TEXT PRIMARY KEY,
  liquidacion_id            TEXT NOT NULL REFERENCES liquidaciones_importacion(id),
  documento_compra_detalle_id TEXT NOT NULL REFERENCES documentos_compra_detalle(id),
  monto_distribuido         REAL NOT NULL,
  costo_unitario_anterior   REAL NOT NULL,
  costo_unitario_nuevo      REAL NOT NULL
);
CREATE INDEX idx_liquidacion_detalle_liquidacion ON liquidaciones_importacion_detalle(liquidacion_id);

-- =========================================================================
-- MÓDULO 5: Cuentas por Pagar
-- =========================================================================

CREATE TABLE cuentas_bancarias (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  banco         TEXT NOT NULL,
  numero_cuenta TEXT,
  moneda_id     TEXT NOT NULL REFERENCES monedas(id),
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);

CREATE TABLE pagos_proveedor (
  id                TEXT PRIMARY KEY,
  numero            TEXT NOT NULL UNIQUE,
  proveedor_id      TEXT NOT NULL REFERENCES proveedores(id),
  fecha             TEXT NOT NULL,
  forma_pago        TEXT NOT NULL, -- efectivo | transferencia | cheque
  monto_total       REAL NOT NULL,
  cuenta_bancaria_id TEXT REFERENCES cuentas_bancarias(id),
  numero_cheque     TEXT,
  banco_cheque      TEXT,
  fecha_cheque      TEXT,          -- fecha en que se hace efectivo (posdatado)
  estado_cheque     TEXT,          -- pendiente | cobrado | anulado (solo aplica si forma_pago = cheque)
  prioridad         TEXT NOT NULL DEFAULT 'normal', -- baja | normal | alta
  estado            TEXT NOT NULL DEFAULT 'confirmado', -- confirmado | anulado
  motivo_anulacion  TEXT,
  usuario_id        TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id  TEXT REFERENCES usuarios(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);
CREATE INDEX idx_pagos_proveedor_proveedor ON pagos_proveedor(proveedor_id);
CREATE INDEX idx_pagos_proveedor_cheque ON pagos_proveedor(estado_cheque, fecha_cheque);

CREATE TABLE pagos_proveedor_aplicaciones (
  id                    TEXT PRIMARY KEY,
  pago_id               TEXT NOT NULL REFERENCES pagos_proveedor(id),
  documento_compra_id   TEXT NOT NULL REFERENCES documentos_compra(id),
  monto_aplicado        REAL NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_pago_prov_aplicaciones_pago ON pagos_proveedor_aplicaciones(pago_id);
CREATE INDEX idx_pago_prov_aplicaciones_doc ON pagos_proveedor_aplicaciones(documento_compra_id);

-- =========================================================================
-- MÓDULO 6: Caja y Tesorería
-- =========================================================================

CREATE TABLE cajas (
  id          TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  nombre      TEXT NOT NULL,
  activo      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE turnos_caja (
  id                  TEXT PRIMARY KEY,
  caja_id             TEXT NOT NULL REFERENCES cajas(id),
  usuario_id          TEXT NOT NULL REFERENCES usuarios(id),
  fondo_inicial       REAL NOT NULL,
  fecha_apertura      TEXT NOT NULL,
  fecha_cierre        TEXT,
  efectivo_esperado   REAL, -- fondo inicial + ventas en efectivo - gastos de caja chica pagados en efectivo
  efectivo_contado    REAL,
  diferencia          REAL, -- contado - esperado (sobrante positivo, faltante negativo)
  estado              TEXT NOT NULL DEFAULT 'abierto', -- abierto | cerrado
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
CREATE INDEX idx_turnos_caja_caja ON turnos_caja(caja_id, estado);
CREATE INDEX idx_turnos_caja_usuario ON turnos_caja(usuario_id);

-- Movimientos manuales de caja (entrada/salida con concepto obligatorio) y los generados
-- automáticamente por ventas en efectivo, gastos de caja chica y transferencias a banco.
CREATE TABLE movimientos_caja (
  id                    TEXT PRIMARY KEY,
  turno_caja_id         TEXT NOT NULL REFERENCES turnos_caja(id),
  tipo                  TEXT NOT NULL, -- entrada_manual | salida_manual | venta_efectivo | gasto_caja_chica | transferencia_banco
  concepto              TEXT NOT NULL,
  monto                 REAL NOT NULL, -- positivo = entrada, negativo = salida
  documento_origen_tipo TEXT,
  documento_origen_id   TEXT,
  usuario_id            TEXT NOT NULL REFERENCES usuarios(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at            TEXT
);
CREATE INDEX idx_movimientos_caja_turno ON movimientos_caja(turno_caja_id);
CREATE INDEX idx_movimientos_caja_origen ON movimientos_caja(documento_origen_tipo, documento_origen_id);

CREATE TABLE caja_chica (
  id              TEXT PRIMARY KEY,
  caja_id         TEXT NOT NULL REFERENCES cajas(id),
  nombre          TEXT NOT NULL,
  fondo_asignado  REAL NOT NULL DEFAULT 0,
  activo          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);

CREATE TABLE gastos_caja_chica (
  id              TEXT PRIMARY KEY,
  caja_chica_id   TEXT NOT NULL REFERENCES caja_chica(id),
  concepto        TEXT NOT NULL,
  categoria       TEXT,
  monto           REAL NOT NULL,
  comprobante_ruta TEXT, -- ruta local del comprobante adjunto
  fecha           TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'confirmado', -- confirmado | anulado
  motivo_anulacion TEXT,
  usuario_id      TEXT NOT NULL REFERENCES usuarios(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);
CREATE INDEX idx_gastos_caja_chica_caja ON gastos_caja_chica(caja_chica_id);

CREATE TABLE transferencias_caja_banco (
  id                  TEXT PRIMARY KEY,
  caja_id             TEXT NOT NULL REFERENCES cajas(id),
  turno_caja_id       TEXT REFERENCES turnos_caja(id),
  cuenta_bancaria_id  TEXT NOT NULL REFERENCES cuentas_bancarias(id),
  tipo                TEXT NOT NULL, -- deposito | retiro
  monto               REAL NOT NULL,
  fecha               TEXT NOT NULL,
  estado              TEXT NOT NULL DEFAULT 'confirmada', -- confirmada | anulada
  usuario_id          TEXT NOT NULL REFERENCES usuarios(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);

CREATE TABLE conciliaciones_bancarias (
  id                  TEXT PRIMARY KEY,
  cuenta_bancaria_id  TEXT NOT NULL REFERENCES cuentas_bancarias(id),
  periodo_desde       TEXT NOT NULL,
  periodo_hasta       TEXT NOT NULL,
  saldo_sistema       REAL,
  saldo_estado_cuenta REAL,
  estado              TEXT NOT NULL DEFAULT 'en_proceso', -- en_proceso | conciliada
  fecha_conciliada    TEXT,
  usuario_id          TEXT NOT NULL REFERENCES usuarios(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);

-- Partidas del extracto bancario real (origen = estado_cuenta). Cada una se concilia contra
-- una línea del libro en la cuenta Bancos (asiento_detalle_id), o se registra en contabilidad
-- si era un cargo/crédito del banco que no estaba en el sistema (asiento_id). Las líneas del
-- sistema no se copian aquí: se leen en vivo del libro mayor de Bancos.
-- monto > 0 = crédito a la cuenta (depósito); monto < 0 = débito (cheque cobrado, cargo).
CREATE TABLE conciliaciones_bancarias_detalle (
  id                    TEXT PRIMARY KEY,
  conciliacion_id       TEXT NOT NULL REFERENCES conciliaciones_bancarias(id),
  fecha                 TEXT NOT NULL,
  descripcion           TEXT NOT NULL,
  monto                 REAL NOT NULL,
  origen                TEXT NOT NULL, -- sistema | estado_cuenta
  movimiento_caja_id    TEXT REFERENCES movimientos_caja(id),
  transferencia_id      TEXT REFERENCES transferencias_caja_banco(id),
  asiento_detalle_id    TEXT REFERENCES asientos_contables_detalle(id),
  asiento_id            TEXT REFERENCES asientos_contables(id),
  conciliado            INTEGER NOT NULL DEFAULT 0,
  tipo_diferencia       TEXT, -- cheque_en_transito | cargo_bancario_no_registrado | otro
  created_at            TEXT,
  updated_at            TEXT,
  deleted_at            TEXT
);
CREATE INDEX idx_conciliacion_detalle_conciliacion ON conciliaciones_bancarias_detalle(conciliacion_id);
CREATE INDEX idx_conciliacion_detalle_asiento ON conciliaciones_bancarias_detalle(asiento_detalle_id);

-- =========================================================================
-- MÓDULO 7: Contabilidad
-- =========================================================================

CREATE TABLE cuentas_contables (
  id              TEXT PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  tipo            TEXT NOT NULL, -- activo | pasivo | patrimonio | ingreso | costo | gasto
  cuenta_padre_id TEXT REFERENCES cuentas_contables(id),
  es_movimiento   INTEGER NOT NULL DEFAULT 1, -- 0 = cuenta de agrupación, no recibe asientos directos
  activo          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);
CREATE INDEX idx_cuentas_contables_padre ON cuentas_contables(cuenta_padre_id);

CREATE TABLE periodos_contables (
  id                TEXT PRIMARY KEY,
  nombre            TEXT NOT NULL, -- "2026-09", "2026"
  fecha_inicio      TEXT NOT NULL,
  fecha_fin         TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'abierto', -- abierto | cerrado
  fecha_cierre      TEXT,
  usuario_cierre_id TEXT REFERENCES usuarios(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at        TEXT
);

-- Asiento contable: generado automáticamente detrás de cada operación (venta, compra, cobro,
-- pago, ajuste de inventario, movimiento de caja), o manual solo para depreciación,
-- provisiones y corrección contable, según la especificación.
CREATE TABLE asientos_contables (
  id                    TEXT PRIMARY KEY,
  numero                TEXT NOT NULL UNIQUE,
  fecha                 TEXT NOT NULL,
  concepto              TEXT NOT NULL,
  periodo_id            TEXT NOT NULL REFERENCES periodos_contables(id),
  origen_modulo         TEXT NOT NULL, -- ventas | compras | cxc | cxp | caja | inventario | manual
  origen_documento_tipo TEXT,
  origen_documento_id   TEXT,
  es_manual             INTEGER NOT NULL DEFAULT 0,
  estado                TEXT NOT NULL DEFAULT 'confirmado', -- confirmado | anulado
  motivo_anulacion      TEXT,
  usuario_id            TEXT NOT NULL REFERENCES usuarios(id),
  usuario_anulo_id      TEXT REFERENCES usuarios(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at            TEXT
);
CREATE INDEX idx_asientos_fecha ON asientos_contables(fecha);
CREATE INDEX idx_asientos_periodo ON asientos_contables(periodo_id);
CREATE INDEX idx_asientos_origen ON asientos_contables(origen_documento_tipo, origen_documento_id);

CREATE TABLE asientos_contables_detalle (
  id          TEXT PRIMARY KEY,
  asiento_id  TEXT NOT NULL REFERENCES asientos_contables(id),
  cuenta_id   TEXT NOT NULL REFERENCES cuentas_contables(id),
  debe        REAL NOT NULL DEFAULT 0,
  haber       REAL NOT NULL DEFAULT 0,
  descripcion TEXT,
  CHECK ((debe = 0 AND haber >= 0) OR (haber = 0 AND debe >= 0))
);
CREATE INDEX idx_asiento_detalle_asiento ON asientos_contables_detalle(asiento_id);
CREATE INDEX idx_asiento_detalle_cuenta ON asientos_contables_detalle(cuenta_id);
