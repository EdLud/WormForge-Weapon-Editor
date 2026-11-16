import JSZip from 'jszip';
import { WeaponProject } from '../types/weapon';
import { WFWS_SDK_MOD_TOML, WFWS_SPRITE_BUILDER_LUA } from '../data/wfwsSdk';
import {
  roamSheetPath,
  roamSheetsOwnFlight,
  generateLuaCode,
  generateModToml,
  generateProfileToml,
  bitFlightSheetPath,
  behaviorStateSheetPath,
  customSoundPath,
  extraHandSheetPath,
  flashSheetPath,
  holdNeedsAimLayer,
  missileFlightSheetPath,
  packArtPath,
  silentHoldSheetPath,
  wfwsRoleFlags,
  PACK_ART_SLOTS,
  sanitizeModFolder,
  terrainStampPath,
  wepBundlePath,
} from './luaGenerator';
import {
  bitBuilderMode,
  primaryBuilderOn,
  resolveBehaviorStates,
} from '../data/spriteBuilder';
import {
  applySheetAliases,
  collapseSpriteSections,
  compactSpriteLists,
  dedupeSheets,
} from './sheetDedupe';
import {
  createDefaultHoldSheet,
  createDefaultMissileSheet,
  createSilentSheet,
} from './defaultArt';

/**
 * A bundle-relative path with every `.`/`..`/empty segment dropped and `/` as the
 * separator. A path that reaches the ZIP is data (an import, `customSprites`), so
 * `../../x.png` must not become an entry pointing outside the mod folder; the
 * engine refuses `..` at load too (`inside_pack`), so normalising here can only
 * agree with it. Returns null when nothing usable is left.
 */
export function safeBundlePath(path: string): string | null {
  const segments = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  return segments.length > 0 ? segments.join('/') : null;
}

