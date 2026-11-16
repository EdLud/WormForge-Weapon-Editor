"""Run the melee / swing half of `wfws_sprite_builder` against a fake `wa`.

The swing is simulation code: it only runs inside Worms Armageddon, so every
mistake in it (an early return, a gate that never opens, a handle that never
compares equal) costs a round trip into the game. This harness loads the real
SDK, builds a melee hold, presses Space and walks the clip, reporting what the
layer drew, what the strike hit and whether it released the worm.

    python -m pip install lupa
    python tools/lua/harness_melee.py            # exits 1 on a failure

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
WORM = {
    "id": 1, "hp": 100, "turn": True, "visible": True, "body_visible": True,
    "weapon": "test.bat", "x": 1000, "y": 1000, "vx": 0, "vy": 0,
    "facing": 1, "aim": 0.5, "aim_target": 0.0, "state_id": 0x68, "state": "ready",
    "taken": False,
}
# `facing = 1` points the barrel right, so the worm it reaches stands at x + 24.
VICTIM = {
    "id": 2, "hp": 100, "turn": False, "visible": True, "body_visible": True,
    "weapon": "stock.grenade", "x": 1024, "y": 1000, "vx": 0, "vy": 0,
    "facing": -1, "aim": 0.5, "aim_target": 0.0, "state_id": 0x65, "state": "standing",
    "taken": False,
}
LOG = []
QUADS = []
EVENTS = []


def worm_record(w):
    t = lua.table()

    def take(_self, opts=None):
        freeze = opts is not None and opts["turn"] == "freeze"
        w["taken"] = True
        EVENTS.append(("take", freeze))
        return True

    def release(_self, vx=None, vy=None, opts=None):
        w["taken"] = False
        EVENTS.append(("release", vx, vy))
        return True

    def hurt(_self, opts=None):
        amount = opts["amount"] if opts is not None else 0
        w["hp"] -= amount or 0
        EVENTS.append(("hurt", w["id"], amount))
        return True

    t.take = take
    t.release = release
    t.hurt = hurt
    for k, v in w.items():
        t[k] = v
    return t


WORMS = [WORM, VICTIM]
RECORDS = [worm_record(w) for w in WORMS]

# The engine hands out a *new* `WormHandle` userdata per `wa.worms.all()` call and
# defines no `__eq`, so two handles for one worm never compare equal. The harness
# has to model that, or it hides the very bug it exists to catch.
lua.execute("""
local records = ...
function fresh_worm(id)
  local rec = records[id]
  return setmetatable({}, {
    __index = function(_, k) return rec[k] end,
    __newindex = function(_, k, v) rec[k] = v end,
  })
end
""", {1: RECORDS[0], 2: RECORDS[1]})
FRESH = lua.globals()["fresh_worm"]


def all_worms():
    out = lua.table()
    for i, w in enumerate(WORMS, 1):
        out[i] = FRESH(w["id"])
    return out


wa = lua.table()
wa.log = lambda msg: LOG.append(str(msg))
wa.msg = lua.table()
wa.msg.FRAME_FINISH = 40
wa.world = lua.table()
wa.world.frame = lambda: WORLD["frame"]
wa.world.keys = lambda: lua.table_from(WORLD["keys"])
wa.world.set_turn_clock = lambda ms: EVENTS.append(("turn_clock", ms))
wa.worms = lua.table()
wa.worms.all = all_worms
wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
wa.draw = lua.table()


def quad(*args):
    # `wa.draw.quad(table)`: one reused table carrying `sheet`, `points`, `blend`, …
    t = args[0]
    pts = t["points"]
    p1 = pts[1] if pts is not None else None
    QUADS.append({
        "sheet": t["sheet"],
        "blend": t["blend"],
        "tint": t["tint"],
        "x": p1["x"] if p1 is not None else None,
        "y": p1["y"] if p1 is not None else None,
    })


wa.draw.quad = quad
DRAW = []
MSG = []
wa.on = lua.table()
wa.on.draw = lambda fn: DRAW.append(fn)
wa.on.worm_message = lambda fn, opts=None: MSG.append(fn)
wa.weapons = lua.table()
wa.weapons.hold_sheet = lambda weapon, n: EVENTS.append(("mute", n))

lua.globals()["wa"] = wa

# `wf.sdk` is only needed for `holds.PX_HANDS`/`PX_POSTURE`; the spec names its
# sheets by hand here, so a stub is enough.
lua.execute("""
package.preload["wf-lib/holds"] = function()
  return { PX_HANDS = { [1] = "hand_rad.png", [2] = "hand_rad.png", [3] = "hand_rad_lower.png" } }
