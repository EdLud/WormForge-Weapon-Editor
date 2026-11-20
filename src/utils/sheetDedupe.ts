/**
 * One PNG per picture, however many roles use it.
 *
 * A weapon's sheets are declared one path per role (`hold.png`, `missile.png`,
 * `bit_flight.png`, `state_homing.png`, `state_roam.png`, …), and most of them
 * resolve to the same fallback art when the author uploaded nothing. Writing and
 * declaring six copies of one PNG costs GPU atlas space for nothing: WA binds
 * every declared sheet, and the same pixels bind six times under six ids.
 *
 * Two sheets share a file only when **all** of these are true:
 *
 *  - the bytes are identical (a real comparison, not a name or size guess);
 *  - `mod.toml` slices them into the same number of frames, because the engine
 *    cuts a strip by the declared `frames`;
 *  - when that count is more than one, the rest of the declaration too (`fps`,
 *    `play`). `[sprites."path"]` is one table per path, so it carries one speed
 *    for every role that names it: two roles that want the same strip at
 *    different speeds are two sheets, and merging them would retime one.
 *
 * A one-frame sheet is the exception the fallback art lives on: it has nothing to
 * animate, so `fps`/`play` cannot change what is drawn and the kept declaration
 * serves both.
 *
 * The alias is applied to the generated Lua and `mod.toml` afterwards, so the
 * paths those files name are the paths the ZIP actually carries.
 */

/**
 * The claim's `sprites = { "a", "b" }` list goes through the same rewrite, so an
 * aliased role repeats the kept path. A repeat is noise (and binds the sheet twice
 * in a claim that counts entries), so the list keeps one entry per picture.
 */
function splitSpriteListItems(body: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < body.length) {
        current += body[i + 1];
        i += 1;
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
    if (ch === ',') {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) items.push(tail);
  return items;
}

export function compactSpriteLists(text: string): string {
  return text.replace(/sprites = \{([^}]*)\}/g, (whole, body: string) => {
    const items = splitSpriteListItems(body);
    if (items.length === 0) return whole;
    const unique = items.filter((item, index) => items.indexOf(item) === index);
    if (unique.length === items.length) return whole;
    return `sprites = { ${unique.join(', ')} }`;
  });
}

/** 64-bit FNV-1a over the bytes, as hex: good enough to group, exact by compare. */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash ^ BigInt(bytes[i])) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16);
}

/** The `[sprites."path"]` block `mod.toml` declares for a sheet, if any. */
export function spriteDeclaration(modToml: string, path: string): string {
  const header = `[sprites."${path}"]`;
  const at = modToml.indexOf(header);
  if (at < 0) return '';
  // The rest of the header's own line is empty; the keys start on the next one.
  const rest = modToml.slice(at + header.length).split('\n').slice(1);
  const body: string[] = [];
  for (const line of rest) {
    const trimmed = line.trim();
    if (trimmed === '') break;
    if (trimmed.startsWith('[')) break;
    body.push(trimmed);
  }
  return body.join('\n');
}

export type SheetEntry = { path: string; bytes: Uint8Array };

/** How the engine cuts this sheet: the declared `frames`, else one. */
export function sheetFrames(modToml: string, path: string): number {
  const frames = /^frames\s*=\s*(\d+)$/m.exec(spriteDeclaration(modToml, path));
  const value = frames ? Number(frames[1]) : 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Group the sheets, keep one file per group and return the alias for the rest.
 * The first path of a group is the canonical one, which is also the one the
 * generator named first (`hold.png` before `missile.png`).
 */
export function dedupeSheets(
  sheets: SheetEntry[],
  modToml: string,
): { files: SheetEntry[]; alias: Map<string, string> } {
  const files: SheetEntry[] = [];
  const alias = new Map<string, string>();
  const byKey = new Map<string, SheetEntry>();
  for (const sheet of sheets) {
    const frames = sheetFrames(modToml, sheet.path);
    // Playback only matters for a strip; one frame cannot animate.
    const playback = frames > 1 ? spriteDeclaration(modToml, sheet.path) : '';
    const key = `${hashBytes(sheet.bytes)}\u0000${frames}\u0000${playback}`;
    const kept = byKey.get(key);
    if (!kept) {
      byKey.set(key, sheet);
      files.push(sheet);
      continue;
    }
    // Same picture, same declaration: point the duplicate at the kept path.
    if (kept.bytes.length === sheet.bytes.length) {
      let same = true;
      for (let i = 0; i < kept.bytes.length; i += 1) {
        if (kept.bytes[i] !== sheet.bytes[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        alias.set(sheet.path, kept.path);
        continue;
      }
    }
    // A hash collision is not a reason to lose a sheet.
    files.push(sheet);
  }
  return { files, alias };
}

/**
 * Rewrite the quoted paths in the generated Lua and `mod.toml`. Only the whole
 * quoted token is replaced, so `state_homing.png` can never rewrite the start of
 * `state_homing_bit.png`.
 */
export function applySheetAliases(text: string, alias: Map<string, string>): string {
  let out = text;
  // Longest first, so a path that contains another is never left half-rewritten.
  const paths = [...alias.keys()].sort((a, b) => b.length - a.length);
  for (const from of paths) {
    const to = alias.get(from)!;
    out = out.split(`"${from}"`).join(`"${to}"`);
    out = out.split(`'${from}'`).join(`'${to}'`);
  }
  return out;
}

/**
 * A repeated `[sprites."…"]` table is invalid TOML: the engine's reader keeps
 * whatever the second section leaves, and a sheet whose declaration is lost fails
 * in `wa.on.draw` ("error converting Lua nil to table"). Aliasing can bring two
 * declarations of one file together, so exactly one survives, the first one.
 */
export function collapseSpriteSections(modToml: string): string {
  const lines = modToml.split('\n');
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\[sprites\."(.+)"\]$/.exec(lines[i].trim());
    if (!match) {
      out.push(lines[i]);
      continue;
    }
    const started = out.length;
    out.push(lines[i]);
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('[')) {
      out.push(lines[i]);
      i += 1;
    }
    i -= 1;
    if (seen.has(match[1])) {
      out.length = started;
      // Keep the blank line that separated the sections.
      while (out.length > 0 && out[out.length - 1] === '') out.pop();
      out.push('');
      continue;
    }
    seen.add(match[1]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
