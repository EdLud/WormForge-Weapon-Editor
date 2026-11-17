/**
 * Splitting a bundle module into the parts a carry has to keep.
 *
 * A bundle's weapon is a module that returns a claim table, and its code lives in
 * three places the engine loads in a fixed order (AGENTS.md lesson 21):
 *
 * - the **preamble**, at module level: the `require`s, the constant tables and
 *   the helper functions a callback closes over. 118 of the 255 weapon modules in
 *   the installed corpus keep something here, so a carry that drops the preamble
 *   ships callbacks reading nils;
 * - the **install body**, which runs once per match: the install-time locals
 *   (20 modules keep state there) and the `wa.on.*` registrations;
 * - the **claim table**, whose hook keys are single-valued.
 *
 * This module reads those three out and nothing else: it emits nothing, decides
 * nothing, and never guesses. A block it cannot close is reported in `notes`
 * rather than cut short, because a half-carried body is worse than a stated gap
 * (`reqs/custom_code_import_plan.md`, M1 to M3).
 *
 * The scan runs on `maskLuaCode`'s copy throughout, so a `-- end` in a comment or
 * an `"end"` in a string cannot close a block, and every offset is still the
 * original's, so the text handed back is verbatim.
 */
import { maskLuaCode, scanBlockEnd } from '../luaText';
import { CLAIM_HOOK_KEYS, type ClaimHookKey } from '../../data/luaHooks';

export type LuaBlockKind = 'require' | 'local' | 'function' | 'assignment' | 'call' | 'other';

export interface LuaBlock {
  kind: LuaBlockKind;
  /** Verbatim source, without the trailing newline. */
  text: string;
  /** 1-based line the block starts on. */
  line: number;
  /** Names the block declares (`local a, b`, `local function f`, `function M.f`). */
  declares: string[];
  /** Bundle module ids this block requires. */
  requires: string[];
}

export interface LuaRegistration {
  /** The event, without the `wa.on.` prefix. */
  event: string;
  /** The whole call, verbatim, options table included. */
  text: string;
  /** Arguments split at top-level commas. */
  args: string[];
  /** The handler (first argument). */
  handler: string;
  /**
   * The options table, when one was passed. It is part of the call, not
   * decoration: a `worm_message` without its `msgs` filter runs on every message.
   */
  options: string | null;
  line: number;
}

export interface LuaInstall {
  /** The parameter name (`ctx` in every bundle this editor writes). */
  param: string;
  /** Everything between the parameter list and the closing `end`. */
  bodyText: string;
  /** Its top-level statements, in order: the prologue and the helpers. */
  statements: LuaBlock[];
  /** Module-level index of the `function` keyword, for ordering the preamble. */
  at: number;
}

export interface SplitModule {
  /** A module-level `install = function(...)`, in any of the three shapes. */
  install: LuaInstall | null;
  /** Module-level statements that end before `install`: requires, constants, helpers. */
  preamble: LuaBlock[];
  /** Every `wa.on.*` registration in the install body (or the file, when there is none). */
  registrations: LuaRegistration[];
  /** Claim hooks found, as their function literal. */
  hooks: Partial<Record<ClaimHookKey, string>>;
  /** 1-based line each hook starts on, for the notes and the panel. */
  hookLines: Partial<Record<ClaimHookKey, number>>;
  /** Every `require("…")` id in the file, in order, deduped. */
  requires: string[];
  /** Why a block could not be read whole. Never a reason to guess. */
  notes: string[];
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/;

const lineAt = (code: string, index: number) => code.slice(0, index).split('\n').length;

/**
 * Bracket and block depth, shared by the statement scan and the argument split.
 *
 * Both have to answer the same question ("is this comma or newline at the top
 * level of this construct?"), and the block half is not optional: a comma inside
 * `function() … end` is not an argument separator, which is what turned
 * `wa.on.draw(function() for i = 1, n do … end end)` into a registration with two
 * arguments and a bogus options table.
 */
class Depth {
  brackets = 0;
  blocks = 0;
  private pendingDo = false;

  /** True when neither a bracket nor a block is open. */
  get top(): boolean {
    return this.brackets === 0 && this.blocks === 0;
  }

  /** Accounts for a bracket character; returns false for anything else. */
  bracket(ch: string): boolean {
    if (ch === '(' || ch === '[' || ch === '{') {
      this.brackets += 1;
      return true;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      this.brackets -= 1;
      return true;
    }
    return false;
  }

