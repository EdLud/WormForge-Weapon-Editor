import React from 'react';
import { Boxes, Info, Trash2 } from 'lucide-react';
import type { PackProject } from '../types/weapon';
import { sanitizeModFolder } from '../utils/luaGenerator';
import { renamespaceWeapons } from '../utils/pack';
import { slugId } from '../utils/weaponId';

interface PackSettingsCardProps {
  pack: PackProject;
  onChange: (patch: Partial<PackProject>) => void;
  /** Remove the active weapon. The rail has the same action on a desktop. */
  onRemoveWeapon?: () => void;
}

const inputClass =
  'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-60 disabled:cursor-not-allowed';

/**
 * The bundle's own identity, which only exists once it holds more than one weapon.
 *
 * `mod.toml` is one file per bundle: its `id` names the folder under
 * `WormForge/Mods/`, its `name` is what the mod loader lists, and `replaces` takes
 * other bundles over. A bundle of one weapon does not get a second identity
 * (see `syncPackToSoleWeapon`), so this card explains that instead of offering
 * fields whose values would be overwritten on the next edit of the weapon.
 */
export const PackSettingsCard: React.FC<PackSettingsCardProps> = ({
  pack,
  onChange,
  onRemoveWeapon,
}) => {
  const many = pack.weapons.length > 1;
  const folder = sanitizeModFolder(pack.id);
  const replaces = (pack.replaces ?? []).join(', ');
  // The bundle id is the author's, and it is the **namespace** its weapons live
  // under, so renaming it renames them with it (`renamespaceWeapons`). It is
  // edited whole: no part of it is fixed.
  const renameBundle = (raw: string) => {
    const next = slugId(raw, 'bundle');
    if (next === pack.id) return;
    const renamed = renamespaceWeapons(pack, pack.id, next);
    onChange({ ...renamed, id: next } as Partial<PackProject>);
  };

  return (
    <section
      aria-label="Bundle Settings"
      className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/80 px-4 py-2.5 dark:border-stone-800 dark:bg-stone-950/60">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
            Bundle Settings
          </h2>
          <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
            ·
          </span>
          <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
            {pack.weapons.length} weapon{pack.weapons.length === 1 ? '' : 's'} · one mod.toml, one profile
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2 py-1 font-mono text-[10px] text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
          <Boxes className="h-3 w-3" aria-hidden="true" />
          WormForge/Mods/{folder}/
        </span>
      </div>

      <div className="space-y-3 p-4">
        {!many && (
          <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-[11px] leading-relaxed text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              This bundle holds one weapon, so it <em>is</em> that weapon: its id, name, author and
              version are the weapon&apos;s, and the export stays{' '}
              <span className="font-mono">{folder}.zip</span>. Add a second weapon to the bundle to
              give the bundle its own id and name.
            </span>
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Bundle id
            </span>
            <input
              className={inputClass}
              value={pack.id}
              disabled={!many}
              title="Unique across every installed bundle, and the namespace its weapons live under; it names the folder under WormForge/Mods/."
              onChange={(event) => renameBundle(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Bundle name
            </span>
            <input
              className={inputClass}
              value={pack.name}
              disabled={!many}
              title="What the mod loader lists, and the default profile file name."
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Author
            </span>
            <input
              className={inputClass}
              value={pack.author}
              disabled={!many}
              onChange={(event) => onChange({ author: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Version
            </span>
            <input
              className={inputClass}
              value={pack.version}
              disabled={!many}
              onChange={(event) => onChange({ version: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Profile name
            </span>
            <input
              className={inputClass}
              value={pack.profileName ?? ''}
              placeholder={pack.name}
              title="The one profile file every weapon of this bundle is placed in. Empty uses the bundle name."
              onChange={(event) => onChange({ profileName: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Replaces bundles
            </span>
            <input
              className={inputClass}
              value={replaces}
              placeholder="px.ports, other.bundle"
              title="Bundle ids this pack takes over, comma separated. Each id is written into `replaces`."
              onChange={(event) =>
                onChange({
                  replaces: event.target.value
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>

        <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
          Every weapon keeps its own component block, its own Lua module and its own art folder, so
          editing one weapon never moves another&apos;s files. Renaming the bundle does not rename
          the weapons: an id is allocated once, so a rename never moves a weapon&apos;s art. The
          dependencies are the union of what the weapons need, and one profile places all of them.
        </p>

        {onRemoveWeapon && many && (
          <button
            type="button"
            onClick={onRemoveWeapon}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
            title="Remove the selected weapon from this bundle"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Remove selected weapon
          </button>
        )}
      </div>
    </section>
  );
};
