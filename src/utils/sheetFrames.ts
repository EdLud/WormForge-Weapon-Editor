/**
 * Vertical sheet slicing, the way the engine does it.
 *
 * `crates/engine/src/sprite.rs` (and the loader behind `initgraphic`) treats a
 * declared `frames` count as a plain vertical division of the image: frame `i`
 * is the rectangle `(0, i * height / frames, width, height / frames)`. When the
 * height is not a multiple of the frame count that rectangle is not an integer,
 * the loader refuses the sheet and the sprite is missing for the whole weapon,
 * which is why the editor warns before an export can carry it.
 */
export interface FrameFit {
  /** `height / frames`, floored, in pixels. */
  cell: number;
  /** Pixels left over by the division; 0 means the sheet slices evenly. */
  remainder: number;
  ok: boolean;
  /** Frame counts (2..64) that divide the height evenly, for the suggestion. */
  divisors: number[];
}

export function frameFit(
  width: number | undefined,
  height: number | undefined,
  frames: number | undefined,
): FrameFit | null {
  if (!width || !height || !frames || frames <= 1) return null;
  const remainder = height % frames;
  const divisors: number[] = [];
  for (let n = 2; n <= Math.min(64, height); n += 1) {
    if (height % n === 0) divisors.push(n);
  }
  return { cell: Math.floor(height / frames), remainder, ok: remainder === 0, divisors };
}