  /**
   * Accounts for the word starting at `i`. Returns its length, and whether it
   * closed the outermost block (a statement ends right after that word).
   */
  word(masked: string, i: number): { length: number; closes: boolean } {
    const word = WORD.exec(masked.slice(i, i + 24))?.[0] ?? '';
    let closes = false;
    if (word === 'function' || word === 'if' || word === 'repeat') {
      this.blocks += 1;
      this.pendingDo = false;
    } else if (word === 'for' || word === 'while') {
      this.blocks += 1;
      this.pendingDo = true;
    } else if (word === 'do') {
      if (this.pendingDo) this.pendingDo = false;
      else this.blocks += 1;
    } else if (word === 'end' || word === 'until') {
      this.blocks -= 1;
      this.pendingDo = false;
      closes = this.top;
    }
    return { length: Math.max(1, word.length), closes };
  }
}

/** The last non-space character before `index`, and the word it ends. */
function tailOf(masked: string, from: number, index: number): { char: string; word: string } {
  let i = index - 1;
  while (i > from && (masked[i] === ' ' || masked[i] === '\t' || masked[i] === '\r')) i -= 1;
  const char = masked[i] ?? '';
  let j = i;
  while (j > from && /[A-Za-z0-9_]/.test(masked[j - 1])) j -= 1;
  return { char, word: masked.slice(j, i + 1) };
}

/** A line break inside an expression does not end the statement. */
function continuesOnNextLine(masked: string, from: number, index: number): boolean {
  const { char, word } = tailOf(masked, from, index);
  if (',+-*/%^<>=~#'.includes(char)) return true;
  return word === 'and' || word === 'or' || word === 'not' || char === '.';
}

/**
 * Index just past the statement that starts at `from`, or -1.
 *
 * Brackets and blocks both have to be closed before a line break ends a
 * statement, which is what keeps `local x = function() … end` and a multi-line
 * `{ … }` table in one piece. `elseif` is one word and so never opens a block,
 * and `repeat … until` closes like any other.
 */
function statementEnd(masked: string, from: number, limit: number): number {
  const depth = new Depth();
  const stop = Math.min(masked.length, from + limit);
  let i = from;
  while (i < stop) {
    const ch = masked[i];
    if (depth.bracket(ch)) {
      i += 1;
      continue;
    }
    if (ch === '\n' && depth.top && !continuesOnNextLine(masked, from, i)) return i;
    if (/[A-Za-z_]/.test(ch)) {
      const { length, closes } = depth.word(masked, i);
      if (closes) return i + length;
      i += length;
      continue;
    }
    i += 1;
  }
  // A file that ends without a newline (or on its closing `}`) still ends the
  // statement, as long as everything opened was closed.
  if (stop === masked.length && depth.top) return masked.length;
  return -1;
}

/** Every `require("…")` id in a piece of source, in order. */
function requiresIn(text: string, masked: string): string[] {
  const out: string[] = [];
  const call = /(^|[^A-Za-z0-9_.])require\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(masked)) !== null) {
    const after = m.index + m[0].length;
    const arg = /^[ \t]*["']([^"']+)["']/.exec(text.slice(after));
    if (arg && !out.includes(arg[1])) out.push(arg[1]);
  }
  return out;
}

