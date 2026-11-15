import type { MissileAnimType, WeaponProject } from '../types/weapon';
import { assetUrl } from './assetUrl';
import {
  createPlaceholderHoldSheet,
  createPlaceholderMissileSheet,
} from './placeholderSprites';

/**
 * The fallback held/flight art while no PNG has been uploaded. This sprite is
 * drawn for this project (`spec/holyhandgrenade.png`), not taken from WA: a
 * bundle that has no uploaded art still ships a sprite, and it has to be one the
 * editor may actually redistribute. It lives in `public/` so both the builder
 * previews and the exported bundle use the exact same pixels.
 *
 * One sprite covers every weapon on purpose. There used to be a bazooka for
 * barrel donors and a grenade for the rest, both cut from WA's own art, which
 * meant every untouched export carried Team17 pixels.
 */

export type DefaultArtKey = 'hand_grenade';

export interface DefaultArt {
  key: DefaultArtKey;
  label: string;
  url: string;
  /** Native pixels of the supplied PNG (square, as PX's hold cells). */
  width: number;
  height: number;
}

const ART: Record<DefaultArtKey, DefaultArt> = {
  hand_grenade: {
    key: 'hand_grenade',
    label: 'hand-drawn grenade',
    url: assetUrl('assets/defaults/default_hand_grenade.png'),
    width: 64,
    height: 64,
  },
};

/** The fallback art, whatever the donor or fire type is. */
export function defaultArtFor(_project: WeaponProject): DefaultArt {
  return ART.hand_grenade;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the sprite sheet.'));
    }, 'image/png');
  });
}

/** Stack `count` copies of `img` vertically so `frames` slices line up. */
async function stackFrames(img: HTMLImageElement, count: number): Promise<Blob> {
  const frames = Math.max(1, Math.round(count) || 1);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight * frames;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.imageSmoothingEnabled = false;
  for (let frame = 0; frame < frames; frame += 1) {
    ctx.drawImage(img, 0, frame * img.naturalHeight);
  }
  return canvasToPng(canvas);
}

/** The `hold.png` written when the hold builder has no uploaded sheet. */
export async function createDefaultHoldSheet(
  project: WeaponProject,
  frames: number
): Promise<Blob> {
  try {
    const img = await loadImage(defaultArtFor(project).url);
    return await stackFrames(img, frames);
  } catch {
    return createPlaceholderHoldSheet(frames);
  }
}

/** The `missile.png` written when custom flight art has no uploaded sheet. */
export async function createDefaultMissileSheet(
  project: WeaponProject,
  anim: MissileAnimType,
  frames: number
): Promise<Blob> {
  try {
    const img = await loadImage(defaultArtFor(project).url);
    return await stackFrames(img, frames);
  } catch {
    return createPlaceholderMissileSheet(anim, frames);
  }
}

/**
 * The 1x1 transparent sheet the aiming manager points the engine's hold draw at
 * while its quads draw (`hold.sheets[1]`, switched with
 * `wa.weapons.hold_sheet`). The handle claims every `hold.sheets` entry, so the
 * file only has to exist; nothing is ever drawn from it.
 */
export async function createSilentSheet(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvasToPng(canvas);
}
