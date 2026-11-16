/**
 * Generator edge cases a user's own data can reach. No server, exits 1 on a
 * failure.
 *
 *   bun run tools/check_generator_edges.ts
 *
 * Three of them, each one a bug that was found by the audit and could be hit
 * again by an import:
 *
 *  - an **array** in `recordExtra` used to be written as `= nil` and lost;
 *  - a **non-identifier key** used to be written as `rec.["k"]`, which is a Lua
 *    syntax error, so the whole weapon module failed to compile;
 *  - `parseCustomLua` counted `end`/`if`/`for` inside comments and strings, so a
 *    custom `on_explode` with "the end" in a comment was truncated and the rest
 *    of the snippet was emitted as broken Lua.
 */
import {
  parseCustomLua,
  generateLuaCode,
  customSoundPath,
  meleeSoundPath,
} from '../src/utils/luaGenerator';
import { stockDonor, stockDonorBaseline } from '../src/data/stockDonors';
import { DEFAULT_BODY } from '../src/data/defaults';
import { DEFAULT_MELEE } from '../src/data/melee';
import type { WeaponProject } from '../src/types/weapon';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};

const makeProject = (patch: Partial<WeaponProject> = {}): WeaponProject => {
  const base = stockDonor('grenade') as Partial<WeaponProject>;
  return {
    ...(base as WeaponProject),
    id: 'wfws.check.edges',
    name: 'Edges',
    based_on: 'stock.grenade',
    defaults: { ammo: 1, delay: 0, crateChance: 0, cratePool: 'default', afterFire: 'end_turn' },
    fireType: 'power',
    hold: { enabled: false } as WeaponProject['hold'],
    donorBaseline: stockDonorBaseline('grenade'),
    body: { ...DEFAULT_BODY, ...(base.body ?? {}) },
    action: 'bounce',
    burst: 'nothing',
    recordOverrides: { ...(base.recordOverrides ?? {}) },
    ...patch,
  } as WeaponProject;
};

