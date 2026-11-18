import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  FolderPlus,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { PackProject } from '../types/weapon';
import { hasProjectileBody } from '../data/recordTabs';

const ARCHETYPE_BADGE: Record<string, string> = {
  power: 'Projectile',
  hitscan: 'Firearm',
  drop: 'Dropped',
  cursor: 'Cursor',
  arrow: 'Arrow',
  spray: 'Flame',
  special: 'Special',
  melee: 'Melee',
};

/** The one-line family label the rail and the mobile switcher share. */
export function weaponKindLabel(project: PackProject['weapons'][number]): string {
  if (project.fireType === 'cursor') return project.teleport ? 'Teleport' : 'Air Strike';
  if (project.fireType === 'drop') return project.body?.fuse ? 'Dynamite' : 'Mine';
  return ARCHETYPE_BADGE[project.fireType] ?? project.fireType;
}

interface PackRailProps {
  pack: PackProject;
  activeIndex: number;
  onSelect: (index: number) => void;
  /** A fresh weapon from the default donor. */
  onAddWeapon: () => void;
  /** Read an installed bundle and append the weapon it produces. */
  onImportWeapon: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
}

/**
 * The weapons a bundle holds, in the order the manifest and the profile see them.
 *
 * One weapon is the ordinary case and the rail says nothing extra: that bundle is
 * that weapon (see `syncPackToSoleWeapon`). The list only becomes a list when a
 * second weapon is added, which is also when the bundle gets its own identity.
 */
export const PackRail: React.FC<PackRailProps> = ({
  pack,
  activeIndex,
  onSelect,
  onAddWeapon,
  onImportWeapon,
  onDuplicate,
  onRemove,
  onMove,
}) => {
  const many = pack.weapons.length > 1;
  return (
    <div className="mt-2 rounded-xl border border-stone-200 bg-white/70 p-2 dark:border-stone-800 dark:bg-stone-900/40">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
          {many ? `Bundle · ${pack.weapons.length} weapons` : 'Bundle'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onImportWeapon}
            className="rounded-md border border-sky-300/80 bg-sky-50/75 p-1 text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:bg-sky-900/40"
            title="Read an installed mod and add its weapon to this bundle"
            aria-label="Add a weapon from installed mods"
          >
            <Upload className="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onAddWeapon}
            className="rounded-md border border-forge-300/80 bg-forge-50/75 p-1 text-forge-700 transition-colors hover:bg-forge-100 dark:border-forge-700/60 dark:bg-forge-950/30 dark:text-forge-300 dark:hover:bg-forge-900/40"
            title="Add a blank weapon (the stock Grenade record) to this bundle"
            aria-label="Add a blank weapon"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* A pack can hold a hundred weapons: the list scrolls inside the sidebar so
          the workspace navigation under it stays reachable. */}
      <ul className="max-h-[38vh] space-y-1 overflow-y-auto pr-0.5">
        {pack.weapons.map((weapon, index) => {
          const active = index === activeIndex;
          return (
            <li key={`${weapon.id}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={active ? 'true' : undefined}
                className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                  active
                    ? 'bg-forge-50 text-forge-900 ring-1 ring-forge-200 dark:bg-forge-950/40 dark:text-forge-100 dark:ring-forge-800'
                    : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/60'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      active ? 'bg-forge-500' : 'bg-stone-300 dark:bg-stone-600'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{weapon.name}</span>
                  <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-stone-400 dark:text-stone-500">
                    {weaponKindLabel(weapon)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate pl-3 font-mono text-[9px] text-stone-400 dark:text-stone-500">
                  {weapon.id}
                </span>
                {hasProjectileBody(weapon.fireType, weapon.teleport, weapon.body?.fuse) && (
                  <span className="mt-0.5 block truncate pl-3 text-[9px] text-stone-400 dark:text-stone-500">
                    {weapon.useWepFile && weapon.wepFile ? '.wep base' : weapon.based_on}
                    {' · '}
                    {weapon.action && weapon.action !== 'none' ? weapon.action : 'direct'}
                  </span>
                )}
              </button>

              {active && (
                <div className="mt-1 flex items-center gap-1 pl-1">
                  <button
                    type="button"
                    onClick={() => onDuplicate(index)}
                    className="flex items-center gap-1 rounded-md border border-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                    title="Add a copy of this weapon to the bundle"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                    className="rounded-md border border-stone-200 p-1 text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                    title="Move up in the bundle"
                    aria-label="Move this weapon up"
                  >
                    <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(index, 1)}
                    disabled={index === pack.weapons.length - 1}
                    className="rounded-md border border-stone-200 p-1 text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                    title="Move down in the bundle"
                    aria-label="Move this weapon down"
                  >
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    disabled={pack.weapons.length <= 1}
                    className="ml-auto rounded-md border border-rose-200 p-1 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    title={
                      pack.weapons.length <= 1
                        ? 'A bundle always holds one weapon'
                        : 'Remove this weapon from the bundle'
                    }
                    aria-label="Remove this weapon from the bundle"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!many && (
        <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-stone-400 dark:text-stone-500">
          <FolderPlus className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
          One weapon: the bundle takes this weapon&apos;s id, name and folder. Add another to give the
          bundle its own.
        </p>
      )}
    </div>
  );
};

interface WeaponSwitcherProps {
  pack: PackProject;
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Adds a blank weapon. The sidebar rail has the rest of the actions. */
  onAdd?: () => void;
}

/**
 * The mobile stand-in for the rail: the bundle's weapons as a select, and the one
 * action a phone needs to start a bundle (the card on the record page has the
 * rest). The select only exists once there is more than one weapon.
 */
export const WeaponSwitcher: React.FC<WeaponSwitcherProps> = ({
  pack,
  activeIndex,
  onSelect,
  onAdd,
}) => {
  const many = pack.weapons.length > 1;
  if (!many && !onAdd) return null;
  return (
    <span className="flex items-center gap-1">
      {many && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Weapon in this bundle</span>
          <select
            value={activeIndex}
            onChange={(event) => onSelect(Number(event.target.value))}
            className="max-w-28 truncate rounded-md border border-stone-300 bg-white px-1.5 py-1 text-[11px] font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          >
            {pack.weapons.map((weapon, index) => (
              <option key={`${weapon.id}-${index}`} value={index}>
                {weapon.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-forge-300/80 bg-forge-50/75 p-1 text-forge-700 dark:border-forge-700/60 dark:bg-forge-950/30 dark:text-forge-300"
          aria-label="Add a weapon to this bundle"
          title="Add a blank weapon to this bundle"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </span>
  );
};
