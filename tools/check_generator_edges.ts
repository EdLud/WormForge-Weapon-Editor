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
import { DEFAULT_EMITTER, DEFAULT_EMITTER_RING, DEFAULT_EMITTER_TRAIL } from '../src/data/emitter';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
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

// ---- melee: a swing always exists, and a strike owns its lift ------------
{
  // `sb.hold` builds the strike only when there is a clip, and the Swing
  // handler (which owns the Space edge) only runs when there is one: `melee`
  // with no keys was a weapon whose Space press did nothing. The panel refuses
  // to delete the last key, an imported bundle does not.
  const noKeys = makeProject({
    fireType: 'melee',
    hold: { enabled: true } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: { ...DEFAULT_MELEE, enabled: true },
  });
  const empty = generateLuaCode(noKeys);
  const emptyRows = empty.split(String.fromCharCode(10));
  const keyT = Number(/\{ t = (\d+), angle = 0,/.exec(empty)?.[1]);
  const hitFrame = Number(/hit_frame = (\d+),/.exec(empty)?.[1]);
  check(
    'a melee weapon with no clip keys still exports a swing',
    /^\s*swing = \{$/m.test(empty) && Number.isFinite(keyT),
    emptyRows.filter((l) => /swing|t = /.test(l)).join(' | ') || 'no swing at all',
  );
  check(
    'its single key sits on the strike frame, so the hit can land',
    keyT === hitFrame && Number.isFinite(hitFrame),
    `key at ${keyT}, hit frame ${hitFrame}`,
  );
  check(
    'and the file says why it invented that key',
    empty.includes('one pose at the strike frame'),
  );
  check('the strike is emitted with it', empty.includes('melee = {'));

  // A listed strike that throws flat used to omit `lift`, and `hold_melee_hits`
  // reads a missing key as the weapon's `lift`: the second strike of a combo was
  // thrown with the first one's.
  const combo = makeProject({
    fireType: 'melee',
    hold: { enabled: true } as WeaponProject['hold'],
    aimClip: {
      enabled: true,
      ticks: 16,
      finish: 'endTurn',
      keys: [{ t: 8, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' }],
      echo: { enabled: false, count: 0, every: 1, fade: 0.6, blend: 'alpha' },
    } as WeaponProject['aimClip'],
    melee: {
      ...DEFAULT_MELEE,
      enabled: true,
      lift: 5,
      hits: [
        { frame: 8, damage: 10, power: 2, lift: 5 },
        { frame: 16, damage: 12, power: 4, lift: 0 },
      ],
    },
  });

// ---- a custom body is marked as not generated ----------------------------
{
  // `checkLua` answers "did the editor generate this" from these two comment
  // lines, so the generator has to write exactly one pair per custom body, around
  // the body and nothing else. A missing pair leaves a carried `start_vortex`
  // reading as a generated line; a duplicate makes a re-import nest them.
  const nl = String.fromCharCode(10);
  const carried = makeProject({
    enableCustomLua: true,
    customLuaSnippet: `on_explode = { on = function(ev)${nl}  start_vortex(ev.x, ev.y, ev.worm)${nl}end }`,
  });
  const text = generateLuaCode(carried);
  const lines = text.split(nl);
  const open = lines.filter((l) => l.includes('not generated by the editor')).length;
  const close = lines.filter((l) => /^\s*-- end not generated\s*$/.test(l)).length;
  check('one marker pair around the custom body', open === 1 && close === 1, `open ${open}, close ${close}`);
  const openAt = lines.findIndex((l) => l.includes('not generated by the editor'));
  check(
    'the body sits between the markers',
    lines[openAt + 1]?.trim() === 'start_vortex(ev.x, ev.y, ev.worm)' &&
      /^\s*-- end not generated\s*$/.test(lines[openAt + 2] ?? ''),
    lines.slice(openAt, openAt + 3).join(' / '),
  );
  check(
    'a weapon with no custom body writes no marker',
    !generateLuaCode(makeProject()).includes('not generated by the editor'),
  );
}

  const twice = generateLuaCode(combo).split(String.fromCharCode(10));
  check(
    'every listed strike writes its own lift, zero included',
    twice.some((l) => /^\s*\{ frame = 16, damage = 12, power = 4, lift = 0 \},$/.test(l)),
    twice.find((l) => l.includes('frame = 16')) ?? 'no second strike',
  );
}

// ---- the emitter ---------------------------------------------------------
// PX's effect manager is an actor with a follow closure, so what matters is
// which closer the generator writes: a muzzle emitter is moved from
// `worm_message` filtered to `FRAME_FINISH` (scanning `wa.worms.all()` for the
// turn worm so standing still to aim still spawns it before Space), a round
// emitter latches each missile frame, and a family with no missile must never
// be given one.
{
  const ring = { ...DEFAULT_EMITTER_RING, enabled: true };
  const muzzle = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'muzzle', ring } }),
  );
  check(
    'a muzzle emitter moves on FRAME_FINISH for the turn worm',
    muzzle.includes('wa.on.worm_message(function()') &&
      muzzle.includes('wa.msg.FRAME_FINISH') &&
      muzzle.includes('wa.worms.all()') &&
      muzzle.includes('EMITTER:move_to(x, y)'),
  );
  check(
    'it is active while the turn worm has the weapon selected',
    muzzle.includes('not (w and w.weapon == ctx.id)'),
  );
  check(
    'and it spawns an independent emitter per round without dropping the aim emitter',
    muzzle.includes('EMITTER_ROUNDS[m.id]') &&
      muzzle.includes('emitter_round(m.id)') &&
      !muzzle.includes('EMITTER_CARRIED') &&
      muzzle.includes('wa.on.missile_frame(function(m)'),
  );
  check(
    'the hand-off writes no on_fire',
    !muzzle.includes('on_fire = function'),
    'a claim on_fire replaces WA\'s shot, so the round was never fired',
  );
  check('the ring is emitted bent', muzzle.includes('ellipse = { 1, 1 }'));
  check('a round follower is written per round', muzzle.includes('local function emitter_round(id)'));

  const round = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'round' } }),
  );
  check(
    'a round emitter starts on the missile',
    round.includes('emitter_start(m.x, m.y, w,') &&
      round.includes('wa.on.missile_frame(function(m)'),
  );
  check('and needs no muzzle hook', !round.includes('wa.on.body_move') && !round.includes('wa.on.worm_message'));

  const noCarry = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true, carry: false } }),
  );
  check(
    'carry off keeps the emitter an aiming effect',
    !noCarry.includes('EMITTER_ROUNDS') && !noCarry.includes('on_fire = function'),
    'an on_fire or round tracker was written for an emitter that never leaves the muzzle',
  );

  // A placed mine has no missile of the weapon, so a stored `round` anchor has
  // to fall back rather than emit a follower that can never latch.
  const mine = makeProject({
    fireType: 'drop',
    body: { ...DEFAULT_BODY, fuse: false },
    emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'round' },
  });
  const mineLua = generateLuaCode(mine);
  check(
    'a mine falls back to the muzzle',
    mineLua.includes('emitter_muzzle(') && !mineLua.includes('EMITTER_ROUNDS'),
    'the round anchor was emitted for a family with no missile',
  );

  // The muzzle anchor on that same mine still may not spawn round emitters
  // for rounds that never exist.
  const mineCarry = makeProject({
    fireType: 'drop',
    body: { ...DEFAULT_BODY, fuse: false },
    emitter: { ...DEFAULT_EMITTER, enabled: true, anchor: 'muzzle', carry: true },
  });
  const mineCarryLua = generateLuaCode(mineCarry);
  check(
    'a mine keeps its carry on the muzzle',
    !mineCarryLua.includes('EMITTER_ROUNDS') &&
      !mineCarryLua.includes('EMITTER_CARRIED') &&
      !mineCarryLua.includes('on_fire = function'),
    'the emitter spawned round trackers for a placed mine that never fires a missile',
  );

  // The emitter's own ribbon needs `fx.install{ trail = true }`, which is what
  // calls `trail.install()` and therefore registers the hook that *draws* a
  // ribbon. With `trail = false` the samples were taken and never painted.
  const ribbonOnly = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        trail: { ...DEFAULT_EMITTER_TRAIL, enabled: true },
      },
    }),
  );
  check(
    'an emitter ribbon installs the trail module',
    /fx\.install\{ trail = true,/.test(ribbonOnly),
    'fx.install disabled the trail, so the emitter ribbon would never be drawn',
  );
  const noRibbon = generateLuaCode(
    makeProject({ emitter: { ...DEFAULT_EMITTER, enabled: true } }),
  );
  check(
    'and nothing asks for it without one',
    /fx\.install\{ trail = false,/.test(noRibbon),
    'the trail module was installed for a weapon with no ribbon at all',
  );

  const tracking = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true, track: true },
      },
    }),
  );
  check(
    'a tracking ring writes track = true in its ring table',
    /ring = \{[\s\S]{0,400}track = true,/.test(tracking),
    'the ring table lost its heading tracking',
  );

  const rainbow = generateLuaCode(
    makeProject({
      emitter: {
        ...DEFAULT_EMITTER,
        enabled: true,
        rainbow: true,
        ring: { ...DEFAULT_EMITTER_RING, enabled: true },
        trail: { ...DEFAULT_EMITTER_TRAIL, enabled: true },
      },
    }),
  );
  const lines = rainbow.split(String.fromCharCode(10));
  const keys = lines.filter((l) => /^\s+rainbow = true,$/.test(l));
  // One switch, on the emitter's own table: `fx.emitter` hands it to the spark,
  // the glow, the reach, the ribbon and the ring that do not set one, which is
  // PX's single `SetRainbowMode`. A per-part key would say the same thing twice.
  check('the emitter rainbow is one switch', keys.length === 1, `${keys.length} rainbow keys`);
  check(
    'and it sits on the emitter, not a part',
    keys.length === 1 && /^ {8}rainbow = true,$/.test(keys[0]),
    JSON.stringify(keys[0] || ''),
  );
  check(
    'a part can still opt out',
    !/rainbow = false,/.test(rainbow),
    'no part writes rainbow = false',
  );
}

// ---- the trail and burst rainbow/noise -----------------------------------
{
  const lua = generateLuaCode(
    makeProject({
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 5,
        glowWidth: 9,
        noise: 3,
        rainbow: true,
        color: '#66ccff',
        target: 'main',
      },
      explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true, rainbow: true },
    }),
  );
  check('the ribbon writes its crackle noise', /^\s+noise = 3,$/m.test(lua));
  check('the ribbon writes its rainbow', /^\s+rainbow = true,$/m.test(lua));
  check(
    'the burst writes its rainbow',
    /fx\.burst\{[\s\S]{0,600}rainbow = true,/.test(lua),
    'the burst has no rainbow row',
  );
  const plain = generateLuaCode(
    makeProject({
      ribbonTrail: {
        enabled: true,
        max: 10,
        every: 1,
        vanish: 2,
        coreWidth: 5,
        glowWidth: 9,
        noise: 0,
        rainbow: false,
        color: '#66ccff',
        target: 'main',
      },
    }),
  );
  check(
    'a straight trail writes neither key',
    !/^\s+noise = 0,$/m.test(plain) && !/^\s+rainbow = false,$/m.test(plain),
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ngenerator edge cases: all checks passed');
