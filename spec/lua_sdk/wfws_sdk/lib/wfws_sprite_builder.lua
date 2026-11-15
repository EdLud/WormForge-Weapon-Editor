-- wfws_sprite_builder.lua -- WFWS's own fork of PX's sprite builder.
--
-- Two layers of gating:
--
--   IDENTITY (decided once, on first sight): which kind of missile is this?
--     primary, cluster bit, or an extra `roles` entry. Cached per missile id.
--
--   STATE (re-evaluated every pre phase): what is it doing right now?
--     homing, digging, or a roaming animal waiting to take off. Each state may
--     swap the art, the animation, or hand the missile back to WA (native).
--
--   ROAM (`roam = true`): a roaming animal walks until the turn's player
--     presses Space, then flies. WA draws the walk from `m.sprite`, which is
--     normal-flight art only; the generator zeroes `sheep.flight_1/2` (the
--     flown art) and leaves the walk pose alone when WA can draw it, passing its
--     id as `walk` so the classifier still knows the primary. When that pose
--     cannot draw (an imported Project X sprite number, or none), the record
--     `sprite` is zeroed too and the builder draws the walk itself: upright,
--     with the owning role's frames.
--
--   DIG is not a state: a digging round has no art of its own. The record's
--     dig sprite indexes are zeroed (a mole or the wsv* frames would draw
--     underneath), and the builder simply cycles the flight sheet while the
--     nose is in the land. See `dig =` below.
--
-- API:
--
--   sb.flight(ctx, {
--     weapon = ctx.id,
--     sheet = "...", anim = "track", ...        -- primary art
--     size  = 1.25,                             -- every sheet, every role
--     angle = 90,                               -- degrees added to the draw
--     bits  = { sheet = "...", ... } | "inherit" | nil/false (native)
--     is_bit = function(m) ... end,             -- optional classifier override
--     roles  = { { name = "x", match = function(m) ... end, sheet = "..." } },
--     dig    = true | { probe = 6, spread = 3, hold = 3, need = 2 },
--     roam   = true | { walk = 153, fly = 699 }, -- roaming animal (see ROAM)
--     states = {
--       { scope = "main" | "bit" | "any" | <role name>,
--         sig  = 245 | { 246, 247, 248 },       -- native sprite ids that mean
--                                               -- "in this state"
--         when = function(m) ... end,           -- or any custom test
--         sheet = "...", anim = "...", ...      -- art for this state
--         native = true },                      -- OR: leave WA's art alone
--     },
--   })
--
-- STATE SIGNAL (legacy, `sig`): an old assumption that WA writes the
-- behaviour's own sprite id into m.sprite. It does not -- `m.sprite` is the
-- flight sprite and nothing else -- so new work should time the state (homing
-- arm/time in ms) or probe for it (dig) instead of matching ids. `sig` stays
-- only for bundles that still pass one.
--
-- Default bit test: `m.sprite ~= 0` at first sight. `m.sprite` is the sprite
-- WA blits for the missile (+0x2EC): for a fired round that is the record's
-- `missile.sprite`, which the generator zeroes while the builder owns the art,
-- and for a cluster bit it is the record's `clusters.bit.sprite` (WA's
-- constructor picks the cluster half of the record when the pellet index is
-- set), which the generator keeps nonzero. So a nonzero value at first sight is
-- a bit. The exception is a roaming animal whose walk pose WA draws natively:
-- the record `sprite` then holds that pose's id, passed back as `walk`.
--
-- Pure data at load: `wa` is touched only inside M.flight and its callbacks.
--
-- Bundle: wfws.sdk (spec/lua_sdk/wfws_sdk). `holds` is exported by the
-- `wf.sdk` dependency, so this bundle requires it by its public module name.

local shared = require("wf-lib/holds")

local M = {}

local ANIM_TYPE = {
  track = 2,
  rotation = 3,
  slow = 1,
  medium = 1,
  fast = 1,
  none = 5,
  -- Roaming animals: points along the velocity but clamped to a tilt range,
  -- and rests at a fixed angle when the animal has no speed.
  roam = 4,
}
local ANIM_SPEED = { slow = 0.5, medium = 0.8, fast = 1.35 }

