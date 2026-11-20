/**
 * The export's sheet atlas: one file per picture.
 *
 * `modExporter` collects every sheet it is about to write, groups the ones whose
 * bytes are identical, and rewrites the generated Lua and `mod.toml` to the kept
 * path. This checks the pure half (no browser), because the failure mode is
 * silent: a path rewritten in one place and not the other ships a declared sheet
 * with no file, and a repeated `[sprites."…"]` table is invalid TOML (the engine
 * loses the declaration and `wa.on.draw` fails on it).
 *
 *   bun run tools/check_sheet_dedupe.ts
 */
import {
  applySheetAliases,
  collapseSpriteSections,
  compactSpriteLists,
  dedupeSheets,
  hashBytes,
  sheetFrames,
  spriteDeclaration,
} from '../src/utils/sheetDedupe';

const NL = String.fromCharCode(10);

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    console.log(`ok    ${name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const png = (seed: number) => new Uint8Array([137, 80, 78, 71, seed, seed + 1, seed + 2]);
const one = png(1);
const other = png(9);

const toml = [
  'id = "a.b"',
  '',
  '[sprites."sprites/m/missile.png"]',
  'frames = 1',
  'fps = 15',
  'play = "loop"',
  '',
  '[sprites."sprites/m/state_roam.png"]',
  'frames = 1',
  'fps = 15',
  'play = "loop"',
  '',
  '[sprites."sprites/m/stamp.png"]',
  'frames = 32',
  '',
  '',
].join(NL);

check('the hash separates different bytes', hashBytes(one) !== hashBytes(other));
check(
  'a declaration is read whole',
  spriteDeclaration(toml, 'sprites/m/stamp.png') === 'frames = 32',
  spriteDeclaration(toml, 'sprites/m/stamp.png'),
);
check('an undeclared sheet counts as one frame', sheetFrames(toml, 'sprites/m/hold.png') === 1);
check('a declared strip counts its frames', sheetFrames(toml, 'sprites/m/stamp.png') === 32);

// The fallback-art case: hold, missile and roam are one picture, all one frame.
const sheets = [
  { path: 'sprites/m/hold.png', bytes: one },
  { path: 'sprites/m/missile.png', bytes: one },
  { path: 'sprites/m/state_roam.png', bytes: one },
  { path: 'sprites/m/stamp.png', bytes: other },
];
const { files, alias } = dedupeSheets(sheets, toml);
check(
  'one file per picture',
  files.map((f) => f.path).join(',') === 'sprites/m/hold.png,sprites/m/stamp.png',
  files.map((f) => f.path).join(','),
);
check(
  'the duplicates point at the kept path',
  alias.get('sprites/m/missile.png') === 'sprites/m/hold.png' &&
    alias.get('sprites/m/state_roam.png') === 'sprites/m/hold.png' &&
    alias.size === 2,
  JSON.stringify([...alias]),
);

// The same strip at two speeds is two sheets: `[sprites."path"]` carries one
// `fps` for every role that names the path, so merging would retime one.
const retimed = dedupeSheets(
  [
    { path: 'sprites/m/hold.png', bytes: one },
    { path: 'sprites/m/bit.png', bytes: one },
  ],
  [
    '[sprites."sprites/m/hold.png"]',
    'frames = 2',
    'fps = 15',
    'play = "loop"',
    '',
    '[sprites."sprites/m/bit.png"]',
    'frames = 2',
    'fps = 11',
    'play = "loop"',
    '',
  ].join(NL),
);
check(
  'a strip at a different speed keeps its own file',
  retimed.files.length === 2 && retimed.alias.size === 0,
  `${retimed.files.length} files, ${retimed.alias.size} alias(es)`,
);

// A one-frame sheet has nothing to animate, so it shares regardless of playback.
const oneFrame = dedupeSheets(
  [
    { path: 'sprites/m/hold.png', bytes: one },
    { path: 'sprites/m/missile.png', bytes: one },
  ],
  ['[sprites."sprites/m/missile.png"]', 'frames = 1', 'fps = 15', 'play = "loop"', ''].join(NL),
);
check(
  'one-frame sheets share whatever their playback says',
  oneFrame.files.length === 1 &&
    oneFrame.alias.get('sprites/m/missile.png') === 'sprites/m/hold.png',
  `${oneFrame.files.length} files`,
);

// The same picture cut into a different number of frames is a different sheet.
const sliced = dedupeSheets(
  [
    { path: 'sprites/m/hold.png', bytes: one },
    { path: 'sprites/m/strip.png', bytes: one },
  ],
  ['[sprites."sprites/m/strip.png"]', 'frames = 4', ''].join(NL),
);
check(
  'a differently sliced strip keeps its own file',
  sliced.files.length === 2 && sliced.alias.size === 0,
  `${sliced.files.length} files`,
);

// The rewrite must never touch a path that merely starts with another's name.
const lua = [
  'sprites = { "sprites/m/hold.png", "sprites/m/state_homing.png", "sprites/m/state_homing_bit.png" }',
  'sheet = "sprites/m/state_homing.png"',
].join(NL);
const rewritten = applySheetAliases(
  lua,
  new Map([
    ['sprites/m/state_homing.png', 'sprites/m/hold.png'],
    ['sprites/m/state_homing_bit.png', 'sprites/m/roam.png'],
  ]),
);
check(
  'aliases rewrite whole quoted paths only',
  !rewritten.includes('"sprites/m/state_homing_bit.png"') &&
    rewritten.includes('"sprites/m/roam.png"') &&
    rewritten.includes('sheet = "sprites/m/hold.png"'),
  rewritten,
);

const compacted = compactSpriteLists(
  'sprites = { "sprites/m/hold.png", "sprites/m/hold.png", "sprites/m/bit.png" },',
);
check(
  'the claim list keeps one entry per picture',
  compacted === 'sprites = { "sprites/m/hold.png", "sprites/m/bit.png" },',
  compacted,
);

const compactedWithSdk = compactSpriteLists(
  'sprites = { "sprites/m/hold.png", "sprites/m/hold.png", trail.BEAM, trail.GLOW, fx.SPARK, fx.BLOB, fx.SMOKE },',
);
check(
  'compacting a claim sprite list preserves Effects SDK constants',
  compactedWithSdk ===
    'sprites = { "sprites/m/hold.png", trail.BEAM, trail.GLOW, fx.SPARK, fx.BLOB, fx.SMOKE },',
  compactedWithSdk,
);

const singleQuoted = applySheetAliases(
  "local s = 'sprites/m/missile.png'",
  new Map([['sprites/m/missile.png', 'sprites/m/hold.png']]),
);
check(
  'aliases rewrite single-quoted sprite paths too',
  singleQuoted === "local s = 'sprites/m/hold.png'",
  singleQuoted,
);

// A repeated table is invalid TOML, so it can never survive, whatever its body.
const repeated = collapseSpriteSections(
  [
    '[sprites."sprites/m/hold.png"]',
    'frames = 2',
    'fps = 15',
    '',
    '[sprites."sprites/m/hold.png"]',
    'frames = 2',
    'fps = 11',
    '',
  ].join(NL),
);
check(
  'a repeated sprite table keeps only its first declaration',
  (repeated.match(/^\[sprites\."sprites\/m\/hold\.png"\]$/gm) || []).length === 1 &&
    repeated.includes('fps = 15') &&
    !repeated.includes('fps = 11'),
  repeated,
);

const collapsed = collapseSpriteSections(
  applySheetAliases(
    [
      '[sprites."sprites/m/hold.png"]',
      'frames = 1',
      '',
      '[sprites."sprites/m/missile.png"]',
      'frames = 1',
      '',
      '[sprites."sprites/m/stamp.png"]',
      'frames = 32',
      '',
    ].join(NL),
    new Map([['sprites/m/missile.png', 'sprites/m/hold.png']]),
  ),
);
check(
  'one declaration per file after aliasing',
  (collapsed.match(/^\[sprites\."sprites\/m\/hold\.png"\]$/gm) || []).length === 1 &&
    collapsed.includes('[sprites."sprites/m/stamp.png"]'),
  collapsed,
);

if (failed > 0) {
  console.error(`${NL}${failed} sheet dedupe check(s) failed`);
  process.exit(1);
}
console.log(`${NL}sheet dedupe: all checks passed`);
