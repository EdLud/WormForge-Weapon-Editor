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
import { parseCustomLua, generateLuaCode } from '../src/utils/luaGenerator';
import { stockDonor, stockDonorBaseline } from '../src/data/stockDonors';
import { DEFAULT_BODY } from '../src/data/defaults';
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

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ngenerator edge cases: all checks passed');
