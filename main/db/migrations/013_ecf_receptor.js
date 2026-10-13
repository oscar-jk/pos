// e-CF entre contribuyentes (Descripción Técnica Emisores Electrónicos): entrega del e-CF al
// comprador electrónico con su acuse de recibo, y comprobantes recibidos de proveedores con su
// acuse (ARECF) y aprobación comercial (ACECF). Idempotente.
const COLUMNAS_ENTREGA = [
  ['entrega_estado', 'TEXT'],          // pendiente | entregado | no_electronico | no_recibido
  ['entrega_url', 'TEXT'],
  ['entrega_intentos', 'INTEGER NOT NULL DEFAULT 0'],
  ['entrega_error', 'TEXT'],
  ['entrega_proximo_at', 'TEXT'],
  ['acuse_xml', 'TEXT'],               // ARECF firmado que devolvió el comprador
  ['acuse_estado', 'INTEGER'],         // 0 recibido | 1 no recibido
  ['aprobacion_estado', 'INTEGER'],    // ACECF del comprador: 1 aceptado | 2 rechazado
  ['aprobacion_motivo', 'TEXT'],
  ['aprobacion_xml', 'TEXT'],
];

const TABLA_RECIBIDOS = `
CREATE TABLE IF NOT EXISTS ecf_recibidos (
  id                   TEXT PRIMARY KEY,
  tipo_ecf             INTEGER,
  encf                 TEXT NOT NULL,
  rnc_emisor           TEXT NOT NULL,
  razon_social_emisor  TEXT,
  rnc_comprador        TEXT,
  fecha_emision        TEXT,           -- dd-MM-AAAA
  monto_total          REAL,
  total_itbis          REAL,
  xml                  TEXT NOT NULL,  -- e-CF recibido, tal cual
  via                  TEXT NOT NULL,  -- servicio | importado
  acuse_estado         INTEGER NOT NULL, -- 0 recibido | 1 no recibido
  acuse_motivo         INTEGER,        -- 1 especificación | 2 firma | 3 duplicado | 4 RNC comprador
  acuse_xml            TEXT,           -- ARECF firmado que se devolvió
  aprobacion_estado    INTEGER,        -- 1 aceptado | 2 rechazado (nuestra decisión)
  aprobacion_motivo    TEXT,
  aprobacion_xml       TEXT,           -- ACECF firmado
  aprobacion_envio     TEXT,           -- pendiente | enviada | error
  aprobacion_intentos  INTEGER NOT NULL DEFAULT 0,
  aprobacion_error     TEXT,
  aprobacion_proximo_at TEXT,
  aprobacion_enviada_at TEXT,
  documento_compra_id  TEXT REFERENCES documentos_compra(id),
  usuario_id           TEXT REFERENCES usuarios(id),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_ecf_recibidos_emisor ON ecf_recibidos(rnc_emisor, encf);
`;

module.exports = {
  id: '013_ecf_receptor',
  COLUMNAS_ENTREGA,
  TABLA_RECIBIDOS,
  up(db, { columnasDe }) {
    const existentes = columnasDe(db, 'ecf_documentos');
    for (const [nombre, tipo] of COLUMNAS_ENTREGA) {
      if (!existentes.has(nombre)) db.exec(`ALTER TABLE ecf_documentos ADD COLUMN ${nombre} ${tipo}`);
    }
    db.exec(TABLA_RECIBIDOS);
  },
};
