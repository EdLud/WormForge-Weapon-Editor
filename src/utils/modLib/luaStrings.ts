/**
 * The strings a Lua module builds instead of spelling.
 *
 * A bundle's claim table is data, but a hand-written port often fills it with
 * names it declared once:
 *
 * ```lua
 * local SHEET = "sprites/buffalo/buffalo.png"
 * local SND = "sounds/buffalo/"
 * wa.weapons.replace{ hold = { sheet = SHEET }, sounds = { SND .. "start.wav" } }
 * ```
 *
 * The table reader (`luaTable.ts`) only keeps literals, so `sheet` and every
 * `sounds` entry came back `null` and the import dropped them: Buffalo of Lies
 * lost its hold sheet, its panel icon, its four WAVs and its `sprites` list
 * while its record arrived intact, which reads as "the sprite builder was not
 * read" rather than "four strings were not resolved".
 *
 * This module resolves exactly that much and no more:
 *
 * - `local NAME = <string literal or another such constant>` chains, in any
 *   order of declaration (resolved to a fixed point), including `..`;
 * - an expression that is a literal, a known constant, or a `..` chain of
 *   those, which is all a path in a claim table ever is.
 *
 * Anything else (a table name, a function call, arithmetic) is left alone, so a
 * value the editor cannot know stays missing rather than becoming a guess.
 */
import { maskLuaCode } from '../luaText';
import type { LuaTable, LuaValue } from './luaTable';

/** `local A = "x"`, `local B = A .. "/y"`: the string constants a module builds. */
export function stringConstants(code: string): Map<string, string> {
  const constants = new Map<string, string>();
  const decls: { name: string; expr: string }[] = [];
  for (const match of code.matchAll(/\blocal\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n;]+)/g)) {
    decls.push({ name: match[1], expr: match[2] });
  }
  // Two passes settle `local A = "x"` then `local B = A .. "y"`, and a third
  // covers `C = B .. D`; the loop stops as soon as nothing new resolves, so a
  // chain of any depth is read without letting a cycle run forever.
  for (let pass = 0; pass < 4; pass += 1) {
    let progress = false;
    for (const decl of decls) {
      if (constants.has(decl.name)) continue;
      const value = resolveStringExpr(decl.expr, constants);
      if (value !== undefined) {
        constants.set(decl.name, value);
        progress = true;
      }
    }
    if (!progress) break;
  }
  return constants;
}

/**
 * One expression to a string: a quoted literal, a known constant, or a `..`
 * chain of those. `undefined` means "not knowable from the text".
 */
export function resolveStringExpr(
  expr: string,
  constants: Map<string, string>,
): string | undefined {
  const text = stripTrailingComment(expr).trim();
  if (!text) return undefined;
  const parts = splitConcat(text);
  if (parts.length === 0) return undefined;
  let out = '';
  for (const part of parts) {
    const piece = part.trim();
    const literal = /^(["'])([\s\S]*)\1$/.exec(piece);
    if (literal) {
      // A Lua string cannot span lines in a claim table; a newline here means
      // the expression ran on and this is not a path.
      if (literal[2].includes('\n')) return undefined;
      out += literal[2];
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(piece);
    if (name) {
      const known = constants.get(piece);
      if (known === undefined) return undefined;
      out += known;
      continue;
    }
    return undefined;
  }
  return out;
}

/** `A .. "b" .. C`, split on `..` outside quotes and parentheses. */
function splitConcat(text: string): string[] {
  const masked = maskLuaCode(text);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '.' && masked[i + 1] === '.' && depth === 0) {
      parts.push(text.slice(start, i));
      i += 2;
      start = i;
      continue;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function stripTrailingComment(expr: string): string {
  const masked = maskLuaCode(expr);
  const dash = masked.indexOf('--');
  return dash >= 0 ? expr.slice(0, dash) : expr;
}

/**
 * Fill a table's string fields from the text it was written as.
 *
 * Only missing values are filled: a literal the reader already has is the
 * author's, and a nested table is resolved through its own text so
 * `hold = { sheet = SHEET }` works as well as `sounds = { SND .. "x.wav" }`.
 */
export function resolveTableStrings(
  table: LuaTable,
  tableText: string,
  constants: Map<string, string>,
): LuaTable {
  const masked = maskLuaCode(tableText);
  const open = masked.indexOf('{');
  if (open < 0) return table;
  const close = matchingBrace(masked, open);
  if (close < 0) return table;
  let index = 0;
  for (const [from, to] of topLevelFields(masked, open, close)) {
    const chunk = tableText.slice(from, to);
    const chunkMasked = masked.slice(from, to);
    const assign = /^[\s,]*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/.exec(chunkMasked);
    let key: string;
    let expr: string;
    if (assign) {
      key = assign[1];
      expr = chunk.slice(assign[0].length);
    } else {
      index += 1;
      key = String(index);
      expr = chunk;
    }
    const trimmed = expr.trim();
    if (!trimmed) continue;
    const nested = masked.slice(from + (chunk.length - trimmed.length), to).trimStart();
    if (trimmed.startsWith('{') && nested.startsWith('{')) {
      const existing = table[key];
      if (existing && typeof existing === 'object') {
        const nestedMasked = maskLuaCode(trimmed);
        const end = matchingBrace(nestedMasked, 0);
        resolveTableStrings(existing, trimmed.slice(0, end + 1), constants);
      }
      continue;
    }
    const value = resolveStringExpr(expr, constants);
    if (value === undefined) continue;
    const current: LuaValue | undefined = table[key];
    if (current === undefined || current === null) table[key] = value;
  }
  return table;
}

/** The `}` that closes the `{` at `open`, or -1. */
export function matchingBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The field ranges inside the table body: `[from, to)` pairs, splitting on `,`
 * at this table's own depth. A `,` inside a nested table or a string does not
 * split, which is why the split is done on the masked copy.
 */
function topLevelFields(masked: string, open: number, close: number): [number, number][] {
  const fields: [number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      fields.push([start, i]);
      start = i + 1;
    }
  }
  if (start < close) fields.push([start, close]);
  return fields.filter(([from, to]) => masked.slice(from, to).trim().length > 0);
}
