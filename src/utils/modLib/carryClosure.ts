/**
 * Carrying the declarations a bundle's hook closes over (M2 and M3 of
 * `reqs/custom_code_import_plan.md`).
 *
 * A hook body is never self-contained. Vortex's `on_explode` is one line,
 * `start_vortex(ev.x, ev.y, ev.worm)`, and `start_vortex` is an install-time
 * function that reads `vortices`, `tick`, `END_AT`, `fx`; `tick` reads `pull`,
 * `scatter`, `finish`, `BLAST_AT`; `pull` reads `REACH`, `CAPTURE`, `steer`; and
 * the constants are module-level. Pulsar's body reads `aura`, an install-time
 * table. Carrying the body without that chain is how an export ends up calling a
 * nil (today's vortex) or writing to one (today's pulsar).
 *
 * So the unit of carry is not the hook, it is the **closure**: the hook's free
 * names, resolved against the declarations the module actually has, transitively
 * and in source order.
 *
 * Three rules keep it honest:
 *
 * - **Scope is respected.** An install-level declaration is visible to a hook and
 *   to other install-level blocks; a module-level one is visible everywhere; a
 *   module-level block cannot see an install local (`ctx` included), so a
 *   preamble helper that reads `ctx` is reported rather than carried into a nil.
 * - **A name the emitted file already binds is not carried twice.** Same module
 *   (a bundle's `local fx = require("wf-lib/effects/px_effects")` against our
 *   own) means the block is dropped and the generated local serves both; a
 *   *different* module under the same name is renamed to `<name>_bundle` across
 *   all carried text, because a shadowed `fx` is a callback that silently does
 *   nothing (plan section 4). `reserved` is what the generator says it binds.
 * - **What cannot run is not carried.** A block with an unbalanced `end` is
 *   refused with a note (the plan's `lua-ast` rule), and a `require` of a module
 *   the export does not ship is carried but named, because the alternative is a
 *   load error with no explanation.
 *
 * Lockstep maths is rewritten, not blocked: `math.random` becomes `wa.random`
 * and `math.sin/cos/atan` become `wa.math.*` (WA's own sine table, identical bits
 * on every peer), through the same `fixLockstepRng` the custom Lua box uses, so
 * there is one mapping in the editor and not two. The one form with no
 * equivalent, `math.random()` with no arguments, is left alone and reported.
 */
import { fixLockstepRng, freeNames } from '../luaCheck';
import { checkLua } from '../luaCheck';
import { maskLuaCode, rewriteNames, scanBlockEnd } from '../luaText';
import type { LuaBlock, SplitModule } from './splitModule';

export interface CarryBlock {
  /** `preamble` is module level, `prologue` is inside `install`. */
  origin: 'preamble' | 'prologue';
  /** The declaration, verbatim except for the renames and lockstep rewrites. */
  text: string;
  declares: string[];
  requires: string[];
  /** 1-based line in the source module. */
  line: number;
  /** The names that pulled this block into the closure. */
  neededBy: string[];
}

export interface CarryRename {
  from: string;
  to: string;
  /** What the emitted file binds `from` to instead. */
  kept: string;
}

export interface CarryResult {
  preamble: CarryBlock[];
  prologue: CarryBlock[];
  /** Names a carried block reads that nothing in the bundle declares. */
  unresolved: string[];
  /** Names renamed around a binding the generated file already has. */
  renames: CarryRename[];
  /** The lockstep calls rewritten, deduped (`math.sin`, `wa.random`, …). */
  rewrites: string[];
  /** `math.random()` with no arguments: no `wa.random` form means the same. */
  floatRandom: boolean;
  /** Blocks refused, and why. */
  refused: string[];
  /** The bundle dependencies a carried `require` needs (`effects.sdk`, …). */
  dependencies: string[];
  /** Warnings to show at import: a carried `wa` read at load, a missing module. */
  notes: string[];
  /** Bundle-relative paths rewritten onto the export's own folder. */
  pathRewrites: number;
  /** Each art path the carried text names, before and after the move. */
  paths: { source: string; target: string }[];
  /**
   * The same renames and rewrites, applied to another piece of carried text (the
   * hook body itself), so the hook and its declarations agree.
   */
  transform(text: string): {
    text: string;
    rewrites: string[];
    floatRandom: boolean;
    pathRewrites: number;
    paths: { source: string; target: string }[];
  };
}