// ---- recordExtra: arrays survive, keys stay valid Lua ---------------------
{
  const project = makeProject();
  project.recordExtra = {
    missile: { some_list: [1, 2, 3], nested: [{ a: 1 }, { b: 2 }] },
    'weird-key': { x: 1 },
  } as unknown as WeaponProject['recordExtra'];
  const lines = generateLuaCode(project).split('\n');
  const text = lines.join('\n');

  check(
    'a list in recordExtra is written as a table',
    text.includes('rec.missile.some_list = { 1, 2, 3 }'),
    lines.find((l) => l.includes('some_list')) ?? 'no line',
  );
  check(
    'a list of tables is written as tables',
    text.includes('rec.missile.nested = { { a = 1 }, { b = 2 } }'),
    lines.find((l) => l.includes('nested')) ?? 'no line',
  );
  check(
    'no recordExtra value is dropped as nil',
    !/rec\.[\w."']+ = nil$/.test(text),
    lines.find((l) => / = nil$/.test(l)) ?? '',
  );
  check(
    'a quoted key uses brackets, not `rec.[`',
    text.includes('rec["weird-key"].x = 1'),
    lines.find((l) => l.includes('weird')) ?? 'no line',
  );
  check(
    'no `rec.[` anywhere (invalid Lua)',
    !text.includes('rec.['),
    lines.find((l) => l.includes('rec.[')) ?? '',
  );
}

// ---- parseCustomLua: comments and strings are not blocks ------------------
{
  const snippet = [
    'on_explode = function(ev)',
    '  -- the end of it, honestly; if only',
    '  local label = "if you see this, do not stop"',
    '  wa.explosion(ev.x, ev.y, 40)',
    'end',
    '',
    'local extra = 1',
  ].join('\n');
  const parsed = parseCustomLua(snippet);
  check(
    'the body keeps its last real statement',
    parsed.onExplodeBody.includes('wa.explosion(ev.x, ev.y, 40)'),
    parsed.onExplodeBody.replace(/\n/g, ' | '),
  );
  check(
    'the body stops at the function end',
    !parsed.onExplodeBody.includes('local extra'),
    parsed.onExplodeBody.replace(/\n/g, ' | '),
  );
  check('the rest of the snippet survives', parsed.remainingSnippet.includes('local extra = 1'));
  check('the comment stays out of the rest', !parsed.remainingSnippet.includes('the end of it'));
}

// ---- a template the engine does not know writes no copy_from -------------
// The engine refuses the whole bundle for `stock.<unknown>`, so one typo took
// every other weapon down with it. An unknown slot now writes the record
// without a template instead.
{
  const known = generateLuaCode(makeProject());
  check(
    'a real template is still written',
    known.includes('copy_from = "stock.grenade"'),
    'a known donor lost its copy_from',
  );
  const unknown = generateLuaCode(makeProject({ based_on: 'stock.famas' }));
  check(
    'an unknown template is not written',
    !/^\s*copy_from = /m.test(unknown),
    unknown.split(String.fromCharCode(10)).find((l) => /copy_from = /.test(l)) ?? 'no assignment',
  );
  check(
    'and the Lua says why',
    unknown.includes("not one of WA's own weapons"),
    'the fallback is silent',
  );
}

// ---- a commented-out on_explode is not a declaration ---------------------
{
  const snippet = ['-- on_explode = function(ev) end', 'local x = 1'].join('\n');
  const parsed = parseCustomLua(snippet);
  check('a commented-out on_explode is not extracted', !parsed.hasOnExplode);
  check(
    'and the snippet passes through untouched',
    parsed.remainingSnippet.includes('local x = 1'),
  );
}

// ---- the launch WAV rides `on_fire` --------------------------------------
{
  // `on_fire` is WA's fire dispatch, so the launch report is a claim key with no
  // library behind it: the play is one line and the path has to be declared in
  // the claim's `sounds` list, or the engine has nothing to play.
  const wav = new File([new Uint8Array([82, 73, 70, 70])], 'launch.wav', { type: 'audio/wav' });
  const asset = { file: wav, fileName: 'launch.wav', previewUrl: '', size: 4 };
  const plain = makeProject({
    customSounds: {
      launchEnabled: true,
      launch: asset,
      launchPriority: 10,
      explosionEnabled: false,
      explosionPriority: 8,
      shotEnabled: false,
      shotEvery: 1,
      shotPriority: 8,
      intervalEnabled: false,
      intervalMs: 400,
      intervalDelayMs: 0,
      intervalLimit: 0,
      intervalPriority: 8,
    },
  });
  const launchPath = customSoundPath(plain, 'launch')!;
  const text = generateLuaCode(plain);
  check(
    'a launch WAV is played from on_fire',
    text.includes('on_fire = function(ev)') &&
      text.includes(`wa.sound.play(ev.worm, "${launchPath}", 10)`),
    text.split(String.fromCharCode(10)).find((l) => l.includes('sound.play')) ?? 'no play',
  );
  check(
    'and its path is declared in the claim sounds list',
    text.includes(`sounds = { "${launchPath}" },`),
    'the engine would have nothing to load',
  );

  // An author's own `on_fire` owns the key: emitting ours as well would write the
  // same field twice and their handler would lose.
  const hand = {
    ...plain,
    enableCustomLua: true,
    customLuaSnippet: 'on_fire = function(ev) wa.sound.play(ev.worm, "sounds/x/y.wav", 8) end',
  };
  const handText = generateLuaCode(hand);
  check(
    'a custom on_fire keeps the launch WAV out of the file',
    !handText.includes(launchPath),
    'two on_fire keys, one of them silently lost',
  );

  // Sequential fire already owns `on_fire`; the launch play goes inside it, so a
  // burst reports the trigger once instead of once per shot.
  const seq = makeProject({
    customSounds: plain.customSounds,
    fireSequence: {
      enabled: true,
      mode: 'missiles',
      count: 3,
      delay: 6,
      speed: 20,
      standoff: 6,
      spreadX: 0,
      spreadY: 0,
      offsetX: 0,
      offsetY: 0,
      liveAim: false,
      cancelOnWeaponChange: true,
    },
  } as Partial<WeaponProject>);
  const seqText = generateLuaCode(seq);
  const fireAt = seqText.indexOf('on_fire = function(ev)');
  // The path is also in the claim's `sounds` list, which comes first; the play
  // call itself is what has to sit inside the trigger.
  const playAt = seqText.indexOf(`wa.sound.play(ev.worm, "${launchPath}"`);
  check(
    'a burst plays the launch WAV inside its own on_fire',
    fireAt >= 0 && playAt > fireAt && playAt < seqText.indexOf('seq.fire_seq_mis{'),
    playAt < 0 ? 'no play' : 'the play is outside the trigger',
  );
}

// ---- a melee strike's uploaded WAV ---------------------------------------
{
  // The swing plays the file by path, so the path has to be declared in the
  // claim's `sounds` list and the native id must step aside (a WAV wins).
  const wav = new File([new Uint8Array([82, 73, 70, 70])], 'hit.wav', { type: 'audio/wav' });
  const melee = makeProject({
    fireType: 'melee',
    hold: { enabled: true } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: {
      ...DEFAULT_MELEE,
      enabled: true,
      hitSound: {
        id: 96,
        priority: 16,
        file: { file: wav, fileName: 'hit.wav', previewUrl: '', size: 4 },
      },
      missSound: { id: 96, priority: 8 },
    },
  });
  const text = generateLuaCode(melee);
  const hitPath = meleeSoundPath(melee, 'hit')!;
  const rows = text.split(String.fromCharCode(10));
  check(
    'a melee WAV is played by path and its id steps aside',
    text.includes(`hit_wav = "${hitPath}"`) && !rows.some((l) => /^\s*hit_sound = /.test(l)),
    rows.find((l) => l.includes('hit_')) ?? 'no row',
  );
  check(
    'and the strike WAV is declared in the claim sounds list',
    rows.some((l) => l.startsWith('      sounds = {') && l.includes(hitPath)),
    'the engine would have nothing to play',
  );
  check(
    'the whiff keeps its native id and no priority row',
    rows.some((l) => /^\s*miss_sound = 96,$/.test(l)) &&
      !rows.some((l) => l.includes('miss_priority')),
    'the default 8 needs no row',
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ngenerator edge cases: all checks passed');
