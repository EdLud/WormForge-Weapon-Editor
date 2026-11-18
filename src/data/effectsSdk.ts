// The exported ZIPs ship the effects.sdk library, so the editor needs its files
// as strings. The Lua and the manifest are imported straight from
// `spec/lua_sdk/effects_sdk/` with Vite's `?raw`, one source of truth, and the
// sheets are the SDK's own PNGs resolved as URLs and fetched when an export
// writes them: nothing here copies art into `public/`, so an SDK sheet only
// exists once in the repository.
//
// Why ship it at all: an export used to carry `dependencies = ["effects.sdk"]`
// and nothing else, so a player without the library, or with an older copy,
// could not load a weapon whose effects need 0.4.3. The bundle's own library is
// the version it was generated against, the same way `wfws.sdk` ships.
//
// The folder is the catalogue's own (`Mods/wf-lib/effects_sdk/`), so unpacking
// an export over an installed copy updates that copy in place instead of
// leaving a second bundle with the same id, which the engine refuses
// (`bundle effects.sdk is installed more than once; keep one copy`).
import effectsSdkToml from '../../spec/lua_sdk/effects_sdk/mod.toml?raw';
import pxEffectsLua from '../../spec/lua_sdk/effects_sdk/libs/px_effects.lua?raw';
import trailLua from '../../spec/lua_sdk/effects_sdk/libs/trail.lua?raw';
import customExplosionLua from '../../spec/lua_sdk/effects_sdk/libs/custom_explosion.lua?raw';

/** mod.toml for the effects.sdk library bundle (`id = "effects.sdk"`). */
export const EFFECTS_SDK_MOD_TOML = effectsSdkToml;

/** The library's modules, at the paths its `[exports]` table names. */
export const EFFECTS_SDK_FILES: { path: string; text: string }[] = [
  { path: 'wf-lib/effects_sdk/libs/px_effects.lua', text: pxEffectsLua },
  { path: 'wf-lib/effects_sdk/libs/trail.lua', text: trailLua },
  { path: 'wf-lib/effects_sdk/libs/custom_explosion.lua', text: customExplosionLua },
];

/**
 * Every sheet the manifest declares, with the URL Vite gives its bytes and the
 * path it has inside the library folder. The declarations and the files have to
 * agree or the engine refuses the library (`declared asset ... is missing`), so
 * this list is built from the folder itself rather than hand-copied.
 */
export const EFFECTS_SDK_SHEETS: { path: string; url: string }[] = Object.entries(
  import.meta.glob('../../spec/lua_sdk/effects_sdk/sprites/**/*.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>,
)
  .map(([source, url]) => {
    const at = source.indexOf('sprites/');
    const relative = at >= 0 ? source.slice(at) : source.split('/').pop();
    return { path: `wf-lib/effects_sdk/${relative}`, url };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

// The question "does this weapon need the library" is asked by the emitter, so it
// lives there (`packExporter.ts`'s `needsEffectsSdk`) rather than here: this module
// is Vite-only (the `?raw` and `import.meta.glob` above), and the emitter has to
// run without a bundler. One rule, in the module that can be tested.