/**
 * Module ids the export can `require`, and the bundle dependency that provides
 * each. Everything under `wf-lib/` belongs to a library the editor ships in the
 * zip or declares as a dependency; a bundle's own `lib/` is neither, so a carried
 * `require` of it is named for the author to add.
 */
const MODULE_DEPENDENCIES: { prefix: string; id: string }[] = [
  { prefix: 'wf-lib/holds', id: 'wf.sdk' },
  // `wf.sdk`'s own `[exports]` table: the engine's library bundle provides these
  // names, so `require("wf-lib/own_time")` resolves once the manifest declares
  // `wf.sdk`. A carried PX weapon opens with exactly that line.
  { prefix: 'wf-lib/own_time', id: 'wf.sdk' },
  { prefix: 'wf-lib/shared', id: 'wf.sdk' },
  { prefix: 'wf-lib/parkour', id: 'wf.sdk' },
  { prefix: 'wf-lib/tooltip', id: 'wf.sdk' },
  { prefix: 'wf-lib/lightning', id: 'wf.sdk' },
  { prefix: 'wf-lib/px_sprite_builder', id: 'wf.sdk' },
  { prefix: 'wf-lib/sdk', id: 'wf.sdk' },
  { prefix: 'wf-lib/wfws_sprite_builder', id: 'wfws.sdk' },
  { prefix: 'wf-lib/wfws_sdk/', id: 'wfws.sdk' },
  { prefix: 'wf-lib/effects/', id: 'effects.sdk' },
  { prefix: 'wf-lib/fire_seq', id: 'px.fire_seq' },
  { prefix: 'wf-lib/electric/', id: 'px.electric' },
];

/** The dependency a carried `require` needs, or null when the module is unknown. */
export function dependencyForModule(module: string): string | null {
  const hit = MODULE_DEPENDENCIES.find((entry) => module.startsWith(entry.prefix));
  return hit ? hit.id : null;
}

const cache = new WeakMap<LuaBlock, string[]>();

/**
 * The free names of a body, **including the function literals it builds**.
 *
 * `wa.on.worm_message(function(worm) swim_push(worm) end, { … })` is one
 * statement, and the checker reads a bare call as one expression, so it reports
 * nothing inside the callback: every registration seed carried no names at all,
 * and a bundle's state was only resolved through its claim hooks. The bundles
 * that declare their state in a `setup` helper register exactly this way.
 */
function bodyFreeNames(text: string, ambient: string[]): string[] {
  const names = new Set(freeNames(text, ambient));
  const masked = maskLuaCode(text);
  const word = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = word.exec(masked)) !== null) {
    if (m[0] !== 'function') continue;
    // `scanBlockEnd` answers the offset the closer starts at, so the body runs
    // to the end of that word: `function(w) points = 0` without its `end` is an
    // unbalanced fragment, and the checker reports nothing inside one.
    const end = scanBlockEnd(masked, m.index + m[0].length);
    if (end <= m.index) continue;
    const body = text.slice(m.index, end + 'end'.length);
    for (const name of freeNames(body, ambient)) names.add(name);
    word.lastIndex = end;
  }
  return [...names];
}

/** The free names of a block, given what is already in scope. */
function needs(block: LuaBlock, ambient: string[]): string[] {
  const cached = cache.get(block);
  if (cached) return cached;
  const names = bodyFreeNames(block.text, ambient);
  cache.set(block, names);
  return names;
}

/**
 * Which block declares `name`, searching `scopes` in order. The **last**
 * declaration in a scope wins, as it does in Lua, and the carried blocks are
 * emitted in source order so a forward call between two `local function`s still
 * resolves.
 */