end
""")

sb = lua.execute('return assert(loadfile(%r))()' % SDK.replace("\\", "/"))

ctx = lua.table()
ctx.id = "test.bat"


def build_spec(weapon="test.bat", weap_rotation=1):
    spec = lua.table_from({
        "weapon": weapon,
        "sheet": "sprites/test.bat/hold.png",
        "silent_sheet": "sprites/test.bat/silent.png",
        "cell_size": 60,
        "hand_type": "mid",
        "weap_radius": 6,
        "weap_rotation": weap_rotation,
        "weap_radial_rotation": 1,
        "weap_scale": 1,
        "hand_radius": 10,
        "hand_rotation": 1,
        "hand_radial_rotation": 1,
        "draw_hand": True,
        "frames": 1,
        "swing": lua.table_from({
            "ticks": 16,
            "finish": "end_turn",
            "keys": lua.table_from([
                lua.table_from({"t": 0, "angle": 0, "dx": 0, "dy": 0, "scale": 1}),
                lua.table_from({"t": 8, "angle": -30, "dx": 0, "dy": 0, "scale": 1}),
                lua.table_from({"t": 16, "angle": 0, "dx": 0, "dy": 0, "scale": 1}),
            ]),
        }),
        "melee": lua.table_from({
            "radius": 32, "width": 16, "follow_swing": True, "hit_frame": 8,
            "push": "aim", "power": 3, "lift": 1, "log": True,
        }),
    })

    # The claim's own hit callback, written the way the generator writes it:
    # `hit = function(victim, vx, vy) victim:hurt{ amount = 24, vx = vx, vy = vy } end`
    spec["melee"]["hit"] = lua.execute(
        "return function(victim, vx, vy) victim:hurt{ amount = 24, vx = vx, vy = vy } end")
    return spec


hold = sb.hold(ctx, build_spec())
if hold is None:
    print("FAIL  M.hold returned nil")
    sys.exit(1)
print("layer registered: draw=%d message=%d" % (len(DRAW), len(MSG)))
if not DRAW or not MSG:
    print("FAIL  the layer never registered. log:", LOG)
    sys.exit(1)
draw_fn = DRAW[0]
msg_fn = MSG[0]


def step(n, space=False):
    """One 50 Hz frame: the draw, then WA's frame-end messages, then the draw."""
    WORLD["frame"] = n
    WORLD["keys"]["space"] = space
    for i, rec in enumerate(RECORDS):
        for k, v in WORMS[i].items():
            rec[k] = v
    QUADS.clear()
    draw_fn()
    msg_fn(all_worms()[1], wa.msg.FRAME_FINISH)
    draw_fn()


failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  " + detail) if detail else ""))
    if not ok:
        failures.append(name)


# Aiming, no press: the layer draws the held art and mutes the engine sheet.
step(1)
check("aiming draws the hold", len(QUADS) > 0, "%d quad(s)" % len(QUADS))
check("engine sheet muted while drawing", ("mute", 1) in EVENTS)

# Space: the swing takes the worm on the same frame and starts drawing.
step(2, space=True)
check("Space takes the worm", ("take", True) in EVENTS)
check("the press frame draws the swing", len(QUADS) > 0, "%d quad(s)" % len(QUADS))

# Hold Space for the whole clip: WA would repeat the key, but the swing ignores it.
for n in range(3, 12):
    step(n, space=True)
check("the strike dealt damage", VICTIM["hp"] < 100, "victim hp %d" % VICTIM["hp"])
check("the strike pushed through the callback",
      any(e[0] == "hurt" and e[1] == 2 and e[2] == 24 for e in EVENTS),
      str([e for e in EVENTS if e[0] == "hurt"][:2]))
