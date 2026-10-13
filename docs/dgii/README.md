# Documentación oficial de facturación electrónica (DGII)

Fuente: https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx

## `xsd/` (versionado)

Esquemas XSD v1.0 publicados por la DGII, sin modificar:

- `e-CF 31` a `e-CF 47`: los diez tipos de comprobante fiscal electrónico.
- `RFCE 32`: resumen de factura de consumo menor a RD$250,000.
- `ANECF`: anulación de secuencias e-NCF.
- `ACECF`: aprobación comercial.
- `ARECF`: acuse de recibo.
- `Semilla`: autenticación.

`scripts/compilar-esquemas-ecf.js` los compila a `main/ecf/esquemas.json`, el archivo con el que el sistema arma y valida cada XML. Las pruebas vuelven a validar contra estos XSD con libxml2 (`tests/ecf-xsd.js`).

Cuando la DGII publique una versión nueva:

1. Reemplace los archivos de esta carpeta.
2. Ejecute `node scripts/compilar-esquemas-ecf.js`.
3. Corra `npm test`.

## `pdf/` (no versionado)

Formatos, Descripción Técnica, Informe Técnico, Firmado de e-CF y Representación Impresa. Se descargan del mismo enlace y sirven de referencia; no hacen falta para compilar ni probar.
