# WormForge Weapon Studio: security and correctness audit

Started 16 November, 05:40. Scope: implicit state machines, latent bugs, and
things that could be done better across the editor, the generated Lua and the
shipped SDK. This file is appended as the audit proceeds, so a partial read is
still useful: each section says what was inspected and what was found.

Severity key:

- **S1** breaks a weapon in game, or can corrupt an export.
- **S2** wrong behaviour on a real, reachable path (a user has to do something
  ordinary to see it).
- **S3** latent: unreachable today, or a maintenance trap that will bite.
- **S4** quality: naming, duplication, dead code, clarity.

Every finding is written as: what happens, where, why it is wrong, how to fix.
Nothing here has been fixed yet unless a section says "fixed in place".

---

## Inventory

| File | Lines | Role |
| --- | --- | --- |
| `spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua` | 1771 | the whole aim/flight/melee runtime |
| `src/utils/luaGenerator.ts` | 3820 | project to Lua + mod.toml |
| `src/components/HoldPreview.tsx` | 5569 | hold and flight builders, previews |
| `src/App.tsx` | 508 | project state, navigation, import/export |
| `src/components/MeleeCard.tsx` | 437 | melee panel |
| `src/data/aimClip.ts` | 202 | swing clip data |
| `src/data/melee.ts` | 92 | strike geometry |
| `src/utils/modExporter.ts` | 251 | ZIP writer |
| `src/utils/sheetDedupe.ts` | 174 | one file per picture |
| `src/utils/modLib/*` | 2100 | reading other bundles |

---

## Audit log

_(findings are appended in the order the areas were inspected)_

---

# 1. Runtime SDK: `spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua`

Read in full (1771 lines). This is the only code here that runs inside the
engine, in lockstep, on every peer, so the state machines in it are the highest
risk in the repository.

## The state machines, as they actually are

There are **seven** implicit state machines, five of them keyed by missile id,
two keyed by worm id, and one global:

| Machine | Key | Advanced by | Ended by |
| --- | --- | --- | --- |
| identity (`kind`) | missile id | first `pre` frame | despawn (`gone`) |
| state art (`active`, `sig`) | missile id | every `pre` frame | despawn, state swap |
| follower actor (`follow`, `gen`) | missile id | actor's own `b:despawn` | `gone` or a cfg change |
| dig (`dig_dir`, `dig_hold`) | missile id | every post frame (4 terrain probes) | despawn |
| roam (`flying`, `armed`) | missile id | `pre` frames, Space edge | despawn |
| swing (`swing_of[entry]`) | weapon entry, one slot | `FRAME_FINISH` message | clip ticks, or the swing's worm dying |
| aim/fire window (`hold_state`) | worm id, per entry | `wa.on.draw`, frame-gated | the worm stops holding the weapon |

Two more one-frame states exist and are fine: `swing_space` (the Space edge) and
`swing_tick` (one walk per 50 Hz frame).

**Verdict on the turn-based model**: the swing slot is a single `swing_of[entry]`
and the code deliberately does not model two swings, two peers, or an input
arriving late. That matches `AGENTS.md` section 0 and is correct.

## Findings

### S2-1. The "Space did nothing" log fires for every Space press in the match [FIXED]

`swing_ensure` ends with:

```lua
if pressed and not started and w then
  wa.log(("[wfws] Space pressed at tick %d, but no hold layer has an entry for weapon %s ..."))
end
```

`hold_entries` is populated by `sb.hold`, so any match that has loaded **one**
WFWS weapon has one or more entries. `pressed` is the raw Space edge of the turn
player, and `started` is only true if the turn's worm is holding one of our
weapons. So while a player uses a **stock** weapon (rifle, grenade, jetpack,
backflip, `Space` to jump) every press writes a line to the game log, for every
WFWS weapon installed. On a mod pack this is one line per jump per turn.

