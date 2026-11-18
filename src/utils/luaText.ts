/**
 * Lua text helpers with no engine knowledge: the masker both the snippet parser
 * and the code checker read, and the bounded block scan they both walk.
 */

/** Words that are never an identifier read. */
export const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto',
  'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true',
  'until', 'while',
]);

/**
 * Index of the `end` (or `until`) that closes the block opened just before
 * `from`, in masked text.
 *
 * `function`, `if`, `for`, `while`, `repeat` and a bare `do` each open one, and
 * the `do` of a `for`/`while` header opens nothing of its own: it is consumed by
 * the pending flag the loop header set. Pairing by look-back ("the text before
 * this `do` contains a `for`") is what made a bare `do ... end` inside a loop
 * close the loop instead, so `scanBlockEnd` returned an `end` early and
 * `parseCustomLua` cut an `on_explode` body short. Identifiers are read whole,
 * so `endless` is a name and not an `end`. Bounded, so a malformed body cannot
 * stall the caller: it returns `-1` instead of hanging.
 */
export function scanBlockEnd(masked: string, from: number, limit = 50000): number {
  const word = /[A-Za-z_][A-Za-z0-9_]*/g;
  word.lastIndex = from;
  let depth = 1;
  let pendingDo = false;
  let steps = 0;
  let m: RegExpExecArray | null;
  while ((m = word.exec(masked)) !== null && steps < limit) {
    steps += 1;
    const name = m[0];
    if (name === 'for' || name === 'while') {
      depth += 1;
      pendingDo = true;
      continue;
    }
    if (name === 'function' || name === 'if' || name === 'repeat') {
      depth += 1;
      pendingDo = false;
      continue;
    }
    if (name === 'do') {
      if (pendingDo) pendingDo = false;
      else depth += 1;
      continue;
    }
    if (name === 'end' || name === 'until') {
      pendingDo = false;
      depth -= 1;
      if (depth === 0) return m.index;
    }
  }
  return -1;
}

/** 1-based line number of a character offset. */
export function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) {
    if (code[i] === String.fromCharCode(10)) line += 1;
  }
  return line;
}

/** The same text with Lua comments and string bodies replaced by spaces.
 *
 * `parseCustomLua` finds the end of an `on_explode` body by counting
 * `function`/`if`/`for`/`while` against `end`, so a word inside a comment
 * ("-- the end of it") or a string ("end of file") used to close the body
 * early and leave the rest of the snippet behind as broken Lua. Masking keeps
 * every index where it was (one character out, one character back), so the
 * scan runs on the masked copy and the original is what gets sliced.
 *
 * `luaCheck` reads the same copy, so a `math.sin` in a comment or a `pairs` in
 * a string is not a finding.
 */
