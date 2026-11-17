const trimmedLogoCache = new Map<string, string>();

/**
 * Automatically trims excess white/transparent padding around a company logo
 * and centers it inside a crisp 1:1 square canvas so the icon appears large
 * and well-proportioned in UI headers and A4 PDF exports.
 */
export async function trimLogoWhitespace(src: string): Promise<string> {
  if (!src) return src;
  const cached = trimmedLogoCache.get(src);
  if (cached) return cached;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return src;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    const isRemote = src.startsWith('http://') || src.startsWith('https://');
    if (isRemote && !src.startsWith(window.location.origin)) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(src);
          return;
        }

        const scale = Math.min(1, 512 / Math.max(w, h));
        const sw = Math.max(1, Math.round(w * scale));
        const sh = Math.max(1, Math.round(h * scale));

        const scanCanvas = document.createElement('canvas');
        scanCanvas.width = sw;
        scanCanvas.height = sh;
        const scanCtx = scanCanvas.getContext('2d');
        if (!scanCtx) {
          resolve(src);
          return;
        }

        scanCtx.drawImage(img, 0, 0, sw, sh);
        const data = scanCtx.getImageData(0, 0, sw, sh).data;

        let minX = sw;
        let maxX = -1;
        let minY = sh;
        let maxY = -1;

        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const idx = (y * sw + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];
            if (a > 20 && (r < 245 || g < 245 || b < 245)) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX <= minX || maxY <= minY) {
          resolve(src);
          return;
        }

        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;

        // If artwork already fills >88% of both dimensions and is near square, keep original
        if (cropW >= sw * 0.88 && cropH >= sh * 0.88 && Math.abs(sw - sh) < 4) {
          trimmedLogoCache.set(src, src);
          resolve(src);
          return;
        }

        // Map cropped bounds back to full image coordinates for maximum sharpness
        const origMinX = Math.max(0, Math.floor(minX / scale));
        const origMinY = Math.max(0, Math.floor(minY / scale));
        const origCropW = Math.min(w - origMinX, Math.ceil(cropW / scale));
        const origCropH = Math.min(h - origMinY, Math.ceil(cropH / scale));

        const outSize = Math.max(256, Math.round(Math.max(origCropW, origCropH) * 1.1));
        const outCanvas = document.createElement('canvas');
        outCanvas.width = outSize;
        outCanvas.height = outSize;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) {
          resolve(src);
          return;
        }

        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(0, 0, outSize, outSize);

        const targetMax = outSize * 0.9;
        const fitScale = Math.min(targetMax / origCropW, targetMax / origCropH);
        const drawW = origCropW * fitScale;
        const drawH = origCropH * fitScale;
        const dx = (outSize - drawW) / 2;
        const dy = (outSize - drawH) / 2;

        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(img, origMinX, origMinY, origCropW, origCropH, dx, dy, drawW, drawH);

        const result = outCanvas.toDataURL('image/png');
        trimmedLogoCache.set(src, result);
        resolve(result);
      } catch {
        resolve(src);
      }
    };

    img.onerror = () => resolve(src);
    img.src = src;
  });
}
