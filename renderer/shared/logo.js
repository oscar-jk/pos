// Preparación de imágenes antes de guardarlas: el logo del negocio, la foto de cada local y las
// fotos de producto. Se reducen en la ventana (canvas) para que pesen poco dentro de la base; la
// validación definitiva la hace el proceso principal (main/imagenes.js).
(function () {
  // En la demo web todo vive en el almacenamiento del navegador (unos 5 MB): fotos más chicas.
  // Se decide al usar (este archivo puede cargarse antes que los de la demo).
  const esWeb = () => !window.__PUNTOX_ES_ELECTRON && Boolean(window.PuntoXWebStore);
  const perfiles = (ES_WEB = esWeb()) => ({
    logo: { lado: 256, maxBytes: 300 * 1024, transparente: true },
    sucursal: ES_WEB ? { lado: 640, maxBytes: 120 * 1024 } : { lado: 1280, maxBytes: 400 * 1024 },
    producto: ES_WEB ? { lado: 480, maxBytes: 90 * 1024 } : { lado: 900, maxBytes: 400 * 1024 },
    miniatura: { lado: 160, maxBytes: 40 * 1024, recorte: true },
  });

  function bytesDeDataUrl(d) { return Math.floor((d.length - d.indexOf(',') - 1) * 3 / 4); }

  function leerImagen(archivo) {
    return new Promise((resolve, reject) => {
      if (!archivo || !/^image\/(png|jpeg|webp)$/.test(archivo.type)) { reject(new Error('Usa una imagen PNG, JPG o WebP')); return; }
      // Se lee como data URL: la política de seguridad de la ventana admite data: y no blob:.
      const lector = new FileReader();
      lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
      lector.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo leer la imagen'));
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }

  // Dibuja la imagen reducida a `lado` px como máximo. Con recorte, la deja cuadrada (centro),
  // que es como se ven las miniaturas en listas y en la cuadrícula del mostrador.
  function reducir(img, { lado, maxBytes, transparente, recorte }, etiqueta) {
    const ancho = img.naturalWidth;
    const alto = img.naturalHeight;
    let sx = 0; let sy = 0; let sw = ancho; let sh = alto;
    if (recorte) { const m = Math.min(ancho, alto); sx = (ancho - m) / 2; sy = (alto - m) / 2; sw = m; sh = m; }
    const escala = Math.min(1, lado / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * escala));
    canvas.height = Math.max(1, Math.round(sh * escala));
    const ctx = canvas.getContext('2d');
    if (!transparente) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const intentos = transparente
      ? [['image/png'], ['image/webp', 0.9], ['image/webp', 0.7], ['image/jpeg', 0.7]]
      : [['image/webp', 0.85], ['image/jpeg', 0.85], ['image/webp', 0.7], ['image/jpeg', 0.7], ['image/jpeg', 0.55], ['image/jpeg', 0.4]];
    for (const [tipo, calidad] of intentos) {
      const d = canvas.toDataURL(tipo, calidad);
      if (d.startsWith(`data:${tipo}`) && bytesDeDataUrl(d) <= maxBytes) return d;
    }
    throw new Error(`${etiqueta} pesa demasiado. Usa una imagen más sencilla`);
  }

  async function preparar(archivo, perfil, etiqueta = 'La imagen') {
    const img = await leerImagen(archivo);
    return reducir(img, perfiles()[perfil], etiqueta);
  }

  // Foto de producto: la imagen y su miniatura cuadrada.
  async function prepararFotoProducto(archivo) {
    const img = await leerImagen(archivo);
    return { imagen: reducir(img, perfiles().producto, 'La foto'), miniatura: reducir(img, perfiles().miniatura, 'La miniatura') };
  }

  window.PuntoXLogo = {
    preparar: (archivo) => preparar(archivo, 'logo', 'El logo').catch((e) => { throw new Error(e.message.replace(/^Usa una imagen/, 'El logo debe ser una imagen')); }),
  };
  window.PuntoXImagen = {
    preparar,
    fotoSucursal: (archivo) => preparar(archivo, 'sucursal', 'La foto'),
    fotoProducto: prepararFotoProducto,
  };
})();
