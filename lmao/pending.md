# Hand-Off Prompt: WormForge Weapon Studio Defect Audit & Finish

Repository: `C:\Users\lucia\Documents\GitHub\WormForge Weapon Editor`
Platform: Windows 11, PowerShell 7, Bun 1.4.x. Always use `bun run ...`, never `npx tsx`.

## 0. Rules & Constraints

- Edit **only** `C:\Users\lucia\Documents\GitHub\WormForge Weapon Editor`. Never touch `...\Worm-Forge-Lua-Editor`, `wfcheck.exe`, or `...\WormForgeNew` (read-only ground truth).
- If you edit `spec/lua_sdk/effects_sdk/` or `wfws_sdk/`, sync to `D:\Worms Armageddon\WormForge\Mods\wf-lib\...` (`effects_sdk` 0.4.4 is already synced).
- `0` is a real value: audit `??` vs `||`, `undefined` vs `0`, and `NaN` guards.
- No em dashes (`—`, U+2014) in code, comments, or copy; use commas.
- Do not add dependencies, frameworks, or new SDK bundles. Do not silence `wfcheck`.
- **Leave pre-existing unrelated working-tree changes alone**: staged/unstaged changes in `AGENTS.md`, `wf_weapon_editor_notes.md`, `spec/lua_sdk/wfws_sdk/*`, `tools/gen_test_pack.ts`, `tools/lua/harness_melee.py`, `src/components/{EffectsCards,HoldPreview,MeleeCard}.tsx` (pre-existing staged hunks), and untracked `spec/lua_sdk/px_fire_seq/`. Do not commit or push.
- Every finding must be pinned with a regression test in `tools/` and **mutation-checked** (break the fix, watch the check FAIL, restore it, watch it PASS).

---

## 1. Current State & Verification Numbers

### Baseline (recorded before audit edits)
- `bun run lint` (`tsc --noEmit`): exit 0
- `bun run build`: 1768 modules, exit 0
- `bun run tools/gen_test_pack.ts`: 60 weapons, 48 sheets, exit 0
- All 10 `tools/check_*.ts`: PASS (`check_pack_roundtrip` 78 cases, `check_pack_fixture` 26 cases with `wf-lib/utilities` 23 carried blocks, `check_module_scan` 77 cases, `check_mod_import` 60 weapons)
- `tools/audit_records.ts "D:\Worms Armageddon\WormForge\Mods"`: exit 0 (296 weapons, 295 with record; 0 unmodelled groups, 0 mask conflicts, 0 record-field/output problems; 27 `no decoded donor` notes because optional `%TEMP%/wf_px/default` is absent)
- `tools/audit_bundles.ts "D:\Worms Armageddon\WormForge\Mods"`: exit 0 (37 bundles, 172 weapons: 34 byte-identical, 1 stable after named donor `example.tools`, 2 need a library, 0 failed)
- `wfcheck.exe --format pretty test_pack\wftest_pack`: exit 0 (`checked 61 file(s): no findings (WormForge 0.9.61)`)
- Python harnesses (`harness_melee.py`, `harness_flight.py`, `harness_effects.py`, `harness_emitter_weapon.py`, `harness_trail_bits.py`): 5/5 PASS