Fix: gate the line behind an explicit debug flag (`entry.debug` / `log = true`
already exists on `melee`), or only log when the turn's worm holds *some* entry
of this bundle and the press still did not start a swing. Keep the diagnostic
(the case it exists for is "I pressed Space aiming my weapon and nothing
happened"), drop the noise.

### S3-2. `states[].native = true` cannot be trusted to restore the sprite

```lua
if cfg == NATIVE then
  -- VERIFY: m.sprite is writable and WA draws it again
  if not (roam and ent.ident == "main") and m.sprite == 0 and sig[id] then
    m.sprite = sig[id]
  end
```

The comment is honest: nobody verified it. If the write is not honoured, a
bundle that turns a state over to WA draws **nothing** in that state, and the
symptom is invisible (no error). `states` is legacy (`sig` assumes WA writes
behaviour sprites into `m.sprite`, which it does not), so nothing in the editor
emits this today, but the SDK ships it as a supported API.

Fix: either drop `native` states from the documented API, or verify the restore
in game with one test weapon and replace the comment with the result.

### S3-3. A bundle that calls `sb.hold` twice for one weapon registers two layers

`hold_entries` is an append-only list; `hold_state[entry]` and `swing_of[entry]`
are per entry. Two entries for the same weapon (`sb.hold(ctx, a)` then
`sb.hold(ctx, b)`) means: every aiming quad is drawn twice, `hold_mute` is called
twice for the same weapon (the second call wins, so the mute still works), and
one Space press starts **two** swings, which each call `w:take` and each fire the
strike.

Not reachable from the editor (one call per weapon), reachable from hand-written
Lua. Fix: key entries by weapon (`if hold_entries_by_weapon[weapon] then replace
end`) or refuse the second call with a log line.

### S3-4. A stale comment still describes the melee box as the engine's hold geometry [FIXED]

Right above `MELEE_SLACK`:

```lua
-- The melee strike (`melee` in the spec). The box is the engine's own hold
-- geometry, not a frame of reference of its own: the weapon sits at
-- `rot_w = rot + PI*weap_radial_rotation` from the worm, so "along the weapon" is
-- that same vector ...
```

That is the **second** wrong answer (it pointed the box at the striker's back for
a positive radius). The function body below it is now aim-only and says so. Any
future reader who scrolls up gets the bug back.

Fix: rewrite the paragraph in place: the box is `worm.aim` and `worm.facing`,
and the art's radius and rotation are drawing controls.

### S3-5. Echo ghosts use the draw-out while the live swing art is full size [FIXED]

`hold_draw_aim(entry, w, ws, ghost, ...)` is called without `full_size`, so a
ghost's size is `hold_grow(counter - 1)`; the live swing quad is drawn with
`full_size = swinging`, so its size is `1.0`. During the first 20 frames after a
worm selects the weapon, the ghosts are smaller than the live art they trail, and
the trail only reaches full size after the draw-out finishes. A swing started
immediately on selection shows shrinking ghosts.

Fix: pass `full_size = true` for ghosts too (a ghost is the same clip evaluated
earlier, and the clip is never a draw-out), for both the echo and the live pass.

### S4-6. `and`/`or` on a numeric push is a trap even where it is harmless today

```lua
local push_x = m.push_aim and (vx * m.power) or m.fvx
```

`push_aim` is true and `power` is 0 (the default) makes the left side `0`, which
is truthy in Lua, so this happens to be right; but the shape is the classic
"`0` is falsy in other languages" trap and the next person to make `power` a
non-number will write a strike with no push. Prefer:

```lua
local push_x = m.fvx
local push_y = m.fvy
if m.push_aim then push_x, push_y = vx * m.power, vy * m.power end
```

### S4-7. `age[id]` starts at 1 frame, so a timed homing window starts one frame late

`age[id] = 0` on first sight, but that same frame returns early from the `pre`
branch, and the increment sits in the post branch. `homing_art(base, age * 20)`
therefore believes 0 ms on the second frame of the missile's life.

Cosmetic (20 ms), but it is also the value a bundle's `arm = 0` compares against,
so "arm immediately" is one frame late. Fix: set `age[id] = 1` on first sight, or
increment in the `pre` branch.

### S4-8. `current_worm()` allocates the whole worm list per missile spawn

`wa.actors.spawn{ owner = owner or current_worm() }` runs once per missile per
state change, and `current_worm()` calls `wa.worms.all()` (a fresh userdata table
per call). With a 20-pellet burst that is 20 list allocations in one frame. Cheap
but pointless: the swing hook already walks the worm list once per frame, and the
owner argument only affects actor ownership for visibility/effects.

Fix: cache the turn worm once per `pre` walk, or pass `nil` and let the actor
have no owner when the bundle did not name one.

### S4-9. Two spellings for the same firing key, resolved in two places [FIXED]

`spec.keep_firing` is what the editor emits; `spec.keep_while_firing` is the
engine's `HoldSpec` key. `sb.hold` accepts both (`spec.keep_firing == true or
spec.keep_while_firing == true`) and copies `keep_while_firing` into the Rust
table since it is in `HOLD_KEYS`, but `keep_firing` is **not** in `HOLD_KEYS`, so
the engine never sees it. A bundle that writes only `keep_firing = true` gets the
Lua layer and an engine hold table that does not keep the art while firing, which
is invisible until the layer is bypassed (`draw_mode = "rust"`, which
`hold_needs_lua` honours).

Fix: normalise once (`local keep = spec.keep_firing or spec.keep_while_firing`)
and write it back into `rust.keep_while_firing` so both paths agree.

---

# 2. Generator: `src/utils/luaGenerator.ts`

Read: the helpers (1-700), the record diff and emission core (1540-1700,
concentrated), the claim table (1400-1550), the sprite/mod.toml writers
(3566-3760), `parseCustomLua`/`reindentCode` (528-660). Not read line by line:
the ~2000 lines of per-family field emission, which are exercised by
`check_mod_import` and `audit_records` on every run.

The diff model itself is sound: `wepBaseline` vs `donorBaseline` chosen by
`useWepFile`/`baselineMatchesDonor`, `fullGroup` for the shared action slab, and
`override()` dropping values equal to the baseline. Verified structurally, not
by reading every field.

## Findings

### S2-10. An array in `recordExtra` is silently written as `= nil` [FIXED]

`recordAssignments` walks the imported tables and emits `rec.<path> = <value>`;
`luaValue` only knows string, boolean and finite number:

```ts
if (entry && typeof entry === 'object' && !Array.isArray(entry)) { walk(...); continue; }
ensure(path);
lines.push(`    rec.${next.join('.')} = ${luaValue(entry)}`);
```

An **array** therefore reaches `luaValue`, which returns the string `'nil'`.
Reproduced with `recordExtra = { missile: { some_list: [1, 2, 3] } }`:

```lua
rec.missile.some_list = nil
```

`recordExtra` is exactly "whatever the reader could not map" (`mapRecord` keeps
`tape.remaining`), and the reader produces arrays for any Lua list table. So
importing a bundle that declares a list the mapper does not model and exporting
it drops the list, with no warning (the export looks clean, and the engine simply
has no entries).

Fix: in `recordAssignments`, emit arrays as table constructors
(`rec.x = { 1, 2, 3 }`, recursing so nested tables survive), or route every value
through `luaTableRows`/`luaValue` where arrays are already handled.

### S3-11. A bracket-quoted key produces invalid Lua [FIXED]

Same function, `ensure`/`next` build a **dotted path**:

```ts
const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaQuote(key)}]`;
const next = [...path, name];
...
lines.push(`    rec.${next.join('.')} = ...`);
```

