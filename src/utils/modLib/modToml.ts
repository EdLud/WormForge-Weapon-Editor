/**
 * Just enough TOML for a bundle manifest.
 *
 * `mod.toml` uses scalar keys, string arrays (`dependencies`), `[[components]]`
 * array-of-tables, `[sprites."path"]` sub-tables and inline tables for a
 * component's `default_position = { row = "F2", column = 1 }`. Nothing here needs
 * dates or multi-line strings, and a line it cannot read is skipped rather than
 * failing the whole bundle -- a manifest we mis-read is worse than one we
 * partly read, because the components are what matter.
 *
 * Three shapes need their own receiver because they belong to the component
 * block *above* them rather than to the document:
 *
 * - `[[components.options]]` / `[[components.weapon_options]]`, the settings
 *   `ctx.option(key)` reads at install (`components.rs`, `OptionDecl`);
 * - `[components.suggests."<feature id>"]`, a weapon's suggested value for a
 *   feature's per-weapon option;
 * - `[exports]`, the `wf-lib/<name>` module names a bundle provides for its
 *   dependents, which is how `require("wf-lib/…")` resolves at all.
 */

export type TomlValue = string | number | boolean | TomlValue[] | Record<string, unknown>;

export interface TomlDocument {
  /** Top-level scalars and arrays, plus `components` as an array of tables. */
  values: Record<string, TomlValue>;
  /** `[[components]]` blocks, in file order, each with its option tables. */
  components: Record<string, TomlValue>[];
  /** `[sprites."path"]` sub-tables, keyed by the sprite path. */
  spriteDecls: Record<string, Record<string, TomlValue>>;
  /** `[exports]`: public `wf-lib/<name>` -> bundle-relative `.lua` entry. */
  exports: Record<string, string>;
  /** Every `[section]` seen, so callers can tell an unknown manifest apart. */
  sections: string[];
}

function unquote(raw: string): string {
  const text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    const body = text.slice(1, -1);
    // Only the escapes a manifest realistically holds.
    return body.replace(/\\(["'\\nt])/g, (_, ch: string) =>
      ch === 'n' ? '\n' : ch === 't' ? '\t' : ch,
    );
  }
  return text;
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && quote === '"') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}

/**
 * Split on `sep` outside quotes and outside nested `[]` / `{}`. The array and
 * inline-table readers below both need it: a `,` inside a nested value is not a
 * separator, and a comma inside a string is not either.
 */
