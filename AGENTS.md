# AGENTS.md, WormForge Weapon Studio

This file is the hand-off memory for anyone (human or agent) maintaining this
repository. It records what the app does, how it is wired, the engine rules the
UI has to obey, the validation recipes, and the mistakes already paid for.

**Canonical location:** `C:\Users\lucia\Documents\GitHub\WormForge Weapon Editor`
(this repository). The older copy at
`...\Worm-Forge-Lua-Editor\WormForgeWeaponEditor` is a duplicate and must not be
edited.

---

## 0. Read this first: the engine is turn based and lockstep

Worms Armageddon is a turn-based game, and WormForge runs it as a deterministic
lockstep simulation. Everything below follows from that, so start here:

- **One worm acts at a time.** It has the turn, its player's keyboard is the only
  input, and `wa.world.keys()` is that player's synchronised state (`space`,
  `digit`, the arrows), identical on every peer. There is no second shot, no
  second swing and no second aim in flight at the same time: a worm cannot fire
  while another fires, and the turn's worm is the only one pressing anything.
- **Do not write code for what cannot happen.** Two worms swinging at once, two
  peers disagreeing, an input arriving out of order: none of it is possible, and
  handling it costs clarity and hides real bugs. A per-worm map of "who is
  swinging" was never needed; the turn's worm is the swing.
- **Never make a simulation decision from anything but synchronised state**: the
  frame count (`wa.world.frame()`), the keys, the world. Not the render rate
  (`wa.on.draw` runs per viewer and must only draw), not a random number, not wall
  time, not anything a peer could see differently.
- **Decide on a frame, once, and let it play out.** A duration is a number of 50 Hz
  ticks from a stored start frame, so every peer and every replay plays the same
  frames. That is why a clip is data (`clip_pose(t)`) and why a custom animation
  takes the worm and owns its own clock instead of watching WA's state machine.
- **What a turn can really do to you**: end, kill the worm, drop the weapon, or
  change the panel, and everything must settle before the next turn. Those are
  the interruptions worth handling, and they are all observable from the
  simulation.

---

## 1. What this is

A React 19 + TypeScript + Tailwind v4 editor for **WormForge** (Worms
Armageddon modding engine) weapons. It can:

- import a Project X `.wep` binary and decode the native 0x1D0 record;
- edit identity, donor/slot, defaults, flight physics, missile actions, burst
  payloads, collision masks, Lua callbacks, gun/mine/strike fields;
- build the worm **hold art** preview and the 50 Hz **flight sprite** preview;
- export a complete WormForge bundle (`mod.toml`, weapon Lua, profile, sprites,
  optional `.wep`);
- run as a web app (GitHub Pages), a local Express + Vite app, or a Tauri v2
  desktop app.

The companion **code editor** app lives in `...\Worm-Forge-Lua-Editor` and is a
different project. Do not modify it from this repository.

---

## 2. Repository layout

```text
.
├─ src/
│  ├─ App.tsx                  # state, theme, hotkeys, page shell
│  ├─ components/
│  │  ├─ Sidebar.tsx           # desktop sidebar + mobile bar
│  │  ├─ WeaponSettings.tsx    # identity / donor / slot / icon / defaults
│  │  ├─ RecordEditor.tsx      # the record sections
│  │  ├─ HoldPreview.tsx       # hold builder (3-col) + 6-slot flight art builder (canvas)
│  │  ├─ FlightRoleEditor.tsx  # legacy role cards (superseded by HoldPreview hotbar)
│  │  ├─ PackSpriteUpload.tsx  # upload for trail / cluster-bit pack art
│  │  ├─ EffectsCards.tsx      # ribbon trail + explosion burst cards
│  │  ├─ TerrainStampCard.tsx  # wa.land.stamp card (bake, angle, buried, strip preview)
│  │  ├─ ExplosionPreview.tsx  # 50 Hz px_effects burst preview (canvas)
│  │  ├─ BundleDependencies.tsx # extra mod.toml dependencies panel
│  │  ├─ WepImportModal.tsx    # .wep drop zone and decode summary
│  │  ├─ LuaPreviewModal.tsx   # generated Lua / mod.toml / profile
│  │  └─ ProjectileSimulation.tsx # RETIRED, unused; do not re-enable
│  ├─ data/
│  │  ├─ recordTabs.tsx        # section ids/labels/icons shared by nav
│  │  ├─ recordSchema.ts       # field tables used by the editor
│  │  ├─ explosionPresets.ts   # PX electric / pyro / ember burst presets
│  │  ├─ spriteBuilder.ts      # WFWS role defaults, state ids, availability
│  │  └─ stockWeapons.ts       # stock donors, slots, panel positions
│  ├─ types/weapon.ts          # WeaponProject and all record types
│  ├─ utils/
│  │  ├─ wepParser.ts          # .wep -> WeaponProject (+ wepBaseline)
│  │  ├─ luaGenerator.ts       # WeaponProject -> Lua + mod.toml + profile
│  │  ├─ modExporter.ts        # JSZip bundle writer
│  │  ├─ defaultArt.ts         # default hold/flight art selection
│  │  ├─ placeholderSprites.ts # procedural fallback art (only if a fetch fails)
│  │  └─ assetUrl.ts           # BASE_URL-safe public asset paths
│  └─ index.css                # Tailwind v4 theme tokens, focus, scrollbars
├─ public/assets/              # logo, mark, worm sheets, default sprites
├─ spec/                       # source art: banner, backdrop, default_*.png
│  └─ lua_sdk/                 # SDK sources: effects_sdk, wfws_sdk (WFWS builder)
├─ src-tauri/                  # Tauri v2 desktop project
├─ example_mods_*/, wep_Formatting/  # reference bundles and .wep samples
├─ lua-weapons.md, weapon-records.md # engine docs snapshots
├─ wf_weapon_editor_notes.md   # detailed engineering log (read for history)
└─ .github/workflows/deploy.yml # GitHub Pages deployment
```

---

## 3. Commands

```powershell
bun install            # dependencies (bun.lock is committed)
bun run dev            # Express + Vite, http://localhost:3000
bun run lint           # tsc --noEmit
bun run build          # vite build -> dist/
bun run preview        # preview dist
bun run tauri:dev      # desktop dev
bun run tauri:build    # desktop installer
```

Visible Windows launchers: `start-weapon-editor.bat` (full server) and
`start-weapon-editor-vite-only.bat` (UI on 5175). Background shells are not
visible to the user; use the `.bat` files when they need to open the app.

Vite config uses **`base: './'`** so the same build works on GitHub Pages, the
Tauri webview and `file://`-style roots. Resolve every `public/` path through
`assetUrl()`; never hardcode `/assets/...` in JSX.

Environment used during development: Windows 11, PowerShell 7, Bun 1.4.x,
Node 26.x, Vite 8.3.x, React 19.3.x, Tailwind 4.3.x, TypeScript 7.0.x.

---

## 4. Application architecture

`App.tsx` owns the single `WeaponProject` and all navigation state:

- `activeTab: 'editor' | 'hold' | 'effects' | 'code'` (hotkeys `1` / `2` / `3` /
  `4`, ignored while typing in an input/textarea/select);
- `activeSubTab: RecordTabId` (the record sections). Since the redesign it is
  owned by the **workbench tab bar inside `RecordEditor`**, the sidebar and the
  mobile bar are workspace navigation only and no longer list record sections.
  `recordTabs.tsx` defines the ids, labels, hints and icons;
  `visibleRecordTabs(burst, bitAction, fireType, teleport, bodyFuse)` returns the
  tab set that applies to the weapon family: projectile/dynamite and air strike
  get Physics (or Strike & Bombs) · Missile Action · Explodes Into · Sprites &
  Trail · Lua Script, while a mine, teleport tool, firearm, flame stream, arrow,
  melee tool (`fireType: 'melee'`, whose page is the Melee Strike card) or
  special tool gets only its own setup page plus Lua Script. There is no
  "Fine Tuning" tab: its rare fields live where they apply, blast bias,
  damage randomness, random flight wobble and collision outline under
  **Blast Shaping & Random Motion** in Physics & Blast, the pre-explosion
  warning under **Pre-Explosion Warning Sound** there, and the homing sprite /
  animation / trail under **Homing Art & Trail** inside Missile Action's homing
  block (the bounce extras were already in its Bounce Settings).
  When the family changes, `App` moves `activeSubTab` to the first visible tab.
- **Explodes Into owns the payload as one page with three inner views**
  (Ejection & Bit Physics · Bit Targets · Bit Action) instead of the old
  `burst_bit_*` sub-tabs; the selected bit action (bounce/homing/roam/dig) is
  rendered inside the Bit Action view. `bitActionOf()` is the single bit-action
  expression. The other tabs stay exclusive, do not mix the two models.
- Collision targets belong to Missile Action: `Detonates On Contact` is always
  shown, `Bounces Off` only while the action is bounce.