/** What a statement declares, and which kind it is. */
function classify(masked: string): { kind: LuaBlockKind; declares: string[] } {
  const text = masked.trimStart();
  const localFunction = /^local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
  if (localFunction) return { kind: 'function', declares: [localFunction[1]] };
  const fn = /^function\s+([A-Za-z_][A-Za-z0-9_.:]*)/.exec(text);
  if (fn) return { kind: 'function', declares: [fn[1].split(/[.:]/)[0]] };
  // `local x = require("…")` is the shape a preamble require takes in every
  // bundle this editor writes, so it is a `require` block and not a plain local.
  const localRequire = /^local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\s*\(/.exec(text);
  if (localRequire) return { kind: 'require', declares: [localRequire[1]] };
  const aliasRequire = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*require\s*\(/.exec(text);
  if (aliasRequire) return { kind: 'require', declares: [aliasRequire[1]] };
  const local = /^local\s+([A-Za-z_][A-Za-z0-9_,\s]*)/.exec(text);
  if (local) {
    const names = local[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));
    return { kind: 'local', declares: names };
  }
  const assignment = /^([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(?!=)/.exec(text);
  if (assignment) return { kind: 'assignment', declares: [assignment[1]] };
  const call = /^([A-Za-z_][A-Za-z0-9_.]*)\s*[({]/.exec(text);
  if (call) return { kind: 'call', declares: [] };
  return { kind: 'other', declares: [] };
}

/** The top-level statements in `[from, to)`, verbatim. */
function statements(
  code: string,
  masked: string,
  from: number,
  to: number,
  notes: string[],
  limit: number,
): LuaBlock[] {
  const out: LuaBlock[] = [];
  let i = from;
  while (i < to) {
    while (i < to && /[\s;]/.test(masked[i])) i += 1;
    if (i >= to) break;
    const end = statementEnd(masked, i, limit);
    if (end <= i) {
      notes.push(
        `a statement starting on line ${lineAt(code, i)} could not be closed (an unclosed block or table), so the rest of that region was not read`,
      );
      break;
    }
    // The region ends inside this statement: it is the table that *contains*
    // `install` (`return { … }`), not a preamble block. Its own require is still
    // counted in `requires`, and its contents are read as the install body.
    if (end > to) break;
    const text = code.slice(i, end);
    const maskedText = masked.slice(i, end);
    const { kind, declares } = classify(maskedText);
    out.push({
      kind,
      text,
      line: lineAt(code, i),
      declares,
      requires: requiresIn(text, maskedText),
    });
    i = end;
  }
  return out;
}

/** Index of the `(` that follows the word at `from`, or -1. */
function parenAfter(masked: string, from: number): number {
  let i = from;
  while (i < masked.length && masked[i] !== '(' && masked[i] !== '\n') i += 1;
  return masked[i] === '(' ? i : -1;
}

/** Index just past the `)` matching the `(` at `open`, or -1. */
function closeParen(masked: string, open: number, limit = 20000): number {
  let depth = 0;
  const stop = Math.min(masked.length, open + limit);
  for (let i = open; i < stop; i += 1) {
    const ch = masked[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Split raw argument text at top-level commas, blocks included. */
function splitArgs(text: string): string[] {
  const masked = maskLuaCode(text);
  const depth = new Depth();
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = masked[i];
    if (depth.bracket(ch)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      i += depth.word(masked, i).length;
      continue;
    }
    if (ch === ',' && depth.top) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  out.push(text.slice(start));
  return out.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
}

/**
 * The `install` function, in any of the shapes real modules use: an assignment
 * inside the returned table (`install = function(ctx)`), a plain function
 * (`function install(ctx)`), or the module-table form PX uses
 * (`function M.install(ctx)` and `M.install = function(ctx)`).
 */
function findInstall(
  code: string,
  masked: string,
): { param: string; bodyStart: number; bodyEnd: number; at: number } | null {
  const patterns = [
    /\binstall\s*=\s*function\b/g,
    /\bfunction\s+[A-Za-z_][A-Za-z0-9_.:]*install\s*\(/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(masked);
    if (!match) continue;
    const fnAt = masked.indexOf('function', match.index);
    const open = parenAfter(masked, fnAt);
    if (open === -1) continue;
    const close = closeParen(masked, open);
    if (close === -1) continue;
    const end = scanBlockEnd(masked, fnAt + 'function'.length);
    if (end === -1) return null;
    const param = code.slice(open + 1, close - 1).split(',')[0]?.trim() || 'ctx';
    return { param, bodyStart: close, bodyEnd: end, at: fnAt };
  }
  return null;
}

export function splitModule(code: string): SplitModule {
  const notes: string[] = [];
  const masked = maskLuaCode(code);
  const installAt = findInstall(code, masked);
  const limit = Math.max(4000, code.length * 2);

  const split: SplitModule = {
    install: null,
    preamble: [],
    registrations: [],
    hooks: {},
    hookLines: {},
    requires: [],
    notes,
  };

  // ---- preamble and install body -------------------------------------------
  const preambleEnd = installAt ? installAt.at : code.length;
  split.preamble = statements(code, masked, 0, preambleEnd, notes, limit);
  if (installAt) {
    split.install = {
      param: installAt.param,
      bodyText: code.slice(installAt.bodyStart, installAt.bodyEnd),
      statements: statements(
        code,
        masked,
        installAt.bodyStart,
        installAt.bodyEnd,
        notes,
        limit,
      ),
      at: installAt.at,
    };
  } else {
    notes.push(
      'no `install` function: this module builds its claim some other way, so only its registrations and hooks could be read',
    );
  }

  // ---- wa.on.* registrations -----------------------------------------------
  const regionFrom = installAt ? installAt.bodyStart : 0;
  const regionTo = installAt ? installAt.bodyEnd : code.length;
  const call = /(^|[^A-Za-z0-9_.])wa\s*\.\s*on\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  call.lastIndex = regionFrom;
  let m: RegExpExecArray | null;
  while ((m = call.exec(masked)) !== null && m.index < regionTo) {
    const open = masked.indexOf('(', m.index);
    const close = closeParen(masked, open);
    if (close === -1) {
      notes.push(`the wa.on.${m[2]} call on line ${lineAt(code, m.index)} has no closing parenthesis`);
      break;
    }
    const args = splitArgs(code.slice(open + 1, close - 1));
    split.registrations.push({
      event: m[2],
      text: code.slice(m.index + m[1].length, close),
      args,
      handler: args[0] ?? '',
      options: args.length > 1 ? args.slice(1).join(', ') : null,
      line: lineAt(code, m.index),
    });
    call.lastIndex = close;
  }

  // ---- claim hooks ---------------------------------------------------------
  // Both shapes the engine reads: `on_x = function(ev)` and `on_x = { on = … }`.
  for (const key of CLAIM_HOOK_KEYS) {
    const hook = new RegExp(
      `(^|[^A-Za-z0-9_.])${key}\\s*=\\s*(function|\\{\\s*on\\s*=\\s*function)`,
    ).exec(masked);
    if (!hook) continue;
    const fnAt = masked.indexOf('function', hook.index);
    const end = scanBlockEnd(masked, fnAt + 'function'.length);
    if (end === -1) {
      notes.push(`the ${key} body on line ${lineAt(code, fnAt)} could not be closed, so it was not read`);
      continue;
    }
    const stop = masked.startsWith('until', end) ? end + 5 : end + 3;
    split.hooks[key] = code.slice(fnAt, stop);
    split.hookLines[key] = lineAt(code, hook.index);
  }

  // ---- every require in the file -------------------------------------------
  split.requires = requiresIn(code, masked);

  return split;
}