function splitTopLevel(body: string, sep: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaped = false;
  let depth = 0;
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && quote === '"') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseValue(raw: string): TomlValue {
  const text = raw.trim();
  if (text.startsWith('[')) {
    // `["a", "b"]`, possibly spread over lines (the caller joined them).
    const body = text.replace(/^\[/, '').replace(/\]$/, '');
    return splitTopLevel(body, ',').map(parseValue);
  }
  if (text.startsWith('{')) {
    // An inline table: `default_position = { row = "F2", column = 1 }`. A
    // bundle's panel position lives here, and reading it as one string is why
    // an imported pack put every weapon on its donor's slot.
    const body = text.replace(/^\{/, '').replace(/\}$/, '');
    const table: Record<string, TomlValue> = {};
    for (const part of splitTopLevel(body, ',')) {
      const at = part.indexOf('=');
      if (at < 0) continue;
      const key = unquote(part.slice(0, at));
      if (key) table[key] = parseValue(part.slice(at + 1));
    }
    return table;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return unquote(text);
}

/** `[[components]]`, `[sprites."a/b.png"]`, `[profile]` -> path segments. */
function splitSection(header: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of header) {
    if (quote) {
      if (ch === quote) {
        segments.push(current);
        current = '';
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '.') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

export function parseToml(source: string): TomlDocument {
  const doc: TomlDocument = {
    values: {},
    components: [],
    spriteDecls: {},
    exports: {},
    sections: [],
  };
  let component: Record<string, TomlValue> | null = null;
  let spritePath: string | null = null;
  let spriteTable: Record<string, TomlValue> | null = null;
  // The receiver of a `key = value` line: a component's own keys, one of its
  // `options` / `weapon_options` entries, its `suggests` table for one feature,
  // or the document's `[exports]` map.
  let optionTable: Record<string, TomlValue> | null = null;
  let suggestsTable: Record<string, TomlValue> | null = null;
  let exportsTable: Record<string, string> | null = null;
  // A `key = [ …` value can wrap; keep appending until the brackets close.
  let pending: { key: string; text: string } | null = null;

  const assign = (key: string, value: TomlValue) => {
    if (optionTable) optionTable[key] = value;
    else if (suggestsTable) suggestsTable[key] = value;
    else if (exportsTable) {
      const name = unquote(key);
      const target = typeof value === 'string' ? value : '';
      if (name && target) exportsTable[name] = target;
    } else if (component) component[key] = value;
    else if (spriteTable) spriteTable[key] = value;
    else doc.values[key] = value;
  };

  /** `[[components.options]]` appended to the component block it follows. */
  const componentOptions = (
    table: Record<string, TomlValue>,
    which: 'options' | 'weapon_options',
  ) => {
    if (!component) return null;
    const existing = component[which];
    const list = (Array.isArray(existing) ? existing : []) as unknown as Record<
      string,
      TomlValue
    >[];
    component[which] = list as unknown as TomlValue;
    list.push(table);
    return table;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const trimmedLeading = rawLine.replace(/^\s+/, '');
    if (!trimmedLeading || trimmedLeading.startsWith('#')) continue;
    const line = stripTomlComment(trimmedLeading).trimEnd();
    if (!line) continue;

    if (pending) {
      pending.text += ` ${line.trim()}`;
      if ((pending.text.match(/\[/g) || []).length <= (pending.text.match(/\]/g) || []).length) {
        assign(pending.key, parseValue(pending.text));
        pending = null;
      }
      continue;
    }

    const arrayHeader = /^\[\[(.+?)\]\]/.exec(line);
    if (arrayHeader) {
      const path = splitSection(arrayHeader[1]);
      doc.sections.push(path.join('.'));
      spriteTable = null;
      spritePath = null;
      suggestsTable = null;
      exportsTable = null;
      optionTable = null;
      if (path[0] === 'components') {
        // A nested array-of-tables belongs to the component before it, and must
        // not start a new component: `[[components.options]]` used to become a
        // phantom component and lose every option.
        const which = path.length === 2 ? path[1] : '';
        if (which === 'options' || which === 'weapon_options') {
          optionTable = componentOptions({}, which);
          continue;
        }
        if (path.length === 1) {
          component = {};
          doc.components.push(component);
          continue;
        }
      }
      // Anything else is a section this reader does not model.
      component = null;
      continue;
    }

    const tableHeader = /^\[(.+?)\]\s*(?:#.*)?$/.exec(line);
    if (tableHeader) {
      const path = splitSection(tableHeader[1]);
      doc.sections.push(path.join('.'));
      optionTable = null;
      suggestsTable = null;
      component = null;
      spritePath = path[0] === 'sprites' && path.length > 1 ? path.slice(1).join('.') : null;
      spriteTable = spritePath ? {} : null;
      if (spritePath && spriteTable) doc.spriteDecls[spritePath] = spriteTable;
      exportsTable = !spritePath && path[0] === 'exports' && path.length === 1 ? doc.exports : null;
      // `[components.suggests."<feature>"]` is the last component's own table.
      if (!spritePath && path[0] === 'components' && path[1] === 'suggests' && path.length > 2) {
        const last = doc.components[doc.components.length - 1];
        if (last) {
          const map = (last.suggests as Record<string, Record<string, TomlValue>> | undefined) ??
            ((last.suggests = {}) as Record<string, Record<string, TomlValue>>);
          suggestsTable = map[path.slice(2).join('.')] = {};
          component = last;
        }
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    // A dotted key belongs to a sub-table we do not model (`components.suggests`).
    if (!key || key.includes('.')) continue;

    const valueText = line.slice(eq + 1).trim();
    if (valueText.startsWith('[') && !valueText.includes(']')) {
      pending = { key, text: valueText };
      continue;
    }
    assign(key, parseValue(valueText));
  }

  return doc;
}