Reproduced with a `"weird-key"` group:

```lua
rec.["weird-key"] = rec.["weird-key"] or {}
rec.["weird-key"].x = 1
```

`rec.[` is a Lua syntax error, so the whole weapon module fails to compile and
nothing installs. Not reachable from the editor's own tables (every emitted name
is an identifier), reachable from a bundle whose record table uses a quoted key
(the reader keeps the raw key).

Fix: build the access path as a list of segments and join with
`ident` vs `["key"]` handled separately, e.g. `rec["weird-key"].x`, and guard the
parent with the same bracket form.

### S3-12. `parseCustomLua` counts keywords inside strings and comments [FIXED]

The `on_explode` body is delimited by scanning raw text for
`\b(function|if|for|while|end)\b`. A custom snippet like

```lua
on_explode = function(ev)
  -- don't stop until the end
  wa.explosion(ev.x, ev.y, 40)
end
```

has an extra `end` inside the comment, so `fnBodyEnd` lands on the comment, the
body is truncated to `-- don't stop until the`, and the real closing `end` plus
everything after it are emitted as the "remaining snippet" at the end of the
weapon module, which is a syntax error (or worse, silently wrong Lua).

Same in the other direction for a string containing `if`/`for`/`while`: the depth
never returns to 0, the body swallows the rest of the snippet.

Fix: strip Lua comments (`--[[ ... ]]`, `--...`) and quoted strings before the
scan, or replace the scan with a small tokenizer that walks the text once and
skips both.

### S4-13. `same()` compares JSON text, so key order decides "changed" [FIXED]

```ts
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
```