function findDeclaration(name: string, scopes: LuaBlock[][], skip?: LuaBlock): LuaBlock | null {
  for (const region of scopes) {
    let found: LuaBlock | null = null;
    for (const block of region) {
      if (block === skip) continue;
      if (block.declares.includes(name)) found = block;
    }
    if (found) return found;
  }
  return null;
}

/** A name close to `name` that nothing has taken. */
function freeAlias(name: string, taken: Set<string>): string {
  const base = `${name}_bundle`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_x`;
}

/**
 * The declarations a set of carried bodies needs, transitively.
 *
 * `reserved` is what the emitted weapon file already binds: the generator's own
 * `require`s mapped to their module id, and its own locals mapped to `''`.
 */
export function carryClosure(
  seeds: { label: string; text: string; enclosing?: LuaBlock[][] }[],
  split: SplitModule,
  reserved: Map<string, string>,
  /** The export's sprite/sound folder (`sanitizeModFolder(id)`). */
  folder = '',
  /** What the generator will emit, so an identical declaration is not carried twice. */
  emitted = '',
): CarryResult {
  const param = split.install?.param ?? 'ctx';
  /** The bundle dependencies a carried `require` needs, in the order they appear. */
  const dependencies: string[] = [];
  const installAmbient = [param];
  const preambleAll = split.preamble.filter((block) => block.declares.length > 0 || block.requires.length > 0);
  const prologueAll = (split.install?.statements ?? []).filter(
    (block) => block.declares.length > 0 || block.requires.length > 0,
  );

  // ---- the closure ---------------------------------------------------------
  const carried = new Map<LuaBlock, { origin: 'preamble' | 'prologue'; neededBy: string[] }>();
  const unresolved: string[] = [];
  const refused: string[] = [];
  const notes: string[] = [];
  // A queue item carries the scopes of the point of use, innermost first, so a
  // name declared inside `function weapon.setup() … end` resolves where it was
  // written rather than at module level (`swim_suit`, `portal_gun`, `nuke_rocket`).
  const queue: { name: string; scopes: LuaBlock[][]; from: string; skip?: LuaBlock }[] = [];
  /**
   * The scopes a block's own needs are resolved in: its own enclosing blocks,
   * then the install body (where a prologue block lives and where a carried
   * block is hoisted to), then the module level.
   */
  const scopesOf = (block: LuaBlock): LuaBlock[][] => [
    block.scope ?? [],
    ...(block.enclosing ?? []),
    prologueAll,
    preambleAll,
  ];
  for (const seed of seeds) {
    const scopes = [...(seed.enclosing ?? []), prologueAll, preambleAll];
    for (const name of bodyFreeNames(seed.text, installAmbient)) {
      queue.push({ name, scopes, from: seed.label });
    }
  }
  /**
   * The function whose parameter list binds `name`, if that is where it comes
   * from. A module shaped `function M.install(ctx, spec)` takes `spec` from
   * whoever calls it (`lib/cursor.lua` is installed that way), so the hook
   * closes over the *caller's* table: carrying the body without the call reads a
   * nil, and the summary has to say which line that is rather than "nothing
   * declares it".
   */
  const parameterOf = (name: string, scopes: LuaBlock[][]) => {
    for (const region of scopes) {
      for (const block of region) {
        const head = /function\s*([A-Za-z0-9_.:]*)\s*\(([^)]*)\)/.exec(block.text);
        if (!head) continue;
        const params = head[2].split(',').map((param) => param.trim()).filter(Boolean);
        if (params.includes(name)) {
          return { header: head[1] || 'function', params: head[2].trim(), line: block.line };
        }
      }
    }
    return null;
  };
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { name, scopes, from, skip } = queue.shift()!;
    // The skip is part of the identity: `x = …` asks for the `local x` while
    // excluding itself, and that is a different question from the earlier
    // lookup of `x` that found the assignment.
    const key = `${name}|${skip?.line ?? 0}|${scopes.map((scope) => scope[0]?.line ?? 0).join(',')}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const block = findDeclaration(name, scopes, skip);
    if (!block) {
      const parameter = parameterOf(name, scopes);
      if (parameter) {
        // The block that reads it **is** carried when its other names resolve
        // (`utilities.cursor` installs `lib/cursor.lua`'s machinery with a spec
        // table, and its `on_click` hook arrives intact while `spec` stays a
        // nil), so the note must not claim the body was dropped.
        const note = `\`${name}\` is a parameter of \`${parameter.header}(${parameter.params})\` on line ${parameter.line}, which the caller supplies: the carried code reads it as a nil unless the call that passes it is carried too`;
        if (!notes.includes(note)) notes.push(note);
      }
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    // A block that cannot be carried is not carried whole, and its own needs are
    // not followed: a half-copied helper is a nil call with extra steps.
    const shape = checkLua(block.text, { mode: 'fragment', skipGlobals: true });
    const broken = shape.find(
      (finding) =>
        finding.severity === 'error' &&
        (finding.rule === 'lua-ast' || finding.rule === 'lua-nul' || finding.rule === 'lua-size'),
    );
    if (broken) {
      refused.push(`line ${block.line}: ${broken.message}`);
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    // The same declaration can be reached through more than one path, and the
    // scope walk builds its own block objects for a nested scope (a `setup`
    // helper is read once as a top-level statement and once from inside). One
    // line is one declaration, whatever object it arrived as.
    const sameBlock = (a: LuaBlock, b: LuaBlock) =>
      a.line === b.line && squash(a.text) === squash(b.text);
    const twin = [...carried.keys()].find((other) => sameBlock(other, block));
    const entry = twin ? carried.get(twin) : undefined;
    if (entry) {
      entry.neededBy.push(from);
      continue;
    }
    const origin = preambleAll.includes(block) ? 'preamble' : 'prologue';
    // Two *locals* of one name would collide once both are hoisted into install;
    // a `local x` and the `x = …` that follows it are one binding (lesson 21's
    // shape), so only two `local` declarations clash.
    const declaresLocal = (text: string) => /^\s*local\b/.test(text);
    const clash = declaresLocal(block.text)
      ? [...carried.keys()].find(
          (other) =>
            other !== block &&
            declaresLocal(other.text) &&
            other.declares.some((declared) => block.declares.includes(declared)),
        )
      : undefined;
    if (clash) {
      // The same declaration written twice, once per helper that needs it: PX's
      // `weapon.definition` and `weapon.setup` both open with
      // `local shared = require("lib/shared")`, and that is one binding, not a
      // collision. The first copy serves both.
      if (squash(clash.text) === squash(block.text)) {
        carried.get(clash)?.neededBy.push(from);
        continue;
      }
      notes.push(
        `line ${block.line} declares ${block.declares.join(', ')} in a different scope from line ${clash.line}, so only the first was carried`,
      );
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    carried.set(block, { origin, neededBy: [from] });
    // A `wa` read at module level is a load-time nil (lesson 21).
    if (origin === 'preamble' && block.kind !== 'require') {
      const loadTime = checkLua(block.text, { mode: 'module', skipGlobals: true }).find(
        (finding) => finding.rule === 'module-wa' && finding.severity === 'error',
      );
      if (loadTime) {
        notes.push(`carried line ${block.line} reads \`wa\` while the module loads: ${loadTime.message}`);
      }
    }
    const nextScope: 'module' | 'install' = origin === 'preamble' ? 'module' : 'install';
    // A bare `x = …` binds an existing local, so the declaration of `x` has to
    // travel too or the assignment writes a global: pulsar declares `local zap`
    // at module level and assigns `zap = require("wf-lib/electric/damage")`
    // inside `install` (lesson 21's shape, because that module reads `wa` while
    // it loads).
    const own = scopesOf(block);
    if (origin === 'prologue' && !/^\s*local\b/.test(block.text)) {
      queue.push({ name, scopes: own, from: name, skip: block });
    }
    for (const need of needs(block, nextScope === 'install' ? installAmbient : [])) {
      queue.push({ name: need, scopes: own, from: name });
    }
  }

  // ---- what the emitted file already binds --------------------------------
  // One decision per name, not per block: a declaration (`local fx`) and the
  // assignment that follows it (`fx = require("…")`) are one binding, and
  // dropping half of a pair is how a bundle's `fx` ends up nil.
  const carriedModules = new Map<string, string>();
  for (const [block] of carried) {
    if (block.requires.length === 1 && block.declares.length === 1) {
      carriedModules.set(block.declares[0], block.requires[0]);
    }
  }
  const taken = new Set<string>([
    ...reserved.keys(),
    ...preambleAll.flatMap((block) => block.declares),
    ...prologueAll.flatMap((block) => block.declares),
  ]);
  // A declaration the export writes **itself, identically**, is not carried:
  // this is what makes a re-import of our own output stable (`stamp_hit`,
  // `STAMP_HIT`, the trail's own helpers). The comparison squashes whitespace,
  // because the export re-indents what it carries and a comment inside the block
  // is part of the text either way.
  const emittedSquashed = emitted ? squash(emitted) : '';
  const dropBlocks = new Set<LuaBlock>();
  for (const [block] of carried) {
    if (emittedSquashed && emittedSquashed.includes(squash(block.text))) {
      dropBlocks.add(block);
      continue;
    }
    if (block.declares.length === 1) {
      const name = block.declares[0];
      const keptModule = reserved.get(name) ?? '';
      const mine = carriedModules.get(name);
      // Same module: the file's own binding is the same value, so the generated
      // declaration serves the hook too and nothing is carried.
      if (keptModule !== '' && mine !== undefined && mine === keptModule) dropBlocks.add(block);
    }
  }
  const droppedNames = new Set(
    [...dropBlocks].flatMap((block) => block.declares),
  );
  const renames: CarryRename[] = [];
  for (const name of new Set(
    [...carried.keys()].filter((block) => !dropBlocks.has(block)).flatMap((block) => block.declares),
  )) {
    if (!reserved.has(name) || droppedNames.has(name)) continue;
    const to = freeAlias(name, taken);
    taken.add(to);
    renames.push({ from: name, to, kept: reserved.get(name) || 'a local of its own' });
  }
  for (const block of dropBlocks) carried.delete(block);

  // ---- what a surviving require needs from `mod.toml` ----------------------
  // A carried `require("wf-lib/effects/…")` only resolves at load if the bundle
  // declares `effects.sdk`, and an import never saw a manifest line for it: the
  // editor's own feature dependencies cover its own output, not a bundle's code.
  // A module nothing here ships is named instead, because the export would fail
  // at load and the author needs to know which line to add.
  for (const [block] of carried) {
    for (const module of block.requires) {
      const dependency = dependencyForModule(module);
      if (dependency) {
        if (!dependencies.includes(dependency)) dependencies.push(dependency);
        continue;
      }
      notes.push(
        `carried \`require("${module}")\` is not shipped by the export: add the bundle that provides it to Dependencies, or the export fails at load`,
      );
    }
  }

  // ---- rewrites, then the blocks ------------------------------------------
  const transform = (text: string) => {
    const renamed = rewriteNames(text, renames);
    const fixed = fixLockstepRng(renamed);
    // A bundle's own art moves with the export: the ZIP only ever ships
    // `sprites/<mod>/` and `sounds/<mod>/`, so a carried `sprite =
    // "sprites/vortex/hold.png"` has to name the folder the file is written to
    // or the call fails when it runs.
    const moved = rewriteBundlePaths(fixed, folder);
    return {
      text: moved.text,
      rewrites: rewrittenCalls(renamed, fixed),
      floatRandom: hasFloatRandom(fixed),
      pathRewrites: moved.moves.filter((move) => move.source !== move.target).length,
      paths: moved.moves,
    };
  };
  const rewrites = new Set<string>();
  let floatRandom = false;
  let pathRewrites = 0;
  const paths: { source: string; target: string }[] = [];
  const output = (origin: 'preamble' | 'prologue'): CarryBlock[] =>
    [...carried.entries()]
      .filter(([, entry]) => entry.origin === origin)
      .map(([block, entry]) => ({ block, entry }))
      .sort((a, b) => a.block.line - b.block.line)
      .map(({ block, entry }) => {
        const transformed = transform(block.text);
        for (const call of transformed.rewrites) rewrites.add(call);
        floatRandom = floatRandom || transformed.floatRandom;
        pathRewrites += transformed.pathRewrites;
        paths.push(...transformed.paths);
        return {
          origin,
          text: transformed.text,
          declares: block.declares,
          requires: block.requires,
          line: block.line,
          neededBy: [...new Set(entry.neededBy)],
        };
      });

  return {
    preamble: output('preamble'),
    prologue: output('prologue'),
    unresolved,
    renames,
    rewrites: [...rewrites],
    floatRandom,
    pathRewrites,
    paths,
    refused,
    dependencies,
    notes,
    transform,
  };
}

/** Whitespace-free text, for comparing two renderings of one declaration. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/** The `math.*` forms a rewrite actually changed, so the note can name them. */
function rewrittenCalls(before: string, after: string): string[] {
  if (before === after) return [];
  const out: string[] = [];
  const names = before.match(/math\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const name of names) {
    const flat = name.replace(/\s+/g, '');
    if (flat === 'math.random') out.push('math.random -> wa.random');
    else if (flat === 'math.sin') out.push('math.sin -> wa.math.sin');
    else if (flat === 'math.cos') out.push('math.cos -> wa.math.cos');
    else if (flat === 'math.atan') out.push('math.atan -> wa.math.atan');
  }
  return [...new Set(out)];
}

/** `math.random()` returns a float: there is no `wa.random` form that matches. */
function hasFloatRandom(code: string): boolean {
  return /(^|[^A-Za-z0-9_.])math\s*\.\s*random\s*\(\s*\)/.test(code);
}

/**
 * Moves a carried reference to the bundle's own art onto the export's folder.
 *
 * A ZIP ships `sprites/<mod>/…` and `sounds/<mod>/…` and nothing else: the
 * engine resolves a pack path inside the bundle that names it (`inside_pack`),
 * so a carried `sprite = "sprites/vortex/hold.png"` would name a folder the
 * export does not have. Only the folder segment changes; the file name is the
 * author's, and a file the export does not write is a missing-art error with the
 * path in it rather than a silent one.
 *
 * The match is on a quoted string, because a path in a comment is prose.
 */
export function rewriteBundlePaths(
  text: string,
  folder: string,
): { text: string; moves: { source: string; target: string }[] } {
  if (!folder) return { text, moves: [] };
  const moves: { source: string; target: string }[] = [];
  // The whole quoted path is captured so the caller can load the same file from
  // the bundle it came from, not only name the folder it moves to. A path that is
  // already the export's own (`sprites/<mod>/hold.png`, which is what a re-import
  // sees) is recorded too: that is how a carried sheet stays declared and
  // written on the second pass instead of quietly leaving the zip.
  const seen = new Set<string>();
  const out = text.replace(
    /(["'])((?:sprites|sounds)\/[^/"']+\/[^"']+)(["'])/g,
    (whole, quote: string, path: string, close: string) => {
      const slash = path.indexOf('/');
      const kind = path.slice(0, slash);
      const file = path.slice(path.indexOf('/', slash + 1) + 1);
      const target = `${kind}/${folder}/${file}`;
      // A path can contain neither a comma nor a newline, so the pair is a key.
      const key = `${path},${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        moves.push({ source: path, target });
      }
      return target === path ? whole : `${quote}${target}${close}`;
    },
  );
  return { text: out, moves };
}