-- The rotation each missile was last drawn at, by `m.id`, so another module can
-- ask how the round lay at the moment it burst (the terrain stamp bakes its
-- picture with that angle instead of the velocity heading). A lockstep id, the
-- same one `wa.on.missile_frame` gives (`m.id`) and the one `ev.missile` carries
-- into `on_explode`. Degrees clockwise from up, which is how a rotation strip is
-- authored; `M.heading` returns nil for a missile this builder never drew, so a
-- caller falls back to its own guess (a stock round's velocity heading).
--
-- This is the *world* rotation, without the weapon-wide `angle`: that offset
-- exists because an uploaded sheet may not point up, and a stamp's own art is
-- authored pointing up, so carrying the offset over would tilt every stamp of
-- an off-axis sheet. A mirrored (left-facing) pose keeps its side in the sign.
--
-- Entries are not dropped on despawn: the explosion callback runs around the
-- same time, and the id may still be needed for a frame. The table is bounded
-- instead, and a reset only costs one frame for anything still in flight.
local drawn_by = {}
local drawn_count = 0
local DRAWN_MAX = 256

local function remember_drawn(id, deg)
  if drawn_by[id] == nil then
    drawn_count = drawn_count + 1
    if drawn_count > DRAWN_MAX then
      drawn_by, drawn_count = {}, 1
    end
  end
  drawn_by[id] = deg
end

-- The last drawn rotation of a missile, in degrees clockwise from up (nil when
-- this builder never drew it: a stock sheet, or a role it left to WA).
function M.heading(id)
  if id == nil then return nil end
  return drawn_by[id]
end

local function current_worm()
  for _, w in ipairs(wa.worms.all()) do
    if w.turn then return w end
  end
end

local function sign(n) return n > 0 and 1 or (n < 0 and -1 or 0) end

-- Sheet frames, one cycle per `1 / anim_speed` second (PX's rate).
--
-- `pingpong` plays the strip forwards and then backwards (0, 1, 2, 1, 0, ...)
-- instead of looping it hard back to the first frame, which is what an
-- animation authored to reverse itself needs. The phase still spans one
-- forwards-plus-backwards pass, so `anim_speed` means the same thing either way,
-- and the two endpoints are not held for a double frame.
function M.cyclical_frame(phase, anim_speed, num_frames, pingpong)
  if not phase then phase = 0.0 end
  local spd = (anim_speed or 1.0) * 30 / 1000
  phase = phase + spd
  if phase > 0.99 then phase = 0.0 end
  if pingpong and num_frames > 1 then
    local span = 2 * num_frames - 2
    local i = math.floor(phase * span) % span
    return i < num_frames and i or span - i, phase
  end
  local frame = math.floor(phase * num_frames) % num_frames
  return frame, phase
end

function M.track_angle(vx, vy)
  return -wa.math.atan(vx, vy) - math.pi
end

function M.rotation_turn(prev_rot, vx, vy, spin)
  return (prev_rot or 0) + (spin or 1.0) * 0.5 * (vx * 0.15 + math.abs(vy) * 0.01 * sign(vx))
end

function M.spin_turn(prev_rot, vx, anim_speed)
  return (prev_rot or 0) + (anim_speed or 0.5) * 0.5 * sign(vx)
end

-- `anim = "roam"`: a walking animal's pose.
--
-- WA walks a roaming animal with no velocity of its own, so `track` leaves the
-- art pointing at the last heading and a moving animal looks dead on the
-- ground. On the ground (`grounded`) this holds `rest` and lets the art lean at
-- most `up` degrees above it or `down` below it while the animal steps. In the
-- air it tracks the velocity exactly like `track`: a flying animal points where
-- it flies, which is what PX's own sheep art does. Angles are radians; the
-- caller keeps the three limits.
function M.roam_angle(vx, vy, rest, up, down, speed, grounded, prev)
  if not grounded then
    -- Airborne: full tracking. A hop with no velocity keeps the last heading
    -- instead of snapping to nonsense (`track_angle(0, 0)` is due south).
    if (speed or 0) < 0.05 then return prev or rest end
    return M.track_angle(vx, vy)
  end
  if (speed or 0) < 0.05 then return rest end
  -- The ground pose is mirrored by `facing` when it walks left, so measure the
  -- lean on the right-facing side only. Using the signed `vx` made every step
  -- left look like a steep climb and tilt the art up.
  local ax = vx
  if ax < 0 then ax = -ax end
  local want = M.track_angle(ax, vy)
  -- Shortest signed difference, so a heading across the wrap point still clamps
  -- on the near side.
  local delta = (want - rest + math.pi) % (2 * math.pi) - math.pi
  -- Angles grow clockwise, so a positive delta leans the nose down (`down`
  -- limits it) and a negative one raises it (`up` limits that side).
  if delta > down then
    delta = down
  elseif delta < -up then
    delta = -up
  end
  return rest + delta
end

-- ---------------------------------------------------------------------------
-- Digging. A digging record names no art of its own once the builder owns the
-- flight sheet (the generator zeroes `dig.dive_sprite` and `dig.sprite_1..3`),
-- so "digging" is only an animation: the sheet keeps tracking the heading and
-- cycles its frames while the round is inside the land. PX's Bunker Buster
-- tells the two apart by probing the terrain around the nose; four probes, two
-- hits, and it is in the dirt. Coordinates are pixels, like `m.x` / `m.y`.
-- ---------------------------------------------------------------------------
local DIG_PROBE = 6.0   -- pixels ahead of the centre
local DIG_SPREAD = 3.0  -- pixels either side of the heading
local DIG_HOLD = 3      -- frames a clear nose keeps the dig animation on
local DIG_NEED = 2      -- probes that must be solid
local DIG_OFFSETS = { -1.0, -0.34, 0.34, 1.0 }

local function dig_settings(o, size)
  if o == nil or o == false then return nil end
  local t = type(o) == "table" and o or {}
  local anim = t.anim
  return {
    probe = t.probe or DIG_PROBE,
    spread = t.spread or DIG_SPREAD,
    hold = t.hold or DIG_HOLD,
    need = t.need or DIG_NEED,
    sheet = t.sheet,
    anim = anim,
    anim_type = anim and ANIM_TYPE[anim] or nil,
    spin = t.spin,
    cyclical = t.cyclical,
    pingpong = t.pingpong,
    anim_speed = t.anim_speed,
    scale = t.scale ~= nil and (t.scale * (size or 1.0)) or nil,
    mirror = t.mirror,
    z = t.z,
  }
end

-- ---------------------------------------------------------------------------
-- Weapon-wide builder parameters, applied to every role (the primary, the
-- bits, each state and any `roles` entry):
--
--   size  = 1.25   what the panel's Size field multiplies each role's `scale`
--                  by, so one number resizes the whole weapon.
--   angle = 90     degrees added to whatever rotation the role's `anim` asked
--                  for, for art that does not point up. Tracked art stays
--                  tracked; it just gains the offset.
--   offset = { x = 0, y = -3 }
--                  the art nudged inside its own cell, in sheet pixels, scaled
--                  with the art. It turns with the drawn angle and mirrors with
--                  the side, so a sheet whose pivot is off-centre stays correct
--                  at every heading. A role's own `offset` replaces it.
--
-- There is no glow here on purpose: WA only glows its own whitelisted sprites
-- (`wa.assets.load{ wa_sprites }`), and a pack sheet has no glow copy.
-- ---------------------------------------------------------------------------
-- Heading of the round, normalized; the last one when it is at rest.
local function heading_of(m, last)
  local vx, vy = m.vx or 0, m.vy or 0
  local len = math.sqrt(vx * vx + vy * vy)
  if len < 0.0001 then return last or { 0.0, 1.0 } end
  return { vx / len, vy / len }
end

-- Four probes across the nose. `wa.land.solid` is WA's own terrain test.
local function in_land(m, dir, d)
  local x, y = m.x, m.y
  if not x or not y then return false end
  local px, py = -dir[2], dir[1]
  local hits = 0
  for i = 1, #DIG_OFFSETS do
    local k = DIG_OFFSETS[i] * d.spread
    if wa.land.solid(x + dir[1] * d.probe + px * k,
                     y + dir[2] * d.probe + py * k) then
      hits = hits + 1
      if hits >= d.need then return true end
    end
  end
  return false
end

-- One frame of dig state for a missile: true while digging.
local function update_dig(m, d, dirs, holds)
  local id = m.id
  local dir = heading_of(m, dirs[id])
  dirs[id] = dir
  if in_land(m, dir, d) then
    holds[id] = d.hold
    return true
  end
  local left = holds[id] or 0
  if left > 0 then
    holds[id] = left - 1
    return true
  end
  return false
end

-- Sentinel: a missile (or state) the builder leaves to WA.
local NATIVE = {}

local function resolve(o, size, offset)
  local anim = o.anim or "none"
  local cfg = {
    sheet = o.sheet,
    anim = anim,
    anim_type = ANIM_TYPE[anim],
    spin = o.spin or 1.0,
    cyclical = o.cyclical or 0,
    pingpong = o.pingpong == true,
    anim_speed = o.anim_speed or 1.0,
    z = o.z or 5.0,
    scale = (o.scale or 1.0) * (size or 1.0),
    mirror = o.mirror ~= false,
    frame_fn = o.frame_fn,
    turn_fn = o.turn_fn,
  }
  -- `offset = { x, y }` is in sheet pixels and scales with the art, so one
  -- number works at any `size` / `scale`. A role's own offset replaces the
  -- weapon-wide one instead of adding to it (it is a different pivot error, not
  -- an extra nudge).
  local off = o.offset or offset
  if type(off) == "table" then
    cfg.ox = (off.x or 0) * cfg.scale
    cfg.oy = (off.y or 0) * cfg.scale
  end
  -- `homing = { arm = ms, time = ms, sheet = "...", ... }`: art for the
  -- homing window, resolved once at install like every other role.
  if type(o.homing) == "table" then
    local h = resolve(o.homing, size, offset)
    h.arm = o.homing.arm or 0
    h.time = o.homing.time or 0
    cfg.homing = h
  end
  return cfg
end

-- Homing is timed, not detected: WA arms the missile `arm` ms after it is
-- fired and steers it for `time` ms (0 = until it lands or blasts). The game
-- is a 50 Hz lockstep, so a frame is exactly 20 ms on every machine.
local MS_PER_FRAME = 20

local function homing_art(cfg, ms)
  local h = cfg and cfg.homing
  if not h then return cfg end
  local arm = h.arm or 0
  if ms < arm then return cfg end
  if (h.time or 0) > 0 and ms >= arm + h.time then return cfg end
  return h
end

local function sigset(v)
  if v == nil then return nil end
  local s = {}
  if type(v) == "table" then
    for i = 1, #v do s[v[i]] = true end
  else
    s[v] = true
  end
  return s
end

function M.flight(ctx, opts)
  if not opts or not opts.weapon or not opts.sheet then
    wa.log("wfws_sprite_builder.flight: weapon and sheet are required")
    return
  end

  local size = opts.size or 1.0
  local angle = opts.angle or 0.0
  -- Every role is nudged by the same `offset` unless it names its own.
  local offset = opts.offset
  -- `anim = "roam"` limits: a resting angle and how far the art may tilt either
  -- way from it, in degrees. One preset for every role, like `size`/`angle`.
  -- `rest = 90` lays a walking animal flat (its sheet points up), which is the
  -- editor's default; keep the two in step, or the art rests upright in game
  -- while the preview shows it flat.
  local tilt = opts.tilt or {}
  local rest = math.rad(tilt.rest or 90.0)
  local up = math.rad(math.abs(tilt.up or 25.0))
  local down = math.rad(math.abs(tilt.down or 25.0))

  local main = resolve(opts, size, offset)

  local bit_cfg = NATIVE
  local bit_art = false
  if type(opts.bits) == "table" then
    bit_cfg = resolve(opts.bits, size, offset)
    bit_art = true
  elseif opts.bits == "inherit" then
    bit_cfg = main
  end

  local extra = {}
  if type(opts.roles) == "table" then
    for i, r in ipairs(opts.roles) do
      extra[i] = { name = r.name or ("role" .. i), match = r.match, cfg = resolve(r, size, offset) }
    end
  end

  local states = {}
  if type(opts.states) == "table" then
    for i, s in ipairs(opts.states) do
      states[i] = {
        scope = s.scope or "any",
        sigs = sigset(s.sig),
        when = s.when,
        cfg = s.native and NATIVE or resolve(s, size, offset),
      }
    end
  end

  local owner = opts.owner

  local kind = {}        -- [id] = { ident = "main"|"bit"|role name, base = cfg }
  local sig = {}         -- [id] = last nonzero m.sprite seen (the state signal)
  local active = {}      -- [id] = cfg in force this frame
  local follow = {}      -- [id] = { actor, cfg, gen, seen }
  local spin_ang = {}
  local roam_side = {}   -- [id] = true while the walking pose faces left
  local cycl_phase = {}
  local dig_dir = {}     -- [id] = last heading, for the terrain probes
  local dig_hold = {}    -- [id] = frames left of "digging"
  local dig = dig_settings(opts.dig, size)
  -- Roaming animals: WA draws the walk from the record `sprite` (the ground
  -- pose) and the flown art from `sheep.flight_1/2`. `roam` carries the ids
  -- the generator wrote, when there are any:
  --
  --   roam = { walk = 153, fly = 699 }
  --
  -- `walk` (a stock ground pose) means WA keeps drawing the animal itself until
  -- it takes off: the press is the turn player's synchronized Space
  -- (`wa.world.keys().space`, lockstep input, so every peer switches on the same
  -- frame), or, if WA moves the flown id into the render slot, that id showing
  -- up. `fly` is that id (the unassigned sentinel the generator writes so the
  -- Space takeoff stays enabled). With neither, the builder draws the animal
  -- from the first frame and `roam` only documents the record's action.
  --
  -- A `sheet` in that table is the animal's own flight art: the builder draws it
  -- from the takeoff instead of the primary sheet, with that role's own `anim`,
  -- `cyclical`, `spin`, `scale` and `z`.
  local roam = opts.roam == true or type(opts.roam) == "table"
  local roam_ids = type(opts.roam) == "table" and opts.roam or nil
  local walk_pose = roam_ids and tonumber(roam_ids.walk) or nil
  local fly_pose = roam_ids and tonumber(roam_ids.fly) or nil
  -- A roaming animal may fly on art of its own (`roam = { sheet = ...,
  -- anim = ..., ... }`) instead of the primary sheet. It is still WA's animal
  -- until Space, so this only takes over from the takeoff on.
  local roam_cfg = roam_ids and roam_ids.sheet and resolve(roam_ids, size, offset) or nil
  local flying = {}      -- [id] = true once WA has the animal airborne
  local armed = {}       -- [id] = Space was seen up since the missile appeared
  local age = {}         -- [id] = frames since first sight, for homing ms
  local logged = {}      -- [id] = frames logged so far (opts.log)
  local gen = 0

  -- Identity: first sight, before this module has zeroed m.sprite.
  local function classify(m)
    for i = 1, #extra do
      if extra[i].match(m) then return { ident = extra[i].name, base = extra[i].cfg } end
    end
    local is_bit
    if opts.is_bit then
      is_bit = opts.is_bit(m) and true or false
    elseif m.bit ~= nil then
      -- The engine's own answer (MissileEntity+0x150, `shoot_desc.pellet`).
      is_bit = m.bit and true or false
    else
      -- A cluster bit carries its own record sprite; the fired round carries
      -- the record `sprite` unless the builder zeroed it. A roaming animal's
      -- walk pose is the one nonzero sprite that is NOT a bit. Without a bit
      -- role there is nothing to tell apart, so everything is the primary --
      -- otherwise a plain weapon would classify as a bit and draw nothing.
      is_bit = bit_art and (m.sprite ~= 0) and m.sprite ~= walk_pose
    end
    if is_bit then return { ident = "bit", base = bit_cfg } end
    return { ident = "main", base = main }
  end

  -- State: first matching state in scope, else the identity art.
  local function pick(m, ent)
    local s = sig[m.id]
    for i = 1, #states do
      local st = states[i]
      if st.scope == "any" or st.scope == ent.ident then
        if (st.sigs and s and st.sigs[s]) or (st.when and st.when(m)) then
          return st.cfg
        end
      end
    end
    return ent.base
  end

  local function gone(id, g)
    return function(b)
      local f = follow[id]
      if not f or f.gen ~= g then return end   -- stale actor from a state swap
      if f.seen then f.seen = false return end
      follow[id] = nil
      spin_ang[id] = nil
      roam_side[id] = nil
      cycl_phase[id] = nil
      kind[id] = nil
      sig[id] = nil
      active[id] = nil
      dig_dir[id] = nil
      dig_hold[id] = nil
      flying[id] = nil
      armed[id] = nil
      logged[id] = nil
      age[id] = nil
      b:despawn()
    end
  end

  local function drop_follower(id)
    local f = follow[id]
    if f then
      follow[id] = nil
      f.actor:despawn()
    end
    cycl_phase[id] = nil
  end

  wa.on.missile_frame(function(m)
    if m.weapon ~= opts.weapon then return end
    local id = m.id

    local ent = kind[id]
    if ent == nil then
      ent = classify(m)
      kind[id] = ent
      age[id] = 0
      -- `log = true` for one line per missile's first three frames: what the
      -- identity test actually saw. Turn it off once a convention is settled.
      if opts.log then
        logged[id] = (logged[id] or 0) + 1
        wa.log(string.format("wfws: id=%s sprite=%s ident=%s",
          tostring(m.id), tostring(m.sprite), tostring(ent.ident)))
      end
    elseif opts.log and (logged[id] or 0) < 3 then
      logged[id] = (logged[id] or 0) + 1
      wa.log(string.format("wfws: id=%s sprite=%s ident=%s phase=%s",
        tostring(m.id), tostring(m.sprite), tostring(ent.ident), tostring(m.phase)))
    end

    if m.phase == "pre" then
      if roam and ent.ident == "main" and not flying[id] then
        -- The Space press that takes off is the turn player's, so the turn's
        -- worm has to exist. `armed` needs to have seen Space released since
        -- the animal appeared, so a key already held at launch cannot skip the
        -- ground phase.
        local keys = wa.world.keys and wa.world.keys() or nil
        local held = keys and keys.space and true or false
        if not held then
          armed[id] = true
        elseif armed[id] and current_worm() then
          flying[id] = true
        end
        -- WA moves its flown sprite in at the takeoff; if that lands in the
        -- render slot, it is an exact signal that beats the key.
        if fly_pose and m.sprite == fly_pose then flying[id] = true end
      end
      -- A stock walk pose is WA's own art: leave the ground to WA until the
      -- animal is airborne. Without one nothing draws the walk, so the builder
      -- keeps drawing it (`anim = roam` rests it on the ground).
      if roam and ent.ident == "main" and walk_pose and not flying[id] then
        active[id] = NATIVE
        return
      end
      if m.sprite ~= 0 then sig[id] = m.sprite end   -- read BEFORE zeroing
      local cfg = pick(m, ent)
      if roam_cfg and ent.ident == "main" then cfg = roam_cfg end
      active[id] = cfg
      if cfg == NATIVE then
        -- Hand the sprite back. If our earlier zero stuck, restore the last
        -- signal (VERIFY: m.sprite is writable and WA draws it again).
        if not (roam and ent.ident == "main") and m.sprite == 0 and sig[id] then
          m.sprite = sig[id]
        end
      else
        -- Hide WA's native sprite while our follower actor draws the custom
        -- art. A walking wanderer with no usable walk pose reaches this too:
        -- its record `sprite` was zeroed, so there was nothing to hide.
        m.sprite = 0
      end
      return
    end

    local base = active[id]
    if base == nil then
      base = pick(m, ent)
      active[id] = base
    end
    if base == NATIVE then
      drop_follower(id)
      return
    end
    age[id] = (age[id] or 0) + 1
    local cfg = homing_art(base, age[id] * MS_PER_FRAME)

    -- Digging: terrain probes around the nose decide whether the round is in
    -- the land. When `dig = true`, it locks to `track` and cycles the owning
    -- sheet; any `anim`, `spin`, `anim_speed`, `cyclical`, `scale`, `mirror`,
    -- `z`, or `sheet` in `dig = { ... }` overrides the owning role while in
    -- the dirt and reverts smoothly in open air.
    local digging = (dig and update_dig(m, dig, dig_dir, dig_hold)) or false
    if digging and dig.sheet and dig.sheet ~= cfg.sheet then
      local dig_cfg = {
        sheet = dig.sheet,
        anim = dig.anim or "track",
        anim_type = dig.anim_type or ANIM_TYPE[dig.anim or "track"],
        spin = dig.spin ~= nil and dig.spin or cfg.spin,
        cyclical = dig.cyclical ~= nil and dig.cyclical or cfg.cyclical,
        anim_speed = dig.anim_speed ~= nil and dig.anim_speed or cfg.anim_speed,
        z = dig.z ~= nil and dig.z or cfg.z,
        scale = dig.scale ~= nil and dig.scale or cfg.scale,
        mirror = dig.mirror ~= nil and dig.mirror or cfg.mirror,
        -- The underground sheet is the same cell, so it keeps the pivot fix.
        ox = cfg.ox,
        oy = cfg.oy,
        frame_fn = cfg.frame_fn,
        turn_fn = cfg.turn_fn,
      }
      cfg = dig_cfg
    end

    local f = follow[id]
    if f and f.cfg ~= cfg then            -- state changed: new art, new actor
      drop_follower(id)
      f = nil
    end
    if not f then
      gen = gen + 1
      f = {
        cfg = cfg, gen = gen,
        actor = wa.actors.spawn({
          sprite = cfg.sheet, x = m.x, y = m.y,
          gravity = false, collide = false,
          owner = owner or current_worm(), on = gone(id, gen),
        }),
      }
      follow[id] = f
    end
    f.seen = true
    local b = f.actor
    b.x, b.y, b.vx, b.vy = m.x, m.y, 0, 0

    local active_anim = cfg.anim
    local active_anim_type = cfg.anim_type
    local active_spin = cfg.spin
    local active_cyclical = cfg.cyclical
    local active_pingpong = cfg.pingpong
    local active_anim_speed = cfg.anim_speed
    local active_mirror = cfg.mirror
    local active_scale = cfg.scale
    local active_z = cfg.z

    if digging then
      active_anim = dig.anim or "track"
      active_anim_type = dig.anim_type or ANIM_TYPE[active_anim]
      if dig.spin ~= nil then active_spin = dig.spin end
      if dig.cyclical ~= nil then active_cyclical = dig.cyclical end
      if dig.pingpong ~= nil then active_pingpong = dig.pingpong end
      if dig.anim_speed ~= nil then active_anim_speed = dig.anim_speed end
      if dig.mirror ~= nil then active_mirror = dig.mirror end
      if dig.scale ~= nil then active_scale = dig.scale end
      if dig.z ~= nil then active_z = dig.z end
    end

    local rot = 0
    local frame = 0
    local roam_left = false
    local eff_vx = (digging and (m.vx or 0) == 0 and (m.vy or 0) ~= 0) and 0.001 or m.vx
    if cfg.turn_fn then
      rot = cfg.turn_fn(m, spin_ang[id])
      spin_ang[id] = rot
    elseif active_anim_type == 2 then
      rot = M.track_angle(m.vx, m.vy)
    elseif active_anim_type == 3 then
      rot = M.rotation_turn(spin_ang[id], eff_vx, m.vy, active_spin)
      spin_ang[id] = rot
    elseif active_anim_type == 1 then
      rot = M.spin_turn(spin_ang[id], eff_vx, (ANIM_SPEED[active_anim] or 0.5) * (active_spin or 1.0))
      spin_ang[id] = rot
    elseif active_anim_type == 4 then
      -- `anim = roam`: the walking pose. The sheet is authored facing right and
      -- mirrored for left, so the heading is measured on the right-facing side
      -- (`hx`) and the mirror supplies the side. Super sheep flight is drawn
      -- from `roam = { sheet = ..., anim = ... }`, a different config with its
      -- own anim, so it never reaches this branch.
      local grounded = roam and ent.ident == "main" and not flying[id]
      local vx = m.vx or 0
      if active_mirror then
        if vx < 0 then roam_side[id] = true
        elseif vx > 0 then roam_side[id] = false end   -- vx == 0 keeps the side
        roam_left = roam_side[id] or false
      end
      local hx = active_mirror and math.abs(vx) or vx
      rot = M.roam_angle(hx, m.vy, rest, up, down,
        math.sqrt(vx ^ 2 + (m.vy or 0) ^ 2), grounded, spin_ang[id])
      spin_ang[id] = rot
    end

    if cfg.frame_fn then
      frame = cfg.frame_fn(m)
    elseif digging or active_cyclical > 0 then
      local nframes = digging and math.max(1, active_cyclical) or active_cyclical
      if nframes > 0 then
        frame, cycl_phase[id] = M.cyclical_frame(cycl_phase[id], active_anim_speed,
          nframes, active_pingpong)
      else
        cycl_phase[id] = nil
      end
    else
      cycl_phase[id] = nil
    end

    -- Walking pose (`anim = roam`): a real mirror about the sprite's vertical
    -- axis, side kept in `roam_side` so a straight drop does not snap to the
    -- right. Every other anim keeps the old rule: mirror by the sign of `vx`.
    local roam_anim = active_anim_type == 4
    if roam_anim then
      b.facing = roam_left and -1 or 1
    else
      b.facing = active_mirror and (m.vx < 0 and -1 or 1) or 1
    end
    b:frame(frame)
    -- `angle` is added in the drawn frame, and a mirrored sheet is flipped
    -- about the vertical axis, so the offset is negated on the left side to
    -- keep the art pointing the same way either way.
    local drawn
    if roam_anim and roam_left then
      drawn = -(math.deg(rot) + angle)   -- screen mirror of the right-facing pose
    elseif roam_anim then
      drawn = math.deg(rot) + angle
    else
      drawn = math.deg(rot) + (b.facing < 0 and -angle or angle)
    end
    local world_deg = math.deg(rot)
    if roam_anim and roam_left then world_deg = -world_deg end
    remember_drawn(id, world_deg % 360)
    b:gfx({
      angle = drawn % 360,
      depth = active_z,
      scale = active_scale,
    })
    -- `offset = { x, y }`: the art nudged inside its own cell, in sheet pixels
    -- and already scaled with the art (`resolve`). `drawn` is the sprite's own
    -- frame, `angle` included, and a mirrored sheet is flipped about its
    -- vertical axis first, so x follows `facing` and the pair is then turned
    -- with the art. The follower is presentation only (no gravity, no
    -- collision), so this moves no simulation body.
    local ox, oy = cfg.ox or 0, cfg.oy or 0
    if ox ~= 0 or oy ~= 0 then
      if b.facing < 0 then ox = -ox end
      local rad = math.rad(drawn)
      local cr, sr = wa.math.cos(rad), wa.math.sin(rad)
      b.x = m.x + ox * cr - oy * sr
      b.y = m.y + ox * sr + oy * cr
    end
  end)
end

M.PX_POSTURE = shared.PX_POSTURE
M.PX_HANDS = shared.PX_HANDS

-- ---------------------------------------------------------------------------
-- Worm hold: WA draws the gun on the aiming poses itself (`worm_hold.rs`), and
-- authors cannot reach it. `sb.hold` builds the engine's `hold =` table and, when
-- a feature the engine has no field for is on, takes the aiming poses over with
-- quads of the same sheet (`wa.on.draw`), mirroring the engine's own maths so
-- nothing moves but the feature. The engine keeps everything else: walking, the
-- put-away animation, the firing poses, the flash.
--
--   local hold = sb.hold(ctx, {
--     sheet = "sprites/<mod>/hold.png",
--     cell_w = 90, cell_h = 90,     -- sheet cell in px (the quad layer only)
--     offset = { x = 2, y = -3 },   -- forces the layer (sheet px, scaled)
--     silent_sheet = "sprites/<mod>/silent.png",  -- the mute, 1x1 transparent
--     weap_radius = 6, weap_rotation = 1, weap_scale = 1,
--     hand = sb.PX_HANDS[2], hand_radius = 10, hand_size = 60,
--     frames = 1, anim_speed = 1, keep_while_firing = true, put_away = true,
--   })
--
-- wa.weapons.replace{ hold = hold }
--
-- The mute is `wa.weapons.hold_sheet(weapon, n)`: while a worm aims with this
-- weapon the engine is pointed at `silent_sheet`, so only the quads draw, and it
-- is pointed back at sheet 0 the moment nobody does. Rust's claim loads
-- `hold.sheets` by itself, so the silent PNG costs no `sprites` entry.
-- ---------------------------------------------------------------------------
local HOLD_DEPTH = 0x10000          -- `worm_hold.rs`: our.depth.FRONT
local HOLD_HAND_CELL = 60.0         -- PX's three hand sheets are 60x60
local HOLD_AIM_STATES = {
  [0x67] = true, [0x68] = true, [0x69] = true,
}
-- WA's firing frames. They are the two frames of a shot, which is why a firing
-- animation needs a window of its own (`fire.ticks`).
local HOLD_FIRE_STATES = {
  [0x6A] = true, [0x6B] = true,
}
-- The keys the engine reads off `hold` (`HoldSpec`). Everything else in the
-- table is ours: cells, offset, silent sheet, `weapon`, `size`, `hand_size`.
local HOLD_KEYS = {
  "sheet", "sheets", "hand", "hand_radius", "hand_rotation",
  "hand_radial_rotation", "hand_scale", "weap_radius", "weap_scale",
  "weap_rotation", "weap_radial_rotation", "anim_speed", "frames",
  "keep_while_firing", "thrown", "put_away", "flash", "static",
  -- Lua-only keys the engine ignores but `px_hold_art` and PX's own library
  -- read off the same table, kept so a `sb.hold` table is the inline one.
  "hand_type", "size",
}

local hold_entries = {}
local hold_state = {}              -- [entry][worm id] = { counter, phase, frame, muted }
local hold_hooked = false

-- `grow` from `worm_hold.rs`: the 20-frame draw-out, one invisible frame first.
local function hold_grow(counter)
  local size = 0.0
  for c = 0, math.min(20, counter) do
    if c >= 20 then size = 1.0
    elseif c > 17 then size = c / 20.0
    elseif c > 9 then size = size - 0.025
    else size = 2.7 * c / 20.0 end
  end
  return size
end

-- `next_phase` from `worm_hold.rs`: one strip frame every 1 / (0.03 * speed)
-- 50 Hz frames, so the sheet plays at the engine's rate and not the render's.
local function hold_next_phase(phase, speed)
  if phase > 0.99 then return 0.0 end
  return phase + speed * 0.03
end

-- A corner of the drawn cell: `render::Sprite::emit`'s rotation (radians,
-- clockwise, y down), the same one `px_hold_art` uses.
local function hold_corner(t, cx, cy, cos, sin, lx, ly)
  t.x = cx + lx * cos - ly * sin
  t.y = cy + lx * sin + ly * cos
end

-- One quad spec, refilled per draw: no table in the render callback.
local HOLD_QUAD = { depth = HOLD_DEPTH, points = { {}, {}, {}, {} } }
local HOLD_OPAQUE = 0xFFFFFFFF

-- `hold_quad` colours the quad from an alpha, because `wa.draw.quad` takes
-- 0xAARRGGBB and `gpu.rs::quad_tint` premultiplies it: an alpha below 1 fades
-- the art without a blend mode of its own.
local function hold_colour(alpha)
  if alpha == nil or alpha >= 1 then return HOLD_OPAQUE end
  if alpha <= 0 then return 0x00FFFFFF end
  return math.floor(alpha * 255.0 + 0.5) * 0x1000000 + 0xFFFFFF
end

local function hold_quad(sheet, cx, cy, angle, half_w, half_h, facing, frame, worm, alpha)
  local cos, sin = wa.math.cos(angle), wa.math.sin(angle)
  local pts = HOLD_QUAD.points
  if facing < 0 then
    hold_corner(pts[1], cx, cy, cos, sin,  half_w, -half_h)
    hold_corner(pts[2], cx, cy, cos, sin, -half_w, -half_h)
    hold_corner(pts[3], cx, cy, cos, sin, -half_w,  half_h)
    hold_corner(pts[4], cx, cy, cos, sin,  half_w,  half_h)
  else
    hold_corner(pts[1], cx, cy, cos, sin, -half_w, -half_h)
    hold_corner(pts[2], cx, cy, cos, sin,  half_w, -half_h)
    hold_corner(pts[3], cx, cy, cos, sin,  half_w,  half_h)
    hold_corner(pts[4], cx, cy, cos, sin, -half_w,  half_h)
  end
  HOLD_QUAD.sprite = sheet
  HOLD_QUAD.frame = frame or 0
  HOLD_QUAD.color = hold_colour(alpha)
  -- Inherit the worm's Invisibility the way `draw_holds` does: an invisible,
  -- unrevealed team draws nothing, a revealed one gets the ghost tint.
  HOLD_QUAD.visibility = worm
  wa.draw.quad(HOLD_QUAD)
end

-- True when the quads need to own the aiming poses: any feature the engine's
-- `HoldSpec` cannot express. Everything else stays the engine's fast path, with
-- no extra atlas slot and no draw hook.
function M.hold_needs_lua(spec)
  if type(spec) ~= "table" then return false end
  if spec.draw_mode == "rust" then return false end
  if spec.draw_mode == "lua" then return true end
  local off = spec.offset
  if type(off) == "table" and ((off.x or 0) ~= 0 or (off.y or 0) ~= 0) then return true end
  local hand = spec.hand_offset
  if type(hand) == "table" and ((hand.x or 0) ~= 0 or (hand.y or 0) ~= 0) then return true end
  if spec.clip ~= nil or spec.echo ~= nil or spec.swing ~= nil then return true end
  -- A firing role is always ours: the engine draws nothing after its two firing
  -- frames, and px_hold_art draws only inside them.
  if spec.fire ~= nil then return true end
  -- The held art on WA's firing frames is ours too (`keep_firing`): the engine
  -- draws it there only while `h.firing` is set, which a burst repeats without.
  if spec.keep_firing ~= nil then return true end
  return false
end

-- ---------------------------------------------------------------------------
-- The Space swing (`swing` in the spec, `project.aimClip` in the editor).
--
-- A clip is data, not Lua: keyframes over 50 Hz ticks, each holding an angle
-- added to the drawn one, a dx/dy in sheet pixels, a size multiplier, an
-- optional strip frame and alpha, and the easing that reaches it. `M.clip_pose`
-- is a pure function of the ticks since the press, which is what keeps the two
-- halves honest: the simulation decides *when* (the key edge, the finish) and
-- the draw decides *how it looks*, from the same arithmetic the editor's
-- preview runs. Nothing here reads the render clock, and nothing writes state
-- from inside `wa.on.draw`.
-- ---------------------------------------------------------------------------
local CLIP_EASE = {
  linear = function(t) return t end,
  in_quad = function(t) return t * t end,
  out_quad = function(t) return 1 - (1 - t) * (1 - t) end,
  inout_quad = function(t)
    if t < 0.5 then return 2 * t * t end
    return 1 - 2 * (1 - t) * (1 - t)
  end,
  in_cubic = function(t) return t * t * t end,
  out_cubic = function(t) return 1 - (1 - t) ^ 3 end,
  inout_cubic = function(t)
    if t < 0.5 then return 4 * t * t * t end
    return 1 - 4 * (1 - t) ^ 3
  end,
  out_back = function(t)
    local c = 1.70158
    local u = t - 1
    return 1 + (c + 1) * u * u * u + c * u * u
  end,
  out_elastic = function(t)
    if t == 0 or t == 1 then return t end
    local u = t - 1
    return 2 ^ (-10 * t) * wa.math.sin((u * 10 - 0.75) * (2 * math.pi / 3)) + 1
  end,
  hold = function(t)
    if t >= 1 then return 1 end
    return 0
  end,
}

local function clip_lerp(a, b, f)
  return a + (b - a) * f
end

-- The pose at `t` ticks. Keys are read in file order but sorted by `t` once, at
-- install, so this stays allocation-free enough for a draw callback: it returns
-- one small table per call and the caller drops it.
function M.clip_pose(clip, t)
  local keys = clip and clip.keys
  if not keys or #keys == 0 then return nil end
  local first, last = keys[1], keys[#keys]
  if t <= first.t then
    return { angle = first.angle or 0, dx = first.dx or 0, dy = first.dy or 0,
      scale = first.scale or 1, frame = first.frame, alpha = first.alpha or 1 }
  end
  if t >= last.t then
    return { angle = last.angle or 0, dx = last.dx or 0, dy = last.dy or 0,
      scale = last.scale or 1, frame = last.frame, alpha = last.alpha or 1 }
  end
  local i = 1
  while i < #keys and keys[i + 1].t <= t do i = i + 1 end
  local a, b = keys[i], keys[i + 1]
  local span = b.t - a.t
  local raw = span > 0 and (t - a.t) / span or 1
  local ease = CLIP_EASE[b.ease or "inout_quad"] or CLIP_EASE.inout_quad
  local f = ease(raw)
  local a_scale, b_scale = a.scale or 1, b.scale or 1
  local a_alpha, b_alpha = a.alpha or 1, b.alpha or 1
  return {
    angle = clip_lerp(a.angle or 0, b.angle or 0, f),
    dx = clip_lerp(a.dx or 0, b.dx or 0, f),
    dy = clip_lerp(a.dy or 0, b.dy or 0, f),
    scale = clip_lerp(a_scale, b_scale, f),
    -- A frame is an index, not a number to blend: it steps at the segment end.
    frame = (raw >= 1) and b.frame or a.frame,
    alpha = clip_lerp(a_alpha, b_alpha, f),
  }
end

-- Sorted copy of a clip's keys, so `clip_pose` never has to sort in a callback.
local function clip_prepare(clip)
  if type(clip) ~= "table" or type(clip.keys) ~= "table" or #clip.keys == 0 then
    return nil
  end
  local keys = {}
  for i = 1, #clip.keys do
    local k = clip.keys[i]
    if type(k) == "table" and type(k.t) == "number" then keys[#keys + 1] = k end
  end
  table.sort(keys, function(a, b) return a.t < b.t end)
  if #keys == 0 then return nil end
  return {
    keys = keys,
    ticks = math.max(1, math.floor(clip.ticks or keys[#keys].t or 1)),
    finish = clip.finish,
  }
end

local function hold_mute(entry, on)
  if not entry.silent then return end
  local want = on == true
  if entry.muted == want then return end
  local swap = wa.weapons and wa.weapons.hold_sheet
  if not swap then return end
  -- A refused swap (the weapon is not placed yet) must not take the whole
  -- draw callback with it: quads are dropped for the frame when it errors.
  local ok = pcall(swap, entry.weapon, want and entry.silent or 0)
  if ok then entry.muted = want end
end

-- One aiming frame of the engine's draw, as a quad: `draw_holds` in
-- `worm_hold.rs`, aim branch only. The put-away and firing poses are not drawn
-- here, because the engine keeps them (PX's aiming has no put-away of its own).
local function hold_draw_aim(entry, w, ws, pose, firing_hold)
  local pi = math.pi
  local facing = w.facing < 0 and -1 or 1
  local static = entry.static_angles
  local a = static and 0.5 or (w.aim or 0.5)
  local rot = (1.0 - a) * pi
  local rot_w = rot + pi * entry.weap_radial_rotation
  local rot_h = rot - pi * entry.hand_radial_rotation
  -- Aim frames use `counter - 1`; the engine's first one is deliberately blank.
  -- A firing frame shows the art at full size, as `draw_holds` does.
  local base = firing_hold and 1.0 or hold_grow(ws.counter - 1)
  local scale = pose and pose.scale or 1
  local size = base * entry.weap_scale * scale
  local frames = math.max(1, entry.frames)
  local phase = firing_hold and (ws.fire_hold_phase or 0.0) or ws.phase
  local frame = math.floor(phase * frames)
  if pose and pose.frame then frame = math.floor(pose.frame) end
  if frame >= frames then frame = frames - 1 end
  if frame < 0 then frame = 0 end
  local alpha = pose and pose.alpha or 1

  local cx = w.x + facing * wa.math.sin(rot_w) * entry.weap_radius
  local cy = w.y - wa.math.cos(rot_w) * entry.weap_radius
  -- The swing's own angle goes in before the side mirror, so the art cuts the
  -- same way on both sides of the worm (a positive angle always lifts it).
  local swing = pose and pose.angle and (pose.angle * pi / 180.0) or 0
  local ang = ((static and static.weap * pi
    or (pi - pi * a - pi * (1.0 - entry.weap_rotation))) + swing) * facing

  -- `offset = { x, y }`: the art nudged inside its own cell, scaled with the
  -- art like `size`/`angle` on the flight builder. Mirrored with the side and
  -- turned with the drawn angle, so an off-centre grip stays put at every aim.
  -- A swing's `dx`/`dy` is the same channel, added to it.
  local ox = (entry.ox + (pose and pose.dx or 0)) * size
  local oy = (entry.oy + (pose and pose.dy or 0)) * size
  if ox ~= 0 or oy ~= 0 then
    if facing < 0 then ox = -ox end
    local cr, sr = wa.math.cos(ang), wa.math.sin(ang)
    cx = cx + ox * cr - oy * sr
    cy = cy + ox * sr + oy * cr
  end
  hold_quad(entry.sheet, cx, cy, ang,
    entry.cell_w * size * 0.5, entry.cell_h * size * 0.5, facing, frame, w, alpha)

  if entry.hand and entry.draw_hand ~= false and (entry.hand_radius or 0) ~= 0 then
    local hx = w.x + facing * wa.math.sin(rot_h) * entry.hand_radius
    local hy = w.y - wa.math.cos(rot_h) * entry.hand_radius
    local h_ang = (static and static.hand * pi or (rot + pi * entry.hand_rotation)) * facing
    -- The hand's own cell scales with `hand_scale`, so its offset and the
    -- swing's carry ride that size, not the weapon's.
    local hsize = size * (entry.hand_scale or 1.0)
    local hox = (entry.hox + (pose and pose.dx or 0)) * hsize
    local hoy = (entry.hoy + (pose and pose.dy or 0)) * hsize
    if hox ~= 0 or hoy ~= 0 then
      if facing < 0 then hox = -hox end
      local cr, sr = wa.math.cos(h_ang), wa.math.sin(h_ang)
      hx = hx + hox * cr - hoy * sr
      hy = hy + hox * sr + hoy * cr
    end
    local h_half = (entry.hand_size or HOLD_HAND_CELL) * hsize * 0.5
    hold_quad(entry.hand, hx, hy, h_ang, h_half, h_half, facing, 0, w, alpha)
  end
end

-- One firing frame of the firing role (`fire` in the spec): the same aim pose
-- the held art takes, the same cell and hand rules, but its own sheet, size,
-- strip and numbers. No draw-out and no clip: a shot is not an aim.
local function hold_draw_fire(entry, w, ws)
  local fire = entry.fire
  local pi = math.pi
  local facing = w.facing < 0 and -1 or 1
  local a = w.aim or 0.5
  local rot = (1.0 - a) * pi
  local rot_w = rot + pi * fire.weap_radial_rotation
  local rot_h = rot - pi * fire.hand_radial_rotation
  local size = fire.scale or 1.0
  local cx = w.x + facing * wa.math.sin(rot_w) * fire.weap_radius
  local cy = w.y - wa.math.cos(rot_w) * fire.weap_radius
  local ang = (pi - pi * a - pi * (1.0 - fire.weap_rotation)) * facing
  local frames = math.max(1, fire.frames or 1)
  local frame = math.floor((ws.fire_phase or 0.0) * frames)
  if frame >= frames then frame = frames - 1 end
  if frame < 0 then frame = 0 end
  -- `offset = { x, y }`: the firing art nudged inside its own cell, in sheet
  -- pixels and scaled with the role's own `scale`, the same channel the held
  -- art has, turned with the drawn angle and mirrored with the side.
  local ox = (fire.ox or 0) * size
  local oy = (fire.oy or 0) * size
  if ox ~= 0 or oy ~= 0 then
    if facing < 0 then ox = -ox end
    local cr, sr = wa.math.cos(ang), wa.math.sin(ang)
    cx = cx + ox * cr - oy * sr
    cy = cy + ox * sr + oy * cr
  end
  local cell_w = fire.cell_w or HOLD_HAND_CELL
  local cell_h = fire.cell_h or HOLD_HAND_CELL
  hold_quad(fire.sheet, cx, cy, ang,
    cell_w * size * 0.5, cell_h * size * 0.5, facing, frame, w, 1)

  if fire.hand and fire.draw_hand ~= false and (fire.hand_radius or 0) ~= 0 then
    local hx = w.x + facing * wa.math.sin(rot_h) * fire.hand_radius
    local hy = w.y - wa.math.cos(rot_h) * fire.hand_radius
    local h_ang = (rot + pi * fire.hand_rotation) * facing
    local hsize = (fire.hand_scale or 1.0)
    local h_half = (fire.hand_size or HOLD_HAND_CELL) * hsize * 0.5
    -- The hand's nudge rides its own cell, so it scales with `hand_scale`.
    local hox = (fire.hox or 0) * hsize
    local hoy = (fire.hoy or 0) * hsize
    if hox ~= 0 or hoy ~= 0 then
      if facing < 0 then hox = -hox end
      local cr, sr = wa.math.cos(h_ang), wa.math.sin(h_ang)
      hx = hx + hox * cr - hoy * sr
      hy = hy + hox * sr + hoy * cr
    end
    hold_quad(fire.hand, hx, hy, h_ang, h_half, h_half, facing, 0, w, 1)
  end
end

-- The firing window, one step per 50 Hz frame. WA's two firing states are the
-- whole of a shot for WA, which is why a firing sheet used to flash for a
-- single frame; `fire.ticks` keeps it up for that many frames from the first
-- firing frame, and 0 means "WA's own frames only". A gap of more than a frame
-- between two firing states is a new shot, and restarts the strip.
local function hold_fire_step(entry, w, ws, now)
  local fire = entry.fire
  local keep = entry.keep_firing
  if not fire and not keep then return false end
  local firing = w.state_id ~= nil and HOLD_FIRE_STATES[w.state_id] or false
  local ticks = fire and (fire.ticks or 0) or 0
  -- A held weapon that stays on the firing frames (`keep_firing`) needs no
  -- window of its own: WA's own two frames are the shot.
  if keep and not fire then ticks = 0 end
  if firing then
    if ws.fire_start == nil or not ws.fire_last or now - ws.fire_last > 1 then
      ws.fire_start = now
      ws.fire_phase = 0.0
      ws.fire_hold_phase = 0.0
      ws.fire_frame = now - 1
    end
    ws.fire_last = now
  end
  if ws.fire_start == nil then return false end
  if ws.fire_start > now then
    ws.fire_start = nil
    return false
  end
  if ticks <= 0 then
    if not firing then return false end
  elseif now - ws.fire_start >= ticks then
    return false
  end
  if ws.fire_frame ~= now then
    ws.fire_frame = now
    if fire and (fire.frames or 1) > 1 then
      ws.fire_phase = hold_next_phase(ws.fire_phase or 0.0, fire.anim_speed or 1.0)
    end
    if keep and (entry.frames or 1) > 1 then
      ws.fire_hold_phase = hold_next_phase(ws.fire_hold_phase or 0.0, entry.anim_speed or 1.0)
    end
  end
  return true
end

-- The per-worm state the draw and the simulation half share: the draw-out
-- counter, the engine's strip phase, and the swing's start tick.
local function hold_worm_state(entry, w)
  local per_worm = hold_state[entry]
  if not per_worm then
    per_worm = {}
    hold_state[entry] = per_worm
  end
  local ws = per_worm[w.id]
  if not ws then
    ws = { counter = 0, phase = 0.0, frame = -1, swing = nil, space = false }
    per_worm[w.id] = ws
  end
  return per_worm, ws
end

-- True while the engine would draw this worm's hold: alive, visible, body
-- visible, this weapon selected, and an aiming state.
local function hold_aiming(entry, w)
  return w.hp and w.hp > 0 and w.visible and w.body_visible
    and w.weapon == entry.weapon and HOLD_AIM_STATES[w.state_id] and true or false
end

local function hold_ensure_hook()
  if hold_hooked then return end
  if not (wa.on and wa.on.draw and wa.draw and wa.draw.quad) then
    wa.log("wfws_sprite_builder.hold: this engine build has no wa.on.draw/wa.draw.quad")
    return
  end
  hold_hooked = true
  wa.on.draw(function()
    local now = wa.world.frame() or 0
    local worms = wa.worms.all()
    for i = 1, #hold_entries do
      local entry = hold_entries[i]
      local mute = false
      local per_worm = hold_state[entry]
      if per_worm then
        -- A worm keeps its state while the weapon is its own: aiming, in the
        -- firing window, or in between. The aim states are not the test, or the
        -- firing window would lose its start on the first firing frame.
        for j = 1, #worms do
          local w = worms[j]
          local ws = per_worm[w.id]
          if ws and not (w.hp and w.hp > 0 and w.visible and w.body_visible
            and w.weapon == entry.weapon) then
            per_worm[w.id] = nil
          end
        end
      end
      for j = 1, #worms do
        local w = worms[j]
        local aiming = hold_aiming(entry, w)
        local owns = w.hp and w.hp > 0 and w.visible and w.body_visible
          and w.weapon == entry.weapon
        local ws = nil
        if owns and (aiming or entry.fire or entry.keep_firing) then
          local _, state = hold_worm_state(entry, w)
          ws = state
        end
        if ws then
          local firing = hold_fire_step(entry, w, ws, now)
          if aiming then
            -- Advance once per 50 Hz frame, never once per rendered frame: the
            -- render rate is not the game's and differs between machines.
            if ws.frame ~= now then
              ws.frame = now
              ws.counter = math.min(20, ws.counter + 1)
              if entry.frames > 1 then
                ws.phase = hold_next_phase(ws.phase, entry.anim_speed)
              end
            end
            -- `fire.hide_main`: the firing art replaces the held weapon while
            -- its window is open, so the gun is not drawn underneath it.
            if not (firing and entry.fire and entry.fire.hide_main) then
              local pose = nil
              if entry.clip and ws.swing then
                pose = M.clip_pose(entry.clip, now - ws.swing)
              end
              hold_draw_aim(entry, w, ws, pose)
              mute = true
            end
          else
            -- The engine's draw-out replays from the start on the next aim.
            ws.counter = 0
          end
          if firing then
            -- `keep_firing`: the held art stays on WA's firing frames, under
            -- the firing sheet if there is one. This is what px_hold_art used to
            -- fill, and it is the same aim geometry at full size.
            if entry.keep_firing then
              hold_draw_aim(entry, w, ws, nil, true)
              mute = true
            end
            if entry.fire then
              hold_draw_fire(entry, w, ws)
              -- The engine would draw its own held sheet on 0x6A/0x6B when the
              -- weapon keeps it while firing; a hidden main weapon must not show.
              if entry.fire.hide_main then mute = true end
            end
          end
        end
      end
      -- Point the engine at the silent sheet only while the quads draw, and
      -- back at the real one so walking, put-away and the fire pose keep it.
      hold_mute(entry, mute)
    end
  end)
end

-- The simulation half of the swing: one handler for every layer, run per worm
-- message, gated to the first call of each 50 Hz frame so the entries and the
-- worm list are walked once. `wa.world.keys().space` is the turn player's
-- synchronised keyboard, so the edge lands on the same frame on every peer;
-- `wa.on.draw` must never decide a swing, because its rate is the renderer's.
local swing_hooked = false
local swing_tick = -1

local function swing_ensure()
  if swing_hooked then return end
  if not (wa.on and wa.on.worm_message and wa.world and wa.world.frame) then return end
  swing_hooked = true
  wa.on.worm_message(function()
    local now = wa.world.frame() or 0
    if now == swing_tick then return end
    swing_tick = now
    local keys = wa.world.keys and wa.world.keys() or nil
    local space = keys and keys.space or false
    local worms = wa.worms.all()
    for i = 1, #hold_entries do
      local entry = hold_entries[i]
      if entry.clip then
        for j = 1, #worms do
          local w = worms[j]
          local _, ws = hold_worm_state(entry, w)
          if not hold_aiming(entry, w) then
            ws.space = false
            ws.swing = nil
          else
            if space and not ws.space and not ws.swing then
              ws.swing = now
            end
            ws.space = space
            if ws.swing and now - ws.swing >= entry.clip.ticks then
              ws.swing = nil
              -- The claim eats WA's fire, so a swing that changes nothing has
              -- to hand the turn back or the worm would sit there for ever.
              if entry.clip.finish == "end_turn" and wa.world.set_turn_clock then
                wa.world.set_turn_clock(0)
              end
            end
          end
        end
      end
    end
  end, { msgs = { wa.msg.FRAME_FINISH } })
end

-- Build a worm hold. Returns the `hold =` table the claim wants; registers the
-- quad layer only when `M.hold_needs_lua` says the engine cannot do it.
function M.hold(ctx, spec)
  if type(spec) ~= "table" or type(spec.sheet) ~= "string" then
    wa.log("wfws_sprite_builder.hold: sheet is required")
    return nil
  end
  local weapon = spec.weapon or (ctx and ctx.id)
  local rust = {}
  for i = 1, #HOLD_KEYS do
    local k = HOLD_KEYS[i]
    if spec[k] ~= nil then rust[k] = spec[k] end
  end
  if rust.static == nil and type(spec.static_angles) == "table" then
    rust.static = spec.static_angles
  end
  local silent = nil
  if type(spec.silent_sheet) == "string" then
    local sheets = {}
    if type(spec.sheets) == "table" then
      for i = 1, #spec.sheets do sheets[i] = spec.sheets[i] end
    end
    sheets[#sheets + 1] = spec.silent_sheet
    rust.sheets = sheets
    silent = #sheets
  end

  if not M.hold_needs_lua(spec) then return rust end
  if weapon == nil then
    wa.log("wfws_sprite_builder.hold: `weapon = ctx.id` is required for the quad layer")
    return rust
  end
  if silent == nil then
    wa.log("wfws_sprite_builder.hold: the quad layer needs `silent_sheet` to mute the engine draw")
    return rust
  end

  local cell = spec.cell_size or HOLD_HAND_CELL
  local off = type(spec.offset) == "table" and spec.offset or {}
  local hand_off = type(spec.hand_offset) == "table" and spec.hand_offset or {}
  local clip = clip_prepare(spec.swing or spec.clip)
  -- The firing role, normalised once so the draw reads plain numbers.
  local fire_spec = type(spec.fire) == "table" and spec.fire or nil
  local fire = nil
  if fire_spec and type(fire_spec.sheet) == "string" then
    fire = {
      sheet = fire_spec.sheet,
      cell_w = fire_spec.cell_w or cell,
      cell_h = fire_spec.cell_h or cell,
      scale = fire_spec.scale or 1.0,
      frames = math.max(1, fire_spec.frames or 1),
      anim_speed = fire_spec.anim_speed or 1.0,
      ticks = math.max(0, fire_spec.ticks or 0),
      hide_main = fire_spec.hide_main == true,
      weap_radius = fire_spec.weap_radius or spec.weap_radius or 1.0,
      weap_rotation = fire_spec.weap_rotation or 1.0,
      weap_radial_rotation = fire_spec.weap_radial_rotation or 1.0,
      hand = fire_spec.hand,
      hand_radius = fire_spec.hand_radius or 1.0,
      hand_rotation = fire_spec.hand_rotation or 1.0,
      hand_radial_rotation = fire_spec.hand_radial_rotation or 1.0,
      hand_scale = fire_spec.hand_scale or 1.0,
      hand_size = fire_spec.hand_size or HOLD_HAND_CELL,
      draw_hand = fire_spec.draw_hand,
      -- `offset` / `hand_offset`, the held art's own nudge channels, in sheet
      -- pixels: the firing role is a quad layer too, so it takes them as well.
      ox = (type(fire_spec.offset) == "table" and fire_spec.offset.x) or 0,
      oy = (type(fire_spec.offset) == "table" and fire_spec.offset.y) or 0,
      hox = (type(fire_spec.hand_offset) == "table" and fire_spec.hand_offset.x) or 0,
      hoy = (type(fire_spec.hand_offset) == "table" and fire_spec.hand_offset.y) or 0,
    }
  end
  local entry = {
    weapon = weapon,
    sheet = spec.sheet,
    silent = silent,
    muted = false,
    clip = clip,
    hox = hand_off.x or 0,
    hoy = hand_off.y or 0,
    cell_w = spec.cell_w or cell,
    cell_h = spec.cell_h or cell,
    ox = off.x or 0,
    oy = off.y or 0,
    weap_radius = spec.weap_radius or 1.0,
    weap_rotation = spec.weap_rotation or 1.0,
    weap_radial_rotation = spec.weap_radial_rotation or 1.0,
    weap_scale = spec.weap_scale or 1.0,
    hand = spec.hand,
    hand_radius = spec.hand_radius or 1.0,
    hand_rotation = spec.hand_rotation or 1.0,
    hand_radial_rotation = spec.hand_radial_rotation or 1.0,
    hand_scale = spec.hand_scale or 1.0,
    hand_size = spec.hand_size or HOLD_HAND_CELL,
    draw_hand = spec.draw_hand,
    frames = spec.frames or 1,
    anim_speed = spec.anim_speed or 1.0,
    static_angles = rust.static,
    fire = fire,
    -- `keep_while_firing` is the engine's key for the same idea; once the layer
    -- draws, honouring it here is what makes the two agree.
    keep_firing = (spec.keep_firing == true or spec.keep_while_firing == true) or nil,
  }
  hold_entries[#hold_entries + 1] = entry
  hold_ensure_hook()
  if clip then swing_ensure() end
  return rust
end

return M
