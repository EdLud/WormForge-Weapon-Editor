import React from 'react';
import { Swords, Target } from 'lucide-react';
import type { WeaponProject } from '../types/weapon';
import { DEFAULT_MELEE } from '../data/melee';

interface MeleeCardProps {
  project: WeaponProject;
  onChange: (patch: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

/**
 * The melee strike: the box the swing scans, the tick it lands on, and how the
 * victim is thrown. Everything here is emitted as `melee = { ... }` inside the
 * `sb.hold` spec, and the aiming manager fires the hit from its own swing clock
 * (so the hit is the same frame on every peer, and the preview's red box is the
 * box the game tests).
 */
export const MeleeCard: React.FC<MeleeCardProps> = ({ project, onChange }) => {
  const melee = { ...DEFAULT_MELEE, ...(project.melee ?? {}) };
  const clip = project.aimClip;
  const hitFrame = Math.max(0, Math.round(melee.hitFrame));
  const clipTicks = Math.max(1, Math.round(clip?.ticks ?? 16));
  // The swing the hit rides: enabling the strike turns the Space clip on, so the
  // panel never shows a hit frame with nothing to land on.
  const swingOn = !!clip?.enabled || melee.enabled;
  const hitscan = melee.enabled && !!project.hold?.enabled && swingOn;

  const update = (patch: Partial<typeof melee>) => onChange({ melee: { ...melee, ...patch } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
            <Swords className="h-4 w-4 text-forge-600 dark:text-forge-400" aria-hidden="true" />
            Melee Strike
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
            The aiming phase is the attack. Space plays the held art&apos;s swing (eat_fire, so
            nothing leaves the worm) and the scan box below lands on the hit frame. The red box in
            the Hold page&apos;s preview is this box, drawn at the aim you have set there.
          </p>
        </div>
        <label
          htmlFor="melee-enabled"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-xs font-bold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        >
          <input
            id="melee-enabled"
            type="checkbox"
            checked={melee.enabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              // The strike lands on a tick of the swing, and the swing is a clip
              // on the held art, so switching the strike on switches both on.
              // One patch, because two `onChange` calls both read the same
              // `project` and the second would undo the first.
              const patch: Partial<WeaponProject> = { melee: { ...melee, enabled } };
              if (enabled) {
                if (project.aimClip && !project.aimClip.enabled) {
                  patch.aimClip = { ...project.aimClip, enabled: true };
                }
                if (project.hold && !project.hold.enabled) {
                  patch.hold = { ...project.hold, enabled: true };
                }
              }
              onChange(patch);
            }}
            className="h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
          />
          Enable Strike
        </label>
      </div>

      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          hitscan
            ? 'border-forge-200 bg-forge-50/70 text-forge-800 dark:border-forge-800/60 dark:bg-forge-950/25 dark:text-forge-300'
            : 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-300'
        }`}
      >
        <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Melee hitscan:{' '}
          <span className="font-mono font-bold">{hitscan ? 'true' : 'false'}</span>
          {hitscan
            ? ` (a box test ${Math.round(hitFrame * 20)} ms after Space: no projectile, no blast)`
            : !melee.enabled
              ? ' (the strike is off)'
              : !project.hold?.enabled
                ? ' (turn on custom held art: the swing is the attack)'
                : ' (turn on Swing on Space in the Hold page)'}
        </span>
      </div>

      {melee.enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="melee-radius"
                className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="How far the strike reaches along the weapon, in pixels. The near edge starts at the worm's body, so a short reach is a punch and a long one is a spear."
              >
                Scan Reach (px)
              </label>
              <input
                id="melee-radius"
                type="number"
                min={4}
                max={200}
                value={melee.radius}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                  update({ radius: value });
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="melee-width"
                className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="Half the arc's width, in pixels: how far to either side of the weapon the strike catches. A bat wants a wide one, a spear a narrow one."
              >
                Scan Width (px, each side)
              </label>
              <input
                id="melee-width"
                type="number"
                min={2}
                max={120}
                value={melee.width}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                  update({ width: value });
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="melee-hit-frame"
                className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="The 50 Hz tick of the swing at which the box lands (20 ms each). The clip is 16 ticks by default, so 8 lands mid-cut."
              >
                Hit Frame (ticks after Space)
              </label>
              <input
                id="melee-hit-frame"
                type="number"
                min={0}
                max={200}
                value={melee.hitFrame}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                  update({ hitFrame: Math.max(0, value) });
                }}
                className={inputClass}
              />
              <p className="mt-1 text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                {Math.round(hitFrame * 20)} ms into a {clipTicks}-tick swing
                {hitFrame > clipTicks ? ': past the end, so it never lands' : ''}
              </p>
            </div>
            <div>
              <label
                htmlFor="melee-damage"
                className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="Damage handed to WA's own hit (`worm:hurt`), so it goes through the normal health and knockback code."
              >
                Damage
              </label>
              <input
                id="melee-damage"
                type="number"
                min={0}
                max={200}
                value={melee.damage}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                  update({ damage: value });
                }}
                className={inputClass}
              />
            </div>
          </div>

          <label
            htmlFor="melee-follow-swing"
            title="Scan along the drawn swing angle at the hit frame instead of the aim pose. A cut through an arc then sweeps the box with the art, which is how an overhead swing reaches an overhead worm."
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
          >
            <input
              id="melee-follow-swing"
              type="checkbox"
              checked={melee.followSwing}
              onChange={(event) => update({ followSwing: event.target.checked })}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Follow the swing direction</span>
              <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                On: the box turns with the blade&apos;s angle at the hit frame. Off: it stays
                straight along the aim, whatever the art is doing.
              </span>
            </span>
          </label>

          <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="melee-push-mode"
                  className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                  title="How the victim is thrown: away along the weapon (the aim), or a fixed vx/vy of your own."
                >
                  Hit Direction
                </label>
                <select
                  id="melee-push-mode"
                  value={melee.pushMode}
                  onChange={(event) =>
                    update({ pushMode: event.target.value as 'aim' | 'fixed' })
                  }
                  className={selectClass}
                >
                  <option value="aim">Along the aim (the weapon&apos;s direction)</option>
                  <option value="fixed">Fixed vx / vy</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="melee-kind"
                  className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                  title="The hit kind. Electrical needs the weapon to declare px.electric, which the strike adds itself."
                >
                  Damage Type
                </label>
                <select
                  id="melee-kind"
                  value={melee.kind}
                  onChange={(event) => update({ kind: event.target.value as 'normal' | 'taze' })}
                  className={selectClass}
                >
                  <option value="normal">Normal</option>
                  <option value="taze">Electrical (taze)</option>
                </select>
              </div>
            </div>

            {melee.pushMode === 'aim' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="melee-push-power"
                    className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                    title="The shove away from the worm along the weapon, in WA's hurt speed (px per frame). 3 is a solid bat, 6 sends the worm flying."
                  >
                    Push (px per frame)
                  </label>
                  <input
                    id="melee-push-power"
                    type="number"
                    step={0.5}
                    min={0}
                    max={20}
                    value={melee.pushPower}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                      update({ pushPower: value });
                    }}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="melee-lift"
                    className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                    title="Upward lift added to the throw, in px per frame (positive is up), so a bat can pop a worm into the air."
                  >
                    Lift (up)
                  </label>
                  <input
                    id="melee-lift"
                    type="number"
                    step={0.5}
                    min={-10}
                    max={10}
                    value={melee.lift}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                      update({ lift: value });
                    }}
                    className={inputClass}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="melee-push-vx"
                    className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                    title="The literal horizontal speed the victim is thrown at, in WA's hurt units (px per frame). Positive is to the right on screen."
                  >
                    vx
                  </label>
                  <input
                    id="melee-push-vx"
                    type="number"
                    step={0.5}
                    min={-20}
                    max={20}
                    value={melee.pushVx}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                      update({ pushVx: value });
                    }}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="melee-push-vy"
                    className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                    title="The literal vertical speed, in WA's hurt units (px per frame). Negative is up."
                  >
                    vy
                  </label>
                  <input
                    id="melee-push-vy"
                    type="number"
                    step={0.5}
                    min={-20}
                    max={20}
                    value={melee.pushVy}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                      update({ pushVy: value });
                    }}
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="melee-once"
              title="Hit each worm once per swing. Off means the box keeps hitting every frame it overlaps, which drains health fast."
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
            >
              <input
                id="melee-once"
                type="checkbox"
                checked={melee.oncePerTarget}
                onChange={(event) => update({ oncePerTarget: event.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              <span className="text-xs text-stone-700 dark:text-stone-300">
                <span className="font-semibold">One hit per worm</span>
                <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                  Per swing, not per frame.
                </span>
              </span>
            </label>
            <label
              htmlFor="melee-spare-shooter"
              title="Leave the worm holding the weapon out of its own strike, so a long reach cannot hit the swinger."
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
            >
              <input
                id="melee-spare-shooter"
                type="checkbox"
                checked={melee.spareShooter}
                onChange={(event) => update({ spareShooter: event.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              <span className="text-xs text-stone-700 dark:text-stone-300">
                <span className="font-semibold">Spare the firing worm</span>
                <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                  Never hit the worm that swung.
                </span>
              </span>
            </label>
          </div>

          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] leading-snug text-stone-600 dark:border-stone-700 dark:bg-stone-950/30 dark:text-stone-400">
            Tip: the Hold page&apos;s aim slider picks which posture the box is drawn at, and the
            swing card there sets the angle the box follows. The strike needs no ammo and no
            projectile: <span className="font-mono">eat_fire = true</span> is written for the swing,
            and the turn ends when the clip does.
          </p>
        </>
      )}
    </div>
  );
};

export default MeleeCard;