### Latest Verification (after F1-F13 code fixes)
- `bun run lint`: exit 0
- `tools/check_module_scan.ts`: PASS (77 cases)
- `tools/check_carried_lua.ts`: PASS (`pulsar` 7 prologue / 0 preamble)
- `tools/check_lua_hooks.ts`: PASS
- `tools/check_mod_import.ts`: PASS
- `tools/check_pack_fixture.ts`: PASS (26 cases; `wf-lib/utilities` now carries all 24 blocks including `cursor.lua`'s `on_select` handler and round-trips byte-identical)
- `tools/audit_bundles.ts "D:\Worms Armageddon\WormForge\Mods"`: PASS (37 bundles, 172 weapons: **35 byte-identical**, 0 stable after named donor, 2 need a library, 0 failed)

---

## 2. What Has Already Been Solved

### Solved, Regression-Tested, and Mutation-Checked (F1-F12)

1. **F1 (`src/utils/luaGenerator.ts`)**: Launch WAV / `on_fire` conflict and single `fires` block / native group gating. Launch WAV rides `wa.on.worm_message` (`WEAPON_RELEASED`) instead of claiming `on_fire` (which replaces WA's shot dispatch); commented `-- on_fire =` no longer suppresses launch WAV or `fireSequence`; duplicate `fires` tables and leaking native groups prevented. Pinned in `tools/check_generator_edges.ts`.
2. **F2 (`src/utils/sheetDedupe.ts`)**: `compactSpriteLists` replaced `/\"[^\"]*\"/g` with quote-aware `splitSpriteListItems` (preserves expressions, escaped quotes, single quotes) and `applySheetAliases` rewrites both double- and single-quoted aliases. Pinned in `tools/check_sheet_dedupe.ts`.
3. **F3 (`src/utils/packExporter.ts`, `src/utils/luaGenerator.ts`)**: Export/pack invariants:
   - Replacing Ninja Rope or Skip Go no longer emits duplicate TOML keys in the profile.
   - Air strike with `missileSprite.mode === 'custom'` does not declare an unwritten `missile.png`.
   - Pack icon + colliding weapon `customIconFile` survive at distinct paths (`packIconBundlePath`).
   - Hold sheet uses `holdSheetPath(project)`; terrain stamp path gated by `supportsTerrainStamp(project)`; imported stamp sheets preserve `frames = N` in `mod.toml`.
   - `validateBundle` allows WA soundbank paths and refuses missing 1-frame claim sprites.
   Pinned in `tools/check_pack_roundtrip.ts`.
4. **F4 (`src/utils/modLib/{ownOutput,importFeatures,importWeapon,mapRecord}.ts`)**: Initial import/export symmetry fixes for feature extraction and `ownOutput` signatures. Pinned in `tools/check_mod_import.ts`.
5. **F5 (`spec/lua_sdk/effects_sdk/` bumped `0.4.3 -> 0.4.4`, synced to `D:\Worms Armageddon\WormForge\Mods\wf-lib\effects_sdk\`)**:
   - `libs/custom_explosion.lua`: `EFFECT_KEYS` now forwards `core` and `rainbow` to `fx.burst`.
   - `libs/px_effects.lua`: `fx.emitter` honors explicit `spark = true`/`glow = true` even when `preset = "thunder"`, and preserves explicit `spark`/`glow`/`reach`/`trail` RGB when top-level `color` is set.
   Pinned in `tools/lua/harness_effects.py`.
6. **F6**: Bundle/export validation and carry edge fixes pinned across `check_pack_roundtrip.ts` and `check_mod_import.ts`.
7. **F7 (`src/utils/luaGenerator.ts`, `src/utils/packExporter.ts`)**:
   - Melee hit WAV paths sorted by `meleeStrikes` frame order in both generator and exporter.
   - Hold `cell_h` respects `sheetFrames`.
   - `extraHand` firing scale/state reset handled cleanly.
   Pinned in `tools/check_generator_edges.ts`.
8. **F8 (`src/utils/luaGenerator.ts`)**:
   - `formatNumber` guards non-finite/`NaN` to `0`.
   - `fullGroup` preserves `bounce.explosion.push_pct = 100` fallback and user `homing.trail.sprite` (instead of overwriting with `0`).
   - Clustlet `bounceTouched` includes `'bounce_power'`.
   - `bitFlight: 'inherit'` + `homing_bit` emits `bits` table with primary sheet and homing block.
   - `animSpeed === 0` and `spinRate === 0` emit explicitly (`!== undefined && !== 1`) on main, bit, and dig roles.
   - `usesFireSequence` gated by `!hasCarriedOnFire` (suppressing both emission and `px.fire_seq` dependency).
   - `parseCustomLua` uses `scanBlockEnd` (handles bare `do ... end` and `repeat ... until`); `hookBodyOf` matches whole-word `\bend\b` (ignores `blend`/`send`).
   Pinned in `tools/check_generator_edges.ts`.
9. **F9 (`src/utils/wepParser.ts`)**:
   - Stopped stripping `explosionSoundBefore`/`cExplosionSoundBefore` via `recNum`; applied `recNum` to dig, cHoming, and `strike.plane`.
   - Decoded `burstRaw === 3` as `'clusters'`, `fireConfig` (repo enum `'on_hit' | 'resting'`), and `handling.{remember_selection,available_in_caves,ends_turn}` + `retreat = 0`.
   Pinned in `tools/check_generator_edges.ts`.
10. **F10 (`src/utils/donorRebase.ts`, `src/utils/pack.ts`)**:
    - `donorRebase.ts:56-57`: `baseValue !== undefined` -> `currentValue !== undefined` so edits to keys absent from the old donor baseline (`handling.ends_turn`, `handling.available_in_caves`, `handling.remember_selection`) are preserved across donor switches.
    - `pack.ts:71-79`: `renamespaceWeapons` calls `retargetWeaponArt` when `weapon.id === from` (not only prefix matches).
    Pinned in `tools/check_copyfrom.ts` and `tools/check_pack_roundtrip.ts`.
11. **F11 (`luaGenerator.ts`, `modLib/{importFeatures,importWeapon,mapRecord,luaTable,scan,modToml}.ts`)**:
    - `customExplodeBody` scoped to `on_explode` via `extractOnExplodeHookBody`; `maskLuaCode` in `stamp_clear`; gated `stripOwnedBurst`.
    - Melee sound defaults aligned with `wfws_sprite_builder.lua` (`miss_sound` default `0`, `hit_priority` default `8`); `fireHandScale`/`fireDrawHand`/`fireHandRadius` read back.
    - Sequential fire `offsetY = 0` and `seq_dir` round-trip cleanly without false custom-`on_fire` warning.
    - `stockSlotForPosition` for single-weapon slot; air strike keeps `'cursor'`; teleport `on_select = { cursor = true }` handled in `fireTypeOf` (after `utility` so utility+cursor stays `'special'`).
    - Partial `missile.trail` without `sprite` does not force `enabled = false`; `clusters.bit.homing` resolves stock sprite names via `stockSpriteId`.
    - Removed bare-stem `packArt` heuristic (`sprites/x/trail.png` no longer falsely promoted).
    - Added `applyPathAssignments` in `luaTable.ts` so post-literal `rec.<path> = <literal>` merges into `recordExtra`.
    - `modToml.ts` strips inline `#` comments outside quotes, preserves escapes inside arrays, and types array elements.
    Pinned in `tools/check_mod_import.ts`.
12. **F12 (`src/utils/luaCheck.ts`, `src/utils/luaText.ts`, `src/utils/modLib/splitModule.ts`, `src/utils/luaGenerator.ts`)**:
    - `math.random()` `floatForm` detection; paren-less `require "..."`; `module-wa` inside module-scope IIFE/`pcall`/`xpcall`.
    - Block-state stack in `checkBlocks`/`scanBlockEnd`/`Depth`.
    - `checkGlobals`: `local` list termination, scoped function parameters, `{ ... }` table-key handling (preserving fragment top-level `CLAIM_HOOK_KEYS` exemption for Custom Lua snippets).
    - `fixLockstepRng` spaced `math . sin` span length fix.
    Pinned in `tools/check_lua_rules.ts`.

### Solved in Code & Passing Existing Suites, Awaiting Regression Tests + Mutation-Check (F13)

13. **F13 (Import / Carry Scanner & Closure Symmetry)**:
    - `src/utils/modLib/luaStrings.ts`: `stringConstants` scans `maskLuaCode(code)`; `splitConcat` skips `..` cleanly (`i += 1; start = i + 1`); quote-aware `stripTrailingComment`; `resolveTableStrings` offset fix; `topLevelFields` splits on `,` or `;`.
    - `src/utils/modLib/luaTable.ts`: `hasInfixOp()` check in `value()` so `"sprites/a/" .. NAME` is not misread as bare `"sprites/a/"`; `repeat` in `skipExpression`; `inParens` and statement-keyword guards in `readCallTable`.
    - `src/utils/modLib/splitModule.ts`: `until` pops stack without returning `closes: true` in `Depth.word`; `bodyRegion` stops before trailing `end`; `findInstall` requires `(?:[A-Za-z_][A-Za-z0-9_.:]*[.:])?install\s*\(` (rejects `uninstall`); claim-hook scan scoped to `wa.weapons.replace` literal `[claimFrom, claimTo]` and allows keys before `on = function` (e.g. `on_select = { cursor = true, on = function(sel) ... end }`).
    - `src/utils/luaGenerator.ts`: merged `on_select = { cursor = true, on = <carried hook> }` when both `fireType === 'cursor' && teleport` and `carriedHooks.has('on_select')`, fixing a real duplicate-`on_select` overwrite bug exposed on `wf-lib/utilities`'s `cursor.lua`.
    - `src/utils/modLib/carryClosure.ts`:
      - `beforeLine` + `readerText` on closure queue/`findDeclaration`; bare `x = ...` searches prior declarations (`block.line < beforeLine`) for both `preamble` and `prologue`.
      - `preambleSet` excludes `prologueAll` in `scopesOf` so module-level helpers cannot wrongly resolve install locals.
      - `parameterOf` skips `prologueAll`/`preambleAll` and non-enclosing blocks (`block.start !== undefined && !block.text.includes(readerText)`), keeping `installHeader` (`start: undefined`).
      - `claimSpan(emitted)` splits `emitted` into `headSquashed` (before claim / `local rec`) and `tailSquashed` (after claim, excluding claim interior); drops against `tailSquashed` only when all `neededBy` are `wa.on.*` registrations (`pulsar`'s `sound_worm`), preventing claim hooks or prologue helpers from dropping helpers declared only inside or after `wa.weapons.replace`.
      - `maskLuaCode` in `hasFloatRandom` and `rewrittenCalls` (counts unprefixed `math.<fn>` before vs after so comments/strings and unrewritten `math.random()` are ignored).
      - `rewriteBundlePaths` masks comments/strings via `maskLuaCode`, uses backreference `\1`, and records folder-prefix `moves` even when `target === prefix`.
    - `src/utils/modLib/importWeapon.ts`: `expandFolder` uses `path.source` directly (preserves nested `sounds/foo/sub/`); `weapon.spriteDecls[source]` checked before basename fallback; `on_select.cursor === true` fallback placed at end of `fireTypeOf` (after `utility`).
    - `src/utils/modLib/ownOutput.ts`: `'ribbon-trail'` requires `declares(split, 'wf-lib/effects/trail')` (synthetic fixture updated in `tools/check_lua_hooks.ts:335`).

---

## 3. What Is Pending (Execute In Order)

### Pending A: Pin F13 with Regression Tests + Mutation Check
Add targeted cases to:
1. `tools/check_module_scan.ts`:
   - `luaStrings`: commented `local DIR = "sprites/fake/"` ignored; `"a--b"` preserved; `;`-separated table fields resolved.
   - `luaTable`: `"sprites/a/" .. NAME` is not returned as `"sprites/a/"`; `repeat ... until` in skipped expression; `readCallTable` stops on `)` / statement keyword instead of stealing a later table.
2. `tools/check_lua_hooks.ts`:
   - `splitModule`: `repeat ... until` inside install; `function uninstall(ctx)` rejected as install; `on_select = { cursor = true, on = function(sel) ... end }` captured and `generateLuaCode` emits a single merged `on_select` key; `on_explode = function(...)` outside `wa.weapons.replace` ignored.
   - `ownOutput`: hand-written `TRAIL` + `trail.add` without `wf-lib/effects/trail` classified as `foreign`, not `own`.
3. `tools/check_carried_lua.ts`:
   - Module-level `local x; x = ...` pulls in `local x` via `beforeLine` (and skips a later assignment); preamble helper referencing an install local stays unresolved; sibling function parameter is not misattributed by `parameterOf`; claim hook needing a block that only appears post-claim or inside `wa.weapons.replace` is NOT dropped; `hasFloatRandom`/`rewrittenCalls` ignore comments/strings; `rewriteBundlePaths` ignores `--` comments, requires matching quotes, and records same-folder prefix moves; nested `expandFolder` (`sounds/foo/sub/`) and exact `spriteDecls[source]` precedence over basename collisions.
4. Mutation-check at least 4 F13 fixes (break -> FAIL -> restore -> PASS).

### Pending B: F14 - Critical / Zero Preview Fidelity Fixes (4 Verified Bugs)
Note: User explicitly asked NOT to re-audit all preview canvases ("I know it's good"), only apply these 4 verified critical/zero fixes:
1. **`src/components/HoldPreview.tsx:1380-1387`**: `!facingRight` applies `ctx.translate(cellX + SIZE, cellY); ctx.scale(-1, 1);` without `ctx.save()/ctx.restore()`, leaking the mirror transform into the melee strike scan box drawn at lines 1393+. Fix: wrap the `!facingRight` branch in `ctx.save(); ... ctx.restore();`.
2. **`src/utils/sheetTint.ts:10-35`**: Line 18 allows unprefixed 6-hex (`"ff0000"`) into `ctx.fillStyle`, which Canvas 2D rejects as invalid CSS (silently staying black `#000000`), and neither `tintedSheet` nor `parseHexColour` accepts 3-hex (`"#f00"`). Fix: export `normalizeTintHex(color: string): string` normalizing 3- or 6-digit hex (with or without `#`) to `#rrggbb` (fallback `#ffffff`), and use it in both `tintedSheet` and `parseHexColour`. Pin with unit tests in `tools/check_generator_edges.ts` and mutation-check.
3. **`src/components/ExplosionPreview.tsx:239, 465`**: `config.fade || 0.55` turns `fade = 0` into `0.55` (disagreeing with `luaGenerator.ts` / `px_effects.lua:416` where `0` is truthy). Fix: `config.fade ?? 0.55` at both lines.
4. **`src/components/EmitterPreview.tsx:242-243, 744-773, 840`**:
   - Lines 242-243 (`cosmetics`): `cfg.reachCoreWidth > 0 ? ... : 8` and `cfg.reachGlowWidth > 0 ? ... : 13` swallow `0` (`EmitterCard.tsx:584` explicitly documents `"0 draws the core only"`, and `luaGenerator.ts:358-359` emits `0`). Fix: `Math.max(0, cfg.reachCoreWidth ?? 8)` and `Math.max(0, cfg.reachGlowWidth ?? 13)`, and guard line 840 `if (bolt.coreW > 0) ribbon(build(bolt.coreW), 'beam', false);`.
   - **Do NOT touch `ringWidths` (lines 257-258)**: for rings, `0` genuinely means auto-from-radius (`luaGenerator.ts:392-396` uses `if (em.ring.coreWidth > 0)`).
   - Lines 744-773 (`cfg.trail`): `const coreW = Math.max(0, cfg.trail.coreWidth ?? 8); const glowW = Math.max(0, cfg.trail.glowWidth ?? 0);`, guard `if (coreW > 0) ribbon(points, 'beam', false);`, and compute glow width as `p.alpha * glowW` instead of `(p.width / coreW) * glowW` (which would divide `0 / 0 = NaN` when `coreW === 0`).

### Pending C: F15 - UI State, Zero/NaN Safety, and Component Contracts (12 Verified Bugs)
1. **`StockSpriteInput` numeric `NaN` leak (`src/components/StockSpriteInput.tsx:54-55`, `RecordEditor.tsx:1356, 1377, 1391, 2008`, `HoldPreview.tsx:5467`)**:
   - Typing a partial sprite name like `"s"` in a numeric `StockSpriteInput` emits `"s"`, causing callers to write `Number("s") = NaN` into `roamConfig.{gas_animal_sprite, flight_1, flight_2}` / `body.clustlet.roam.gas_animal_sprite`, turning the input into `"NaN"` and emitting `NaN` in Lua.
   - Fix: buffer local draft text in `StockSpriteInput` when `numeric` is true, committing `onChange` only for `''`, valid finite non-negative integer, or recognized `stockSpriteId(trimmed)` (reset draft on blur); also guard `Number.isFinite` at all 5 callers.
2. **`RecordEditor.tsx:2005-2010` missing `DEFAULT_BIT_ROAM` fallback**:
   - Editing cluster-bit `Gas Pose Sprite` spreads `project.body.clustlet.roam as RoamActionConfig` without `?? DEFAULT_BIT_ROAM`, dropping required `RoamActionConfig` fields when `roam` is `undefined`. Fix: `...(project.body.clustlet.roam ?? DEFAULT_BIT_ROAM)`.
3. **`RecordEditor.tsx` ignores `recordField(project, path, fallback)` (~30+ controls)**:
   - Never imports `src/utils/recordField.ts`. Affects collision masks (`:402-410`, `:2584`, `:2653`), `numField` (`:434`), `animField` (`:471`), and direct reads (`:850, 888, 930, 1022, 1034, 1041, 1067, 1158, 1165, 1182, 1205, 1210, 1219, 1291, 1300, 2148, 2196, 2264, 2272, 2350-2395, 2422, 2450, 2469, 2488, 2753`). On Moon Grenade preset (`recordOverrides: {}`, `donorBaseline = grenade`), Launch Power shows `100%` instead of `0%`, `Detonates On Contact` shows 5 checked targets instead of `{}`, `Bounces Off` shows `{}` instead of 9 targets, and toggling any box corrupts the mask.
   - Fix: import `recordField` and route those reads through `recordField(project, path, fallback)` (verify each control's expected type against `stockDonors.json` baselines).
4. **`WeaponSettings.tsx:155-159` ignores `recordField` for `handling.*`**:
   - Hardcodes `project.recordOverrides['handling.*'] ?? ...` instead of `recordField(project, 'handling.*', ...)`, hiding Shotgun `shots = 2`, Mine/Dynamite `retreat = 5000`, etc.
5. **`HoldPreview.tsx:2343-2345` ignores `recordField` for `roamWalkPose`**:
   - Reads `project.recordOverrides['missile.sprite'] ?? project.body.sprite` instead of `recordField(project, 'missile.sprite', project.body.sprite)`, disagreeing with `luaGenerator.ts:2470` on roaming `.wep` imports (e.g. Aqua Sheep `153`).
6. **`WepImportModal.tsx:490` + `App.tsx:404-416` + `WeaponSettings.tsx:569-583` (`wepBaseline` corruption)**:
   - Importing a `.wep` with `Use .wep weapon file` unchecked clears `wepBaseline = undefined`; editing fields and later toggling `Use imported .wep` on in `WeaponSettings` snapshots the edited `project` as `wepBaseline`, silently dropping all prior edits on export.
   - Fix: in `WepImportModal.tsx:490`, only clear `patch.wepBaseline = undefined` in the `else` branch (`!parseResult.wepFile`); in `App.tsx:404`, preserve/snapshot `wepBaseline` whenever `parsed.wepFile` exists (both `luaGenerator.ts:2416` and `recordField.ts:20-21` already gate `wepBaseline` on `project.useWepFile`).
   - Pin `recordField` (`useWepFile = false` reads `donorBaseline` even when `wepBaseline` is populated; `useWepFile = true` reads `wepBaseline`; `recordOverrides` beats both including `0`/`false`) in `tools/check_copyfrom.ts` and mutation-check.
7. **`HoldPreview.tsx:262-265` (`RoamSheetField` wipes uploaded asset)**:
   - Editing `Frames` calls `onChange({ frames: next, rotationFrames: ... })` without `...asset`, wiping `file`, `fileName`, and `preview`. Fix: spread `...asset`.
8. **`NumberInput.tsx:33-36` + `HoldPreview.tsx:3891-3904` (Space Swing keyframe `Frame` cannot be cleared)**:
   - `NumberInput` drops `''` without firing `onChange`, making `patchKey({ frame: undefined })` unreachable. Fix: add optional `allowEmpty?: boolean` prop to `useNumberDraft` / `NumberInput`, pass `allowEmpty` on the Space Swing keyframe `Frame` cell.
9. **`HoldPreview.tsx:2064, 2107, 2194, 2218, 2236, 3147-3153, 4591-4597` (`<input type="file">` reuse)**:
   - Aim/Firing and Main/Secondary flight roles share `<input type="file">` without `key` or `e.target.value = ''`, so uploading the same filename on a second tab/role or after removal fires no `change` event. Fix: reset `e.target.value = ''` in all 4 upload handlers + `removeCustomRoleSheet`, and add distinct `key` props to both file inputs.
10. **`MeleeCard.tsx:67-80, 162-180, 324-358, 459-478, 508-532, 652-688` & `WeaponOptionsPanel.tsx:144-156`**:
    - Raw `<input type="number">` blocks clearing or typing `-` (negative `vx`/`vy`/`lift` or negative int options), and `MeleeCard` `field()` hardcodes `min={0}` on `vx`/`vy`/`lift`. Fix: switch to `NumberInput` and pass explicit `min={0}` only for non-negative fields (`damage`/`power`), allowing negative `vx`/`vy`/`lift`.
11. **`App.tsx:212-220` global `1`-`4` hotkeys**:
    - Fires on `Ctrl/Cmd/Alt+1..4` and inside `contenteditable`. Fix: guard `e.ctrlKey || e.metaKey || e.altKey` and `(e.target as HTMLElement | null)?.isContentEditable`.
12. **`PackSettingsCard.tsx:35, 231-244` (`Replaces bundles` input strips trailing comma)**:
    - `.split(',').map(trim).filter(Boolean)` on every keystroke eats `,` immediately. Fix: buffer raw draft string locally, sync on blur and external `pack.replaces` changes.
13. **`TooltipTap.tsx:40, 140` (`onClick={close}` resolves to `window.close`)**:
    - `const close` is scoped inside `useEffect`, so JSX `onClick={close}` binds global `window.close` (attempts to close browser tab / Tauri window). Fix: hoist `close` (or `dismiss`) to component scope.

### Pending D: Full Phase 1 Rerun & Hygiene Verification
Run every command in full and verify exit 0 + exact counts:
- `bun run lint`
- `bun run build`
- `bun run tools/gen_test_pack.ts`
- All 10 `tools/check_*.ts` (`check_generator_edges`, `check_copyfrom`, `check_sheet_dedupe`, `check_pack_roundtrip`, `check_pack_fixture`, `check_mod_import`, `check_carried_lua`, `check_lua_hooks`, `check_lua_rules`, `check_module_scan`)
- `bun run tools/audit_records.ts "D:\Worms Armageddon\WormForge\Mods"`
- `bun run tools/audit_bundles.ts "D:\Worms Armageddon\WormForge\Mods"`
- `& 'C:\Users\lucia\Documents\GitHub\Worm-Forge-Lua-Editor\compiler-cli\wfcheck.exe' --format pretty test_pack\wftest_pack`
- All 5 Python harnesses: `python tools/lua/harness_{melee,flight,effects,emitter_weapon,trail_bits}.py`
- Verify `git diff` additions contain **zero** U+2014 em dashes (`—`) and unrelated diffs remain untouched.

---

## 4. Already Cleared & Confirmed False Positives (Do Not Re-Audit)

- **Cleared**:
  - `src/data/sdkModules.ts` matches all 5 installed `wf-lib/*/mod.toml` manifests.
  - `src/data/luaHooks.ts` matches all 17 `bind_on` events in `WormForgeNew/.../lua-host/src/api.rs`.
  - Multi-`onChange` stale-spread audit across `App.tsx` and `src/components/*.tsx`: 0 defects (functional `setPack((prev) => ...)` and disjoint patches).
  - Keyframe tick inputs: both clip keys (`HoldPreview.tsx:3833`) and melee strikes (`MeleeCard.tsx:482`) use `KeyTickInput` (commits on blur/Enter).
  - `assetUrl()` coverage: 0 hardcoded `/assets/...` paths in `src/` (`index.html:13` is rewritten to `./assets/...` by Vite under `base: './'`).
  - Em-dash scan across `src/` and `spec/lua_sdk/`: 0 U+2014 characters.
- **Confirmed False Positives**:
  - `EmitterPreview.tsx:257-258` (`ringWidths` `> 0` fallback): intentional `0 = auto from radius`, matching `luaGenerator.ts:392-396`.
  - `index.html:13` `/assets/wormforge-mark.png`: rewritten by Vite `base: './'`.

---

## 5. Other Potential Areas to Investigate & Suite Blind Spots (Worth Checking on High / XHigh)

1. **Multi-weapon pack export + cross-weapon sheet dedupe edge cases (`packExporter.ts`, `sheetDedupe.ts`)**:
   - Check what happens when two weapons in one pack share identical carried sprite/sound bytes OR when one weapon carries `sprites/<mod>/foo.png` and another uses a different `frames`/`fps`/`play` declaration on identical PNG bytes.
   - Check `weps/<slug>/<file>.wep` collision when two weapons in a multi-weapon pack import `.wep` files with the same basename or after weapon rename/duplicate (`retargetWeaponArt` in `pack.ts` — verify whether `wepFileName` or carried `art.sounds` / `packArt` / `roamSheets` / `terrainStamp` / `customSounds` paths get retargeted on duplicate/rename).
2. **`RecordEditor.tsx` `recordField` type-coercion audit during F15**:
   - Double-check every `recordOverrides` key in `stockDonors.json` vs `RecordEditor.tsx` controls (e.g., `missile.sprite` string vs number, `missile.trail.sprite` `'none'` vs `'0'` vs numeric id, `missile.ends_on_contact` / `missile.bounce.hits` string array vs object `CollisionMask`, `strike.munition` enum vs number) so switching to `recordField` never breaks controlled inputs or masks.
3. **Playwright E2E UI smoke check (zero coverage in `tools/check_*.ts`)**:
   - None of `tools/check_*.ts` mount React components. Consider a quick scratch Playwright script (`%TEMP%\wf_pw`, using Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` against `bun run preview`) to prove the F15 UI fixes live: Moon Grenade preset masks/launch power, `StockSpriteInput` typing `"skunk2"`, `PackSettingsCard` typing `"a, b"`, `MeleeCard` negative `vy`, `HoldPreview` left-facing melee box transform, and `TooltipTap` click not closing the window.
4. **`modExporter.ts` vs `packExporter.ts` divergence**:
   - Verify whether any legacy code path in `src/utils/modExporter.ts` is still invoked directly (e.g. single-weapon export vs pack export) and whether it shares all `validateBundle` / dedupe / `holdSheetPath` / `meleeStrikes` fixes from F3/F7.
5. **Tauri / desktop & server routes (`server.ts` / `src-tauri/`)**:
   - Not audited yet: check if `server.ts` or Tauri commands have path-handling, binary `.wep` loading, or `Mods/` folder scanning edge cases on Windows paths (backslashes, non-ASCII filenames, missing `mod.toml`).
6. **`audit_records.ts` 27 `no decoded donor` cases**:
   - Running `python tools/px_scheme_weps.py "<WA+PX>/PXSchemes/default.pxs" "$env:TEMP\wf_px\default" --all` (read-only from `WormForgeNew`) would let `audit_records.ts` validate all 27 remaining PX donors as well.