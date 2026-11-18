/**
 * Ids, and the namespace a bundle gives them.
 *
 * An installed bundle claims its own id, and the engine refuses two bundles that
 * claim the same one. So the weapons a bundle writes live **under** its id:
 * `<bundle id>.<weapon>` (`lucia.arsenal.rocket`). That convention is all there
 * is. Nothing here fixes a prefix: the bundle id is the author's, both id fields
 * edit the whole id, and the only question the emitter and the validator ask is
 * `isUnderNamespace`.
 *
 * `DEFAULT_ID_NAMESPACE` exists for one job, a **default value** for work that
 * has no bundle yet (a new project, a decoded `.wep`, a weapon a bundle's own
 * module leaves unnamed). It is a suggestion that keeps a fresh id away from the
 * mods already installed, not a rule: nothing checks for it, and the fields edit
 * it away in one keystroke.
 */
export const DEFAULT_ID_NAMESPACE = 'wfws';

/** The engine's own cap on a component id. */
export const ID_MAX = 64;

/** One id segment: lowercase, `[a-z0-9_-]`, empty segments dropped. */
function slugSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * `Heavy Rocket!` -> `heavy_rocket`. Dots are kept, because an id is a path
 * (`lucia.arsenal.rocket`) and the author typed them on purpose; a doubled or
 * trailing dot is not (`a..b` and `a.b.` slug to `a.b`).
 */
export function slugId(raw: string, fallback = 'weapon'): string {
  const segments = (raw ?? '')
    .split('.')
    .map(slugSegment)
    .filter((segment) => segment.length > 0);
  return segments.join('.') || fallback;
}

/** The editable part of an id: everything after the last dot. */
export function weaponIdSuffix(id: string | undefined): string {
  const raw = (id ?? '').trim();
  if (!raw) return '';
  const parts = raw.split('.');
  return parts[parts.length - 1] || '';
}

/** `lucia.arsenal` -> `lucia.arsenal.`, the prefix a weapon id lives under. */
export function idNamespace(bundleId: string | undefined): string {
  const raw = (bundleId ?? '').trim();
  return raw ? `${raw}.` : '';
}

/** `('lucia.arsenal.', 'rocket')` -> `lucia.arsenal.rocket`. */
export function withNamespace(namespace: string, leaf: string): string {
  return `${namespace}${slugId(leaf)}`;
}

/**
 * True when `id` is the bundle itself or one of its weapons. A bundle of one
 * weapon **is** that weapon (`syncPackToSoleWeapon`), so equality counts.
 */
export function isUnderNamespace(id: string | undefined, bundleId: string | undefined): boolean {
  const raw = (id ?? '').trim().toLowerCase();
  const bundle = (bundleId ?? '').trim().toLowerCase();
  if (!raw || !bundle) return false;
  return raw === bundle || raw.startsWith(`${bundle}.`);
}

/**
 * The namespace an **imported** bundle's copy takes: the source's own id with
 * `_import` on its last segment, so a Project X bundle keeps its author's
 * namespace (`px.ports` becomes `px.ports_import`, and its weapons
 * `px.ports_import.port`) instead of being pushed into one of ours.
 *
 * The marker goes in the **last** segment and not on the end of the id as a
 * suffix of dots, because that segment is the folder (`sanitizeModFolder`): a copy
 * called `px.ports.import` writes `Mods/import/`, and every imported bundle would
 * land in the same folder. Appending it twice is not a thing: an id that already
 * ends in `_import` is its own copy.
 */
export function copyNamespace(bundleId: string | undefined): string {
  const raw = (bundleId ?? '').trim() || 'bundle';
  const slug = slugId(raw, 'bundle');
  return /_import$/i.test(slug) ? slug : `${slug}_import`;
}
