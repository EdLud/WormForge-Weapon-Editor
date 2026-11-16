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
};

/** How far inside the near edge the box reaches, so a worm at the feet is hit. */
export const MELEE_SLACK = 3;

/** The engine's aim angle in radians: `rot = (1 - aim) * PI`. */
export function meleeRot(aim: number): number {
  return (1 - Math.min(1, Math.max(0, aim))) * Math.PI;
}

/**
 * The unit vector "out along the weapon" for one aim, and how far the swing has
 * turned it. `(sin(rot_w), -cos(rot_w)) * weap_radius` is the engine's own offset
 * from the worm to the held art, so a **negative** radius (the grip is above the
 * pivot: most hand-drawn art) puts the weapon on the other side of the worm and
 * "forward" is the opposite direction. The swing's angle rotates that vector,
 * mirrored with the side exactly as the drawn angle is (`(base + swing) *
 * facing`), so a cut moves the box the same way on both sides.
 */
export function meleeScan(
  aim: number,
  facing: 1 | -1,
  swingDeg: number,
  radialRotation = 1,
  weapRadius = 1,
): { vx: number; vy: number; angle: number } {
  const rotW = meleeRot(aim) + Math.PI * radialRotation;
  const s = (((swingDeg * Math.PI) / 180) * facing);
  const cos = Math.cos(s);
  const sin = Math.sin(s);
  // Which way the weapon is actually drawn: the sign of its own radius.
  const side = weapRadius < 0 ? -1 : 1;
  const x = side * facing * Math.sin(rotW);
  const y = side * -Math.cos(rotW);
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