export async function exportModZip(project: WeaponProject): Promise<Blob> {
  const zip = new JSZip();
  const modFolder = sanitizeModFolder(project.id);
  const profileName = (project.name || modFolder).replace(/[\\/:*?"<>|]/g, '_');

  let luaCode = generateLuaCode(project);
  let modToml = generateModToml(project);
  const profileToml = generateProfileToml(project);
  // Sheets are collected first: two roles that resolve to the same picture (the
  // fallback art, or one upload used for two) must not bind twice in the atlas.
  const sheets: { path: string; source: File | Blob }[] = [];
  // `path` is the bundle-relative one the Lua and mod.toml name ("sprites/<mod>/
  // hold.png"), because the alias below rewrites those two files by path.
  const addSheet = (path: string, source: File | Blob | null | undefined) => {
    if (source) sheets.push({ path, source });
  };

  // The original Project X record, when the weapon is declared with `wep`
  // instead of `copy_from`. The engine reads it relative to the bundle root.
  const wepPath = wepBundlePath(project);
  if (wepPath && project.wepFile) {
    zip.file(`${modFolder}/${wepPath}`, project.wepFile);
  }

  // Custom Icon
  if (project.customIconFile) {
    zip.file(`${modFolder}/sprites/${modFolder}/icon.png`, project.customIconFile);
  }

  // Hold Art Sheet. The generated Lua always declares hold.sheet, so an
  // enabled hold without an upload ships the default Bazooka/Grenade art
  // instead of a path to a missing file (which fails at load).
  if (project.hold && project.hold.enabled) {
    const holdBlob = project.hold.sheetFile
      ? project.hold.sheetFile
      : await createDefaultHoldSheet(project, project.hold.frames);
    addSheet(`sprites/${modFolder}/hold.png`, holdBlob);
    // The optional firing-state sprite. Only declared in the Lua when a file
    // exists, so nothing dangles when it is off.
    if (project.hold.flashFile) {
      addSheet(flashSheetPath(project), project.hold.flashFile);
    }
    // The second hand's own art. Without an upload the layer draws the first
    // hand's sheet, so there is nothing to write.
    const hand2 = extraHandSheetPath(project);
    if (hand2 && project.hold.extraHand?.file) {
      addSheet(hand2, project.hold.extraHand.file);
    }
    // The aiming manager's mute: a 1x1 transparent sheet the claim loads as
    // `hold.sheets[1]`, which the quad layer switches to while it draws the aim
    // poses itself. The generated Lua names it, so it always has to exist.
    if (holdNeedsAimLayer(project)) {
      addSheet(silentHoldSheetPath(project), await createSilentSheet());
    }
  }

  // Missile/Projectile Sprite Sheet (custom mode always declares the sheet).
  if (primaryBuilderOn(project)) {
    const missileBlob = project.missileSprite.sheetFile
      ? project.missileSprite.sheetFile
      : await createDefaultMissileSheet(
          project,
          project.missileSprite.anim || 'rotation',
          project.missileSprite.frames
        );
    addSheet(missileFlightSheetPath(project), missileBlob);
  }

  // WFWS builder roles. A builder row without an upload ships the same default
  // art as the primary, so a declared path never points at a missing file.
  if (primaryBuilderOn(project)) {
    if (bitBuilderMode(project) === 'builder') {
      const bitBlob = project.bitFlight.sheetFile
        ? project.bitFlight.sheetFile
        : await createDefaultMissileSheet(
            project,
            project.bitFlight.anim || 'rotation',
            project.bitFlight.frames
          );
      addSheet(bitFlightSheetPath(project), bitBlob);
    }
    // Timed homing art (the builder's `homing` / `bits.homing` sheets).
    const flags = wfwsRoleFlags(project);
    for (const [owned, key] of [
      [flags.homing, 'homing'] as const,
      [flags.bitHoming, 'homing_bit'] as const,
      [flags.roam, 'roam'] as const,
    ]) {
      if (!owned) continue;
      const role = project.behaviorArt?.[key];
      const blob = role?.sheetFile
        ? role.sheetFile
        : await createDefaultMissileSheet(project, role?.anim || 'rotation', role?.frames ?? 1);
      addSheet(behaviorStateSheetPath(project, key), blob);
    }
    for (const state of resolveBehaviorStates(project)) {
      if (state.art.mode !== 'builder') continue;
      const stateBlob = state.art.sheetFile
        ? state.art.sheetFile
        : await createDefaultMissileSheet(
            project,
            state.art.anim || 'rotation',
            state.art.frames
          );
      addSheet(behaviorStateSheetPath(project, state.def.key), stateBlob);
    }
  }

  // A roaming animal's two flying sheets (`sheep_sprites`). The engine installs
  // exactly two, so nothing is written unless both are uploaded. A builder
  // sheet owns the flying state instead, and then neither is referenced.
  if (roamSheetsOwnFlight(project)) {
    const sheets = [
      ['flight1', project.roamSheets?.flight1?.file],
      ['flight2', project.roamSheets?.flight2?.file],
    ] as const;
    for (const [which, file] of sheets) {
      if (file) addSheet(roamSheetPath(project, which), file);
    }
  }

  // Uploaded record art (trails, cluster bit sheets). The Lua and mod.toml
  // point at this exact path, so the file is always written when it is declared.
  for (const slot of PACK_ART_SLOTS) {
    const asset = project.packArt?.[slot];
    const path = packArtPath(project, slot);
    if (asset?.file && path) {
      addSheet(path, asset.file);
    }
  }

  // The terrain stamp's baked 32-frame strip. `terrainStampPath` returns null
  // unless the card is on with a sheet, so the declaration and the file are
  // written from the same test and a declared path always exists.
  const stampPath = terrainStampPath(project);
  if (stampPath && project.terrainStamp?.sheet?.file) {
    addSheet(stampPath, project.terrainStamp.sheet.file);
  }

  // Custom WAVs the claim plays by path. The Lua's `sounds` list and the file
  // written here are one contract: a declared path must exist at load.
  for (const role of ['explosion', 'interval', 'shot'] as const) {
    const path = customSoundPath(project, role);
    const asset =
      role === 'explosion'
        ? project.customSounds?.explosion
        : role === 'interval'
          ? project.customSounds?.interval
          : project.customSounds?.shot;
    if (path && asset?.file) {
      zip.file(`${modFolder}/${path}`, asset.file);
    }
  }

  // Any other custom sprite assets
  for (const cs of Object.values(project.customSprites)) {
    // `customSprites` is free-form data, so its path is the one place a `..`
    // could reach a ZIP entry. Normalise it, and skip an entry that had nothing
    // usable left rather than writing a file nothing can name.
    const safe = safeBundlePath(cs.path);
    if (cs.file && safe) addSheet(safe, cs.file);
  }

  // One file per picture. `dedupeSheets` compares the bytes and the declared
  // frame count, then the Lua and mod.toml are rewritten to the kept path, so a
  // weapon whose hold, missile, homing and roam art are all the fallback art
  // binds one sheet under one id instead of four under four.
  const loaded = await Promise.all(
    sheets.map(async (sheet) => ({
      path: sheet.path,
      bytes: new Uint8Array(await sheet.source.arrayBuffer()),
    })),
  );
  const { files, alias } = dedupeSheets(loaded, modToml);
  if (alias.size > 0) {
    luaCode = compactSpriteLists(applySheetAliases(luaCode, alias));
    modToml = collapseSpriteSections(applySheetAliases(modToml, alias));
  }
  for (const file of files) {
    const safe = safeBundlePath(file.path);
    if (safe) zip.file(`${modFolder}/${safe}`, file.bytes);
  }

  // The layout from the mod tutorial: mod.toml and profiles/ have fixed names,
  // and mod.toml's `entry` (weapons/<folder>.lua, see generateModToml) says where
  // the weapon's Lua is. Nothing else reads weapon/, profile/ or a root
  // weapons.lua, so none of those copies are written. Written after the sheet
  // aliases above, so the paths they name are the files the ZIP carries.
  zip.file(`${modFolder}/mod.toml`, modToml);
  zip.file(`${modFolder}/weapons/${modFolder}.lua`, luaCode);
  zip.file(`${modFolder}/profiles/${profileName}.toml`, profileToml);

  // Bundle the wfws.sdk library alongside every export so the weapon's
  // `dependencies = ["wfws.sdk"]` resolves locally without an online install.
  // Library bundles live under `Mods/wf-lib/` next to `wf.sdk` and
  // `effects.sdk`, so the folder goes there and the ZIP unpacks straight into
  // `Mods/`.
  zip.file('wf-lib/wfws_sdk/mod.toml', WFWS_SDK_MOD_TOML);
  zip.file('wf-lib/wfws_sdk/lib/wfws_sprite_builder.lua', WFWS_SPRITE_BUILDER_LUA);

  return await zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
