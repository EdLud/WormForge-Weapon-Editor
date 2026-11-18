// Reading a whole bundle as a pack: every weapon component in it, through the
// same importer a single weapon uses.
//
// This is P5 of `reqs/pack_export_plan.md`, and it is the other direction of the
// emitter: a bundle the editor writes has to come back as the bundle it was, and
// a bundle someone else wrote has to arrive as a pack the editor can edit and
// export without the original losing its weapons to one another.
//
// Three rules, and the reason for each:
//
//  - **A bundle whose weapons already live under its own id is kept verbatim**, so
//    exporting and re-importing an editor bundle is idempotent
//    (`wfws.swim_suit.javelin` stays that), and so the art folders it declares do
//    not move.
//  - **A bundle that does not is namespaced under a copy of its own id**
//    (`copyNamespace`). Components of `px.ports` are `px.port`,
//    `px.banana_express`, … and those ids are taken by the installed bundle:
//    exporting a second bundle that claims one of them is refused by the engine.
//    `px.ports.import.port` is the same weapon under a namespace the export owns,
//    and it keeps the source author's id instead of pushing it into one of ours.
//  - **The folder is what a bump protects** (`adoptWeaponId`), and a weapon whose
//    id had to change has its declared art moved with it, exactly as a duplicate
//    does.
import type { PackProject, WeaponProject } from '../../types/weapon';
import type { ModBundle, ModFile, ModWeapon } from './scan';
import { importBundleWeapon } from './importWeapon';
import {
  adoptWeaponId,
  retargetWeaponArt,
  syncPackToSoleWeapon,
  weaponFolder,
} from '../pack';
import { stockSlotForPosition } from '../../data/stockWeapons';
import { copyNamespace, isUnderNamespace, slugId } from '../weaponId';

export interface PackImport {
  pack: PackProject;
  /** One line per weapon, plus anything that changed its id. */
  notes: string[];
}

const lastSegment = (id: string): string => {
  const at = (id || '').lastIndexOf('.');
  return at < 0 ? id || '' : id.slice(at + 1);
};

/**
 * The bundle id an imported pack exports as. A bundle whose own weapons live
 * under its id is kept (a re-import of an editor bundle must not rename it); any
 * other bundle gets a copy of its own id, because the original is installed and
 * the engine refuses two bundles that claim one id.
 */
export function packIdFromBundle(bundleId: string, componentIds: string[] = []): string {
  const raw = (bundleId || '').trim() || 'bundle';
  const ours = componentIds.length > 0 && componentIds.every((id) => isUnderNamespace(id, raw));
  return ours ? raw : copyNamespace(raw);
}

/** The id a component's weapon gets in the imported pack. */
export function weaponIdFromComponent(packId: string, componentId: string): string {
  const raw = (componentId || '').trim();
  if (isUnderNamespace(raw, packId)) return raw;
  return `${packId}.${slugId(lastSegment(raw) || raw)}`;
}

/**
 * Import every weapon of a bundle into one `PackProject`.
 *
 * A component whose record could not be read is left out rather than imported as
 * a blank weapon (the caller passes the ones with a record), because a pack of
 * silently wrong weapons is worse than a pack that says which one it skipped.
 */
export async function importBundlePack(
  bundle: ModBundle,
  weapons: ModWeapon[],
  files: ModFile[],
): Promise<PackImport> {
  const notes: string[] = [];
  const packId = packIdFromBundle(
    bundle.id,
    weapons.map((weapon) => weapon.componentId),
  );
  const base: PackProject = {
    id: packId,
    name: bundle.name || packId,
    author: bundle.author || 'WormForge Author',
    version: bundle.version || '0.1.0',
    weapons: [],
  };
  if (packId !== bundle.id) {
    notes.push(`${bundle.id}: imported as ${packId}, so the export does not claim the installed bundle's id`);
  }

  // The weapons are collected and the one-weapon rule applied **once** at the
  // end: applied per weapon it would rename the bundle to the first weapon's id
  // and the pack would lose the id the manifest declared.
  const entries: WeaponProject[] = [];
  for (const weapon of weapons) {
    const result = await importBundleWeapon(weapon, files);
    const project = result.project as WeaponProject;
    const wanted = weaponIdFromComponent(packId, weapon.componentId || project.id || project.name);
    const id = adoptWeaponId({ ...base, weapons: entries }, wanted);
    // The panel slot the component replaces, when the position names one: that is
    // what `default_position` is, and it is how a pack keeps its weapons where the
    // author put them instead of all landing on the donor's slot.
    const slot = stockSlotForPosition(weapon.row, weapon.column);
    let entry: WeaponProject = {
      ...project,
      id,
      slot: slot ?? project.slot,
      // A stock icon name round-trips; a path is art, which the single-weapon
      // importer already carries.
      panel_icon: weapon.icon && !weapon.icon.includes('/') ? weapon.icon : project.panel_icon,
    };
    if (id !== wanted) {
      // The id moved, so the folder it names moved: the art it declares by path
      // goes with it (a duplicate's rule).
      entry = retargetWeaponArt(
        entry,
        weaponFolder({ id: wanted } as WeaponProject),
        weaponFolder(entry),
      );
      notes.push(
        `${weapon.componentId}: imported as ${id}, because ${weaponFolder({ id: wanted } as WeaponProject)} is already used in this bundle`,
      );
    }
    entries.push(entry);
    // One line per weapon: an import summary is a list of what arrived, not a
    // transcript of every note the single-weapon importer made.
    notes.push(
      `${weapon.name || weapon.componentId}: ${result.notes.length > 0 ? `${result.notes.length} note(s)` : 'read clean'}`,
    );
  }
  const pack = syncPackToSoleWeapon({ ...base, weapons: entries });

  // The bundle's own profile file name, when it has exactly one: a re-export
  // should not rename the profile the author ships.
  const profileFiles = (bundle.files ?? []).filter((path) =>
    /(^|\/)profiles\/[^/]+\.toml$/i.test(path),
  );
  const profileName =
    profileFiles.length === 1
      ? (profileFiles[0].split('/').pop() || '').replace(/\.toml$/i, '')
      : undefined;

  return { pack: { ...pack, profileName }, notes };
}
