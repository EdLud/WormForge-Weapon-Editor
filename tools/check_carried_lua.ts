/**
 * Carried-Lua check (M2 and M3 of `reqs/custom_code_import_plan.md`).
 *
 * A bundle's hook body is never self-contained: vortex's `on_explode` is one
 * call to `start_vortex`, which reads install-time locals, which read
 * module-level constants, which require libraries. This checks that the closure
 * is carried whole: the declarations, their requires, their dependency ids, the
 * lockstep rewrites, the renames around names the emitted file already binds,
 * and the bundle's own art paths (an export only ships `sprites/<mod>/`).
 *
 * Three kinds of case:
 *
 * - shapes built inline, so a rule has a case even when no mod on this machine
 *   exercises it (a dangling name, an unshipped require, an unbalanced block);
 * - the four real bundles, read from `Mods/` when it is on disk, which is where
 *   the closure comes from in practice;
 * - the round trip: import, export, re-import, and the carried code must come
 *   back identical, because a carry that is not idempotent doubles a header on
 *   every pass.
 *
 * Run: `bun run tools/check_carried_lua.ts` (exits 1 on a failure).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WeaponProject } from '../src/types/weapon';
import type { ModFile } from '../src/utils/modLib/scan';
import { readBundles, readWeapons } from '../src/utils/modLib/scan';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import { ownOutputOf } from '../src/utils/modLib/ownOutput';
import { splitModule } from '../src/utils/modLib/splitModule';
import { carryClosure, dependencyForModule } from '../src/utils/modLib/carryClosure';
import { declaredNames, generateLuaCode, generateModToml, sanitizeModFolder } from '../src/utils/luaGenerator';
import { checkLua } from '../src/utils/luaCheck';
import {
  DEFAULT_IMPORT_HOLD,
  DEFAULT_IMPORT_MISSILE,
} from '../src/utils/modLib/importFeatures';
import { DEFAULT_ROLE_ART } from '../src/data/spriteBuilder';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { DEFAULT_FIRE_SEQUENCE } from '../src/data/fireSequence';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../src/data/defaults';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODS = 'D:/Worms Armageddon/WormForge/Mods';
const BUNDLE = join(ROOT, 'test_pack', 'wftest_pack');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};
const lines = (...parts: string[]) => parts.join('\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The project a bundle import starts from: the same defaults `App` hands
 * `importBundleWeapon`, so a round-trip export is a complete weapon.
 */
const RIBBON_OFF = {
  enabled: false,
  max: 12,
  every: 2,
  vanish: 2,
  coreWidth: 8,
  glowWidth: 13,
  noise: 0,
  rainbow: false,
  color: '#ffffff',
  target: 'main' as const,
};

function baseProject(patch: Partial<WeaponProject> = {}): WeaponProject {
  const p = patch;
  return {
    id: p.id ?? 'wfws.scratch',
    name: p.name ?? 'Scratch',
    description: '',
    version: '0.1.0',
    author: '',
    slot: p.slot ?? 'grenade',
    based_on: p.based_on ?? 'grenade',
    fireType: p.fireType ?? 'power',
    specialSubtype: p.specialSubtype ?? 0,
    teleport: false,
    panel_icon: p.panel_icon ?? 'grenade',
    defaults: { ammo: 3, delay: 0, crateChance: 0, crateType: 'weapon', afterUse: '' },
    body: {
      ...DEFAULT_BODY,
      ...(p.body ?? {}),
      clustlet: { ...DEFAULT_BODY.clustlet, ...(p.body?.clustlet ?? {}) },
    },
    action: p.action ?? 'bounce',
    burst: p.burst ?? 'nothing',
    missileSprite: p.missileSprite ?? DEFAULT_IMPORT_MISSILE,
    bitFlight: p.bitFlight ?? { ...DEFAULT_ROLE_ART },
    behaviorArt: p.behaviorArt ?? {},
    roamConfig: { ...DEFAULT_ROAM, ...(p.roamConfig ?? {}) },
    roamSheets: p.roamSheets ?? { flight1: {}, flight2: {} },
    digConfig: { ...DEFAULT_DIG, ...(p.digConfig ?? {}) },
    fireConfig: { ...DEFAULT_FIRE, ...(p.fireConfig ?? {}) },
    ribbonTrail: p.ribbonTrail ?? RIBBON_OFF,
    explosionEffect: p.explosionEffect ?? DEFAULT_EXPLOSION_EFFECT,
    terrainStamp: p.terrainStamp,
    fireSequence: p.fireSequence ?? DEFAULT_FIRE_SEQUENCE,
    customSounds: p.customSounds ?? DEFAULT_CUSTOM_SOUNDS,
    extraDependencies: p.extraDependencies ?? [],
    hold: p.hold ?? DEFAULT_IMPORT_HOLD,
    aimClip: p.aimClip,
    melee: p.melee,
    packArt: p.packArt ?? {},
    customSprites: p.customSprites ?? {},
    recordOverrides: p.recordOverrides ?? {},
    recordExtra: p.recordExtra,
    enableCustomLua: p.enableCustomLua ?? false,
    customLuaSnippet: p.customLuaSnippet ?? '',
    useWepFile: false,
    ...('carriedLua' in p ? { carriedLua: p.carriedLua } : {}),
  } as WeaponProject;
}