check("inside the box, one hit only", len([e for e in EVENTS if e[0] == "hurt"]) == 1)
check("no second take while swinging", len([e for e in EVENTS if e[0] == "take"]) == 1)

for n in range(12, 20):
    step(n, space=True)
check("the clip releases the worm", ("release", 0, 0) in EVENTS)
check("finish = end_turn ends the turn", ("turn_clock", 0) in EVENTS)
check("one take, one release",
      len([e for e in EVENTS if e[0] == "release"]) == 1,
      str([e for e in EVENTS if e[0] in ("take", "release")]))

# A taken worm is not guaranteed to keep WA's aim state, and the clip must not
# depend on it: the swing is its own clock, so the art keeps drawing with the
# worm in a plain standing state.
EVENTS.clear()
WORM["state_id"] = 0x65
step(50)
step(51, space=True)
check("a press starts the swing in a non-aim state", ("take", True) in EVENTS)
draws = 0
for n in range(52, 60):
    step(n, space=True)
    draws += len(QUADS)
check("the clip draws without an aim state", draws > 0, "%d quad(s) over 8 frames" % draws)
for n in range(60, 68):
    step(n, space=True)
check("the clip still ends in a non-aim state", ("release", 0, 0) in EVENTS)
WORM["state_id"] = 0x68

# WA may stop reporting our weapon during the clip (the worm is taken, its
# selection can drift). The swing is its own clock, so it must still draw and
# still land its hit.
EVENTS.clear()
VICTIM["x"] = 1024
VICTIM["hp"] = 100
step(80)
step(81, space=True)
WORM["weapon"] = "stock.grenade"
draws = 0
for n in range(82, 90):
    step(n, space=True)
    draws += len(QUADS)
check("the clip draws after the selection drifts", draws > 0, "%d quad(s)" % draws)
check("the strike still lands after the drift", VICTIM["hp"] < 100, "victim hp %d" % VICTIM["hp"])
for n in range(90, 100):
    step(n, space=True)
check("the clip still ends after the drift", ("release", 0, 0) in EVENTS)
WORM["weapon"] = "test.bat"

# A sheet turned 40 degrees is still the same weapon: `weap_rotation` is a drawing
# control and must not turn the box.
rot_ctx = lua.table()
rot_ctx.id = "test.bat.rot"
sb.hold(rot_ctx, build_spec("test.bat.rot", 1 + 40 / 180))
EVENTS.clear()
WORM["weapon"] = "test.bat.rot"
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 1024, 1000
VICTIM["hp"] = 100
step(60)
step(61, space=True)
for n in range(62, 78):
    step(n, space=True)
check(
    "a turned sheet does not turn the box",
    VICTIM["hp"] < 100,
    "victim hp %d (weap_rotation must be a drawing control only)" % VICTIM["hp"],
)
WORM["weapon"] = "test.bat"

# The box follows the aim: down when the worm aims down,
# up when it aims up, and forward at a level aim with a POSITIVE `weap_radius`.
# (Reading "forward" off `weap_radius` inverted the box for every positive
# radius, so a strike only landed on whatever the worm had its back to.)
for aim, dx, dy, label in (
    (0.5, 24, 0, "forward at a level aim"),
    (0.0, 0, 26, "down when the worm aims down"),
    (1.0, 0, -26, "up when the worm aims up"),
):
    EVENTS.clear()
    WORM["aim"] = aim
    VICTIM["x"], VICTIM["y"] = 1000 + dx, 1000 + dy
    VICTIM["hp"] = 100
    step(110)
    step(111, space=True)
    for n in range(112, 128):
        step(n, space=True)
    check("the box points " + label, VICTIM["hp"] < 100, "victim hp %d" % VICTIM["hp"])
WORM["aim"] = 0.5
VICTIM["y"] = 1000

# A swing that misses: the victim leaves the box, and the press still plays.
EVENTS.clear()
VICTIM["x"] = 1400
step(30)
step(31, space=True)
for n in range(32, 48):
    step(n, space=True)
check("a miss still runs the whole clip", ("take", True) in EVENTS and ("release", 0, 0) in EVENTS)
check("a miss deals no damage", not [e for e in EVENTS if e[0] == "hurt"])

print()
for line in LOG:
    print("  log:", line)
print()
if failures:
    print("FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all checks passed")
