import type {
  EmitterConfig,
  EmitterRingConfig,
  EmitterTrailConfig,
  WeaponProject,
} from '../types/weapon';
import {
  DEFAULT_EMITTER,
  DEFAULT_EMITTER_RING,
  DEFAULT_EMITTER_TRAIL,
  EMITTER_PRESETS,
  supportsEmitter,
  supportsEmitterRound,
} from '../data/emitter';
import {
  SectionHeader,
  SubSectionTitle,
  TooltipLabel,
  UnitNumberInput,
  buildTooltip,
} from './RecordEditor';
import { AlertTriangle, Orbit } from 'lucide-react';
import { EmitterPreview } from './EmitterPreview';

interface CardProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

interface NumFieldProps {
  id: string;
  label: string;
  code: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function NumField({
  id,
  label,
  code,
  hint,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: NumFieldProps) {
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <TooltipLabel label={label} code={code} desc={hint} htmlFor={id} />
      <UnitNumberInput
        id={id}
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        title={buildTooltip(hint, code)}
        unit={unit}
      />
    </div>
  );
}

function ColourField({
  id,
  label,
  code,
  hint,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  code: string;
  hint: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <TooltipLabel label={label} code={code} desc={hint} htmlFor={id} />
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900"
        />
        <input
          aria-label={`${label} hex`}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className={inputClass}
        />
      </div>
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      title={hint}
      className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 dark:border-sky-800/70 dark:bg-sky-950/30"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
      />
      <span className="text-xs font-semibold text-sky-900 dark:text-sky-200">{label}</span>
    </label>
  );
}

/**
 * PX's effect manager as a live emitter (`fx.emitter`, effects.sdk).
 *
 * It is a *placement* card rather than a burst: the emitter is an actor that
 * follows either the worm's muzzle (so the ring sits where the barrel points,
 * PX's railgun) or the fired round (so the ring travels with the projectile),
 * and it draws whatever is ticked for as long as that anchor exists.
 */
export function EmitterCard({ project, onChange }: CardProps) {
  if (!supportsEmitter(project)) return null;
  const em: EmitterConfig = project.emitter ?? DEFAULT_EMITTER;
  const update = (patch: Partial<EmitterConfig>) => onChange({ emitter: { ...em, ...patch } });
  const updateRing = (patch: Partial<EmitterRingConfig>) =>
    update({ ring: { ...(em.ring ?? DEFAULT_EMITTER_RING), ...patch } });
  const updateTrail = (patch: Partial<EmitterTrailConfig>) =>
    update({ trail: { ...(em.trail ?? DEFAULT_EMITTER_TRAIL), ...patch } });
  const roundOk = supportsEmitterRound(project);
  const anchor = roundOk ? (em.anchor ?? 'muzzle') : 'muzzle';
  const carryBlocked = !project.hold?.enabled;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Emitter"
        code="wf-lib/effects/px_effects (effects.sdk)"
        icon={<Orbit className="h-4 w-4 text-sky-500" aria-hidden="true" />}
        desc="PX's CEffectManager as a live actor: sparks, a glow, short reach bolts, an optional ring and ribbon, at a point that follows the muzzle or the fired round."
        right={
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-1.5 dark:border-sky-800/70 dark:bg-sky-950/30">
            <input
              id="emitter-enable"
              type="checkbox"
              checked={em.enabled}
              onChange={(e) =>
                // Only a family that cannot follow a round has its anchor
                // rewritten: toggling a power weapon off and on must keep the
                // anchor the author picked.
                update({ enabled: e.target.checked, ...(roundOk ? {} : { anchor: 'muzzle' }) })
              }
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-sky-900 dark:text-sky-200">Enable Emitter</span>
          </label>
        }
      />

      {!roundOk && (
        <div className="flex items-start gap-2 rounded-xl border border-stone-300 bg-stone-50 p-3 text-[11px] text-stone-700 dark:border-stone-700 dark:bg-stone-950/40 dark:text-stone-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            This family has no missile WA builds from the record (a placed mine is a mine entity, a
            strike's bombs carry no weapon), so the emitter can only ride the muzzle here.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="space-y-4">
          {/* Where it sits. */}
          <div>
            <TooltipLabel
              label="Anchor"
              code="FRAME_FINISH / missile_frame"
              desc="Round rides the missile WA fires from this record, adopted on its first missile frame. Muzzle sits on the worm's own fire angle (PX's curDist offset) while the turn's worm has this weapon selected, so the effect follows the aim. No on_fire is written: that key would replace WA's shot."
            />
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
              {(
                [
                  { id: 'muzzle', label: 'Muzzle / Aim', enabled: true },
                  { id: 'round', label: 'Fired Round', enabled: roundOk },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={!option.enabled}
                  onClick={() => update({ anchor: option.id })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    option.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                  } ${
                    anchor === option.id
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {anchor === 'muzzle' ? (
            <div className="space-y-3 rounded-xl border border-sky-200/80 bg-sky-50/40 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
              <label
                className={`flex items-start gap-2 ${
                  roundOk ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                }`}
              >
                <input
                  id="emitter-carry"
                  type="checkbox"
                  disabled={!roundOk}
                  checked={em.carry !== false && roundOk}
                  onChange={(e) => update({ carry: e.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500 disabled:cursor-not-allowed"
                />
                <span className="text-[11px] leading-snug text-stone-700 dark:text-stone-300">
                  <strong className="font-semibold text-stone-900 dark:text-white">
                    Hand to the round
                  </strong>{' '}
                  once the trigger fires, as PX retargets its aiming effect to the spawned missile.
                  Off keeps it an aiming effect that ends with the aim.
                  {!roundOk && ' No round to hand it to here, so it stays on the muzzle.'}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <NumField
                  id="emitter-offset-x"
                  label="Muzzle Offset"
                  code="offsetX"
                  hint="Pixels along the fire angle. PX's railgun puts its ring 25 px out so it looks like it leaves the barrel."
                  value={em.offsetX}
                  min={-120}
                  max={120}
                  unit="px"
                  onChange={(offsetX) => update({ offsetX })}
                />
                <NumField
                  id="emitter-offset-y"
                  label="Muzzle Side"
                  code="offsetY"
                  hint="Pixels across the fire angle, positive up-screen while the aim is level."
                  value={em.offsetY}
                  min={-120}
                  max={120}
                  unit="px"
                  onChange={(offsetY) => update({ offsetY })}
                />
              </div>
              {!carryBlocked && (
                <p className="text-[11px] text-sky-800/80 dark:text-sky-300/80">
                  The muzzle sits on the held art, so the aim offset reads against the drawn weapon.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-sky-200/80 bg-sky-50/40 p-3 text-[11px] leading-snug text-stone-700 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-stone-300">
              The emitter starts where the worm fires and follows the newest missile of this weapon
              until it is gone, then ends with it. A cluster bit or a mine never becomes one.
            </p>
          )}

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              Presets:
            </span>
            {(Object.keys(EMITTER_PRESETS) as EmitterConfig['preset'][]).map((preset) => (
              <button
                key={preset}
                type="button"
                title={EMITTER_PRESETS[preset].hint}
                onClick={() => update({ ...EMITTER_PRESETS[preset].patch, preset })}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  em.preset === preset
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                {EMITTER_PRESETS[preset].label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Toggle
              id="emitter-spark"
              label="Spark"
              hint="PX's crackling spark quad, ticking on its own cycle (rate and pause from the preset)."
              checked={em.spark}
              onChange={(spark) => update({ spark })}
            />
            <Toggle
              id="emitter-glow"
              label="Glow"
              hint="A soft additive glow behind the emitter (three passes, PX's drawGlow)."
              checked={em.glow}
              onChange={(glow) => update({ glow })}
            />
            <Toggle
              id="emitter-reach"
              label="Reach Bolts"
              hint="Short bolts that jump out of the emitter on a cooldown, along the preset's curve. This is the thunder, and the electric mine's rays."
              checked={em.reach}
              onChange={(reach) => update({ reach })}
            />
            <Toggle
              id="emitter-rainbow"
              label="Rainbow"
              hint="Colour every part from the hue clock, PX's SetRainbowMode."
              checked={em.rainbow}
              onChange={(rainbow) => update({ rainbow })}
            />
          </div>

          <ColourField
            id="emitter-color"
            label="Emitter Colour"
            code="r, g, b"
            hint="Tint for the bolts, spark and glow (the ring and the ribbon have their own)."
            value={em.color}
            fallback="#82b4ff"
            onChange={(color) => update({ color })}
          />

          {em.reach && (
            <>
              <SubSectionTitle
                title="Reach"
                code="reach"
                desc="The short bolts. Count is how many can be out at once, distance how far they reach, speed the fraction of the arc they cover per frame."
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <NumField
                  id="emitter-reach-count"
                  label="Bolts"
                  code="count"
                  hint="How many bolts may be in flight at once."
                  value={em.reachCount}
                  min={0}
                  max={8}
                  onChange={(reachCount) => update({ reachCount })}
                />
                <NumField
                  id="emitter-reach-distance"
                  label="Reach"
                  code="distance"
                  hint="How far a bolt may travel from the emitter, in pixels. 0 makes it a bolt in place (the thunder preset)."
                  value={em.reachDistance}
                  min={0}
                  max={200}
                  unit="px"
                  onChange={(reachDistance) => update({ reachDistance })}
                />
                <NumField
                  id="emitter-reach-speed"
                  label="Bolt Speed"
                  code="speed"
                  hint="Percent of the arc covered per game frame. 8 to 18 is a crackle, 50 is a strike."
                  value={em.reachSpeed}
                  min={1}
                  max={100}
                  step={0.5}
                  unit="%/f"
                  onChange={(reachSpeed) => update({ reachSpeed })}
                />
                <div>
                  <TooltipLabel
                    label="Curve"
                    code="curve"
                    desc="How the bolt bends: arc sweeps a circular segment, bezier bows the midpoint, line is straight."
                    htmlFor="emitter-reach-curve"
                  />
                  <select
                    id="emitter-reach-curve"
                    value={em.reachCurve}
                    onChange={(e) =>
                      update({ reachCurve: e.target.value as EmitterConfig['reachCurve'] })
                    }
                    className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                  >
                    <option value="arc">Arc</option>
                    <option value="bezier">Bezier</option>
                    <option value="line">Straight</option>
                  </select>
                </div>
                <NumField
                  id="emitter-reach-bulge"
                  label="Bow"
                  code="bulge"
                  hint="How far the curve bows away from the straight line, in pixels. Negative bows the other way."
                  value={em.reachBulge}
                  min={-200}
                  max={200}
                  unit="px"
                  onChange={(reachBulge) => update({ reachBulge })}
                />
                <NumField
                  id="emitter-reach-noise"
                  label="Bolt Noise"
                  code="noise"
                  hint="Radial jitter along the bolt. PX uses 4 for a crackle and 9 for thunder."
                  value={em.reachNoise}
                  min={0}
                  max={24}
                  step={0.5}
                  unit="px"
                  onChange={(reachNoise) => update({ reachNoise })}
                />
                <NumField
                  id="emitter-reach-segments"
                  label="Points"
                  code="segments"
                  hint="Drawn points per bolt. More is smoother and costs more."
                  value={em.reachSegments}
                  min={2}
                  max={64}
                  onChange={(reachSegments) => update({ reachSegments })}
                />
                <NumField
                  id="emitter-reach-core"
                  label="Core Width"
                  code="core_w"
                  hint="Sharp pass width in pixels."
                  value={em.reachCoreWidth}
                  min={0}
                  max={40}
                  step={0.5}
                  unit="px"
                  onChange={(reachCoreWidth) => update({ reachCoreWidth })}
                />
                <NumField
                  id="emitter-reach-glow"
                  label="Glow Width"
                  code="glow_w"
                  hint="Halo pass width in pixels. 0 draws the core only."
                  value={em.reachGlowWidth}
                  min={0}
                  max={40}
                  step={0.5}
                  unit="px"
                  onChange={(reachGlowWidth) => update({ reachGlowWidth })}
                />
              </div>
            </>
          )}

          {/* Ring */}
          <div className="space-y-3 rounded-xl border border-sky-200/80 bg-sky-50/40 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SubSectionTitle
                title="Ring"
                code="fx.ring"
                desc="PX's type 2 effect manager around the emitter: a spinning, crackling ring. Bent into an ellipse it reads as a projectile travelling with the round (the railgun)."
              />
              <Toggle
                id="emitter-ring-enable"
                label="Ring"
                hint="Draw a ring around the emitter's point."
                checked={em.ring.enabled}
                onChange={(enabled) => updateRing({ enabled })}
              />
            </div>
            {em.ring.enabled && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <NumField
                    id="emitter-ring-radius"
                    label="Radius"
                    code="radius"
                    hint="Ring radius in pixels. PX derives the pass widths from it (radius / 100 * 10, clamped 2.3 to 5.5)."
                    value={em.ring.radius}
                    min={2}
                    max={400}
                    unit="px"
                    onChange={(radius) => updateRing({ radius })}
                  />
                  <NumField
                    id="emitter-ring-segments"
                    label="Points"
                    code="segments"
                    hint="Points around the ring."
                    value={em.ring.segments}
                    min={8}
                    max={64}
                    onChange={(segments) => updateRing({ segments })}
                  />
                  <NumField
                    id="emitter-ring-noise"
                    label="Noise"
                    code="noise"
                    hint="Radial jitter in pixels: 0.67 is PX's calm ring, 5 is a live wire."
                    value={em.ring.noise}
                    min={0}
                    max={12}
                    step={0.1}
                    unit="px"
                    onChange={(noise) => updateRing({ noise })}
                  />
                  <NumField
                    id="emitter-ring-speed"
                    label="Spin"
                    code="speed"
                    hint="Degrees per game frame. 0 holds the ring still. Not used while the ring tracks the heading: the heading is written every frame, so a spin could not accumulate."
                    value={em.ring.speed}
                    min={-30}
                    max={30}
                    step={0.5}
                    unit="°/f"
                    disabled={em.ring.track}
                    onChange={(speed) => updateRing({ speed })}
                  />
                  <NumField
                    id="emitter-ring-angle"
                    label="Start Angle"
                    code="angle"
                    hint={
                      em.ring.track
                        ? 'Offset from the owner heading, in degrees, while Track Heading is on.'
                        : 'Where the first point sits, in degrees.'
                    }
                    value={em.ring.angle}
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                    onChange={(angle) => updateRing({ angle })}
                  />
                  <NumField
                    id="emitter-ring-core"
                    label="Core Width"
                    code="core_w"
                    hint="Sharp pass width in pixels. 0 lets the library derive it from the radius."
                    value={em.ring.coreWidth}
                    min={0}
                    max={40}
                    step={0.5}
                    unit="px"
                    onChange={(coreWidth) => updateRing({ coreWidth })}
                  />
                  <NumField
                    id="emitter-ring-glow"
                    label="Glow Width"
                    code="glow_w"
                    hint="Halo pass width in pixels. 0 derives it, and a hairline ring sets it to 0 on purpose."
                    value={em.ring.glowWidth}
                    min={0}
                    max={40}
                    step={0.5}
                    unit="px"
                    onChange={(glowWidth) => updateRing({ glowWidth })}
                  />
                  <NumField
                    id="emitter-ring-ellipse-x"
                    label="Bend X"
                    code="ellipse[1]"
                    hint="Horizontal radius multiplier. 1 is a circle."
                    value={em.ring.ellipseX}
                    min={0.1}
                    max={3}
                    step={0.05}
                    unit="x"
                    onChange={(ellipseX) => updateRing({ ellipseX })}
                  />
                  <NumField
                    id="emitter-ring-ellipse-y"
                    label="Bend Y"
                    code="ellipse[2]"
                    hint="Vertical radius multiplier. Below 1 squashes the ring into the lens PX's railgun fires."
                    value={em.ring.ellipseY}
                    min={0.1}
                    max={3}
                    step={0.05}
                    unit="x"
                    onChange={(ellipseY) => updateRing({ ellipseY })}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Toggle
                    id="emitter-ring-track"
                    label="Track Heading"
                    hint="Point the bend along the owner's direction of travel (the atan2 of its velocity) instead of a fixed angle, so a lens ring faces where the round is going. Spin is not used while it tracks, and a muzzle emitter has no velocity, so it keeps its own angle while aiming."
                    checked={em.ring.track}
                    onChange={(track) => updateRing({ track })}
                  />
                  <Toggle
                    id="emitter-ring-thin"
                    label="Thin Spin"
                    hint="Taper the pass to a point at both ends, PX's thin spin: a comet arc rather than a closed ring."
                    checked={em.ring.thin}
                    onChange={(thin) => updateRing({ thin })}
                  />
                  <Toggle
                    id="emitter-ring-rainbow"
                    label="Ring Rainbow"
                    hint="Colour the ring from the hue clock (inherited from the emitter when it is on)."
                    checked={em.ring.rainbow}
                    onChange={(rainbow) => updateRing({ rainbow })}
                  />
                </div>
                <ColourField
                  id="emitter-ring-color"
                  label="Ring Colour"
                  code="r, g, b"
                  hint="Tint for the ring's core and halo."
                  value={em.ring.color}
                  fallback="#82b4ff"
                  onChange={(color) => updateRing({ color })}
                />
              </>
            )}
          </div>

          {/* Emitter ribbon */}
          <div className="space-y-3 rounded-xl border border-sky-200/80 bg-sky-50/40 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SubSectionTitle
                title="Emitter Ribbon"
                code="fx.emitter{ trail }"
                desc="The emitter's own ribbon, sampled from its path. The Ribbon Trail card is the round's, so a weapon can have one of each."
              />
              <Toggle
                id="emitter-trail-enable"
                label="Ribbon"
                hint="Sample the emitter's position and draw a tapering ribbon behind it."
                checked={em.trail.enabled}
                onChange={(enabled) => updateTrail({ enabled })}
              />
            </div>
            {em.trail.enabled && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <NumField
                    id="emitter-trail-max"
                    label="Length"
                    code="max"
                    hint="Sampled points kept behind the emitter."
                    value={em.trail.max}
                    min={2}
                    max={64}
                    unit="pts"
                    onChange={(max) => updateTrail({ max })}
                  />
                  <NumField
                    id="emitter-trail-every"
                    label="Sample"
                    code="every"
                    hint="Game frames between samples."
                    value={em.trail.every}
                    min={1}
                    max={10}
                    unit="f"
                    onChange={(every) => updateTrail({ every })}
                  />
                  <NumField
                    id="emitter-trail-noise"
                    label="Noise"
                    code="noise"
                    hint="Lateral jitter in pixels."
                    value={em.trail.noise}
                    min={0}
                    max={24}
                    step={0.5}
                    unit="px"
                    onChange={(noise) => updateTrail({ noise })}
                  />
                  <NumField
                    id="emitter-trail-core"
                    label="Core Width"
                    code="core_w"
                    hint="Sharp pass width in pixels."
                    value={em.trail.coreWidth}
                    min={0}
                    max={40}
                    step={0.5}
                    unit="px"
                    onChange={(coreWidth) => updateTrail({ coreWidth })}
                  />
                  <NumField
                    id="emitter-trail-glow"
                    label="Glow Width"
                    code="glow_w"
                    hint="Halo pass width in pixels."
                    value={em.trail.glowWidth}
                    min={0}
                    max={40}
                    step={0.5}
                    unit="px"
                    onChange={(glowWidth) => updateTrail({ glowWidth })}
                  />
                  <ColourField
                    id="emitter-trail-color"
                    label="Ribbon Colour"
                    code="r, g, b"
                    hint="Tint for the emitter's own ribbon."
                    value={em.trail.color}
                    fallback="#82b4ff"
                    onChange={(color) => updateTrail({ color })}
                  />
                </div>
                <Toggle
                  id="emitter-trail-rainbow"
                  label="Ribbon Rainbow"
                  hint="Colour the ribbon from the hue clock along its length (inherited from the emitter when it is on)."
                  checked={em.trail.rainbow}
                  onChange={(rainbow) => updateTrail({ rainbow })}
                />
              </>
            )}
          </div>
        </div>

        {/* The library is the only thing that can draw this honestly. */}
        <div className="space-y-2 xl:sticky xl:top-4">
          <SubSectionTitle
            title="What It Draws"
            code="fx.emitter"
            desc="50 Hz playback of the SDK: the worm sweeps its aim with the emitter on the fire angle, the trigger fires, and the emitter hands itself to the round."
          />
          <EmitterPreview config={em} roundOk={roundOk} />
          <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
            The game&apos;s own sheets, drawn additively: beam.png for the cores, beam_glow.png
            for the halos, the SDK&apos;s ten-frame spark and its 128 px glow blob. The bolt
            cooldowns and the spark cycle are the preset&apos;s numbers, which is why thunder
            strikes once where electric crackles.
          </p>
        </div>
      </div>
    </div>
  );
}
