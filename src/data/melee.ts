import type { MeleeConfig } from '../types/weapon';

/**
 * The melee strike's numbers and geometry.
 *
 * One formula, three readers: the panel's red hit box, `sb.hold`'s simulation
 * (which emits the same arithmetic in Lua) and the test pack. The box is the
 * engine's own hold geometry, not a frame of reference of its own: the weapon is
 * placed at `rot_w = rot + PI * weap_radial_rotation` from the worm, so "along
 * the weapon" is that same vector, and the swing's angle rotates it about the
 * worm.
 */

export const DEFAULT_MELEE: MeleeConfig = {
  enabled: false,
  radius: 34,
  width: 16,
  followSwing: true,
  hitFrame: 8,
  damage: 20,
  kind: 'normal',
  pushMode: 'aim',
  pushPower: 3,
  pushVx: 0,
  pushVy: 0,
  lift: 1,
  oncePerTarget: true,
  spareShooter: true,
  log: false,
};

/** How far inside the near edge the box reaches, so a worm at the feet is hit. */
export const MELEE_SLACK = 3;

/** The engine's aim angle in radians: `rot = (1 - aim) * PI`. */
export function meleeRot(aim: number): number {
  return (1 - Math.min(1, Math.max(0, aim))) * Math.PI;
}

/**
 * The unit vector the strike reaches along: the worm's own aim, turned by the
 * swing. Nothing about the art is in it.
 *
 * `worm.aim` is WA's 180 degree sweep, `0` straight down, `0.5` level, `1`
 * straight up, and `facing` says which side, so the aim direction is
 * `(facing * sin(aim*PI), cos(aim*PI))` (world y is down). The held art's
 * `weap_rotation` and `weap_radius` are drawing controls only: rotating a sheet
 * or moving its pivot does not change where the worm points, and folding either
 * into the box is what pointed it backwards before.
 *
 * The swing's angle is applied before the side mirror, so a cut turns the box the
 * same way on both sides (`swing * facing`, exactly as the drawn angle is).
 */
export function meleeScan(
  aim: number,
  facing: 1 | -1,
  swingDeg: number,
): { vx: number; vy: number; angle: number } {
  const phi = Math.min(1, Math.max(0, aim)) * Math.PI;
  const x = facing * Math.sin(phi);
  const y = Math.cos(phi);
  const s = ((swingDeg * Math.PI) / 180) * facing;
  const cos = Math.cos(s);
  const sin = Math.sin(s);
  const vx = x * cos - y * sin;
  const vy = x * sin + y * cos;
  return { vx, vy, angle: Math.atan2(vy, vx) };
}

/**
 * Whether a point is inside the box: `along` runs outward from the worm, `across`
 * is the arc's half-width. This is the exact test `sb.hold` runs in Lua.
 */
export function meleeHits(
  target: { x: number; y: number },
  origin: { x: number; y: number },
  scan: { vx: number; vy: number },
  radius: number,
  width: number,
  slack = MELEE_SLACK,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const along = dx * scan.vx + dy * scan.vy;
  const across = -dx * scan.vy + dy * scan.vx;
  return along >= -slack && along <= radius && Math.abs(across) <= width;
}

/** The pose angle the box follows at the hit frame, in degrees. */
export function meleeSwingDeg(clipAngle: number, followSwing: boolean): number {
  return followSwing ? clipAngle : 0;
}
