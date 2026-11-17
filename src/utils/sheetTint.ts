/**
 * The effects SDK's sheets are white-on-black and the game multiplies them by
 * the effect colour, so a preview makes one tinted copy and reuses it: the
 * texture keeps its shading, and the black background adds nothing under an
 * additive (`lighter`) composite.
 *
 * Shared by every effect preview so a sheet is tinted the same way in all of
 * them (`ExplosionPreview`, `RibbonTrailPreview`, `EmitterPreview`).
 */
export function tintedSheet(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = /^#?[0-9a-f]{6}$/i.test(color.trim()) ? color : '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** `#rrggbb` to the 0-255 components the sheets are tinted by. */
export function parseHexColour(color: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec((color || '').trim());
  if (!match) return { r: 255, g: 255, b: 255 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** `#rrggbb` for a triplet, which is how a tinted sheet is cached by colour. */
export function hexOf(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}