export function maskLuaCode(code: string): string {
  const out: string[] = [];
  let i = 0;
  const blank = (n: number) => {
    for (let k = 0; k < n; k += 1) out.push(code[i + k] === '\n' ? '\n' : ' ');
  };
  while (i < code.length) {
    const ch = code[i];
    if (ch === '-' && code[i + 1] === '-') {
      const long = /^--\[(=*)\[/.exec(code.slice(i, i + 12));
      if (long) {
        const close = `]${long[1]}]`;
        const end = code.indexOf(close, i + long[0].length);
        const stop = end === -1 ? code.length : end + close.length;
        blank(stop - i);
        i = stop;
        continue;
      }
      const nl = code.indexOf('\n', i);
      const stop = nl === -1 ? code.length : nl;
      blank(stop - i);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < code.length) {
        const c = code[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === ch) {
          j += 1;
          break;
        }
        if (c === '\n') break;
        j += 1;
      }
      const stop = Math.min(j, code.length);
      // The delimiters stay: a statement that ends in a string literal must not
      // look like one ending in `=` (which is a line continuation), or
      // `local HOLE = "…"` swallows the next declaration. The contents are
      // blanked, so an `end` in a string is still not a block.
      const closed = j > i + 1 && code[j - 1] === ch;
      const bodyEnd = closed ? stop - 1 : stop;
      out.push(ch);
      for (let k = i + 1; k < bodyEnd; k += 1) {
        out.push(code[k] === '\n' ? '\n' : ' ');
      }
      if (closed) out.push(ch);
      i = stop;
      continue;
    }
    if (ch === '[') {
      const long = /^\[(=*)\[/.exec(code.slice(i, i + 12));
      if (long) {
        const close = `]${long[1]}]`;
        const end = code.indexOf(close, i + long[0].length);
        const stop = end === -1 ? code.length : end + close.length;
        blank(stop - i);
        i = stop;
        continue;
      }
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

/**
 * Markers around a block the editor did not generate.
 *
 * The generator wraps the custom `on_explode` body (today the only place an
 * imported bundle's code lands, and also where the author's own snippet goes) in
 * these two comment lines. They say what makes a finding there certain rather
 * than possible: nothing in the emitted file declares a name read inside, so it
 * fails when the hook runs, whoever wrote the line. `checkLua` reads them,
 * `customExplodeBody` drops them on a re-import so they cannot nest, and both are
 * comments, so the masked copy and the file's behaviour are untouched.
 */
export const NOT_GENERATED_OPEN =
  '-- not generated by the editor: custom Lua, or a hook an imported bundle carried in';
export const NOT_GENERATED_CLOSE = '-- end not generated';

/** Either marker, trimmed, as a line test. */
export const NOT_GENERATED_MARKER = /^--\s*(?:not generated by the editor\b|end not generated\b)/;

/** Opens or closes? Used to walk the regions, not to classify a line. */
export function isNotGeneratedMarker(line: string): 'open' | 'close' | null {
  const trimmed = line.trim();
  if (!NOT_GENERATED_MARKER.test(trimmed)) return null;
  return /^--\s*end not generated\b/.test(trimmed) ? 'close' : 'open';
}

/**
 * The same text without the editor's own region markers. A bundle this editor
 * wrote already carries them, so a re-import that kept them would wrap the body
 * in a second pair and gain two comment lines on every round trip.
 */
export function stripNotGeneratedMarkers(code: string): string {
  if (!code.includes('not generated')) return code;
  const lines = code.split(String.fromCharCode(10));
  if (!lines.some((line) => isNotGeneratedMarker(line))) return code;
  return lines.filter((line) => isNotGeneratedMarker(line) === null).join(String.fromCharCode(10));
}

/**
 * Line ranges (1-based, inclusive) of the text between the markers, so a finding
 * that carries a line number can be answered with "did the editor generate
 * this". An unclosed region runs to the end of the file, which is what a
 * truncated custom body does.
 */
export function notGeneratedLineRanges(code: string): [number, number][] {
  if (!code.includes('not generated')) return [];
  const lines = code.split('\n');
  const ranges: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const marker = isNotGeneratedMarker(lines[i]);
    if (marker === 'open') {
      open = i + 2;
      continue;
    }
    if (marker === 'close' && open > 0) {
      ranges.push([open, i]);
      open = -1;
    }
  }
  if (open > 0) ranges.push([open, lines.length]);
  return ranges;
}

/**
 * Renames identifiers in Lua source, leaving strings, comments and member
 * accesses alone.
 *
 * Used when a carried block declares a name the generated file already binds
 * (`local fx = require("lib/my_fx")` against our own `local fx`): the carried
 * name becomes `fx_bundle` and every reference **in carried text** follows it.
 * The scan runs on `maskLuaCode`'s copy so a `"fx"` in a sound path or a
 * `-- fx, the effects SDK` comment is not rewritten, and `a.fx` / `a:fx` are
 * member accesses, not reads of the local.
 */
export function rewriteNames(
  text: string,
  renames: { from: string; to: string }[],
): string {
  if (renames.length === 0) return text;
  const masked = maskLuaCode(text);
  const edits: { at: number; length: number; to: string }[] = [];
  for (const { from, to } of renames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(from) || from === to) continue;
    const word = new RegExp(`(^|[^A-Za-z0-9_.:])(${from})(?![A-Za-z0-9_])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = word.exec(masked)) !== null) {
      edits.push({ at: m.index + m[1].length, length: from.length, to });
    }
  }
  if (edits.length === 0) return text;
  edits.sort((a, b) => a.at - b.at);
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    if (edit.at < cursor) continue;
    out += text.slice(cursor, edit.at) + edit.to;
    cursor = edit.at + edit.length;
  }
  return out + text.slice(cursor);
}
