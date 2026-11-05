/**
 * Canvas backing-store sizing for high-DPI and fullscreen layouts.
 * CSS pixels remain the coordinate system used by gameplay and input. The
 * backing bitmap is scaled separately to avoid pointer/camera drift in fullscreen.
 */
export interface CanvasBitmapSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export function calculateCanvasBitmapSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxPixelRatio = 1.5,
  maxBitmapPixels = 8_000_000
): CanvasBitmapSize {
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 0 || cssHeight < 0) {
    throw new RangeError(`Canvas CSS dimensions must be finite and non-negative; received ${cssWidth}x${cssHeight}.`);
  }
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    throw new RangeError(`devicePixelRatio must be finite and positive; received ${devicePixelRatio}.`);
  }
  if (!Number.isFinite(maxPixelRatio) || maxPixelRatio < 1) {
    throw new RangeError(`Maximum canvas pixel ratio must be finite and at least 1; received ${maxPixelRatio}.`);
  }
  if (!Number.isSafeInteger(maxBitmapPixels) || maxBitmapPixels < 1) {
    throw new RangeError(`Maximum canvas bitmap area must be a positive safe integer; received ${maxBitmapPixels}.`);
  }

  const width = Math.max(1, Math.round(cssWidth));
  const height = Math.max(1, Math.round(cssHeight));
  const cssArea = width * height;
  // Preserve at least 1 backing pixel per CSS pixel. Above that, cap the DPR
  // and total surface area so fullscreen 4K/Retina canvases do not rasterize an
  // unnecessarily huge bitmap every frame.
  const areaRatioCap = cssArea > maxBitmapPixels ? 1 : Math.sqrt(maxBitmapPixels / cssArea);
  const effectiveRatio = Math.min(devicePixelRatio, maxPixelRatio, Math.max(1, areaRatioCap));

  return {
    width: Math.max(1, Math.round(width * effectiveRatio)),
    height: Math.max(1, Math.round(height * effectiveRatio)),
    pixelRatio: effectiveRatio
  };
}

/** Resize only when the backing bitmap is stale; assigning width/height clears canvas state. */
export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement): boolean {
  const rect = canvas.getBoundingClientRect();
  const size = calculateCanvasBitmapSize(rect.width || canvas.clientWidth, rect.height || canvas.clientHeight, window.devicePixelRatio);
  let changed = false;
  if (canvas.width !== size.width) {
    canvas.width = size.width;
    changed = true;
  }
  if (canvas.height !== size.height) {
    canvas.height = size.height;
    changed = true;
  }
  return changed;
}