/** What `importBundleWeapon` computes, without needing a bundle for it. */
function carryOf(moduleText: string, project: WeaponProject) {
  const split = splitModule(moduleText);
  const emitted = generateLuaCode(project);
  const reserved = declaredNames(emitted);
  const seeds = split.hooks.on_explode
    ? [{ label: 'on_explode', text: split.hooks.on_explode }]
    : [];
  const carried = carryClosure(seeds, split, reserved, sanitizeModFolder(project.id), emitted);
  const hook = split.hooks.on_explode ?? '';
  return { split, carried, hook: carried.transform(hook) };
}

// ---- shapes -------------------------------------------------------------
{
  // Vortex's shape in miniature: a module constant, an install helper that reads
  // it, and a hook that calls the helper. Nothing here is in the export unless
  // the closure carries it.
  const moduleText = lines(
    'local RIPPLE = 12',
    'local function ring(x, y)',
    '  return x + RIPPLE, y - RIPPLE',
    'end',
    'return {',
    '  install = function(ctx)',
    '    local holes = {}',
    '    local function open(x, y)',
    '      local cx, cy = ring(x, y)',
    '      holes[#holes + 1] = { x = cx, y = cy }',
    '    end',
    '    wa.weapons.replace{',
    '      name = "Ring",',
    '      on_explode = { on = function(ev)',
    '        open(ev.x, ev.y)',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const project = baseProject();
  const { carried } = carryOf(moduleText, project);
  const carriedText = [...carried.preamble, ...carried.prologue].map((block) => block.text).join('\n');
  check(
    'the install helper the hook calls is carried',
    carried.prologue.some((block) => block.text.includes('local function open(')),
    carried.prologue.map((block) => block.text.split('\n')[0]).join(' | '),
  );
  check('and so is the helper it calls', carriedText.includes('local function ring('));
  check(
    'and the module constant it reads',
    carried.preamble.some((block) => block.text.startsWith('local RIPPLE = 12')),
  );
  check('and the table it appends to', carried.prologue.some((block) => block.text.includes('local holes = {}')));
  check(
    'the carried text is the bundle\'s, in source order',
    carriedText.indexOf('RIPPLE') < carriedText.indexOf('local holes') &&
      carriedText.indexOf('local holes') < carriedText.indexOf('local function open'),
  );
  check('nothing is left dangling', carried.unresolved.length === 0, carried.unresolved.join(', '));
  check(
    'the export declares the helper before the hook uses it',
    (() => {
      const code = generateLuaCode(baseProject({
        enableCustomLua: true,
        customLuaSnippet: 'on_explode = { on = function(ev)\n  open(ev.x, ev.y)\nend }',
        carriedLua: { preamble: carried.preamble, prologue: carried.prologue, unresolved: [] },
      }));
      const declared = code.indexOf('local function open(');
      return declared !== -1 && declared < code.indexOf('open(ev.x, ev.y)');
    })(),
  );
}

// ---- lockstep maths is rewritten, not blocked ---------------------------
{
  const moduleText = lines(
    'local function jitter()',
    '  return math.random(-2, 2)',
    'end',
    'local function spin(a)',
    '  return math.cos(a) + math.sin(a) + math.atan(a)',
    'end',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        wa.world.blast{ x = ev.x + jitter(), y = ev.y + spin(1) }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const { carried } = carryOf(moduleText, baseProject());
  const text = [...carried.preamble, ...carried.prologue].map((block) => block.text).join('\n');
  check('math.random becomes wa.random', text.includes('wa.random(-2, 2)'), text);
  check(
    'math.sin/cos/atan become wa.math.*',
    text.includes('wa.math.cos(a)') && text.includes('wa.math.sin(a)') && text.includes('wa.math.atan(a)'),
  );
  check('and the note names the rewrites', carried.rewrites.length === 4, carried.rewrites.join(', '));
  check(
    'the carried code no longer trips the lockstep rule',
    checkLua(text, { mode: 'fragment', skipGlobals: true }).every((finding) => finding.rule !== 'lockstep-rng'),
  );

  // The float form has no equivalent (`wa.random()` is the raw 32-bit draw).
  const float = lines(
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        local odds = math.random()',
    '        if odds > ev.x then return end',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  check(
    'the float form is reported instead of rewritten',
    carryOf(float, baseProject()).hook.floatRandom,
  );
}

// ---- a name nothing declares is reported, not invented ------------------
{
  const moduleText = lines(
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        start_vortex(ev.x, ev.y)',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const { carried } = carryOf(moduleText, baseProject());
  check(
    'a hook calling an undeclared name is reported',
    carried.unresolved.includes('start_vortex'),
    carried.unresolved.join(', '),
  );
  check('and nothing is carried for it', carried.prologue.length === 0 && carried.preamble.length === 0);
}

// ---- a block the scanner cannot close is refused ------------------------
{
  const moduleText = lines(
    'return {',
    '  install = function(ctx)',
    '    local broken = function()',
    '      if true then',
    '    end',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        broken()',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const { carried } = carryOf(moduleText, baseProject());
  check(
    'a block with an unclosed `if` is refused with a reason',
    carried.refused.length > 0 || carried.unresolved.includes('broken'),
    `${carried.refused.join(' | ')} / ${carried.unresolved.join(',')}`,
  );
}

// ---- renames around what the file already binds -------------------------
{
  // A bundle's own `fx` under a name the export binds to a different module:
  // shadowing it would make the claim's own burst run the wrong library.
  const moduleText = lines(
    'local fx = require("lib/my_fx")',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        fx.burst{ x = ev.x, y = ev.y }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const project = baseProject({
    id: 'wfws.renamed',
    explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true },
  });
  const { carried, hook } = carryOf(moduleText, project);
  const declaration = carried.preamble.find((block) => block.text.includes('lib/my_fx'));
  check(
    'a bundle module under a name the file binds is renamed',
    !!declaration && declaration.text.includes('local fx_bundle = require("lib/my_fx")'),
    declaration?.text ?? 'not carried',
  );
  check('and the rename is reported', carried.renames.some((rename) => rename.from === 'fx'), carried.renames.map((r) => r.from).join(','));
  check(
    'the hook body is renamed with it',
    hook.text.includes('fx_bundle.burst{'),
    hook.text,
  );
  check(
    'a string that happens to say fx is left alone',
    carried.transform('local p = "fx"').text.includes('"fx"'),
  );
  check(
    'a require the export does not ship is named',
    carried.notes.some((note) => note.includes('lib/my_fx')),
    carried.notes.join(' | '),
  );
}

// ---- the same module is one declaration, not two ------------------------
{
  const moduleText = lines(
    'local fx = require("wf-lib/effects/px_effects")',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        fx.burst{ x = ev.x, y = ev.y }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  // The export binds `fx` itself as soon as the burst card is on.
  const project = baseProject({ explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true } });
  const { carried } = carryOf(moduleText, project);
  check(
    'a bundle require of the same module is not carried twice',
    !carried.preamble.some((block) => block.text.includes('px_effects')) && carried.renames.length === 0,
    carried.preamble.map((block) => block.text).join(' | '),
  );
  check(
    'and the dependency the code needs is in the manifest',
    /effects\.sdk/.test(generateModToml(project)),
    generateModToml(project).split('\n').find((line) => line.includes('effects.sdk')) ?? 'no effects.sdk',
  );
}

// ---- the bundle's own art moves with the export -------------------------
{
  const moduleText = lines(
    'return {',
    '  install = function(ctx)',
    '    local function puff(x, y)',
    '      wa.sound.play(ctx.owner, "sounds/vortex/boom.wav", 8)',
    '      return "sprites/vortex/hole.png"',
    '    end',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        puff(ev.x, ev.y)',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const project = baseProject({ id: 'wfws.moved' });
  const { carried } = carryOf(moduleText, project);
  const text = [...carried.preamble, ...carried.prologue].map((block) => block.text).join('\n');
  check('a carried sprite path follows the export folder', text.includes('sprites/moved/hole.png'), text);
  check('and so does a sound path', text.includes('sounds/moved/boom.wav'));
  check('and the count is reported', carried.pathRewrites === 2, String(carried.pathRewrites));
}

// ---- the four real bundles ---------------------------------------------
const realMods = (() => {
  try {
    return statSync(MODS).isDirectory();
  } catch {
    return false;
  }
})();
if (!realMods) {
  console.log('skip  the four real bundles (D: is not mounted)');
} else {
  /**
   * Every file under `root` as a `ModFile`: `.lua`/`.toml` as text, art as
   * bytes. Read as text only, a WAV loses its bytes and the feature that plays
   * it is off on the next import, which is a difference the round trip would
   * blame on the carry.
   */
  const toFiles = (root: string): ModFile[] =>
    walk(root).map((full) => {
      const path = relative(root, full).split(sep).join('/');
      if (/\.(lua|toml)$/i.test(full)) return { path, text: readFileSync(full, 'utf8') };
      return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
    });
  const readBundle = (name: string) => {
    const files = toFiles(join(MODS, name));
    const bundle = readBundles(files)[0];
    return { files, weapons: readWeapons([bundle], files) };
  };
  const expectations: Record<string, { prologue: number; preamble: number; because: string }> = {
    // The hardest case: `start_vortex` and the seven helpers below it, plus the
    // chain behind its carried `wa.on.draw` (`cell` reads the strip constants).
    vortex: { prologue: 12, preamble: 21, because: 'start_vortex, its chain and the draw' },
    // `aura`, the fly-by zap state table and its handler's helpers.
    pulsar: { prologue: 7, preamble: 0, because: 'aura and its handlers' },
    // Nothing: its `on_explode` is ours.
    railgun: { prologue: 0, preamble: 0, because: 'no hook of its own' },
    // Its whole weapon is a hand-written `on_fire` (M6) and the chain under it.
    conductor: { prologue: 14, preamble: 12, because: 'its on_fire and its chain' },
  };
  for (const [name, expected] of Object.entries(expectations)) {
    const { files, weapons } = readBundle(name);
    const weapon = weapons.find((entry) => entry.record);
    if (!weapon) {
      check(`${name}: has a record`, false);
      continue;
    }
    const imported = await importBundleWeapon(weapon, files);
    const project = baseProject(imported.project);
    const carried = project.carriedLua;
    check(
      `${name}: carries ${expected.because}`,
      (carried?.prologue.length ?? 0) === expected.prologue &&
        (carried?.preamble.length ?? 0) === expected.preamble,
      `prologue ${carried?.prologue.length ?? 0}, preamble ${carried?.preamble.length ?? 0}`,
    );
    const code = generateLuaCode(project);
    const findings = checkLua(code, { mode: 'module' });
    check(
      `${name}: the export has no dangling name`,
      findings.every((finding) => finding.rule !== 'undefined-global'),
      findings.map((finding) => `${finding.rule} ${finding.name ?? ''} line ${finding.line}`).join(', '),
    );

    // M5: the bundle's `on_explode` is carried code, not the author's snippet,
    // and it lands inside the one handler the editor emits.
    const explodeKeys = code.split('on_explode = ').length - 1;
    check(`${name}: writes one on_explode key`, explodeKeys <= 1, String(explodeKeys));
    check(
      `${name}: the author's snippet stays the author's`,
      !project.enableCustomLua && !project.customLuaSnippet,
      String(project.customLuaSnippet ?? ''),
    );
    // M6: every registration nothing models is carried with its handler, filter
    // included, and written once. The editor's own three are rebuilt from their
    // panels, so a doubled one would be the carry claiming our output.
    const carriedRegistrations = project.carriedLua?.registrations ?? [];
    // Every handler in this corpus opens `wa.on.missile_frame(function(m)` and
    // guards on `m.weapon`, so the first line is not a fingerprint; the body is.
    const squashText = (text: string) => text.replace(/\s+/g, '');
    for (const registration of carriedRegistrations) {
      const needle = squashText(registration.text);
      check(
        `${name}: carries ${registration.event} once`,
        squashText(code).split(needle).length - 1 === 1,
        `${squashText(code).split(needle).length - 1} x ${needle.length}`,
      );
    }
    const ours = ownOutputOf(splitModule(code)).own.length;
    check(
      `${name}: the export registers ours plus theirs`,
      splitModule(code).registrations.length === ours + carriedRegistrations.length,
      `${splitModule(code).registrations.length} vs ${ours} + ${carriedRegistrations.length}`,
    );

    // The round trip: the export must import back to the same carried code, or
    // each pass would copy it again.
    const folder = sanitizeModFolder(project.id);
    const dir = join(tmpdir(), `wf_carried_${name}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, folder, 'weapons'), { recursive: true });
    writeFileSync(join(dir, folder, 'mod.toml'), generateModToml(project));
    writeFileSync(join(dir, folder, 'weapons', `${folder}.lua`), code);
    // The exporter writes the bundle's sheets and samples under the export's own
    // folder; copying them by base name is the same contract without a canvas,
    // and without them a feature (a hold, an interval WAV) would be off on the
    // second import and the carried set would differ for the wrong reason.
    for (const file of files) {
      if (!/^(sprites|sounds)\//.test(file.path)) continue;
      const target = join(dir, folder, ...file.path.split('/').slice(0, 1), folder, file.path.split('/').pop()!);
      mkdirSync(join(target, '..'), { recursive: true });
      const bytes = file.bytes ?? (file.text ? new TextEncoder().encode(file.text) : undefined);
      if (bytes) writeFileSync(target, bytes);
    }
    const exportedFiles = toFiles(join(dir, folder));
    const exportedBundle = readBundles(exportedFiles)[0];
    const exportedWeapon = readWeapons([exportedBundle], exportedFiles).find((entry) => entry.record);
    if (!exportedWeapon) {
      check(`${name}: the export imports back`, false, 'no weapon in the export');
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    const again = await importBundleWeapon(exportedWeapon, exportedFiles);
    const againProject = baseProject(again.project);
    const againCode = generateLuaCode(againProject);
    check(
      `${name}: the carried code round-trips unchanged`,
      (againProject.carriedLua?.preamble ?? []).length === (carried?.preamble ?? []).length &&
        (againProject.carriedLua?.prologue ?? []).length === (carried?.prologue ?? []).length,
      `preamble ${againProject.carriedLua?.preamble.length ?? 0}/${carried?.preamble.length ?? 0}, prologue ${againProject.carriedLua?.prologue.length ?? 0}/${carried?.prologue.length ?? 0}`,
    );
    const carryHeaders = (code: string) =>
      code.split('-- Carried from the source bundle').length - 1;
    check(
      `${name}: and the re-export carries it once`,
      carryHeaders(againCode) === carryHeaders(code),
      `${carryHeaders(againCode)} headers against ${carryHeaders(code)}`,
    );
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- our own output carries nothing ------------------------------------
// The editor's generated weapons declare everything they use, so a re-import of
// the test pack must not "carry" its own `local TINT = …` back as foreign code.
if (statSync(BUNDLE, { throwIfNoEntry: false })) {
  const files: ModFile[] = walk(BUNDLE).map((full) => {
    const path = relative(BUNDLE, full).split(sep).join('/');
    if (/\.(lua|toml)$/i.test(full)) return { path, text: readFileSync(full, 'utf8') };
    return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
  });
  const bundle = readBundles(files)[0];
  const weapons = readWeapons([bundle], files);
  const carrying: string[] = [];
  for (const weapon of weapons) {
    if (!weapon.record) continue;
    const imported = await importBundleWeapon(weapon, files);
    const project = baseProject(imported.project);
    if (project.carriedLua?.preamble.length || project.carriedLua?.prologue.length) {
      carrying.push(weapon.name);
    }
  }
  check(
    'a re-import of the generated pack carries nothing of its own',
    carrying.length === 0,
    carrying.join(', '),
  );
}

// ---- dependencies ------------------------------------------------------
check(
  'every library module maps to the dependency that provides it',
  dependencyForModule('wf-lib/effects/px_effects') === 'effects.sdk' &&
    dependencyForModule('wf-lib/electric/damage') === 'px.electric' &&
    dependencyForModule('wf-lib/holds') === 'wf.sdk' &&
    dependencyForModule('wf-lib/fire_seq') === 'px.fire_seq' &&
    dependencyForModule('lib/whatever') === null,
);

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('carried lua: all checks passed');