- The **Effects & Libraries** workspace (`EffectsWorkspace.tsx`) is where every
  claim hook and library bundle lives, not a record section: the ribbon trail
  (with its 50 Hz `RibbonTrailPreview`), the explosion burst with its
  `ExplosionPreview` canvas, the custom WAVs, the sequential-fire card and the
  **Terrain Stamp** card (`wa.land.stamp`, no library bundle), as one workbench
  tab bar filtered by weapon family. It shows an empty state for
  families with no claim-owned round or blast (guns, arrows, sprays, specials,
  air strikes) and a "More libraries" note for anything not modelled yet. A new
  library gets a tab here instead of a record tab.
- `isDark` with `localStorage['wf_theme_v2']`; **light is the default** unless a
  stored value says dark. `index.html` applies the stored class before paint.
- modals: `.wep` import and the inline bundle-code view.

`Sidebar.tsx` is the desktop navigation (logo, live project card with copyable
ID, the four workspace buttons, import/export, theme toggle); `MobileBar`
replaces it below `lg`. `recordTabs.tsx` is the single source of section ids,
labels, hints and icons.

`RecordEditor.tsx` is controlled: it receives `activeSubTab` and renders only
that section, plus the workbench tab bar that selects it.

Weapon identity and the five defaults live in `WeaponSettings.tsx`, rendered
above the workbench on the record page as one **Weapon Loadout** card (icon,
name, id, author, description · weapon type, base template, inventory slot ·
start ammo, turn delay, crate chance, crate pool, after firing), with turn
handling in a drawer. There is no separate `weapon` section any more.

The old top `Header.tsx` and `GeminiAntigravityModal.tsx` were deleted. There is
no Gemini/Antigravity route or `@google/genai` dependency; do not add them back.

---

## 5. Domain model: WormForge bundles

A bundle is a folder under `WormForge/Mods/`:

```text
<mod_folder>/
  mod.toml
  weapons/<mod_folder>.lua
  profiles/<Weapon Name>.toml
  weps/<file>.wep          # only when the imported .wep is used
  sprites/<mod_folder>/
    icon.png               # only when a custom icon was uploaded
    hold.png               # whenever hold art is enabled
    missile.png            # whenever custom flight art is enabled
```

`mod.toml` essentials:

```toml
id = "author.weapon"
name = "Weapon Name"
version = "0.1.0"
author = "..."
api_version = 4
format_version = 2
dependencies = ["wf.sdk", "wfws.sdk"]   # holds + flight builder, as needed

[[components]]
id = "author.weapon"
type = "weapon"
name = "Weapon Name"
description = "..."
entry = "weapons/<mod_folder>.lua"
icon = "stock_icon_or_sprites/<mod>/icon.png"
default_position = { row = "F2", column = 1 }
```

The weapon Lua is `wa.weapons.replace{ ... }` inside `install = function(ctx)`.
`copy_from = "stock.<slot>"` and `wep = "weps/<file>.wep"` are **mutually
exclusive**: a `.wep` supplies the whole native record and the Lua tables are
only edits.

The `api_version = 4` / `format_version = 2` numbers are required by the engine
even though the UI must not display the phrase "API 4.0".

---

## 6. `.wep` importer (`wepParser.ts`)

- Magic: `[0x06, 0xDD, 0xBB, 0x5A]`.
- Display name: Latin-1 at `0x1E4`.
- Record slab: `0x1D0` bytes starting at byte 4.
- **Air strikes:** `record.rs` applies `STRIKE_SHIFT = 0x14` to every `body`
  field. Decode/emit `missile.*`, `clusters.*` and `clusters.bit.*` through
  `shiftOffsets(rawOffsets, -0x14)`; `strike.*` stays at its own offsets
  (`strike.plane` at `0x38`). `missile.burst`/`project.burst` follow the shift.
- The importer infers a donor and summary from the record, then builds a
  `WeaponProject`. The decoded snapshot is kept as **`wepBaseline`** (body,
  clustlet, action, burst, overrides, fire config). The generator diffs against
  it, so an untouched import emits no override tables and an edited import emits
  only the changed values.
- Numeric writers use `??` (not `||`) so a decoded `0` is preserved.
- Import UI defaults to **"Use .wep weapon file" checked**; in that mode the
  export writes `wep = "weps/<file>.wep"` plus the original file, and record
  edits still appear as overrides.
- `.wep` filenames lie (`teleport.wep` can decode as "Super Tele"). Trust the
  decoded fields, not the name.

Reference implementation: `WormForgeNew/crates/weapons/src/record.rs`,
`tools/record_fields.py`, `tools/embed_weps.py`.

---

## 7. Generator rules (`luaGenerator.ts`)

**Emission is diff-based.** With `useWepFile`, compare against `wepBaseline`;
without it, only emit values that differ from the stock donor. An untouched
import must emit no record tables.

- **The baseline must be the donor the claim copies.** `copy_from` supplies the
  donor's whole record, so diffing against a different donor skips every value
  the two share: `WepBaseline.slot` pins a baseline to its donor,
  `stockDonorBaseline()` sets it, and the generator re-derives it when they
  disagree. `App.updateProject` re-bases the record on a donor change
  (`utils/donorRebase.ts`) and keeps the author's edits. `tools/check_copyfrom.ts`
  guards both halves. A donor missing from `stockDonors.json` writes the whole
  record rather than inheriting one nobody can diff.
- **Actions and bursts are exclusive**: `none`/`bounce`/`homing`/`roam`/`dig`, and
  `nothing`/`clusters`/`fire`. `missile.ends_on_contact` and `missile.bounce.hits`
  are independent masks; `bounce.hits` is emitted only for bounce.
- **Collision masks**: `worms` (0x3C) may not combine with
  `worms_normal/acting/jumping/roping` (the in-game "overlapping worm selections"
  crash). The UI expands or clears the shortcut; the generator expands `worms`
  to the individual flags.
- **The action groups share one native slab** (+0xA8..+0xD0, e.g. a Grenade's
  `bounce.sound` 113 at +0xB4 is also `homing.trail.sprite`), so switching the
  action writes the destination group in full (`fullGroup`, `clustletChanged`);
  a diff of only the changed keys lets the donor's numbers leak through and drew
  oil-drum frames as a homing trail. An untouched `.wep` still emits nothing.
- Clustlets carry `clusters.bit.action` (`impact`/`bounce`/`homing`/`roam`/`dig`);
  the groups share slots too, so only the active one is decoded or emitted.
- Stock values are readable from PX's scheme:
  `python tools/px_scheme_weps.py "<WA+PX>/PXSchemes/default.pxs" OUT --all`
  (in `WormForgeNew`) writes one `.wep` per slot.

**Dependencies** are added per feature: `wf.sdk` (holds), `wfws.sdk` (the flight
builder and `sb.hold`), `effects.sdk` (ribbon trail and burst), `px.fire_seq`
(sequential fire), `px.electric` (taze: burst, pierce or melee), plus
`project.extraDependencies`. Never add a feature to `effects.sdk`: a new SDK
version would have to reach every author.

### The flight sprite builder (`project.missileSprite`, `bitFlight`, `behaviorArt`)

The editor ships `spec/lua_sdk/wfws_sdk/` (id `wfws.sdk`), exporting
`wf-lib/wfws_sprite_builder` and depending on `wf.sdk` for `wf-lib/holds`.

- `require("wf-lib/wfws_sprite_builder")` whenever the primary builder is on.
  Air strikes are excluded: their munitions have no placed missile.
- **`sprite = 0` is unconditional on the primary** while the builder is on: it is
  how WA's own draw is hidden, and neither a `.wep` baseline nor a
  `missile.sprite` override may survive it. The one exception is a roaming animal
  whose walk pose WA can draw (`roamWalkPoseId()`), which is kept and passed back
  as `roam = { walk, fly }`.
- **Identity is "a nonzero first-sight `m.sprite` is a bit"** (`classify`): WA's
  missile constructor gives a fired round `missile.sprite` (0 here) and a cluster
  bit `clusters.bit.sprite`, and it only applies when a `bits` table is configured
  (`inherit` or no bits = everything is the primary). Never classify by spawn
  order: that broke herd and `fire_seq` bursts. `is_bit` overrides it; a future
  `m.bit` is used first. `log = true` prints the first three frames of each
  missile (Hold page: **Log Identity**).
- `bits = { sheet, anim, cyclical, anim_speed, spin, scale, mirror, z }` for the
  bit role, `bits = "inherit"` for the primary art, no `bits` for native WA bits.
  When the builder owns the bits the generator forces a stock
  `clusters.bit.sprite` (`clustlet`) if it was empty, writes `sprite_count = 1`
  (it counts sprite ids, not frames) and skips the claim `cluster = { sprite }`.
