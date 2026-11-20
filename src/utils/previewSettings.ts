/**
 * The effect settings a preview reads where `0` is a real value.
 *
 * The generator writes these numbers as they are and Lua treats `0` as truthy
 * (`o.fade or 0.55` is `0`), so a preview that falls back on `||` or `> 0`
 * shows a different effect from the one the export plays. They live here, not
 * in the components, so `tools/check_generator_edges.ts` can pin them: the
 * preview components load their sheets through Vite and do not import outside it.
 */
import type { EmitterConfig, ExplosionEffectConfig } from '../types/weapon';

/** `fx.burst`'s per-frame envelope step: `fade = o.fade or 0.55`. */
export function burstFade(config: Pick<ExplosionEffectConfig, 'fade'>): number {
  return config.fade ?? 0.55;
}

/**
 * The reach bolts' ribbon widths. `0` skips that pass in the SDK (the card's
 * own hint: 0 draws the core only), so it is not "unset".
 */
export function emitterReachWidths(
  cfg: Pick<EmitterConfig, 'reachCoreWidth' | 'reachGlowWidth'>,
): { coreW: number; glowW: number } {
  return {
    coreW: Math.max(0, cfg.reachCoreWidth ?? 8),
    glowW: Math.max(0, cfg.reachGlowWidth ?? 13),
  };
}

/** The emitter ribbon's widths, read the same way (`trail.lua` keeps a `0`). */
export function emitterTrailWidths(
  trail: Pick<EmitterConfig['trail'], 'coreWidth' | 'glowWidth'>,
): { coreW: number; glowW: number } {
  return {
    coreW: Math.max(0, trail.coreWidth ?? 8),
    glowW: Math.max(0, trail.glowWidth ?? 0),
  };
}
