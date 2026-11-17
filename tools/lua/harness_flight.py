"""Run the flight half of `wfws_sprite_builder` against a fake `wa`.

The flight handler only runs inside Worms Armageddon, and the mistakes that cost
a round trip are the quiet ones: a table that is never freed, an identity that
is not re-decided, a frag that is not recognised as a frag. This harness loads
the real SDK, drives `missile_frame` for both WA phases over a run of 50 Hz
frames, and reports what the builder classified and what it spawned.

    python -m pip install lupa
    python tools/lua/harness_flight.py           # exits 1 on a failure

It covers the two findings of `reqs/audit_wfws_sprite_builder_2026-11-16.md`
that changed SDK behaviour:

  - A2: a missile that never gets a follower (a walking animal WA draws itself)
    is swept after a second, so its per-missile entries cannot outlive the
    match. The one-frame cost of that is one fresh classification.
  - B11: `bits = "inherit"` keeps the primary's art but still classifies a frag
    as a bit, which is what an effect's `target` reads.

It is a development aid, not part of `bun run lint` / `build`: `lupa` is not a
project dependency.
"""
import math
import sys

from lupa import LuaRuntime

SDK = 'C:/Users/lucia/Documents/GitHub/WormForge Weapon Editor/spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua'

lua = LuaRuntime(unpack_returned_tuples=True)

# ---------------------------------------------------------------- the fake wa ---
WORLD = {"frame": 0, "keys": {"space": False}}
LOG = []
SPAWNS = []
CALLS = {}
FRAMES = []

wa = lua.table()
wa.log = lambda msg: LOG.append(str(msg))
wa.msg = lua.table()
wa.msg.FRAME_FINISH = 40
wa.world = lua.table()
wa.world.frame = lambda: WORLD["frame"]
wa.world.keys = lambda: lua.table_from(WORLD["keys"])
wa.worms = lua.table()
wa.worms.all = lambda: lua.table()
wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
wa.math.atan = math.atan
wa.draw = lua.table()
wa.draw.quad = lambda *a: None
wa.on = lua.table()
wa.on.missile_frame = lambda fn: FRAMES.append(fn)
wa.on.draw = lambda fn: None
wa.on.worm_message = lambda fn, opts=None: None
wa.on.body_move = lambda fn, opts=None: None
wa.weapons = lua.table()
wa.weapons.hold_sheet = lambda weapon, n: None


def spawn(spec):
    # A follower actor: `sb.flight` writes `.x/.y/.vx/.vy/.facing` and calls
    # `frame`, `gfx` and `despawn` on it.
    SPAWNS.append(spec)
    actor = lua.table()
    for name in ("frame", "gfx", "despawn", "sound"):
        actor[name] = lambda *a: None
    return actor


wa.actors = lua.table()
wa.actors.spawn = spawn
lua.globals()["wa"] = wa

# `wf.sdk` only supplies the hold sheets, which this half never names.
lua.execute(
    'package.preload["wf-lib/holds"] = function() return { PX_HANDS = {}, PX_POSTURE = {} } end'
)
sb = lua.execute('return assert(loadfile(%r))()' % SDK.replace("\\", "/"))


# ------------------------------------------------------------------- helpers ---
def counter(m):
    """`is_bit` counts classifications: identity is decided once per missile."""
    CALLS[m["id"]] = CALLS.get(m["id"], 0) + 1
    return False


def missile(mid, sprite, weapon):
    m = lua.table()
    m.id = mid
    m.weapon = weapon
    m.sprite = sprite
    m.x, m.y, m.vx, m.vy = 1000.0, 1000.0, 0.0, 0.0
    m.phase = "pre"
    m.despawn = lambda *a: None
    return m


def step(mid, sprite, weapon):
    """One 50 Hz frame: WA delivers the missile to both its phases."""
    WORLD["frame"] += 1
    for phase in ("pre", "post"):
        for fn in FRAMES:
            m = missile(mid, sprite, weapon)
            m.phase = phase
            fn(m)


def flight(weapon, track=True, **opts):
    spec = lua.table_from({"weapon": weapon, "sheet": "sprites/test/missile.png"})
    if track:
        spec["is_bit"] = counter
    for key, value in opts.items():
        spec[key] = value
    sb.flight(None, spec)


fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok or not detail else f"  [{detail}]"))
    if not ok:
        fails += 1


# ---- A2: a missile with no follower is swept, one with a follower is not -----
# A roaming animal WA walks itself: `walk = 900` is its record sprite, so the
# builder hands the art back every pre frame and never makes a follower.
flight("test.roam", roam=lua.table_from({"walk": 900}))
for _ in range(60):
    step(7, 900, "test.roam")
check("the walking animal is classified once", CALLS.get(7) == 1, str(CALLS.get(7)))
check("WA keeps its own walk pose: no follower", len(SPAWNS) == 0, str(len(SPAWNS)))
check("its role is answered while WA draws it", sb.role(7) == "main", repr(sb.role(7)))

# A round a second later is when the sweep is due, and it is the only thing that
# can free a missile the follower never owned.
step(8, 900, "test.roam")
check("the newcomer is classified", CALLS.get(8) == 1, str(CALLS.get(8)))
step(7, 900, "test.roam")
check(
    "the second-old entry with no follower was swept and re-classified",
    CALLS.get(7) == 2,
    f"{CALLS.get(7)} classifications",
)
check("and it is still the main role", sb.role(7) == "main", repr(sb.role(7)))
check("the sweep spawned nothing", len(SPAWNS) == 0, str(len(SPAWNS)))

# A normal round: the follower owns this state, so the sweep must leave it alone
# however old the id is.
flight("test.plain")
for _ in range(3):
    step(9, 0, "test.plain")
check("a drawn round gets its follower", len(SPAWNS) == 1, str(len(SPAWNS)))
check("and is classified once", CALLS.get(9) == 1, str(CALLS.get(9)))
step(10, 0, "test.plain")
step(9, 0, "test.plain")
check(
    "a round with a follower is never swept, however old",
    CALLS.get(9) == 1,
    f"{CALLS.get(9)} classifications",
)
check("its role is still answered", sb.role(9) == "main", repr(sb.role(9)))

# ---- B11: `bits = "inherit"` keeps the art but not the identity --------------
# The generator never writes `inherit`; a hand-written bundle does, and a trail
# or burst with `target = "bit"` reads this answer.
flight("test.inherit", track=False, bits="inherit")
step(11, 500, "test.inherit")
check("a frag of an inheriting role is a bit", sb.role(11) == "bit", repr(sb.role(11)))
flight("test.nobits", track=False)
step(12, 500, "test.nobits")
check(
    "and a round of a plain weapon is still the round",
    sb.role(12) == "main",
    repr(sb.role(12)),
)

if fails > 0:
    print(f"\n{fails} check(s) failed")
    sys.exit(1)
print("\nall checks passed")
