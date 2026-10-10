// Facturación electrónica (e-CF, Ley 32-23): certificado digital, comprobantes firmados y su
// estado ante la DGII, anulaciones de secuencias (ANECF) e indicador bien/servicio del producto
// (campo obligatorio de cada línea del e-CF). Idempotente: en una base nueva ya viene de schema.sql.
const TABLAS_NUEVAS = `
CREATE TABLE IF NOT EXISTS ecf_certificados (
  id              TEXT PRIMARY KEY,
  nombre_archivo  TEXT NOT NULL,
  contenido_p12   TEXT NOT NULL,      -- base64 del .p12
  password_cifrada TEXT NOT NULL,     -- cifrada con el almacén seguro del sistema operativo
  titular         TEXT NOT NULL,
  identificacion  TEXT,               -- SN del certificado: RNC/cédula del firmante
  emisor          TEXT,
  valido_desde    TEXT NOT NULL,
  valido_hasta    TEXT NOT NULL,
  activo          INTEGER NOT NULL DEFAULT 1,
  usuario_id      TEXT REFERENCES usuarios(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS ecf_documentos (
  id                  TEXT PRIMARY KEY,
  origen_tipo         TEXT NOT NULL,   -- documentos_venta | gastos_caja_chica
  origen_id           TEXT NOT NULL,
  tipo_ecf            INTEGER NOT NULL, -- 31, 32, 33, 34, 43, 44, 45
  encf                TEXT NOT NULL UNIQUE,
  ambiente            TEXT NOT NULL,   -- TesteCF | CerteCF | eCF
  rnc_emisor          TEXT NOT NULL,
  rnc_comprador       TEXT,
  fecha_emision       TEXT NOT NULL,   -- dd-MM-AAAA, tal cual va en el XML
  fecha_firma         TEXT NOT NULL,   -- dd-MM-AAAA HH:mm:ss (GMT-4)
  monto_total         REAL NOT NULL,
  total_itbis         REAL NOT NULL DEFAULT 0,
  codigo_seguridad    TEXT NOT NULL,   -- 6 primeros caracteres del SignatureValue
  xml                 TEXT NOT NULL,   -- e-CF firmado (se conserva 10 años)
  via                 TEXT NOT NULL,   -- recepcion | rfce (consumo menor a RD$250,000)
  xml_rfce            TEXT,            -- resumen firmado que se envía en vez del e-CF (via = rfce)
  estado              TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_proceso | aceptado | aceptado_condicional | rechazado | anulado
  track_id            TEXT,
  mensajes            TEXT,            -- JSON con los mensajes de la DGII
  secuencia_utilizada INTEGER,
  contingencia        INTEGER NOT NULL DEFAULT 0, -- 1: no se pudo enviar al emitir
  intentos            INTEGER NOT NULL DEFAULT 0,
  proximo_intento_at  TEXT,
  ultimo_error        TEXT,
  enviado_at          TEXT,
  respondido_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ecf_documentos_estado ON ecf_documentos(estado);
CREATE INDEX IF NOT EXISTS idx_ecf_documentos_origen ON ecf_documentos(origen_tipo, origen_id);

CREATE TABLE IF NOT EXISTS ecf_anulaciones (
  id                  TEXT PRIMARY KEY,
  tipo_ecf            INTEGER NOT NULL,
  encf_desde          TEXT NOT NULL,
  encf_hasta          TEXT NOT NULL,
  cantidad            INTEGER NOT NULL,
  motivo              TEXT NOT NULL,
  ambiente            TEXT NOT NULL,
  xml                 TEXT NOT NULL,   -- ANECF firmado
  estado              TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aceptada | rechazada
  respuesta           TEXT,            -- JSON de la DGII
  intentos            INTEGER NOT NULL DEFAULT 0,
  proximo_intento_at  TEXT,
  ultimo_error        TEXT,
  enviado_at          TEXT,
  usuario_id          TEXT REFERENCES usuarios(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at          TEXT
);
`;

module.exports = {
  id: '012_facturacion_electronica',
  up(db, { columnasDe }) {
    db.exec(TABLAS_NUEVAS);
    if (!columnasDe(db, 'productos').has('es_servicio')) {
      db.exec('ALTER TABLE productos ADD COLUMN es_servicio INTEGER NOT NULL DEFAULT 0');
    }
  },
};