- **`anim = "roam"` is the walking preset.** WA walks a roaming animal with no
  velocity of its own, so on the ground the art holds `rest` (90° by default, a
  sheet that points up lies flat for a side-on walk) and leans at most `up`/`down`
  (`MissileSpriteConfig.roamTilt`); in the air it tracks the velocity like
  `track`. The ground heading uses `abs(vx)` and a leftward walk is a true
  horizontal mirror (`facing = -1` **and** the drawn angle negated, or the animal
  comes out belly-up). The builder keeps the side in `roam_side` through a
  straight drop; the 50 Hz preview mirrors the same way. The role's own sheet may
  own the state (`behaviorArt.roam`): `roam = { sheet, anim, …, walk, fly }`,
  otherwise `roam = { walk, fly }` or `roam = true` and `missile.png` is the art.
- **Digging is not a state and has no sheet.** When the record digs (`action =
  "dig"` or a dig bit) the generator zeroes `dig.dive_sprite` and
  `dig.sprite_1..3` (WA's mole frames would draw under our sheet) and emits
  `dig = true` or `dig = { anim, cyclical, anim_speed, spin, scale, mirror, z }`.
  The builder probes the terrain four times across the heading (two hits = digging,
  PX's Bunker Buster test, 3 frames of hysteresis) and applies those overrides to
  the owning sheet while underground, reverting in open air. `dig.dive_sprite` is
  not art to upload: the flight sheet is the dig animation. A `native` dig role
  leaves the record alone (only a nonzero author id is written) and passes no
  `dig`.
- **Homing is timed, not detected**: `homing = { arm, time, sheet, anim, … }`
  (primary) or `bits.homing = { … }`, and `missile.homing.sprite` /
  `clusters.bit.homing.sprite` are zeroed. The sheet swaps while
  `arm <= age*20 < arm+time` (50 Hz; `time = 0` runs until the round lands).
- **Roaming gas belongs to whichever record roams.** The Skunk's bits are the
  animals, so `clusters.bit.roam.gas` carries the real numbers while the primary's
  group is unused. Both Roam and Bit Roam show it with a stock-sprite picker.
- **Roaming is not a state at all.** WA draws the walking pose from the record
  `sprite`, the two flying sheets from `sheep.flight_1/2` and the gas pose from
  `roam.gas.animal_sprite`. `sheep_sprites = { a, b }` installs two uploaded
  sheets (the numeric rows are skipped when both are present); each is a
  **rotation strip**, not a pose (frame 0 up, clockwise, like `spsheep1/2`), so
  `RoamSheetField` has **Rotate into strip** and a frame count, declared in
  `mod.toml`. With `sb.flight` on for a roam record the generator zeroes
  `sheep.flight_1/2` to the unassigned sentinel 699 (**not** 0: WA reads a zero
  `flight_1` as "cannot fly" and the Space press would do nothing) and passes
  `roam`. A sheep never takes off without Space (`wa.world.keys().space`, the
  turn player's synchronised keyboard).
- **Weapon-wide parameters**: `size` multiplies every role's `scale`, `angle` is a
  rotation offset in degrees (negated on a mirrored sheet), and `offset = { x, y }`
  nudges the art inside its cell in **sheet pixels**, scaled with the art, turned
  with the drawn angle and mirrored with the side. A role's own `offset` wins. The
  follower is `collide = false`, so the round itself never moves. There is no
  glow: WA glows only the natives whitelisted in `wa.assets.load{ wa_sprites }`.
- `states = { { scope, sig, … } }` is **legacy** (`sig` assumed WA writes
  behaviour sprites into `m.sprite`, which it does not). Nothing emits it;
  `resolveBehaviorStates` skips every role.
- Every sheet the layer names is claimed in `sprites` and declared in `mod.toml`,
  and the exporter writes it (uploaded or `defaultArt`), so a declared path always
  exists. Behaviour art requires the primary builder; strikes have no builder path
  at all.
- Known limits: a state does not revert when WA stops writing its sprite; a swap
  respawns the follower (one-frame flicker); inert cluster pellets are drawn as
  particles and never become missiles, so they get no builder art.
- UI: `HoldPreview.tsx` section 2, a 6-role hotbar (`Main`, `Home`, `Bits`,
  `HomeBit`, `Sheep`, `Dig`; unavailable slots greyed) with mode
  (`Native`/`Builder`/`Inherit`/`Probe`), upload, super-sheet slicing, animation,
  frames/anim speed/spin/scale/depth.

### Effects

- **Ribbon trail (`project.ribbonTrail`)**: `require("wf-lib/effects/trail")`,
  `trail.install()`, `trail.BEAM`/`trail.GLOW` in `sprites`, and a
  `wa.on.missile_frame` hook that adds the trail on a round's first `pre` frame
  (WA fires the record itself, so there is no launch id). Colour, widths, `max`,
  `every` and `vanish` are free. Target `main` skips cluster bits; `all` trails
  the whole burst. Live trail ids go in an array, never `pairs` (wfcheck
  `lockstep-pairs`). Only missile families get the card: a strike's munitions have
  no `m.weapon`.
- **Explosion burst (`project.explosionEffect`)**: `px_effects`' ring plus
  squashed lens from a claim `on_explode` (the engine emits it before WA's blast).
  `effect` mode keeps the native blast; `blast` mode zeroes
  `missile.explosion.power`/`push_pct` (or `mine.explosion.*`) and lets
  `custom_explosion.explode` supply damage, push, crater and sound. `fx.install{
  trail = …, depth = { burst = wa.depth.FRONT } }` before the claim: on the SDK's
  `EFFECTS` band an `effect` burst draws under WA's blast and only surfaced after
  the boom. `thickness` is a PX **half**-width (the SDK doubles it); an explicit
  `core` replaces the derived pass. Applies to `power` and `drop` only: a strike's
  bombs have no weapon-table slot, so `on_explode` never fires for them (lesson
  20). A custom Lua `on_explode` is parsed and merged with the burst and the sound
  into one callback.
- **Damage Type: Electrical** works through `px.electric`, never the SDK. WA has
  no electric hit kind (`kind = "taze"` alone is the Prod), so the generator
  declares `local zap` at module level, assigns it inside `install`, and arms the
  hit: `zap.set_message_electric(20, 0, -4, true)` before `blast.explode{ kind =
  "taze" }`, or `zap.set_message_electric_missile(20, ev.worm, 2)` in `effect`
  mode. The pierce and the melee strike arm their own hits the same way.
- **Terrain stamp (`project.terrainStamp`)**: `wa.land.stamp` burns a picture into
  the land where the round bursts. It is a built-in verb, so no dependency. The
  card bakes the upload into **32 cells, frame 0 up, clockwise**
  (`buildRotationSheet`, `maxCell: 256`, no smoothing), because the engine keeps
  stampable frames of 1..256 px. Emission: the strip in `sprites`,
  `mod.toml` `frames = 32`, and one `wa.land.stamp{ sprite, frame, x, y, buried }`
  **appended last** to the merged `on_explode`. `frame` reads `ev.vx`/`ev.vy` (nil
  for a mine, hence `or 0`); with the flight builder on it reads
  `sb.heading and sb.heading(ev.missile)` instead (the drawn world angle, guarded
  because `M.heading` arrived in 0.7.0). **Order matters**: WA's own blast runs
  after the callback and its crater erases the stamp, so only `blast` mode
  survives; the card warns, never silently switches. With
  `wormClearance` > 0 (default 12) a `stamp_clear(x, y)` walk over
  `wa.worms.all()` wraps the call, so a worm is never sealed into the land.
  **Impact damage (`terrainStamp.impact`, PX's javelin)** makes the round pierce:
  `STAMP_HIT` plus `stamp_hit(ev)`, which walks
  `wa.world.electrical_nearby(x, y, radius+16, false)` and hits every damageable
  body inside the square; it zeroes the record's own blast (`silencesBlast`) and
  rides the card's `enabled`, so switching the pierce on can never silently take a
  blast away. It needs no sheet. Valid `kind`s are the engine's native list plus
  `taze`, which arms `zap` (the `local zap` declaration must come before
  `stamp_hit`, and the require must be inside `install`). Card: **Pierce Targets**
  and **On Explosion** are one switch, never both unticked. Only a `power` record
  is offered (a mine has no impact heading).

### The aim layer (`sb.hold`)

`HoldSpec` has no offset, no second hand and no firing window, so a hold that
needs any of them is drawn by `wfws.sdk`'s quad layer instead of the engine.

- `holdNeedsAimLayer(project)` is the single gate (a non-zero `hold.offsetX/Y`,
  `handOffset`, `aimClip`, `melee`, `extraHand`, a firing sheet, or
  `fireType === 'hitscan'` / a fire sequence for `keep_firing`): it decides the
  generator's `sb.hold` call, the exporter's `silent.png`, the `wfws.sdk`
  dependency and the UI's **Atlas Mode** line. A centred hold keeps the engine's
  draw and re-exports byte-identical.
- **The sheet must be claimed** (`holdSheetPath`, plus `params = { gpu_prefix =
  "sprites/" }`): `wa.draw.quad` resolves pack paths through the sprite-key
  registry that the claim `sprites` list fills, so a hold named only by
  `hold.sheet` throws "sprite ... is not installed" while the engine's own draw is
  muted, and the weapon never swings. Same for `hand2.png` and any role sheet.
- **The mute is `wa.weapons.hold_sheet(weapon, n)`** pointing at a 1x1 transparent
  `silent.png` (appended to `hold.sheets`, no `sprites` entry needed) only while a
  worm aims with the weapon. `collect_draws` runs the Lua hooks before
  `worm_hold::draw_holds`, so the swap lands in the same frame; the swap is
  `pcall`ed.
- **The quads copy `worm_hold.rs`**: the weapon at
  `rot_w = rot + PI*weap_radial_rotation` x `weap_radius`, the hand at
  `rot_h = rot - PI*hand_radial_rotation`, drawn angle
  `(PI - PI*aim - PI*(1 - weap_rotation)) * facing` (mirrored by corner order),
  `static = { weap, hand }`, the 20-frame `grow(counter - 1)` draw-out (the first
  aim frame is deliberately blank), and the frame from
  `phase += anim_speed * 0.03`, advanced once per `wa.world.frame()` and never per
  rendered frame. Every quad carries `visibility = worm`, so Invisibility is the
  engine's.
- **`offset` is in sheet pixels**, scaled with the art by `weap_scale`, turned
  with the drawn angle and mirrored with the side; positive Y is down the sheet,
  toward the grip. `hand_offset` is the same nudge for the hand.
- **The layer's hand is the engine's**: `grow(counter) * hand_scale`, no
  `weap_scale` and no clip `scale`, because `draw_holds` always draws
  `config.hand`. A `weap_scale`-sized hand showed as a second hand. A nudged hand
  (`hand_offset`, a clip's `dx`/`dy`) does move off the engine's copy, which is
  the layer's one visible limit.
- **`extra_hand`** (`hold.extraHand`) is the layer's, since `HoldSpec` has one
  hand slot: the engine's own maths, its own art or the first hand's sheet, the
  swing's `dx`/`dy` carried with the weapon, no hand on the echo ghosts or the
  firing pass, and its own firing grip (`fire_radius`/`fire_rotation`/
  `fire_scale`/`fire_offset`/`fire_draw`) which falls back per key to the aiming
  grip.
- **`fire` role** (`hold.flashFile`): the sheet WA draws on its two firing frames
  is its own role (`sheet`, `cell_w`/`cell_h`, `scale`, `frames` + `anim_speed`,
  `ticks`, `hide_main`, its own `weap_radius`/`weap_rotation` and hand). The cell
  is the sheet's own shape (`cell_w = width`, `cell_h = height / frames`), never
  forced square, and a strip (`frames > 1`) must be declared in `mod.toml` or the
  engine slices it by height / width. `ticks` is the window in 50 Hz frames from
  the first firing frame; unset means one cycle, `0` means WA's frames only.
  `fireDrawHand ?? drawHand` is the hand rule, in the panel and the generator.
- **One swing at a time** (`swing_of[entry]`): WA is turn based, so the sampler
  asks for the worm with `worm.turn` and keeps one swing per weapon, not a map per
  worm and not a "another worm is swinging" case (`§0`).
- **`swing` (the Space clip)**: `swing = { ticks, finish, keys }`, data not Lua:
  `M.clip_pose` is a pure function of the tick. The edge is
  `wa.world.keys().space` in a `FRAME_FINISH` worm message, never `wa.on.draw`.
  **The swing takes the worm** (`worm:take{ turn = "freeze" }`) and runs the clip
  from `wa.world.frame() - start` until `ticks`, so WA's worm states are not its
  clock, the art draws for every tick at full size, and the aim/facing at the
  press are latched. At the end `worm:release(0, 0)`, then `finish = "end_turn"`
  sets the turn clock to 0. A swing owns Space, so the claim gets `eat_fire`.
- **`swing.echo`** (ghost trail): `echo = { count, every, fade, blend }` draws
  `clip_pose(t - k*every)` at `fade^k`, farthest first. Nothing is recorded, the
  hand is excluded (`weapon_only`), and `blend` is written on the shared quad
  table every call or an additive ghost leaks into the live draw.
- **Melee strike (`fireType: 'melee'`, `project.melee`)**: the aiming phase is the
  attack. `eat_fire`, no projectile, and on the clip's `hit_frame` the swing loop
  tests a box against `wa.worms.all()`. Geometry in `src/data/melee.ts`, read by
  the red box on the aim preview, the SDK and the test pack: the scan is **the
  worm's own aim and nothing else**. `worm.aim` is WA's sweep (0 straight down,
  0.5 level, 1 straight up) and `worm.facing` is the side, so the direction is
  `(facing * sin(aim*PI), cos(aim*PI))` in world space (y down); the clip's angle
  at the hit frame turns it when `follow_swing`. The held art's `weap_radius` and
  `weap_rotation` are drawing controls: moving a pivot or turning a sheet does not
  change where the worm points, and using either is what pointed the box at the
  striker's back (once through the radius sign, once through the sheet's own
  angle). `radius` is the reach, `width` the half-arc, and the near edge starts
  3 px behind the worm. `spare_shooter` and
  `once` default on, reset per Space press. What a hit does is the weapon's own
  `hit` callback (`victim:hurt{ amount, vx, vy }`, or `zap.hurt_electric` for
  `taze`, `pcall`ed). The hit lands on the first tick at or past `hit_frame`
  with a `st.struck` latch (`>=`, not `==`), so a frame whose message never
  arrives cannot cost the swing its hit and it still lands once. Once the swing
  has taken its worm only that worm dying ends it early: a selection WA drifts
  mid-clip does not cut the animation, and the quads draw on `swinging` alone.
  `log = true` prints the swing's start (tick, position, weapon, aim, facing),
  **every** worm with its `along`/`across` and why it was skipped, the hit frame
  and the swing's end. A press no layer can use logs
  `[wfws] Space pressed at tick N, but no hold layer has an entry for weapon …`.
  The card is the record page's **Melee Strike** tab (`MeleeCard.tsx`). **The base
  record is the Sheep Launcher (`stock.sheep_launcher`, not WA's bat)**: a special
  melee subtype resolves its whole hit in one native frame, so its worm never
  animates, while a power record gives the worm a real aim phase for the swing to
  take over. Not modelled: `stopOnTerrain` and a dedicated swing WAV (the record's
  `fires` sound plays).
- Keyframe ticks commit on blur (`KeyTickInput`), because the keys are sorted by
  `t` and writing the `1` of "16" re-sorted the table mid-typing.

### Animation values

- **Hold**: `worm_hold.rs` does `phase += anim_speed * 0.03` once per 50 Hz frame,
  so a sheet plays `1.5 * frames * anim_speed` frames per second. The UI asks for
  the in-game FPS and the generator emits `anim_speed = fps / (1.5 * frames)`.
  There is no `animate` key in `HoldSpec`.
- **Flight**: PX `anim` (`track`, `rotation`, `slow`, `medium`, `fast`, `none`) is
  an `ANIM_TYPE`, unrelated to the native `missile.animation`. It only goes to
  `sb.flight`; `cyclical` is the frame count, `spin` numeric, the phase advances by
  `anim_speed * 30/1000` per tick, and `track` uses `atan2(vy, vx) + PI/2` (PX
  sheets point up). `pingpong = true` walks `0..n-1` and back (`span = 2n-2`),
  emitted only when `frames > 1`; `M.cyclical_frame` takes it as a fourth argument
  so three-argument bundles still loop.
- `missile.animation` is the native WA animation id: 0 horiz. velocity, 1 cycle,
  2 track movement, 3 track speed, 4 slow cycle, 5 faster cycle, 6 fast cycle. The
  frame count always comes from the art.

### Record ids and art slots

- **A record id can carry `0x10000`** (WA packs a 16.16 phase). `decodeRecordId()`
  strips it, `wepParser` applies it to every sprite and sound read, and the export
  writes the plain id back; a flagged number written straight into a record draws
  nothing.
- `missile.trail.sprite` and `clusters.bit.trail.sprite` accept a bundle path
  inside the record tables (the engine installs the sheet and writes the id).
  `cluster.sprite`, `cluster.homing_sprite` and the weapon's own `sprite` are
  **claim-level** declarations. A path must never go into `clusters.bit.sprite`,
  which only takes stock names or ids.
- **Air strikes have no sprite-builder path**: their art is the claim `sprite`,
  natively drawn with WA's `airmisl` rotation order (`load_strip_bytes`: vertical
  strip, frame 0 up, clockwise, 32 frames for a turn; `animation = 2` picks the
  frame from the flight direction). `PackSpriteUpload`'s rotation sheet builds that
  strip from one frame.
- **No `cluster.homing_sprite` on strikes**: the engine applies it with
  `set_cluster_render_timer`, which writes entry+0x170 with no strike shift (the
  shifted slot is 0x184, another cluster field). `packArtSlotApplies()` refuses it
  and the UI shows the gap.
- A firearm's held art keeps drawing through its burst: `keep_firing = true` for
  `fireType === 'hitscan'` and for a fire sequence, which is `px_hold_art`'s job
  absorbed into `sb.hold`. The aim layer has to be on for those weapons.
- **Sequential fire (`project.fireSequence`, `px.fire_seq`)**: one `on_fire` fires
  a burst; the first shot leaves at once, a hidden timer fires the rest `delay`
  frames apart and holds `shots_fired`/`shots_to_fire` at 0/1 so the worm keeps
  its firing pose. Emits `require("wf-lib/fire_seq")`, a module-level
  `seq_dir(w)`, `fires = { subtype = 4 }` and `on_fire = function(ev) … end`
  (or `fire_sequential_actor`). Keys: `weapon`, `owner`, `cancel_weapon`, `count`,
  `delay`, `spread`, `standoff`, coordinates (functions of `(i, w)` when live aim
  is on) and `on_shot`. **The fuse rides the launch**: when the record's own
  `missile.fuse` is 0 the generator emits `FUSE_DEFAULT = 3000`, `FUSE_AIM`, a
  per-worm table and a `FRAME_FINISH` sampler on `wa.world.keys().digit` (the turn
  player's synchronised keyboard), and `missile = { fuse = fuse_of(ev.worm) }` in
  the launch table; a record with a pinned timer emits none of it. A custom
  `on_fire` owns the trigger, so the card is skipped then. Strikes are excluded.
- Hold geometry is emitted in PX units: `weap_rotation = 1 + degrees/180`,
  `hand_rotation = 1`, `weap_radial_rotation = 1`, `hand_radial_rotation = 1`, and
  `weap_scale` carries the scale. Both radius sliders span `-35..35` px.
- **Engine bug fallback**: `draw_hand = false` still draws the hand, so the
  generator also emits `hand_radius = 0.01` with it (the project keeps the
  author's `hold.handRadius`; the importer restores it).

---

## 8. Hold and flight preview math (`HoldPreview.tsx`)

The aiming preview has the same **-, `%`, +** zoom bar over the canvas
(`aimZoom`, a multiplier on the scene's own 2x: 100% is the framing the reference
art was laid out for). It scales about the worm's own map point, so a close look
frames the hand and the held sprite rather than pushing them off the canvas.

The hold preview mirrors `worm_hold.rs`:

- worm cell 60×60; the 32-frame `aim.png` posture strip is flipped inside the
  cell so the worm faces the weapon;
- `rot = (1 - aim) * PI`; `rot_w = rot + PI`; weapon at
  `(cx + sin(rot_w)*weap_radius, cy - cos(rot_w)*weap_radius)`;
  `weap_angle = rot + weap_rotation`;
- hand at `rot_h = rot - PI` with `hand_radius`; put-away follows the 20-frame
  `0x65/0x66` retreat and `0x6A/0x6B` fire poses; `thrown` skips put-away;
- the scene is composed at 60×60 and drawn at 2× on the landscape.

The flight preview runs at a fixed 50 Hz, uses the `ANIM_TYPE` tables the
builder itself uses, mirrors when `vx < 0`, and draws the sprite at the weapon
pivot. Its playback bar has **-, `%`, +** zoom buttons (`missileZoom`, where
`MISSILE_ZOOM_1X = 4` is WA's own pixel size and the middle button resets, so
100% means game pixels; the oil-drum reference divides by the same 4). The
`%` readout replaced an older `2x..6x` preset row. The bit and behaviour role cards below it share the same flight keys.
The retired `ProjectileSimulation.tsx` had a terrain/collision loop that could
lock the renderer; leave it unused.

**Default art:** when no PNG is uploaded, `defaultArtFor(project)` returns the
one hand-drawn sprite (`spec/holyhandgrenade.png`, 64x64, copied to
`public/assets/defaults/default_hand_grenade.png`), whatever the donor or fire
type is. The preview loads it and `modExporter` writes the same pixels as
`hold.png`/`missile.png` (stacked for `frames`). `placeholderSprites.ts` is only
a fallback if the fetch fails. **It is drawn for this project on purpose:** the
old grenade/bazooka fallbacks were cut from WA's art, so every untouched export
carried Team17 pixels. An export now contains only what the author uploaded plus
this sprite, which is what the footer disclaimer and `README.md` promise.

`hold.sheet` is **required** by `lua-host/src/api.rs`, so a bundle must never
declare it without writing the file.

---

## 8a. Reading other mods (`src/utils/modLib/`)

The editor can read installed bundles, so a weapon from `Mods/` can be
inspected without a `.wep`. `ModBrowserModal` (sidebar → **Read installed
mods**, also the mobile bar) takes a folder, a `.zip` or a drop and lists every
bundle, its weapon components and the record tables each one keeps in Lua.

- `luaTable.ts` reads Lua **data** only: table literals from `a.b = { … }`,
  `a.b{ … }`, `a.b({ … })`, `a.b(name)` and `return { … }`. Function bodies are
  skipped as values but still walked through, because this editor's own
  bundles put `wa.weapons.replace{ … }` inside `install = function(ctx)`.
  Anything that is not a literal becomes `null` instead of failing the file.
  `readCallTable(code, "fx.burst")` finds a table passed to a call even inside a
  callback the table reader skipped, and returns the literal text too (some of
  the generator's values are expressions, like `vx = function … * 14 end`).
- `modToml.ts` reads the manifest (scalars, `dependencies`, `[[components]]`,
  `[sprites."…"]`).
- `scan.ts` finds nested bundles by their own `mod.toml` and resolves each
  weapon component to its module: its own entry when unique, else
  `weapons/index.lua`, else `weapons/<id after the dot>.lua`; then one level of
  `require("lib/…")`. A table is accepted as a record by shape (`missile`,
  `clusters`, `handling`, `gun`, `mine`, `strike`) when nothing names it.
- `loadFiles.ts` is the web-safe input: `webkitdirectory`, JSZip, and
  `webkitGetAsEntry` drops; `.lua`/`.toml` as text, `.wep` as bytes. PNG/GIF/WAV
  entries are listed with a **lazy** reader (`bytesOf`), because a whole `Mods/`
  tree can hold far more art than an import needs. A native path read would need
  `@tauri-apps/plugin-fs`, which is not a dependency.
- A module can name a `.wep` (`wep = "X.wep"`, sometimes assembled as
  `M.WEP .. o.wep`): the literal is matched against the bundle's own files by
  base name, so 41 of 262 weapons on the dev machine resolve one.
- `importWeapon.ts` builds a project the way the engine loads a bundle: the
  `.wep` first (`parseWepBinary`, `useWepFile` + the file kept for export), else
  `copy_from = "stock.<donor>"`; then the module's declared tables are carried
  as **`recordExtra`**. `defaults` map to the project's defaults (a bundle
  import starts from neutral defaults, not the open project's), and
  `missile.action` / `missile.burst` to `action` / `burst`.
- **Features** (`importFeatures.ts`) are the inverse of the generator's feature
  emission, for the bundles this editor writes (the WFWS corpus): the `hold`
  table (`sheet`/`hand_type`/`weap_rotation` reversed to degrees/`weap_scale`/
  `anim_speed` back to FPS), the `sb.flight` argument (primary sheet, `bits`,
  `bits.homing`, `homing`, `dig`, `size`/`angle`/`log`), the `TRAIL` table and
  its `target`, `fx.burst` / `blast.explode` (mode, damage/push/hole/sound and
  every burst field, preset matched back), `seq.fire_seq_mis` /
  `fire_sequential_actor` (including the expression fields `vx`/`x`/`y`), custom
  WAVs and their priorities/timing, the claim `sprites`/`cluster`/`sprite`/
  `sheep_sprites` sheets, `wa.land.stamp` (mode from the `frame` expression,
  angle back as degrees, `buried.soften`/`blend`, `true_colour`, the worm
  clearance from `STAMP_CLEAR`, the impact table from `STAMP_HIT`, and the strip
  attached with its declared `frames`), the custom part of `on_explode`, and any
  manifest
  dependency that is not one of the four automatic ones. The sheets and WAVs are
  read from the bundle and attached as `File`s, so a re-export writes the same
  art instead of the defaults. `unmodelledClaimKeys()` reports function-valued
  claim keys the reader does not carry (a bundle's own callbacks).
- **Full mapping** (`mapRecord.ts`) is the inverse of the generator's emission:
  `missile`/`clusters`/`handling`/`gun`/`mine`/`strike` become the typed fields
  (`body`, `clustlet`, `roamConfig`, `digConfig`, `fireConfig`, `action`,
  `burst`) and everything else becomes `recordOverrides`. Three rules:
  a declared group implies its action (`roam`/`dig`/`homing`/`bounce`, and the
  same for `clusters.bit.action`), a `clusters` table implies the cluster burst,
  and a `mine` group means `body.fuse = false` (the generator picks `mine` over
  `missile` on that test). A trail value that is a bundle path goes to
  `packArt.missile_trail` / `packArt.cluster_trail`, never into a stock-sprite
  override. Fields the mapper does not model are put back under their group in
  `recordExtra`, so nothing is lost. `importBundleWeapon` keeps the decoded
  `.wep` as `wepBaseline` while the mapped values are the project, so a
  `.wep`-backed weapon exports the file plus only its module's edits
  (`App.handleApplyWepImport` honours `parsed.wepBaseline`).
- **`recordExtra` emission** (`luaGenerator`): only the native record groups
  (`missile`, `clusters`, `handling`, `gun`, `mine`, `strike`, `sheep`) are
  carried; a bundle's spec table also holds claim keys (`sprites`, `hold`,
  `params`, `worm_sprites`, sounds, callbacks) that name art inside *that*
  bundle. The values are written as explicit `rec.<path> = …` assignments with
  guarded parents (`rec.missile = rec.missile or {}`) after a `local rec = { … }`
  record, then `wa.weapons.replace(rec)`, never a `pairs` merge, which wfcheck
  reports as `lockstep-pairs`. Full mapping of these values into the typed
  panels is the next step.
- **Record audit**: `bun run tools/audit_records.ts [ModsFolder]`, coverage of
  every record group `record.rs` names, engine invariants (mask conflicts, burst
  without its table, sprite fields holding paths), 28 stock-slot behaviour
  expectations against the decoded donors, and the editor's own output
  (import → generate → check the record the engine would end up with). Keep it
  at zero findings.
- **Native family groups** (`fires`, `arrow`, `baseball_bat`, `fire_punch`,
  `drill`, `jet_pack`, `parachute`, `utility`) are flat scalar tables: decoded
  by the parser, mapped into `recordOverrides`, emitted by the generator's
  `NATIVE_GROUPS` loop, and edited in the record page's **Family Specifics**
  tab. `fires.type`/`method`/`subtype` are selectors the archetype and
  `specialSubtype` own, the mapper consumes them so they cannot leak into
  `recordExtra` and override the archetype. `clusters.bit.sprite_count` is
  floored at 1: the engine divides by it.
- Corpus: `bun run tools/scan_mods.ts [ModsFolder]`, 240 of 262 weapons read
  from the dev machine. Misses are stock-copy examples, templates, and records
  that only exist in a bundled `.wep`.
- **A panel shows the value the record will have, not the editor's default.**
  `recordField(project, 'path', fallback)` (`src/utils/recordField.ts`) returns
  the author's override, else what the donor (or the imported `.wep`) carries,
  else the fallback. `copy_from` supplies the donor's whole record, so a field
  nobody touched is the donor's, `fires.launch_power_pct` used to be shown as
  100 for every weapon (a grenade could not charge), which was the *fallback*
  talking, not the record. `stockDonors.json` was also stale: it predated the
  `.wep` `fires.*` decode, so no donor carried a launch power at all. Regenerate
  it whenever the parser learns a field (`bun run tools/gen_stock_donors.ts`).
- **Per-donor presets** (`src/data/stockDonors.json`): one decoded record per
  panel slot, 70 of them, from PX's default scheme
  (`python tools/px_scheme_weps.py <scheme>.pxs OUT --all` then
  `bun run tools/gen_stock_donors.ts [folder]`). `body.sprite` comes from
  `recordOverrides['missile.sprite']`, the parser's `body.sprite` is a family
  guess, the record's real id is in the override. `project.donorBaseline` is the
  donor as a `WepBaseline`, and the generator picks
  `useWepFile ? wepBaseline : donorBaseline`, so a `copy_from` weapon diffs
  against the donor and writes only its real edits (an untouched new project
  exports three lines). A bundle import sets `replaceProject`, so it starts from
  the default Grenade project instead of inheriting the open weapon's art.

Ids are namespaced: `src/utils/weaponId.ts` fixes `wfws.` and the ID field
edits the suffix only, so no id can collide with a mod the reader shows.

## 9. UI and design system

- Tailwind v4, no component library. The layout is Chakra-dashboard-inspired but
  deliberately stays on Tailwind; do not migrate to Chakra without a concrete
  reason.
- `src/index.css` defines the forge palette (`--color-forge-50…950`, sampled
  from the mod loader logo), `stone` neutrals, fonts (Plus Jakarta Sans,
  Chakra Petch for headings, IBM Plex Mono), global `:focus-visible`, native
  control `accent-color`, reduced-motion handling and thin scrollbars.
- **No em dashes.** The copy uses commas instead (an earlier pass rewrote every
  one in `src/`, `spec/`, `tools/` and the docs). Keep new text that way; an
  em dash also mangles easily in JSX and differs between editors.
- **Credits and disclaimer live in the page footer** (`App.tsx`, a `<details>`
  under the mod path) and in `README.md`: Worms Armageddon and the stock art the
  page shows (sprite-builder tab icons, frozen worm preview, terrain preview
  backdrop) are Team17's, the fallback flight art is hand-drawn, the tool is
  unofficial, what an export contains is stated, and what an author builds is
  their responsibility. Keep both copies in step.
- **No emerald/green theme accents.** The only green left is art (e.g. the
  grenade stem). Do not reintroduce `emerald-*`/`green-*` utility classes.
- **Three accent families carry meaning**, introduced by the redesign: `forge`
  (the brand terracotta) for primary actions, physics and blast; `amber` for
  action/payload states (Missile Action, Explodes Into, cursor teleport, timed
  dynamite, import `.wep`); `sky` for art and setup (Sprites & Trail, Firearm
  Specs, Tool & Setup, Mine Setup, Read installed mods). Workspace icons follow
  the same split. Red (`rose`/`red-*`) is reserved for warnings and destructive
  actions; Export is `forge-600`, not red.
- Light mode is the default. The toggle persists `wf_theme_v2`; `index.html`
  applies it before paint and `App.tsx` keeps `theme-color` in sync.
- Branding: `public/assets/wormforge-logo.png` (327×57 wordmark) and
  `wormforge-mark.png` (49×49, also the favicon), cropped from
  `spec/modloader_banner.png`.
- **Weapon identity is the Weapon Loadout card**, not a record section: icon,
  name/id/description, author, fire archetype, donor, slot, position and the five
  defaults live in `WeaponSettings.tsx`, rendered above the workbench on the
  record page. The record sections are chosen by the workbench tab bar, not by
  the sidebar.
- **Tooltips are tappable** (`TooltipTap.tsx`, mounted once in `App` next to the
  toast; it was written but never mounted at one point, which left every help
  icon dead on a phone). Most explanations are `title` attributes, which a phone
  can never show: a tap on any element with a `title` opens the same text in a
  bubble. The attribute is moved to `data-tip-tap` while open so the native
  tooltip cannot double up. A tap that lands on a real control (`button`,
  `input`, `select`, `textarea`, `a`) is the control's own, so a checkbox still
  toggles. A titled element *inside* a label (the help icon beside a label's
  text) is the tip's own target, so the label's activation is cancelled: the
  pointer event only stops the focus, so the click that follows is swallowed
  once in the capture phase. A `<label>`'s own text keeps its activation, because
  a thumb aims at the words to tick a box or focus a field; on a touch screen the
  bubble opens as well (there is no hover), and with a mouse it does not (the
  native tooltip covers it, and a bubble on every click is noise). The help icons
  themselves carry `-m-1.5 p-1.5`, a 26 px target instead of the 14 px glyph.
- **A declared frame count must divide the sheet's height.** The engine slices a
  vertical strip as `height / frames` and refuses an image that leaves a
  remainder (`initgraphic` fails, so the sprite never loads). `SheetFrameWarning`
  (`src/components/SheetFrameWarning.tsx`, math in `src/utils/sheetFrames.ts`)
  says so next to the control that sets the count, and suggests both fixes: crop
  to the nearest divisible height or pick a frame count that divides. It is wired
  into the flight role card (an uploaded strip, measured from the preview URL),
  the roam strips, the pack-art upload (a declared `frames`) and the hold sheet
  (which stores `sheetWidth`/`sheetHeight` on upload, so no measuring is needed).
  Default art is stacked by `defaultArt.ts` and can never trip it.
- Record sprite fields use `StockSpriteInput` (`src/components/StockSpriteInput.tsx`):
  a text box plus the stock table's datalist, the resolved `name (#id)` hint, a
  red warning for text the engine would read as a bundle path, and the
  `0x10000 + id` explanation when a file spelled an id that way. Use it for every
  record sprite field instead of a bare number or text input.
- Accessibility conventions already in place: skip link, `aria-current` on nav,
  labelled icon-only buttons, labelled form controls, semantic
  `button`/`select`, `aria-live` toast, `prefers-reduced-motion`. Keep them.
- Do not display "API 4.0" in UI copy. Say "WormForge format" or "WormForge
  bundle".

---

## 10. Export contract (`modExporter.ts`)

- `mod.toml`, `weapons/<mod>.lua`, `profiles/<Name>.toml` are always written.
- `weps/<file>.wep` is written only when `useWepFile` is on.
- `sprites/<mod>/icon.png` when a custom icon exists.
- `sprites/<mod>/body.png` when the weapon's own sheet (`sprite`) is uploaded
  the only art path for an air strike's munition.
- `sprites/<mod>/hold.png` whenever hold art is enabled: uploaded sheet if
  present, otherwise the default art (never a dangling path).
- `sprites/<mod>/missile.png` whenever custom flight art is enabled: uploaded
  sheet, otherwise the default art.
- `sprites/<mod>/bit_flight.png` when the WFWS bit role is set to Builder, and
  `sprites/<mod>/state_homing.png` / `state_homing_bit.png` / `state_roam.png`
  when the homing or roaming role is set to Builder (`wfwsRoleFlags`). Uploaded
  sheet if present, otherwise the default missile art. Digging writes no state
  sheet (the flight sheet is the dig animation), and roaming without an own
  sheet uses `sheep_sprites` unless the builder owns the flown art, in which
  case `missile.png` is that art.
- `sprites/<mod>/sheep_flight1.png` / `sheep_flight2.png` when both roaming
  sheets are uploaded (`sheep_sprites` needs exactly two) and the flight builder
  is off, a builder sheet owns the flying state instead. They are rotation
  strips, so `mod.toml` declares their `frames` (the sheet is sliced into that
  many direction cells).
- Any `customSprites` entries are written at their declared paths.
- `mod.toml` declares `[sprites."sprites/<mod>/missile.png"]` for custom flight
  art, the bit, homing-state and roaming-sheep sheets above, and
  `[sprites."sprites/<mod>/hold.png"]` when the hold sheet has more than one
  frame (`frames`, `fps`, `play = "loop"`).
- Profile name sanitizes `\\ / : * ? " < > |`.
- Uploaded pack art (`project.packArt`) is written as
  `sprites/<mod>/trail.png`, `bit.png`, `bit_homing.png`, `bit_trail.png` and
  `body.png` (`.gif` keeps its extension) and declared in `mod.toml` with
  `frames` (PNG only), `fps` and `play`. The path is rebuilt from the current
  weapon id on every export (`packArtPath`), so renaming cannot leave a stale
  folder. `packArtPath` returns null for `cluster_homing_sprite` on a strike
  (see `packArtSlotApplies`).
- The terrain stamp strip (`project.terrainStamp`) is written as
  `sprites/<mod>/stamp.png` and declared with `frames = 32`, the frame count is
  what makes the engine slice the 32 direction cells, and nothing animates it, so
  `fps`/`play` are not needed. `mod.toml` and the ZIP are written from the same
  `terrainStampPath()` test, so a declared path always exists.
- Uploaded WAVs (`project.customSounds`) are written as
  `sounds/<mod>/explosion.wav`, `interval.wav` and `shot.wav` whenever the role
  is enabled and has a file. The claim's `sounds` list, the `on_explode` play
  call and `fire_seq`'s `on_shot` path are the same contract: a declared path
  must exist at load.
- `mod.toml` `dependencies` merges the features' own entries (`wf.sdk` for
  holds, `wfws.sdk` for the flight builder, `effects.sdk` for effects,
  `px.fire_seq` for sequential fire) with
  `project.extraDependencies` (deduped). The Bundle Code page's
  `BundleDependencies` panel edits that list; other bundles are resolved from
  `Mods/` at load.
- **One file per picture (`src/utils/sheetDedupe.ts`).** The exporter collects
  every sheet it is about to write, groups the ones whose bytes are identical
  **and** whose `mod.toml` declaration agrees, keeps the first path of each group
  and rewrites the generated Lua and `mod.toml` to it (whole quoted tokens only,
  so `state_homing.png` cannot rewrite `state_homing_bit.png`; the claim
  `sprites` list is compacted so a role does not repeat the kept path). The
  fallback art is the common case: a weapon whose hold, missile, bit, homing and
  roam art are all unuploaded used to bind six identical sheets under six ids,
  which is six atlas slots for one picture.
  **A declaration is `frames` plus, for a strip, `fps` and `play`**, and one path
  carries one of each, so two roles that want the same picture at different
  speeds are two sheets: merging them retimes one, and merging them while keeping
  both declarations leaves a repeated `[sprites."…"]` table, which is invalid
  TOML (the engine loses the declaration and `wa.on.draw` fails with "error
  converting Lua nil to table"). A **one-frame** sheet has nothing to animate, so
  it shares whatever `fps`/`play` it was declared with: that is what makes the
  fallback art one file. Different `sb.flight`/`sb.hold` params are Lua, not a
  declaration, and do not stop two roles sharing one picture.
  `bun run tools/check_sheet_dedupe.ts` guards the grouping, the rewrite and the
  one-declaration-per-file rule.
- The one exception is the editor's own `wfws.sdk`: every export also ships it at
  `wf-lib/wfws_sdk/` (`mod.toml` + `lib/wfws_sprite_builder.lua`), the folder
  library bundles live in next to `wf-lib/sdk` and `wf-lib/effects_sdk`, so a ZIP
  unpacked into `Mods/` already has it. Both files are imported from
  `spec/lua_sdk/wfws_sdk/` with Vite's `?raw`, so there is no copy to keep in
  sync.

---

## 11. Validation recipes

Run these before saying a change is done:

```powershell
bun run lint   # src/ must have 0 errors
bun run build
```

Test pack for engine behaviour (dev only, output is git-ignored):

```powershell
bun run tools/gen_test_pack.ts   # -> test_pack/wftest_pack/ + test_pack/README.md
```

The pack ships the editor's own `wf-lib/wfws_sdk/` (copied from `spec/`, like an
export does), so its weapons run against the version they were generated for
instead of an older installed copy of the library.

It writes one bundle with 50 components, one profile ("WF Test Pack") and art
derived from `spec/` sheets, one per role (the sprite builder, cluster bits, the
homing window, the homing bit, the roaming animal, native trails, the aim layer,
the swing, the melee strike). **Each entry's intent, expected result and failure
symptom live in `test_pack/README.md`**: read it instead of guessing what a number
is for, and keep it in step when a test changes. The profile places every weapon
on a distinct stock slot with infinite ammo.

Stock record values (PX's default scheme, from `WormForgeNew`):

```powershell
python tools/px_scheme_weps.py "I:/Games/WA 3.6.31.0 + Project X by 0rang3/PXSchemes/default.pxs" OUT --all
```

Each slot's `.wep` is the record that slot plays with; the action slab is at
+0xA8..+0xD0 (`crates/weapons/src/record.rs`).

`copy_from` diff check (no server, exits 1 on a failure):

```powershell
bun run tools/check_copyfrom.ts
```

It builds donor-based projects and asserts that an untouched donor emits no
record tables, that a Mortar with its clustlets off and a 100% push writes
`burst = "nothing"` + `push_pct = 100` (with a correct *and* a stale baseline),
and that re-basing a donor keeps the author's edits while adopting the new
donor's record.

Sheet dedupe check (no server, exits 1 on a failure):

```powershell
bun run tools/check_sheet_dedupe.ts
```

It asserts the grouping (identical bytes and the same frame count share a file, a
differently sliced strip does not), that aliases rewrite whole quoted paths only,
and that one declaration survives per file.

The swing layer's own harness (needs `python -m pip install lupa`, so it is not
part of the repo's checks; exits 1 on a failure):

```powershell
python tools/lua/harness_melee.py
```

It loads the real `spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua` against a
fake `wa` and walks the melee swing frame by frame: the aim draw, the Space take,
the clip drawing with the worm in a plain standing state, the hit through the
claim's callback, the release and `finish = "end_turn"`. Its handles are fresh per
`wa.worms.all()` call, like the engine's, because identity is the bug it caught
(`worm.id` is the only stable comparison).

WFWS bundle import check (no server, exits 1 on a failure):

```powershell
bun run tools/gen_test_pack.ts
bun run tools/check_mod_import.ts
```

It imports every test weapon and asserts each feature comes back with its files:
held art and its scale, the `sb.flight` roles with `size`/`angle`/`offset`, the
ribbon trail and its target, both explosion modes with every burst field and the
preset, `fire_seq` counts/speed/offsets, custom WAVs, pack sheets, roaming strips,
the terrain stamp (mode, angle, `soften`/`blend`/`true_colour`, and the impact
table with the record's blast zeroed), the electric bursts' `damageType` with their
`zap` require and dependency, the Space clip with its echoes, the second hand with
its own sheet, and the melee strike with its `hit` callback. It then regenerates
each weapon and checks the original feature calls survived: a feature with no
inverse in `importFeatures.ts` fails here, which is the point.

Compiler check (lives in the code-editor repo):

```powershell
& 'C:\Users\lucia\Documents\GitHub\Worm-Forge-Lua-Editor\compiler-cli\wfcheck.exe' --format pretty '<bundle folder>'
```

The engine sources and sample records used to verify field mappings:

- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\weapons\src\record.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\lua-host\src\api.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\lua-host\src\record_table.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\crates\engine\src\worm_hold.rs`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\tools\record_fields.py`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\tools\embed_weps.py`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\docs\agent\lua-weapons.md`
- `C:\Users\lucia\Documents\GitHub\WormForgeNew\myre`, 766 real `.wep` files
- `...\myre\pxl_extracted\cweps\weapons`, strike examples

UI smoke test (Playwright is installed in a scratch folder):

```js
const { chromium } = require('playwright-core');
// executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
// scratch scripts: C:\\Users\\lucia\\AppData\\Local\\Temp\\wf_pw
```

There are several `input[type=file]` elements now (icon upload, the import modal,
one per pack-art slot, the hold and firing sheets), so select them by their own
control or panel, or use the file-chooser flow:

```js
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByText(/Drag & drop a/).click(),
]);
await chooser.setFiles('...\\weapon.wep');
```

Pages/subpath smoke test: serve `dist/` under a fake `/repo/` prefix and check
the logo and default sprites return 200 (this catches absolute-path mistakes
that `vite preview` at `/` hides).

---

## 12. Deployment

- `.github/workflows/deploy.yml` builds with Bun, runs `bun run lint` and
  `bun run build`, uploads `dist/` and deploys with
  `actions/deploy-pages@v4`.
- It triggers on pushes to `main` and `workflow_dispatch`.
- Pages must be enabled once by hand: **Settings → Pages → Source: GitHub
  Actions**. `configure-pages` deliberately does **not** use `enablement: true`;
  that made the action try to create the Pages site with the workflow token and
  fail with *"Resource not accessible by integration"* on repos where the token
  cannot create it. If the repo is private, Pages needs a paid plan or the repo
  must be public.
- Site URL: `https://<user>.github.io/<repo>/`. The relative base means the repo
  name does not have to match anything in the config.
- There is no desktop release workflow.

---

## 13. Hard-won lessons

1. **Never trust `.wep` filenames.** Decode and inspect the fields.
2. **Strike shift is real.** Everything in the `body` is 0x14 further for air
   strikes; `strike.*` is not.
3. **Collision masks can crash the game.** `worms` + individual worm flags =
   "overlapping worm selections". Expand or clear the shortcut, never emit both.
4. **`hold.sheet` is mandatory**, and every declared path must exist. A hold block
   without a real file fails at load, and `mod.toml` may not name a file the ZIP
   does not carry (walk `wfwsRoleFlags` too, not only the legacy `states`).
5. **`anim_speed` is a multiplier, not FPS** (`fps / (1.5 * frames)`), and
   `animate` is not an engine key.
6. **PX `anim` is not native `animation`.** Different tables, different meanings.
7. **A record sprite field takes a stock name or an id, never free text** (the
   engine treats anything else as a bundle path and fails the install). The field
   shows the resolved `name (#id)`; the trail presets write real ids
   (`smklt25`/`firehit`/`smkdrk20`, not `smoke`).
8. **Zero is a value.** Use `??` when reading and writing record numbers, never
   `||` in a controlled numeric input.
9. **Diff against a baseline, and only the donor's own baseline** (§7). An
   untouched import emits nothing; a rough diff against the wrong donor skips
   real edits.
10. **`base: './'` means no absolute asset URLs.** Resolve through `assetUrl()`.
11. **The old copies are stale.** Only edit this repository.
12. **The retired `ProjectileSimulation.tsx` can lock the renderer.** Leave it
    unused.
13. **One handler, one `onChange`.** A second call spreads the same `project` and
    undoes the first (this made the native trail checkbox look dead). Use
    `updateOverrides(patch)` for multi-key edits.
14. **A claim `on_explode` needs a weapon-table slot.** An air strike's bombs are
    built from the strike's own record copy, so the hook never fires for them.
15. **The primary's `sprite = 0` is a classifier, not a cosmetic toggle**, and a
    bit needs a nonzero stock sprite (`clustlet`, `sprite_count = 1`). Behaviour
    state ids must be distinct, real and positive (245+), and never a negative id.
16. **`copy_from` diffs must use that donor's baseline** (§7, check 9).
17. **Feature import inverts the generator, not the engine.** Lua expressions
    (`vx = function … end`, `x = ev.worm.x - 3`) are recovered from
    `readCallTable`'s literal text, files come from the bundle through
    `bytesOf`, and an unrecognised callback is reported (`unmodelledClaimKeys`)
    instead of guessed. A new generator feature needs its inverse and a case in
    `tools/check_mod_import.ts`, or a re-export drops it silently.
18. **Engine quirk: `draw_hand = false` still draws the hand** until the engine is
    fixed, hence the `hand_radius = 0.01` fallback (§7).
19. **A stamp call is deleted only when it is ours.** `customExplodeBody` strips
    the generated `wa.land.stamp{ … }` block only after `readCallTable` matched
    its shape; a hand-written stamp is the author's Lua.
20. **`stampAngleForFrame` returns degrees, not a frame.** Frame 8 (90°) once
    re-exported as frame 1 because the value was converted twice.
21. **A module that reads `wa` while it loads cannot be required at module
    level.** A component file only returns its data: declare `local zap` at module
    level where a function needs it as an upvalue, assign it inside `install`.
    Check a new module with `grep -n '^wa\.' <module>.lua` first.
22. **Use `bun run` (not `npx tsx`) for the check scripts**, which import
    `src/utils/` and hit Vite's `import.meta.env`.
23. **WA's worm states are not an animation clock.** A custom animation the pack
    owns (a swing, a vehicle) has to take the worm (`worm:take`) and drive itself
    from `wa.world.frame()` (§7). Gating on an aim or firing state played one
    frame and stopped.
24. **Two worm handles never compare equal.** `wa.worms.all()` builds a new
    userdata per call and the engine defines no `__eq`, so a stored handle is
    not `==` to the next frame's. Keep the handle for the calls you have to make
    and compare `worm.id` (team * 16 + index). `st.worm == w` made the melee clip
    run, hit and release with nothing drawn (lesson 23's twin failure).

---
## 14. Out of scope / deferred

- The **code editor** app (`...\Worm-Forge-Lua-Editor`) is a separate project
  and is managed separately. Do not change it while working here.
- `wfcheck` false positives are deferred to the code-editor effort; do not
  silence warnings or hide findings in this repo.
- No Gemini/Antigravity integration; no "API 4.0" UI labels.
- Tauri release CI is not set up (local `bun run tauri:build` works).
- The stale `metadata.json` (AI Studio) was intentionally not copied here.

---


## 15. Current status

The editor is feature complete for the families it models: `.wep` decode (with
the strike shift), the record workbench, hold art (aim and firing roles, offsets,
swing clip, ghost trail, second hand), melee strikes, the WFWS flight builder
(primary, bits, timed homing, dig, roam), ribbon trail, explosion burst (native or
replaced blast, electrical), terrain stamp with impact damage, sequential fire,
custom WAVs, pack art, the bundle reader (`.wep` + Lua tables + this editor's own
features) and the exporter. `wfws.sdk` is 0.13.0 and ships inside every export.

Validated by the full check set in §11: `lint`, `build`, `gen_test_pack` (50
weapons), `check_mod_import` (50/50), `audit_records` (0 findings),
`check_copyfrom`, `wfcheck` on the pack and on a UI-exported ZIP.

Waiting on a person for:

- in-game passes over the later test weapons (WF 29 fuse, WF 31/32/36 firing art,
  WF 37-45 stamp and pierce, WF 46/47/48/49 aim layer and clip, WF 50 melee), each
  entry's expected result and failure symptom are in `test_pack/README.md`;
- a review of the redesign branch on a phone, then a merge or a rebase;
- the GitHub remote and Pages (§12).

Likely next steps: carry the remaining arbitrary `install` callbacks
(`wa.on.*`) on import, and add WF 51/52 (a swing that misses behind and outside
the arc, and one that only reaches overhead when the box follows the swing).

---

## 16. Maintenance rules

- Match the existing style: Tailwind + `stone`/`forge`, comments that explain
  engine math, no new UI framework.
- Keep the generator **diff-based** and the parser **zero-safe**.
- Every behaviour change needs: `bun run lint`, `bun run build`, a `wfcheck`
  pass on an exported bundle, and a Playwright check for UI changes.
- Update this file, `README.md` and `wf_weapon_editor_notes.md` when behaviour or
  contracts change. The notes file is the detailed history; this file is the
  operating manual.
- Commit to this repository. Do not copy changes back to the old
  `Worm-Forge-Lua-Editor\WormForgeWeaponEditor` folder.
