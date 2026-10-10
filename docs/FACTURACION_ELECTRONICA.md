# Facturación electrónica (e-CF) — Punto X

Cumplimiento de la Ley 32-23, del Decreto 587-24 y de la documentación técnica de la DGII. Todo sale de los documentos oficiales; los XSD están en `docs/dgii/xsd`.

## Qué hace el sistema

### Como emisor

**Comprobantes:**
- Factura de crédito fiscal (E31).
- Factura de consumo (E32).
- Nota de débito (E33).
- Nota de crédito (E34).
- Regímenes especiales (E44).
- Gubernamental (E45).

**Firma:**
- XMLDSig con RSA-SHA256, C14N inclusiva y el certificado `.p12` del negocio.
- Cada XML se arma en el orden del XSD oficial y se valida antes de firmar.
- Los tags vacíos se omiten.

**Montos:**
- Van con ITBIS incluido (`IndicadorMontoGravado = 1`).
- El total del e-CF es exactamente lo cobrado.
- La base y el ITBIS por tasa cuadran con el asiento.
- El descuento global se reparte en las líneas.

**Sin internet:**
- La venta nunca espera a la red: el e-CF se firma al vender y queda en cola.
- La cola lo envía en segundo plano y consulta el resultado por TrackId.
- Si no hay conexión, reintenta y lo marca en contingencia (plazo legal: 72 horas).

**Envío de la factura de consumo (E32):**
- Menor de RD$250,000: se envía el resumen (RFCE) y el e-CF completo se conserva.
- De RD$250,000 o más: va completa y exige el RNC del cliente.

**Entrega al comprador:**
- Aceptado por la DGII, el e-CF se entrega al comprador si es receptor electrónico (según el directorio de la DGII), y se guarda su acuse de recibo.
- Si no es receptor electrónico, el comprador recibe la representación impresa.

**Representación impresa (carta y tique):**
- Tipo de comprobante en palabras, e-NCF y vencimiento de la secuencia.
- Razón social y RNC de ambas partes.
- "E" junto a las partidas exentas.
- QR de consulta: versión 8 como mínimo, 25 mm.
- Código de seguridad (los 6 primeros caracteres del SignatureValue) y fecha de firma.
- Leyendas de contingencia, de ambiente de pruebas y de rechazo.

**Anular:**
- Si el e-CF nunca se envió, la factura se anula y su e-NCF se anula ante la DGII (ANECF).
- Si la DGII ya lo recibió, no se anula: se emite una nota de crédito por el total.
- Las secuencias que sobran también se pueden anular (por ejemplo, al vencer el rango).

**Notas:**
- La nota de crédito (E34) referencia la factura.
- El código de modificación es 1 si devuelve todo de una vez y 3 si es parcial.
- El indicador de 30 días se calcula solo.
- Nunca se acredita más de lo cobrado. Esto corrigió un error previo con el descuento global.

**Contingencia por imposibilidad de emitir:**
- Se factura con NCF serie B.
- Al terminarla, el sistema emite los e-CF que reemplazan esos NCF (código 4) y los envía solo a la DGII.
- El cliente conserva su comprobante serie B.

### Como receptor

- Recibe e-CF de proveedores, ya sea por el servicio web o importando el XML en **Compras > e-CF recibidos**.
- Verifica la firma y que el comprador sea el negocio.
- Responde con un acuse de recibo firmado (ARECF).
- Firma la aprobación o el rechazo comercial (ACECF) y lo envía a la DGII y al proveedor.
- Recibe las aprobaciones comerciales que sus clientes envían sobre sus propios e-CF.

## Puesta en marcha

1. **Configuración > Negocio:** RNC, razón social exacta de la DGII y dirección.
2. **Configuración > Facturación electrónica:**
   1. Cargue el certificado `.p12`. La contraseña la cifra Windows (DPAPI).
   2. Use **Probar conexión** para confirmar que la DGII autentica el certificado.
   3. Registre las secuencias e-NCF autorizadas, con su fecha de vencimiento.
   4. Con al menos E31, E32, E33 y E34, cambie el modo a **Electrónico**.
3. Empiece en **TesteCF** (pruebas) y luego **CerteCF** (certificación). Ninguno de los dos tiene validez fiscal, y las facturas impresas lo dicen. Para pasar a **eCF** (producción) hay que escribir "PRODUCCION" como confirmación.
4. **Ventas > Comprobantes electrónicos** muestra:
   - el estado de cada e-CF;
   - los mensajes de la DGII;
   - la entrega al comprador.

   Desde ahí se reintenta un envío, se descarga el XML (`RNC + e-NCF.xml`) y se anulan secuencias.
