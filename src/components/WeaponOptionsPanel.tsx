import React, { useState } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';
import type { WeaponOptionConfig, WeaponProject } from '../types/weapon';
import { NumberInput } from './NumberInput';

interface WeaponOptionsPanelProps {
  project: WeaponProject;
  onChange: (patch: Partial<WeaponProject>) => void;
}

const fieldInput =
  'w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-800 shadow-xs outline-none focus:border-forge-500 focus:ring-2 focus:ring-forge-500/25 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100';

/** The value a control shows: the player's choice, else the declared default. */
function effective(option: WeaponOptionConfig): boolean | number | string {
  if (option.value !== undefined) return option.value;
  if (option.default !== undefined) return option.default;
  if (option.kind === 'int') return option.min ?? 0;
  if (option.kind === 'choice') return option.choices?.[0] ?? '';
  return false;
}

function describeDefault(option: WeaponOptionConfig): string {
  // The *declared* default, not the current value: the control beside it already
  // shows the choice, and a row that said "default opposite" while the manifest
  // says `default = "straight"` was reading the wrong one.
  const value =
    option.default !== undefined
      ? option.default
      : option.kind === 'int'
        ? (option.min ?? 0)
        : option.kind === 'choice'
          ? (option.choices?.[0] ?? '')
          : false;
  const shown = typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
  const kind =
    option.kind === 'int'
      ? `int ${option.min ?? 0}..${option.max ?? '?'}`
      : option.kind === 'choice'
        ? 'one of ' + (option.choices ?? []).join(' / ')
        : 'on / off';
  return `default ${shown} (${kind})`;
}

/**
 * The component's `ctx.option` settings (`[[components.options]]`).
 *
 * They are the weapon's own settings, not a library's: `ctx.option("k")` on a
 * key the manifest does not declare is a load error, so an imported weapon's
 * declarations are kept in order and only their *values* are edited here. A
 * value equal to the declared default writes nothing to the profile, which is
 * what the engine's own editor stores (the default is stored as no value).
 *
 * `data = true` marks an option that is also the weapon data field of the same
 * key (PX's `placement_range`), so the panel says so rather than pretending the
 * setting lives only in the profile.
 */
export const WeaponOptionsPanel: React.FC<WeaponOptionsPanelProps> = ({ project, onChange }) => {
  const [open, setOpen] = useState(true);
  const options = project.options ?? [];
  if (options.length === 0) return null;

  const setValue = (key: string, value: boolean | number | string) => {
    onChange({
      options: options.map((option) => (option.key === key ? { ...option, value } : option)),
    });
  };
  const changed = options.filter(
    (option) => option.value !== undefined && option.value !== option.default,
  ).length;

  return (
    <div className="border-t border-stone-200/80 pt-3 dark:border-stone-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/80 bg-amber-50/75 px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition-colors hover:border-amber-400 hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <Settings2 className="h-3 w-3" aria-hidden="true" />
          <span>Weapon Options</span>
          <span className="font-mono text-[10px] opacity-70">{options.length}</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
        <span className="text-[11px] text-stone-400">
          {changed === 0
            ? 'all at their defaults, nothing written to the profile'
            : `${changed} changed, written to the profile as [options."${project.id}"]`}
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {options.map((option) => {
            const value = effective(option);
            const id = `wopt-${option.key}`;
            return (
              <div
                key={option.key}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_11rem]"
              >
                <div className="min-w-0">
                  <label
                    htmlFor={id}
                    className="block truncate text-xs font-semibold text-stone-700 dark:text-stone-200"
                  >
                    {option.label || option.key}
                    {option.data && (
                      <span
                        className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-800 dark:bg-sky-950/60 dark:text-sky-200"
                        title="data = true: this option is also the weapon data field of the same key"
                      >
                        data
                      </span>
                    )}
                  </label>
                  <span className="block truncate font-mono text-[10px] text-stone-400">
                    ctx.option(&quot;{option.key}&quot;) · {describeDefault(option)}
                  </span>
                  {option.description && (
                    <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                      {option.description}
                    </span>
                  )}
                </div>
                {option.kind === 'bool' ? (
                  <label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={value === true}
                      onChange={(event) => setValue(option.key, event.target.checked)}
                      className="rounded text-forge-600 focus:ring-forge-500"
                    />
                    <span className="truncate">{value === true ? 'On' : 'Off'}</span>
                  </label>
                ) : option.kind === 'int' ? (
                  <NumberInput
                    id={id}
                    min={option.min}
                    max={option.max}
                    value={typeof value === 'number' ? value : 0}
                    onChange={(event) => {
                      // Only text that parses reaches here: an empty box or a lone
                      // `-` is a draft, not the option's minimum.
                      const next = parseInt(event.target.value, 10);
                      setValue(option.key, Number.isFinite(next) ? next : (option.min ?? 0));
                    }}
                    className={`${fieldInput} font-mono tabular-nums`}
                  />
                ) : (
                  <select
                    id={id}
                    value={String(value)}
                    onChange={(event) => setValue(option.key, event.target.value)}
                    className={fieldInput}
                  >
                    {(option.choices ?? []).map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
