/**
 * Telling this editor's own output apart from a bundle's own code.
 *
 * A re-imported bundle that came out of this editor contains registrations the
 * editor wrote: the ribbon trail's `missile_frame` sweep, the interval WAV's
 * ticker, and the sequential-fire fuse sampler. Those are not foreign code to be
 * carried; they are what a panel already models, and carrying them as well would
 * ship two ribbons, two sounds and two samplers (the plan's open questions 2 and
 * 3: `reqs/custom_code_import_plan.md`, M1.5).
 *
 * The question this module answers is only ever "did this editor write this
 * block", and it answers it with the text. Each feature has a signature that the
 * generator emits and a hand-written bundle does not:
 *
 * - **ribbon trail**: a `TRAIL` table and a `trail.add(m.id, trail_worm(), TRAIL)`
 *   call in the handler (plus `trail_is_bit` when the target is not `main`);
 * - **interval sound**: a `SOUND` table with a `path`, `sound_ticks[m.id]`, and a
 *   play of `SOUND.path` at `SOUND.priority`;
 * - **fuse sampler**: a `worm_message` filtered to `FRAME_FINISH` that writes
 *   `fuse_by_worm[w.id]` from the keyboard digit, with `FUSE_DEFAULT` above it;
 * - **emitter**: the `body_move` handler (filtered to `"worm"`) or legacy
 *   `FRAME_FINISH` handler that keeps the effect manager at the muzzle, and the
 *   `missile_frame` handler that latches a round's `m.id`, which only exist
 *   alongside the `emitter_for` table the emitter card writes.
 *
 * A near miss (`wa.sound.play(w, "sounds/x/y.wav", 8)` on a timer, a
 * `missile_frame` handler that moves a missile) does not match, and matching on
 * `missile_frame` alone would classify every trail-like weapon anyone ever wrote
 * as ours. What the caller does with a recognised block is its own decision: the
 * import says the panel re-emits it, and a panel that is switched off is the
 * author's own choice.
 */
import type { LuaRegistration, SplitModule } from './splitModule';

export type OwnFeature = 'ribbon-trail' | 'interval-sound' | 'fuse-sampler' | 'emitter';

export interface OwnEmission {
  feature: OwnFeature;
  /** The card that writes this again on export. */
  panel: string;
  /** The signature that matched, so a false positive can be argued with. */
  evidence: string;
}

export interface OwnRegistration {
  registration: LuaRegistration;
  emission: OwnEmission;
}

export interface OwnOutput {
  /** Registrations this editor wrote, and the feature that will write them again. */
  own: OwnRegistration[];
  /** Registrations nothing models: the bundle's own code, until M6 carries it. */
  foreign: LuaRegistration[];
}

/** Is this declaration anywhere in the module, preamble or install body? */
const declares = (split: SplitModule, needle: string): boolean =>
  split.install?.bodyText.includes(needle) === true ||
  split.preamble.some((block) => block.text.includes(needle));

const EMISSIONS: Record<OwnFeature, (registration: LuaRegistration, split: SplitModule) => string | null> = {
  'fuse-sampler': (registration, split) => {
    if (registration.event !== 'worm_message') return null;
    if (!registration.options?.includes('FRAME_FINISH')) return null;
    if (!registration.handler.includes('fuse_by_worm[')) return null;
    // `FUSE_DEFAULT` is a module-level declaration (`fuse_of` reads it), so the
    // signature spans the preamble and the install body.
    if (!declares(split, 'FUSE_DEFAULT')) return null;
    return 'worm_message on FRAME_FINISH writing fuse_by_worm from the digit';
  },
  'ribbon-trail': (registration, split) => {
    if (registration.event !== 'missile_frame') return null;
    if (!registration.handler.includes('trail.add(')) return null;
    if (!/(^|\W)TRAIL\b/.test(registration.handler)) return null;
    if (!declares(split, 'local TRAIL = {')) return null;
    return 'missile_frame calling trail.add with the TRAIL table';
  },
  emitter: (registration, split) => {
    if (!declares(split, 'local function emitter_for(')) return null;
    // The muzzle tracker is a `body_move` handler on `"worm"` (or legacy
    // `worm_message` on FRAME_FINISH from older exports).
    if (registration.event === 'body_move') {
      if (!registration.options?.includes('"worm"')) return null;
      if (!registration.handler.includes('emitter_muzzle(')) return null;
      if (!registration.handler.includes('emitter_for(')) return null;
      return 'body_move on "worm" moving the emitter to the muzzle';
    }
    if (registration.event === 'worm_message') {
      if (!registration.options?.includes('FRAME_FINISH')) return null;
      if (!registration.handler.includes('emitter_muzzle(')) return null;
      if (!registration.handler.includes('emitter_for(')) return null;
      return 'worm_message on FRAME_FINISH moving the emitter to the muzzle';
    }
    // The round latch is a `missile_frame` sweep keyed by `m.id`.
    if (registration.event === 'missile_frame') {
      if (
        !registration.handler.includes('EMITTER_ROUNDS') &&
        !registration.handler.includes('EMITTER_ROUND')
      ) {
        return null;
      }
      if (!registration.handler.includes('emitter_round')) return null;
      if (!declares(split, 'local function emitter_round(')) return null;
      return 'missile_frame latching rounds and updating the emitter cache';
    }
    return null;
  },
  'interval-sound': (registration, split) => {
    if (registration.event !== 'missile_frame') return null;
    if (!registration.handler.includes('sound_ticks[')) return null;
    if (!registration.handler.includes('SOUND.path')) return null;
    if (!declares(split, 'local SOUND = {')) return null;
    return 'missile_frame ticking sound_ticks and playing SOUND.path';
  },
};

const PANELS: Record<OwnFeature, string> = {
  'ribbon-trail': 'ribbon trail',
  'interval-sound': 'interval sound',
  'fuse-sampler': 'fuse sampler',
  emitter: 'emitter',
};

/** Which feature a registration is this editor's own emission of, if any. */
export function ownEmissionOf(
  registration: LuaRegistration,
  split: SplitModule,
): OwnEmission | null {
  for (const [feature, match] of Object.entries(EMISSIONS) as [
    OwnFeature,
    (registration: LuaRegistration, split: SplitModule) => string | null,
  ][]) {
    const evidence = match(registration, split);
    if (evidence) return { feature, panel: PANELS[feature], evidence };
  }
  return null;
}

/** Split a module's registrations into what a panel re-emits and what it does not. */
export function ownOutputOf(split: SplitModule): OwnOutput {
  const own: OwnRegistration[] = [];
  const foreign: LuaRegistration[] = [];
  for (const registration of split.registrations) {
    const emission = ownEmissionOf(registration, split);
    if (emission) own.push({ registration, emission });
    else foreign.push(registration);
  }
  return { own, foreign };
}
