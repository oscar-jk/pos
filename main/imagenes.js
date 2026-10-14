// Validación de imágenes que llegan desde la ventana como data URL (logo del negocio, foto de
// sucursal, fotos de producto). Se valida el tipo real por su firma, no por lo que diga el
// encabezado, y se limita el tamaño: todo vive dentro de la base de datos.
const FIRMAS = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

const LIMITES = {
  logo: 300 * 1024,
  sucursal: 400 * 1024,
  producto: 400 * 1024,
  miniatura: 40 * 1024,
};

// etiqueta: cómo se nombra la imagen en el mensaje ("El logo", "La foto").
function validarImagen(dataUrl, { maxBytes, etiqueta = 'La imagen' } = {}) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new Error(`${etiqueta} debe ser una imagen PNG, JPG o WebP`);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > maxBytes) throw new Error(`${etiqueta} pesa más de ${Math.round(maxBytes / 1024)} KB. Usa una imagen más pequeña`);
  if (!FIRMAS[m[1]](bytes)) throw new Error('El archivo no es una imagen válida');
  return dataUrl;
}

module.exports = { validarImagen, LIMITES };