5. **Productos:** marque **Es un servicio** donde corresponda. El e-CF informa bien o servicio en cada línea.

## Proceso de certificación ante la DGII

Ver "Proceso de Certificación para ser Emisor Electrónico" en el portal de la DGII.

| Etapa | Con qué se cubre |
|---|---|
| Pre-certificación (TesteCF) | Ambiente TesteCF con las secuencias de prueba que da la DGII (E31 hasta 10,000,000). |
| Postulación: URL de recepción, aprobación y autenticación | **Requiere publicar los servicios del receptor** (ver "Pendiente"). |
| Pruebas de datos: set de e-CF y de aprobaciones comerciales | El generador y el firmador están listos. Falta leer el Excel del set: su formato solo se ve dentro del portal. |
| Pruebas de simulación: e-CF y su representación impresa en PDF | Ventas reales en CerteCF. El PDF sale con "Guardar como PDF" del diálogo de impresión. |
| Pruebas de comunicación: recepción y aprobaciones | `main/ecf/servidor-receptor.js`, publicado en internet. |
| Declaración jurada | La firma la herramienta de la DGII. |

## Pendiente

### 1. Publicar los servicios del receptor (bloquea la certificación)

La DGII exige tres URL públicas con SSL, disponibles siempre:
- recepción;
- aprobación comercial;
- autenticación (opcional).

Las llaman la DGII y los demás contribuyentes. El manejador ya existe (`crearServidorReceptor`, rutas estándar, probado de punta a punta), pero una aplicación de escritorio sin conexión no puede exponerlo sola.

Opciones:
- (a) Un servicio pequeño en la nube que reciba y guarde, y que la app sincronice. Es la fase Supabase/Vercel que aún no empezó.
- (b) Un túnel HTTPS hacia el equipo de la tienda. Es más barato, pero el equipo tiene que estar siempre encendido.
- (c) Un proveedor de servicios de facturación electrónica solo para la recepción.

### 2. Decisiones fiscales que el sistema no improvisa

- **Ventas a regímenes especiales (E44):** el formato exige que todo vaya exento, y hoy los precios incluyen ITBIS. Por ahora el sistema rechaza un E44 con ITBIS. Falta definir cómo se fija el precio a esos clientes.
- **Nota de crédito después de 30 días:** el indicador se envía. Falta decidir si en ese caso se devuelve solo el precio, sin el ITBIS (Reglamento 293-11, arts. 8 y 28).
- **Retenciones en el E31 a agentes de retención:** hoy no se incluyen; se registran al cobrar.
- **E41 (compras a informales) y E43 (gastos menores):** el generador los soporta, pero requieren reglas de retención y criterios de uso que no están en la especificación.
- **Exportaciones (E46) y pagos al exterior (E47):** no aplican al punto de venta actual.

## Archivos

- `main/ecf/xml.js`: arma y valida cada XML según `esquemas.json`, que se compila de los XSD con `scripts/compilar-esquemas-ecf.js`.
- `main/ecf/c14n.js`, `firma.js`, `certificado.js`: canonicalización, firma y lectura del certificado.
- `main/ecf/construir.js`: e-CF, RFCE y ANECF desde los datos del documento.
- `main/ecf/emision.js`: modo, ambiente, certificado, secuencias y emisión desde ventas.
- `main/ecf/cola.js`: envío, consulta, entrega al comprador y aprobaciones, con reintentos.
- `main/ecf/dgii.js`: servicios de la DGII y de otros contribuyentes.
- `main/ecf/receptor.js`: semilla/token, ARECF y ACECF.
- `main/ecf/servidor-receptor.js`: rutas HTTP.
- `main/ecf/timbre.js`: URL del QR y SVG.
- `main/ipc/ecf.js`: configuración, monitor y recibidos.
- Pantallas:
  - `renderer/configuracion/ecf.js`;
  - `renderer/ventas/ecf.html`;
  - `renderer/compras/ecf-recibidos.js`.
- Migraciones `012_facturacion_electronica` y `013_ecf_receptor`.
- Pruebas: `tests/ecf-*.test.js`. Validan contra los XSD con libxml2 y verifican la firma con `xml-crypto`, de forma independiente al código del sistema.
