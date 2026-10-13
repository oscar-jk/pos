// Preparación del logo del negocio: reduce la imagen elegida a 256 px como máximo (conserva la
// transparencia en PNG) y la mantiene bajo 300 KB. La validación definitiva la hace el proceso
// principal (main/ipc/configuracion.js: validarLogo).
(function () {
  const LOGO_LADO = 256;
  const LOGO_MAX_BYTES = 300 * 1024;

  function bytesDeDataUrl(d) { return Math.floor((d.length - d.indexOf(',') - 1) * 3 / 4); }
  
  // Reduce la imagen a 256 px como máximo (conserva la transparencia en PNG) y la mantiene bajo 300 KB.
  function prepararLogo(archivo) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) { reject(new Error('El logo debe ser una imagen PNG, JPG o WebP')); return; }
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, LOGO_LADO / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const intentos = [['image/png'], ['image/webp', 0.9], ['image/webp', 0.7], ['image/jpeg', 0.7]];
        for (const [tipo, calidad] of intentos) {
          const d = canvas.toDataURL(tipo, calidad);
          if (d.startsWith(`data:${tipo}`) && bytesDeDataUrl(d) <= LOGO_MAX_BYTES) { resolve(d); return; }
        }
        reject(new Error('El logo es demasiado pesado. Usa una imagen más sencilla'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  window.PuntoXLogo = { preparar: prepararLogo };
})();