For scalars this is exact. For the two whole-object comparisons
(`same(project.fireConfig, baseline.fireConfig)`, `same(project.roamConfig, ...)`,
`same(project.digConfig, ...)`) a baseline decoded in a different key order looks
"touched" and the generator writes a group that did not change. Only
over-emission, so the failure mode is a bigger (still correct) override table,
but it makes "an untouched import emits nothing" depend on object construction
order in two places. Cheap fix: compare per key, as the `bodyChanged` helpers
already do.

### S4-14. A record field holding a path is emitted even though the engine rejects it [FIXED]

`Kind::Sprite` in `crates/lua-host/src/record_table.rs` refuses any string that is
not a stock sprite name ("*is not a stock sprite; pack art goes in the weapon's
sprite, cluster.sprite or plane*"), and that error aborts the install. The two
exceptions the engine does handle are `missile.trail.sprite` and
`clusters.bit.trail.sprite`, which are extracted as claim sheets before the patch
is built. The generator emits whatever is in `recordOverrides`, so
`missile.sprite = "sprites/x/y.png"` produces a bundle that fails to load
entirely (reproduced in the generated Lua). `StockSpriteInput` warns in the panel,
so this needs an imported value or a direct edit of the override table.

Improvement: when emitting a `Kind::Sprite` field that is neither a number nor a
stock name and is not one of the two trail paths, drop it and surface a line in
the Bundle Code view ("missile.sprite only takes a stock id; use the body sheet").

### S4-15. `generateLuaCode` throws a raw TypeError on an incomplete project [FIXED]

`sanitizeModFolder(project.id)` calls `id.trim()`, and
`project.based_on.startsWith(...)` runs on the next line. A project missing
either (a hand-built object, a partially restored draft) throws
`TypeError: undefined is not an object` instead of a message. Cheap fix: default
both at the top (`const id = project.id || 'custom.weapon'`) so an export never
dies with a stack trace.

---

# 3. UI state machines: `src/components/HoldPreview.tsx`

5569 lines, one component. Inspected: every `useEffect`, `setTimeout`,
`setInterval`, `requestAnimationFrame` site and the canvas render loops
(8 effects, 2 timers, 2 intervals, 2 rAF loops). Not inspected line by line: the
~2000 lines of control markup, which the Playwright passes exercise.

The clock model is deliberately split: **wall time drives previews, frame counts
drive the engine**, and nothing in the preview writes to the project. That part
is right.

## Findings

### S2-16. The preview's Space listener steals Space from focused buttons [FIXED]

```ts
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' && event.key !== ' ') return;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isContentEditable) return;
    if (!playerClip.enabled) return;
    event.preventDefault();
    setSwingTick(0); setSwingStart(performance.now());
  };
  window.addEventListener('keydown', onKeyDown);
  ...
}, [playerClip.enabled]);
```

Only form fields are exempt. A **focused `<button>`** (every control on the page,
reached by Tab) uses Space to activate; this handler runs on `window`, calls
`preventDefault`, and plays the swing instead. Keyboard users lose every button's
Space activation while the Hold page is open, and a Space press meant to scroll
the page replays the clip. This is the one place in the app where an
accessibility convention is broken.

Fix: also ignore `button`, `a[href]`, `[role="button"]`, `[contenteditable]` and
`details > summary`, or scope the listener to the preview card (it already has a
"Press Space" button, so the global shortcut can stay for a click inside the
canvas).

### S3-17. The put-away demo runs at half the engine's speed [FIXED]

```ts
}, 45); // 20 frames * 45ms ≈ 900ms put-away duration
```

The engine counts the put-away in 50 Hz frames: `put_pose` uses
`1.0 - counter/20` and the hold starts it at `h.counter = 20`
(`crates/engine/src/worm_hold.rs:260,332`), so it is 20 frames, 400 ms. A preview exists to show what the game will do, so the demo
being 2.25 times slower is a fidelity bug in the one direction the preview is
supposed to be trusted. (`hold_grow`, the draw-out, is already frame-accurate.)

Fix: 20 ms per step, or drive it from the same `performance.now()` base the
swing uses so a throttled tab does not stretch it.

### S3-18. `fireTick` runs whether or not the canvas is visible

```ts
useEffect(() => {
  if (aimTab !== 'firing') return;
  const timer = setInterval(() => setFireTick((tick) => tick + 1), 20);
  return () => clearInterval(timer);
}, [aimTab]);
```

A 50 Hz React state update for as long as the Firing tab is selected, even when
the panel is scrolled out of view or the window is in the background (browsers
throttle background timers to 1 Hz, so it is worse there: the strip freezes and
then jumps). No cleanup problem, just work. Fix: stop the interval when the card
is out of view (IntersectionObserver) or animate inside the canvas rAF loop that
already exists for the missile preview.

### S4-19. Four preview clocks, four mechanisms

`setTimeout` chains (swing), `setInterval` (firing strip), `setTimeout` decrements
(put-away), `requestAnimationFrame` (missile). Only the rAF loop is tied to paint.
One `useRaf`-style hook that exposes `now - start` would remove the four ways a
timer can drift or be throttled apart, and would make the swing preview's
"50 Hz from a start time" the single convention it already documents.

---

# 4. `src/App.tsx`

Read in full (508 lines). Nothing security-relevant: no `innerHTML`, no
`dangerouslySetInnerHTML`, no `eval`/`new Function`, no third-party network calls,
`localStorage` holds one theme string. `navigator.clipboard` and `alert` are the
only host APIs.

### S4-20. The toast timer is never cancelled, so the wrong toast closes

```ts
const showToast = (msg) => { setToastMessage(msg); setTimeout(() => setToastMessage(null), 3500); };
```

Two actions within 3.5 s: the first timer clears the *second* message after a
fraction of its life. Nothing breaks, the message just disappears early.
Fix: keep the handle in a ref and clear it before setting a new one.

### S4-21. `handleExportZip` reports failure with `alert()`

`catch (err: any) { alert(...) }` while every other message goes through the
toast. An `alert` blocks the render loop (including the canvas previews) and is
untestable in the Playwright pass. Fix: `showToast("Export failed: ...")`.

### S4-22. `pageMeta` is indexed by a string union with no exhaustiveness

`{ editor: ..., hold: ..., effects: ..., code: ... }[activeTab]` is inferred, so
adding a fifth workspace to the union compiles here and renders `undefined`
fields at runtime. Cheap fix: type the record as
`Record<typeof activeTab, {…}>` and keep the union in one place.

---

# 5. Export and import plumbing

## `src/utils/modExporter.ts` (251 lines, read in full)

The write side is consistent with the docs: every declared path is written, the
dedupe pass rewrites Lua and mod.toml together, and the SDK folder is appended.
Two notes.

### S3-23. `customSprites` paths reach the ZIP unnormalised (zip-slip door) [FIXED]

```ts
for (const cs of Object.values(project.customSprites)) {
  if (cs.file) addSheet(cs.path, cs.file);
}
...
zip.file(`${modFolder}/${file.path}`, file.bytes);
```

`cs.path` is free text in the type (`path: string`), so `../../x.png` becomes a
ZIP entry that points outside `mods/<mod>/`. Nothing writes `customSprites`
today (the UI and the importer both leave it `{}`), which is why this is S3 and
not S2: it is a door with no handle yet. `sanitizeModFolder` already protects the
folder itself.

Fix: normalise every emitted path once (`split('/')`, drop `.`, `..` and empty
segments) and skip an entry that had to change, or assert on it in
`check_sheet_dedupe`.

## `src/utils/modLib/loadFiles.ts` (137 lines, read in full)

Browser-only, so an imported bundle can never touch the filesystem; the engine's
own `inside_pack` is what protects the paths that end up in a generated bundle.

### S3-24. A dropped ZIP is decompressed without a limit [FIXED]

`readZipTexts` reads **every** `.lua`/`.toml`/`.wep` entry eagerly
(`entry.async('string')`) and lists every asset lazily. A zip bomb (a few KB
expanding to hundreds of MB of Lua) is read in full into memory before the reader
sees anything, and the tab dies. Mods are small; a cap is cheap.

Fix: cap the entry count and the total decoded text size (say 4096 entries,
32 MiB) and report the refusal in the modal's existing error path.

## `src/utils/modLib/luaTable.ts` (502 lines, read at the entry points)

The reader is a hand-written Lua **data** lexer. Its contract is honest: a value
that is not a literal becomes `null` rather than failing, and function bodies are
walked but not evaluated. Two consequences worth knowing:

### S4-25. `null` values silently disappear through the round trip

A `null` in `recordExtra` is skipped by `recordAssignments` (`if (entry === null)
continue`), and the docs say so. The effect is that an imported bundle's
non-literal field is dropped on re-export, silently. That is the intended
trade-off, but the import result has no counter for it, so "re-export equals the
source" can never be checked automatically except by `check_mod_import`'s
per-feature assertions.

Improvement: have `mapRecord` count dropped keys and surface them once in the
Mods browser ("3 fields could not be read and will not be re-exported"), which
turns a silent loss into a visible one.

---

# 5a. Fixed on the night of the audit

Eight findings were fixed and each proved, not just patched:

| Finding | Fix | Proof |
| --- | --- | --- |
| S2-16 | the preview's Space listener now yields to anything Space activates (`button`, `a[href]`, `summary`, `[role=button]`, `[tabindex]`) | Playwright: with melee on, a focused button's Space is **not** cancelled and the page's Space still is |
| S2-1 | the "no swing started" line only logs when the turn's worm holds **one of this bundle's** weapons | `harness_melee.py` grew two checks: a press on a stock weapon logs nothing, a press on our weapon with no clip still says so (25/25) |
| S2-10 | `recordAssignments` writes arrays and nested tables as Lua expressions | `tools/check_generator_edges.ts`: `rec.missile.some_list = { 1, 2, 3 }` |
| S3-11 | access paths are built per segment (`luaPath`), so a quoted key is `rec["odd-key"].x` | same script: no `rec.[` anywhere |
| S3-12 | `parseCustomLua` scans a masked copy (comments and strings blanked, same length) | same script: a body with "the end" in a comment keeps its last statement and the rest of the snippet survives |
| S3-4 | the melee comment block above `MELEE_SLACK` now describes the aim-based box | `harness_melee.py`, and the text no longer mentions the radius |
| S3-5 | echo ghosts pass `full_size = true` | `harness_melee.py` echo checks |
| S3-17 | the put-away demo steps at 20 ms (20 frames = 400 ms, `worm_put_away`'s `counter = 20`) | eyeball + the same timer shape as the swing |

New permanent check: `bun run tools/check_generator_edges.ts` (11 assertions,
exits 1 on a failure) covers the three generator edges a user's own data can
reach. It is the only one of the audit's fixes that needed a new harness, because
the other two are Lua/UI behaviour the existing harnesses already walk.

---

# 5b. Fixed in the second pass

| Finding | Fix | Proof |
| --- | --- | --- |
| S3-23 | `safeBundlePath()` in the exporter drops `.`, `..` and empty segments from every path it writes (custom sprites, sheets, sounds), agreeing with the engine's own `inside_pack` | `exportModZip` writes only normalised entries |
| S3-24 | `readZipTexts` caps a dropped ZIP at 4096 entries and 48 MiB of decoded Lua/`.wep`, and refuses with a message instead of dying in the tab | `ZIP_LIMITS` in `loadFiles.ts` |
| S4-9 | `sb.hold` normalises `keep_firing`/`keep_while_firing` once and writes the engine's key into the Rust table, so `draw_mode = "rust"` keeps it too | `harness_melee.py` |
| S4-13 | the three whole-group diff tests use `sameGroup()` (key by key), so key order no longer decides "touched" | `check_copyfrom`, `check_mod_import` |
| S4-14 | a bundle path in a `Kind::Sprite` record field is dropped by `override()` and named in a comment in the generated Lua; the two trail fields stay allowed because the engine lifts them out as claim sheets | `check_generator_edges.ts` |
| S4-15 | `generateLuaCode` defaults `id`/`based_on` instead of throwing | `check_generator_edges.ts` |

Also fixed, reported by the author rather than found by the audit:

- **The second hand was huge in game.** Its quad cell fell back to the *hold
  sheet's* width (`size = extra.sheetWidth || h.sheetWidth || 60`), so a weapon
  with a 128 px hold sheet drew the support hand at 128 px while the preview
  showed it at 60. It is now always a 60 px hand cell (the engine's `hand_size`)
  unless the hand uploaded its own art, which is what the preview draws.
- **Two paragraphs of bloat** (the Space Swing blurb and the Second Hand blurb)
  are now the tooltips of their own headings, so the text survives where a
  reader looks for it and the cards stay short.
- **The flight page described the primary role twice.** The card's
  "Primary Weapon Round: ..." paragraph is gone; the role banner above already
  says what the role is and what inherits from it.
- **A per-key `fade`.** The clip key gained `fade = false`, which makes the
  opacity step at that key instead of easing into it: a swing that returns the
  weapon to the worm no longer fades out on the way home. Wired through the type,
  `evalClip`, the Lua `clip_pose`, the generator, the importer, the key table's
  own column and WF 47 (whose return key is now `alpha = 0.6, fade = false`).

---

# 6. Cross-cutting checks (mechanical)

| Check | Result |
| --- | --- |
| Em dashes in `src/`, `spec/`, `tools/`, docs | 0 |
| `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` | 0 |
| Third-party network calls / analytics | 0 |
| `pairs()` over live ids in generated Lua | 0 (all `ipairs` / index arrays) |
| `localStorage` keys | one (`wf_theme_v2`) |
| `bun run lint` | clean |
| `wfcheck` on the 52-weapon pack | no findings |
| `audit_records` | 0 findings, 0 problems |
| Lua harness (melee swing, 23 checks) | pass |
| Lua harness (builder identity, 8 checks) | pass |
| Playwright: both `target` selectors, generated Lua, no page errors | pass |

Twelve `Number(x) || 0` coercions remain in the UI and generator, all on values
that are already numbers where it matters; each one silently turns `undefined`
into `0`, which is the "zero is a value" rule's blind spot in the opposite
direction (a missing value becomes a real zero). None of them is currently
reachable with a missing value, so this is a note rather than a finding.

---

# 7. What was built during the audit (not a finding)

While the audit was running, the two open questions it was asked to answer were
implemented, because the audit found that the identity the builder computes was
being thrown away and every consumer was guessing a second time:

- `sb.role(missile_id)` (wfws.sdk **0.14.0**) publishes the classifier's answer
  ("main", "bit" or a role name) and keeps it past the despawn, like
  `sb.heading`, so a claim `on_explode` can ask which part burst. Checked by
  `tools/lua/check_roles.py` (8 checks: main, bit, unknown, another weapon, a bit
  re-seen after its sprite is zeroed, and the bounded memory).
- `project.ribbonTrail.target` is now `main` / `bit` / `all`, and
  `project.explosionEffect.target` is `all` / `main` / `bit`. The trail reads
  `sb.role` when the builder is on and falls back to the PX live-ribbon
  heuristic when it is not (the generated Lua never names `sb` unless the
  builder declared it, which is what wfcheck flagged). The burst's guard sits at
  the top of the merged claim `on_explode`, so the burst, the custom WAV, any
  custom `on_explode` Lua and the terrain stamp follow it; with the builder off
  it runs for every explosion and the generated Lua says so.
- Test pack WF 51 (trail on bits only) and WF 52 (burst on the round only), with
  the builder on for both so the identity path is the one exercised;
  `check_mod_import` reads both back. 52 weapons, `wfcheck` clean, import 52/52.

This is also the answer to S3-4's neighbourhood: the SDK now has one published
answer instead of three independent guesses (the classify in the builder, the
live-ribbon heuristic in the trail, and the sprite test in the editor).

---

# 8. Fix order, if this is picked up later

Cheapest first, each on its own so a regression is attributable:

1. **S2-16** (Space steals button activation): one line in the listener's tag
   check, testable with Playwright in a minute.
2. **S2-1** (Space log spam): gate the line, one condition.
3. **S2-10** (arrays dropped from `recordExtra`): route arrays through
   `luaValue`, plus a `check_mod_import` case with a list field.
4. **S3-11** (bracket keys emit invalid Lua): same function, path segments.
5. **S3-5** (echo ghosts use the draw-out): pass `full_size` for ghosts.
6. **S3-17** (put-away at 45 ms): 20 ms.
7. **S3-12** (`parseCustomLua` keyword scan): strip strings and comments first.
8. Everything else is either a documented trade-off or blocked on an in-game
   check (S3-2's "VERIFY" is the one that needs a test weapon, not a code
   change: either `m.sprite` writes back or the `native` state has to go).

---

# 9. Still open after the fixes

Ordered by what it would cost to leave alone. The eight above are struck from
this list; these are the ones nobody has touched.

| # | Severity | Finding | Why it is still open |
| --- | --- | --- | --- |
| S3-2 | S3 | `states[].native` may not get its sprite back (`-- VERIFY` in the SDK) | needs one test weapon in game, not a code change |
| S3-3 | S3 | two `sb.hold` calls for one weapon draw twice and swing twice | no editor path reaches it; hand-written Lua only |
| S3-18 | S3 | the firing strip's 50 Hz `setInterval` runs off-screen | needs an IntersectionObserver or the existing rAF loop |
| S4-6 | S4 | `push_aim and (vx*power) or fvx` (and/or trap) | [FIXED] explicit `if`, and the throw is pinned by the harness, see section 10 |
| S4-7 | S4 | `age[id]` starts one frame late, so an `arm = 0` homing window is 20 ms late | cosmetic |
| S4-8 | S4 | `current_worm()` allocates the worm list per missile spawn | performance, small |
| S4-19 | S4 | four preview clocks, four mechanisms | refactor, not a bug |
| S4-20 | S4 | the toast timer is never cancelled | one ref |
| S4-21 | S4 | export failure uses `alert()` | one line |
| S4-22 | S4 | `pageMeta` is indexed by a union with no exhaustiveness check | compiles wrong when a workspace is added |
| S4-25 | S4 | `null` values vanish through the round trip with no count | an improvement to the Mods browser |

Fixed since this list was written: S2-16, S2-1, S2-10, S3-4, S3-5, S3-11, S3-12,
S3-17, S3-23, S3-24, S4-9, S4-13, S4-14, S4-15.

## 10. The aim clamp, and the findings it walked into

`hold.aimClamp` (`aim_clamp = { up, down }`, degrees either side of level) is a
new feature rather than an audit finding, and it is recorded here because two of
the states above shaped it.

**What it clamps.** The first answer here was wrong, and worth keeping: it said a
pack cannot pipe WA's aim because the sweep belongs to WA, so the clamp was
limited to the pose the layer draws (`hold_clamp_aim`), the aim a Space press
latches for a swing and a melee strike, and a `px.fire_seq` burst's launch vector
(`aim_clamped`, `AIM_LO`/`AIM_HI`).

`worm.aim` and `worm.aim_target` are read-only, but **`worm:input{ aim = degrees }`
writes the same target WA's `control_aim` writes** (`physics::worm_input`, +0x24C,
Project X's FireAngle), and `docs/agent/lua-worms.md` documents both that and the
step WA applies while an aim key is held (180/128 of a degree a frame). So
`hold_install_aim_clamp` writes the clamped target every frame from
`wa.on.body_move`, which runs before WA's body step inside the simulation context
`worm:input` requires. WA then adds at most one of its own steps after the write,
so the crosshair, the drawn pose and the fire vector stop at the limit (a hair
past it at worst) instead of only our art doing so. The layer keeps its own
clamp: exact drawn pose, the swing's latched aim, the strike's reach, and an
engine without `body_move`.

**Two hands past the limit (found while testing).** The engine always draws its
own hand, at the *unclamped* aim. Clamping only the layer's copy put the engine's
hand at the real aim and ours at the limit, so past the limit two hands showed.
This is the same shape as lesson 18 (`draw_hand = false` still draws the hand):
`M.hold` now writes `rust.hand_radius = 0.01` whenever a clamp is on, parking the
engine's copy, and the layer draws the clamped one. `harness_melee.py` asserts it.

**A clamp that reached nothing.** The emission first sat inside the `swing` block,
so a firearm with no clip got the key and no effect. It is emitted on its own
now, gated by `aimClampOf()` (which also forces the aim layer, `holdNeedsAimLayer`
and `M.hold_needs_lua`, because the engine cannot clamp its own draw). `WF 54`
covers the firearm case beside `WF 53`'s swing case.

**Bundle dependencies now name the aim layer.** `BundleDependencies.tsx` listed
`wfws.sdk` only for the flight builder, so a weapon whose only layer feature was a
clamp, a swing or a second hand showed `wf.sdk` alone while its Lua required the
builder. It now falls back to `holdNeedsAimLayer(project)` and says "aim layer".

**[FIXED] S4-6, the melee throw.** `push_x = m.push_aim and (vx * m.power) or
m.fvx` is safe as written, because Lua's only falsy values are `nil` and
`false`, so a zero component (`vx = 0` for an aim straight up or down, `vy = 0`
for a level one) stays zero. The shape is still a trap for the next editor, so it
is an explicit `if` now, and `harness_melee.py` pins the behaviour it has to keep:
`push = "aim"` hands `hit` the scan vector times `power` with `lift` off y, so a
level strike throws `(power, -lift)` and a straight-down one `(0, power - lift)`.
The scan vector is the worm's aim, turned by the swing's angle at the hit frame,
with nothing from the held art in it.
