# Voxel Shipyard

A small web prototype for building low-poly modular spaceships and flying
them around a parallax starfield. Pick a hull, choose a main and trim colour,
fit attachments (thrusters, weapons, mining tools, cargo modules, utility
parts) to the hull's slots, then press **Fly this ship**.

The name is historical: the first iteration rendered voxels. Ships are now
built from low-poly primitives in the style of hard-surface asset packs.

## Running

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # type-check + production bundle in dist/
```

## How it fits together

The code is split so that the game rules never touch Three.js or the DOM,
and the visuals never read the simulation directly. That is the shape an
online version needs: the simulation runs on a server (or headless in
tests), clients send inputs and receive state plus events, and the scene
draws whatever it is told.

```
src/
  core/        Ship model: primitives, meshes, palette, assembly. No DOM, no Three.js.
  catalog/     Hand-authored hulls and attachments, validated at startup.
  state/       Hangar build state, reducers, share codes.
  render/      Three.js ship mesh used by both the hangar and the flight scene.
  ui/          Hangar side panel (plain DOM).

  game/        PURE SIMULATION. No rendering, no DOM; runs headless.
    simulation.ts  WorldSim: ships by id, rocks, loot, comet, beacons; step(dt) -> GameEvent[]
    map.ts         MapDefinition JSON schema, parseMapDefinition (validation), resolveMap
    beacons.ts     Beacon markers and the enter-once tracker
    world.ts       ShipSpec / ShipEntity / Pick types
    events.ts      GameEvent union: everything the outside world reacts to
    controllers.ts ShipController interface, TurretAi, IdleController
    flightController.ts, projectiles.ts, beam.ts, combat.ts, damageRoll.ts,
    rocks.ts, loot.ts, comet.ts, warp.ts, weapons.ts, mapCoords.ts, random.ts

  scene/       VISUALS behind an API (GameScene). Knows nothing about the simulation.
    gameScene.ts   addShip/removeShip/setShipPose, syncRocks/Loot/Projectiles/Beams/Comet,
                   flash/burst/shockwave/explode, camera, pixelation, aimPoint/project
    shipActor.ts   hull mesh + shield shell + hover outline for one ship
    cameraRig.ts, parallax.ts, spaceAssets.ts, pixelate.ts, effects.ts, shieldShell.ts,
    beamRenderer.ts, projectileRenderer.ts, rockRenderer.ts, lootRenderer.ts,
    cometVisual.ts, healthBars.ts, warpTunnel.ts, beaconRenderer.ts

  hud/         DOM overlays and input: hud.ts, labels.ts, hitMarkers.ts, markerLayout.ts, input.ts

  flight/
    flightSession.ts  The only glue: input -> sim.step -> events -> scene/HUD. spawnNpc() API.
  main.ts      Hangar wiring plus entering/leaving a flight session.
  tools/
    generate-space-assets.py  Renders the background PNGs (pure Python, no dependencies)
```

### The three layers in one frame

1. `FlightInputTracker` turns keys and pointer into a `FlightInput`;
   `FlightSession` hands it to `WorldSim.setInput(playerId, input)`.
2. `WorldSim.step(dt)` advances every ship (players through their input,
   NPCs through their `ShipController`), projectiles, beams, rocks, loot and
   the comet, and returns `GameEvent`s: shots fired, hits with rolled damage,
   ships damaged / destroyed / respawned, rocks broken, pickups collected,
   warp phases, comet lifecycle.
3. `FlightSession` maps events to `GameScene` effects and HUD messages and
   markers, then pushes the new state into the scene (`setShipPose`,
   `syncRocks`, ...) and renders.

### Adding NPCs

`FlightSession.spawnNpc({ name, hullName, surface, colours, weaponMounts, x, z, ... })`
registers a ship in the simulation (team, radius, vitals, respawn, an AI
controller) and in the scene (mesh, shield, outline, label) and returns its
id; `removeShip(id)` takes it out again. Ships are keyed by id everywhere,
so a networked client would call the same scene methods from a server
snapshot. At the simulation level the same thing is `WorldSim.addShip(spec)`
with any `ShipController`; `TurretAi` is the stationary guard, `IdleController`
a prop. New behaviours are new controllers.

### Maps as JSON

A sector is a `MapDefinition` (`src/game/map.ts`): plain JSON in map
coordinates ((0, 0) bottom-left, x right, y up, both `0..size`). Load one
with `?map=name` (fetches `public/maps/name.json`), with the hangar's "Load
map JSON" button, or pass a parsed definition to `FlightSession` as `map`.
Every section is optional and falls back to the starter sector; wrong types
fail with a path like `map.objects[2].kind`. The hangar starts in the
**Proving Ground**, a 500 by 500 map with a dozen hand-placed rocks, one gas
cloud, a cache and a marker beacon (`provingGroundMapDefinition`); the raider
waits in its bottom-left corner. The big 10,000 by 10,000 **Starter Sector**
is `?map=starter-sector`, and `public/maps/example-arena.json` is a small
hand-made arena. "Save map as JSON" in the hangar writes whichever map will
fly next.

```jsonc
{
  "version": 1,
  "name": "Iron Ring Arena",
  "size": 4000,                      // square side in world units
  "seed": 7,                         // drives visuals and the optional rock generator
  "spawn": { "x": 2000, "y": 2000, "heading": 0 },
  "scenery": {
    "stars":   [ { "kind": "field", "depth": -3200, "tile": 5000, "count": 2600,
                   "sizeWorld": 14, "sizePx": 1.6, "brightness": 0.55 } ],   // optional
    "planets": [ { "art": "planet-lava-01", "x": 3200, "y": 3000, "depth": -2200,
                   "radius": 420, "rotation": 0.3 } ],                       // art = file name in public/assets/space
    "sun":     { "x": -1500, "y": 3800, "depth": -7000, "size": 6000 },      // or null
    "nebulae": [ { "art": "nebula-03", "x": 2000, "y": 5000, "depth": -6000, "size": 7000,
                   "tint": "#8c2a5a", "opacity": 0.5, "rotation": 1.2 } ],
    "band":    null                                                           // galactic band sprite, or null
  },
  "rocks": [                                                                  // every rock, explicitly
    { "id": "rock-0001", "x": 2300, "y": 2300, "kind": "crystal", "radius": 4, "respawn": 90 },
    { "id": "big-one",   "x": 700,  "y": 3300, "kind": "giant",   "radius": 12, "respawn": null }  // null: never comes back
  ],
  "comet": { "enabled": true, "maxHp": 1200, "speed": 10, "respawnDelay": 15 },  // null/false disables; any CometTuning field
  "objects": [
    { "type": "cache",  "x": 2000, "y": 2080, "resource": "crystal", "count": 6 },  // permanent pickups
    { "type": "beacon", "id": "north-gate", "x": 2000, "y": 3600, "label": "North Gate",
      "description": "Checkpoint one", "colour": "#6fd3ff", "radius": 14 },          // fires beacon-reached
    { "type": "gas-cloud", "id": "west-cloud", "x": 1250, "y": 2000, "radius": 140,
      "damagePerSecond": 12, "label": "Toxic gas", "colour": "#9bff3d" }             // hurts anything inside
  ],
  "markers": [                                                                 // minimap annotations only
    { "type": "icon",  "x": 2424, "y": 2424, "icon": "mine", "label": "Iron ring" },  // onMinimap defaults true
    { "type": "label", "x": 2000, "y": 2000, "text": "IRON RING ARENA", "colour": "#9fb3cc", "size": 12 } // expanded map only unless onMinimap
  ]
}
```

Markers are pure presentation: the simulation never reads them. Icons are
old-school minimap pins, one of `home`, `mine`, `crystal`, `skull`, `shop`,
`repair`, `quest`, `flag`, `star`, `gate`, `fuel`, `anchor` (unknown names
fail to parse); `colour` overrides the icon's own palette and `label` is
shown next to it on the expanded map. Labels name regions; by default they
only appear on the expanded map, set `"onMinimap": true` to show one on the
small map too.

Rock kinds: `stone`, `iron`, `ice`, `crystal`, `giant`. Resources: `ore`,
`iron`, `ice`, `crystal`. Depths are negative (below the ship plane); deeper
means slower parallax. `resolveMap` converts to world coordinates and the
same `ResolvedMap` feeds both `WorldSim` (rocks, caches, beacons, comet) and
`GameScene` (scenery). NPCs are deliberately not part of a map; they are
spawned through `FlightSession.spawnNpc` so a server can own them.

#### Gas clouds (area hazards)

A `gas-cloud` object is a circle that damages every ship inside it: a tick
of `damagePerSecond / 2` every half second, the first one the moment you
cross the radius, shields soaking it before hull. Defaults: radius 60, 10
damage a second, label "Toxic gas", acid-green colour; `id` defaults to
`gas-<index>`. The logic is `HazardTracker` in `src/game/hazards.ts`, which
only remembers which ship is in which cloud and when it next hurts, so a
server runs it as-is and sends `hazard-entered`, `hazard-left` and
`hazard-damage` (all carrying the hazard id) to the players concerned. A
ship that dies inside counts as having left, so respawning in a cloud fires
`hazard-entered` again. Clouds are drawn from the map alone, so nothing about
them is streamed. The Proving Ground has one north-west of the spawn; the
Starter Sector has a wide toxic cloud north-west of its spawn and a small,
nastier ion haze to the south-east.

#### Rocks are records, not clusters

The map is static and every rock is its own record with a stable `id`, so a
server can key rock state on it: health, whether it is currently mined out,
and when it returns. `id` defaults to `rock-0001`, `rock-0002`, ... by
position in the list; `kind` defaults to `stone`, `radius` to 3 and
`respawn` to 120 seconds. There is no procedural fill at runtime: the sim
builds its `RockField` straight from the list, positions never change, and
a depleted rock keeps its record (health 0) until its respawn time, when it
comes back as the same rock and the sim emits `rock-respawned`.

Writing hundreds of rocks by hand is tedious, so the parser accepts an
authoring recipe in place of the list:

```jsonc
"rocks": { "generate": {
  "clusters": [ { "x": 2000, "y": 2600, "radius": 180, "count": 30, "kind": "iron", "crystalChance": 0 } ],
  "giants":   [ { "x": 700, "y": 3300, "radius": 12 } ],
  "scatter":  { "clusters": 4, "perCluster": 50, "clusterRadius": 320, "keepClear": 180, "giants": 2 }, // or null
  "respawn":  90
} }
```

The recipe is expanded deterministically from `seed` **at parse time**
(`generateMapRocks`), and only the explicit list exists in the parsed
`MapDefinition`. "Save map as JSON" in the hangar writes that list, which is
how a recipe gets baked into a file a server can hold: load it, save it,
hand-edit ids or positions as you like. Both files in `public/maps/` are
already explicit.

What the client sees is also server-shaped. `RockField.inView(x, z, r)` and
`RockField.snapshot(x, z, r)` return only the alive rocks near a point, and
`FlightSession` pushes just those to the scene (340 units around the player),
so rocks appear as you approach and vanish behind you exactly as they would
when streamed from a server by interest radius. The minimap draws the full
static list, which a client can download once with the map.

### Stances: friendly until provoked

Every ship has a `stance`, `friendly` or `hostile` (`ShipSpec.stance`,
hostile by default). A friendly ship is nobody's enemy: its AI holds fire
(a `TurretAi` still turns to watch you), the HUD lists it as a friendly
ship rather than an enemy, the minimap shows it green, and seeker missiles
ignore it. It turns hostile when a weapon hit from another team lands on it
(`reason: "provoked"`), when its controller's `wantsToAttack` says so
(`reason: "ambush"`; `TurretAi` takes `ambushRange` and `ambushDelay`), or
when a script calls `WorldSim.setShipStance` (`reason: "set"`). Each change
raises `ship-stance-changed`; the stance resets to the spec's value on
respawn. The hangar's raider starts friendly and jumps you if you stay
within 70 units of it for two seconds.

### Talking to ships, chat and the HUD layout

NPCs spawned with `dialogue: { range, lines }` can be talked to: within
`range` units of the player's centre (30 by default, `DEFAULT_INTERACT_RANGE`)
a "Space · Talk to <name>" prompt appears above the weapon bar, and Space
opens a dialogue panel inside the chat box, styled as a holographic comms
screen: the speaker's portrait in a glowing frame on the left
(`public/assets/portraits/*.png`, pixel art rendered by
`tools/generate-portraits.py`), their name as a cyan header, and the line
typing itself out (22 ms a character, at most 1.4 s a line) with a blinking
"Space ▸ continue" cue. Space or a click completes a line that is still
typing, then advances; holding Space skips a line every 0.14 s; Esc closes.
Dialogue is modal: the ship is held (`WorldSim.setHeld`, velocity zeroed,
input ignored, no firing) and every other control, from the map to the
chat box, is ignored until the conversation ends. Every line is also
written to the chat log. The hangar
spawns a **Navigator** in the top-right corner of the Proving Ground (team
`guild`, friendly, `provokable: false` so shooting him never turns him
hostile, and `invulnerable: true` so nothing damages him: he has no shield,
no bars over his name, and shots, rams and gas pass without effect) with a
five-line briefing.

The flight HUD is now laid out like a classic MMO: minimap, status lines
(position, heading, speed, kills, cargo, nearest enemy, comet) and the
settings buttons in a column top-right; a chat panel bottom-left (Enter
focuses the input, Enter sends, `/help` opens the controls panel, and
anything you say floats above your ship for five seconds); weapons and
prompts bottom-centre. The old top-left readout and bottom-left control
hints are gone; the controls live behind the Controls button and `/help`.
Flight keys are ignored while the chat input has focus.

### Interfaces: slots, ids and server commands

Everything the player can open lives in an interface system
(`src/hud/interfaces/`) modelled on old-school MMO clients and rendered
with **React**. The model is React-free: `InterfaceStore` (`store.ts`) holds
the registry, the open interface per slot and its props, and is unit
tested; `ChatController` (`chat.ts`) holds the chat log and the dialogue
state machine. React components (`ChatInterface`, `InventoryInterface`,
`MapInterface`, `HelpInterface`, `PanelInterface`, `NoticeInterface`) read
those stores through `useSyncExternalStore` and render into five **slot**
containers mounted by `InterfaceManager`; the simulation, the scene and
the per-frame canvases stay outside React. There is one interface open per
slot:

| slot           | where                              | opens by default |
| -------------- | ---------------------------------- | ---------------- |
| `chat`         | bottom-left                        | Chat (0)         |
| `inventory`    | bottom-right, tabbed side panel    | Side panel (1)   |
| `main`         | centre, over the other interfaces  | Map (2), Controls (3) |
| `overlay`      | top-left, under everything         | Panel (4)        |
| `full_overlay` | whole screen, over everything      | Notice (5)       |

An interface is registered as `{ id, slot, name, view }`, where `view` is a
React component receiving `{ id, props, close }`; the chat is id 0 by
decree (`INTERFACE_IDS`). Child elements carry `data-component-id` so a
server can address `id:component`. `InterfaceManager` exposes the store:
`open(id, props)`, `close(id)`, `closeSlot(slot)`, `closeTopmost()`,
`toggle`, `isOpen`, `setProps`, `list()`, and `apply(command)` for the
server-shaped commands `interface-open`, `interface-close`,
`interface-close-slot` and `interface-set` (props are per interface: the
panel takes `title` and `lines`, the notice `title` and `body`, the side
panel `tab`; props set on a closed interface wait for its next open). Until there
is a server, `/ui` in the chat sends the same commands: `/ui list`,
`/ui open 4 title=Objectives lines=Mine iron|Talk to the Navigator`,
`/ui open 5 title=Warning body=Raiders inbound`, `/ui set 1 tab=2`,
`/ui close-slot main`. `FlightSession.applyInterfaceCommand` is the hook a
network layer would call.

The **side panel** (`InventoryInterface`) is a strip of tabs over a content
area, like the old RuneScape inventory. A tab is `{ id, label, icon?,
Component }`, a React component that may read the HUD readout and actions
through `useServices()`. The HUD defines four (Cargo, Ship, Settings,
Controls in `interfaces/tabs.tsx`); add your own with
`hud.inventory.addTab(...)`, replace them with `setTabs`, or switch with
`selectTab`. Esc closes the topmost layer: a full overlay first, then the
main window, then leaves flight.

### Toward online play

- The server owns a `WorldSim`. Clients send `FlightInput` (and warp /
  weapon-group requests); the server steps at a fixed rate and broadcasts a
  snapshot of `ShipEntity` state plus the `GameEvent` list for that tick.
- Rocks need no per-tick traffic: the client has the static list from the
  map, and the server sends `RockSnapshot`s (id, position, health) for rocks
  entering a player's interest radius, plus `rock-damaged`, `rock-destroyed`
  and `rock-respawned` events for ones already in view. Each carries the
  rock's id, which is how a client knows *which* rock to update.
- Health bars follow from that state, not from who fired. A rock shows a bar
  exactly when `hp < maxHp` (`isDamaged`, `RockField.damagedInView`), so when
  one player starts mining a rock, every player with it in view gets the
  same `rock-damaged` and shows the bar at the same moment; nothing extra
  has to be sent.
- Clients run `GameScene` + HUD from snapshots. `FlightSession` already
  separates "apply events" from "push state", so a `NetworkSession` can
  replace the local `WorldSim` with a snapshot stream and keep everything
  else. Client-side prediction would run a local `WorldSim` for the player's
  own ship and reconcile.
- Nothing in `game/` imports from `scene/`, `hud/` or `three`; keep it that
  way. Visual-only data (colours, meshes) lives in `SessionShip` /
  `ShipVisualSpec`, gameplay data in `ShipSpec`.

### Key ideas

- **Coordinates.** X is starboard, Y is up, Z is forward (the nose). Units
  are arbitrary; a fighter is about 12 long.
- **Primitives, not meshes.** A hull is a list of primitives: `segment`
  (a sweep between two cross-sections, which covers boxes, chamfered and
  hexagonal prisms, cylinders, cones and tapered fuselage sections) and
  `wing` (a convex planform with optional thickness taper). Each has a
  palette role, a position, an Euler rotation and a `mirror` flag so
  symmetric details are authored once. Thin `plate`s act as painted panels.
- **Palette roles.** Each primitive has a role rather than a colour. `main`
  and `trim` are user-chosen; `dark`, `metal`, `glass` and `glow` are fixed
  so every ship keeps readable details. `glow` renders unlit and additive,
  which is what makes engine plumes read as light.
- **Slots.** A hull exposes slots with a position on its surface, a facing
  direction, the categories it accepts and a footprint size (`small` fits in
  roughly a 1.2-unit square around the mount, `large` in 2.4). Different hulls
  expose different categories, which is what makes a fighter and a miner take
  different parts.
- **Attachments** are authored once with their base at the origin extending
  along +Z. The slot's facing rotates them into place, so one cargo module
  stands on a hauler's deck or lies along a miner's flank.
- **Validation.** The catalog throws at startup on duplicate ids or defaults
  that do not fit. Tests check every part tessellates cleanly and extends away
  from its mount, every mount sits on its hull, attachments stay within their
  footprint class, and default loadouts never overlap each other.

## Flight mode

- **Controls.** W/S thrust and reverse, A/D strafe (D is the pilot's right
  on screen), the mouse aims the nose, the left button fires the selected
  weapon group, 1/2/3 pick the group, Shift boosts. Wheel zooms, Q/E tilt
  the camera, C toggles perspective / orthographic, Esc returns to the hangar.
- **Coordinates note.** With Y up and the nose along +Z in a right-handed
  frame, starboard is -X, so screen-right is -X in flight. Hull slots are
  labelled accordingly. Everything the player sees (HUD readout, minimap,
  warp messages) uses map coordinates instead: (0, 0) at the bottom-left
  corner of the map, x growing to the right and y growing upward, both
  0 to 10,000 (`flight/mapCoords.ts`).
- **Feel.** Acceleration with exponential drag gives a quick, floaty arcade
  feel with a natural top speed; the nose turns towards the cursor at a capped
  rate so it snaps without being instant. Tuning lives in
  `flight/flightController.ts` as one object.
- **Camera.** A follow camera with velocity lookahead, tilted back from
  vertical by default so the ship reads as 2.5D. The orthographic camera
  shares the same rig and framing for a fair comparison. North (map +y) is
  always up the screen.
- **Minimap.** A square minimap in the bottom-right corner: the whole map
  fills it, north up, N/E/S/W sitting on the frame, a faint grid, rocks as
  dots, planets, gas clouds as translucent discs, beacons as diamonds,
  map-authored icons, enemies in red, the comet with its heading, and your
  ship as a white dot with a heading tick. Press M or the corner button to
  expand it into a large map with a ten-by-ten grid, coordinate ticks, every
  label and icon name, and a live readout of the map coordinate under the
  cursor (handy when writing markers). Clicking either map warps there; Esc
  or M closes the big one.
- **Zoom.** The wheel zooms between 55 and 320 units of camera distance,
  from a close fighter view out to roughly a 600-unit-wide field.
- **Map.** 10,000 x 10,000 units, bounded by a line square. Depth order is
  physical: rocks on the plane, then planets (2,000 to 2,800 down), then four
  starfields (3,200 to 5,200 down: a dense faint field, clustered clumps, a
  medium field and sparse bright giants), then nebulae, a galactic band and
  a soft sun (6,000 to 7,000 down). So planets drift a little, stars barely,
  nebulae least of all. Star tiles repeat 3x3 around the camera. The seeded
  RNG makes the map identical every visit.
- **2D backdrop from PNGs.** Everything behind the ship is flat art: stars
  are soft point sprites, and planets, moons, the sun and nebulae are PNG
  billboards that always face the camera, so the backdrop reads as 2D
  whatever the camera tilt or ship heading. The files live in
  `public/assets/space/` and are listed in `src/flight/spaceAssets.ts`;
  `python3 tools/generate-space-assets.py` regenerates them, or drop in your
  own PNGs with the same names (planet discs centred, see `discFraction`).
- **Stars** are faint and twinkle: each star has its own phase, speed and a
  second colour it shifts towards, all done in the point material's vertex
  shader. Realistic colour mix (mostly yellow-white, some blue and orange).
- **Combat.** You have a shield (blue bar) and hull (green bar) shown with a
  nametag above your ship. Shields soak damage first and regenerate after
  three quiet seconds; ramming rocks above a modest speed costs hull. A
  Raider gunship waits near the start with its own bars and a shield bubble
  that flashes when hit. It turns lazily toward you and returns slow fire
  when you are in range. Kill it and it respawns after eight seconds; die
  and you respawn at the start. Kills and deaths are on the HUD; all numbers
  live in `flight/combat.ts`.
- **Rocks and mining.** Every rock is an explicit map record with a stable
  id, fixed on the ship plane, one of stone, iron (tough, dark), ice
  (fragile, pale), crystal (violet with glowing gem nodes) or giant (radius 8
  to 13). Rocks never move and never split: a depleted rock vanishes, drops
  its resources and returns after its respawn delay (120 s by default, or
  never). Only rocks within 340 units of the player are drawn, the same set
  a server would stream. Each has a health pool in damage
  points (roughly 10 + 12 per unit of radius, times the kind's toughness;
  giants into the hundreds). An untouched rock shows no bar; once a rock has
  lost any health a small billboard bar appears above it and stays until the
  rock is mined out or respawns whole. Hovering a rock outlines it and shows a tooltip with its
  kind, size, health and drops; hovering the enemy does the same for it.
  Breaking a rock scatters resource pickups: ore, iron, ice or crystal,
  scaled by the rock's size. Pickups drift, get pulled in within 16 units of
  the ship and are collected on contact; the HUD shows cargo and its worth.
  The Mule's Mining Laser and Rock Drill work as short beams that deal heavy
  rock damage and double or triple the drops, while barely scratching ships.
  Flying into a rock stops the ship against it (and costs hull above a
  modest speed) rather than bouncing. Logic in `flight/rocks.ts` and
  `flight/loot.ts`; bars in `flight/healthBars.ts`.
- **Gas clouds.** Map-placed hazards drawn like the backdrop nebulae: the
  same wispy nebula PNGs, tinted in the cloud's colour, laid flat on the
  ship plane in five offset, rotated, slightly stretched layers (a dark base
  that dims the stars, two coloured bodies, a faint additive glow and an
  outer wisp layer), plus a sparse dust of dim motes. There is no outline
  and no ring: the damage circle is invisible, and the dense middle of the
  cloud roughly marks it (the tooltip gives the exact radius). The layers
  turn a few degrees a minute and breathe a few percent, so a cloud reads
  as still. Fly in and you take a tick of damage every half second, shields
  first; the HUD shows a pulsing edge glow in the cloud's colour and a
  warning line with the damage rate, hits show as incoming markers, and the
  minimap marks each cloud as a translucent disc. The gas thins to a quarter
  around the player's own ship so it stays readable inside. Clouds sit on
  the overlay layer with the health bars, so pixelation never touches them.
  Logic in `game/hazards.ts`, visuals in `scene/hazardRenderer.ts`.
- **The comet.** One shooting star crosses the map at a time: a glowing icy
  head with a long particle tail, about 2,400 health, moving at 14 units a
  second (well under your top speed) on a straight line. It shows on the
  radar as a pulsing cyan dot with a heading tick, and the HUD reports its
  distance and health. Hover it for an outline and tooltip; shoot or beam it
  to mine it. Every 120 damage it sheds an ice or crystal chunk, and when
  depleted it bursts with a payload of ice, crystal and iron. Mining tools
  multiply the chunks. Flying into it stops you against it and carries you
  along. When it is mined out or flies off the map, a new one enters from
  another edge 25 seconds later. Logic in `flight/comet.ts`.
- **Minimap warp.** Click anywhere on the minimap to warp there. The drive
  spools for half a second (nose swings onto the heading, ship shivers),
  the view blanks out into a hyperspace tunnel of streaking stars, and the
  destination fades back in with the ship already sitting there. The tunnel
  lasts about 0.4 s plus one second per 2,200 units, clamped to 0.8 to
  4.5 s, with a countdown in the HUD. Input and collisions are suspended
  while warping. Phase maths in `flight/warp.ts`, tunnel drawing in
  `flight/warpTunnel.ts`. An edge arrow with a distance label points at the
  comet whenever it is off screen.
- **Pixelation.** The top-right selects (or P and O) set a pixelation level
  (Off, Light, Medium, Heavy, Retro) and a scope. "3D only" renders the 2D
  backdrop sharp and composites the ships, rocks, shots and effects from a
  low-resolution buffer over it; "Everything" renders the whole frame small
  and scales it up with nearest filtering. The DOM UI and the rock health
  bars (an overlay layer drawn last at full resolution) are never pixelated.
  The choice is remembered in localStorage. See `flight/pixelate.ts`.
- **Parallax in orthographic mode.** Depth gives no parallax under an
  orthographic projection, so each layer is translated and scaled per frame
  (`position = C(1 - f)`, `scale = f`, with `f = height / (height - depth)`),
  which reproduces exactly what the perspective camera would show on the
  ship plane.
- **Animated jets.** Thruster plumes use the `plume` role. Each plume vertex
  carries its extent vector and position along it, and the glow material's
  vertex shader stretches plumes by throttle with a per-plume flicker, so the
  animation costs nothing on the CPU.
- **Weapon groups.** Each weapon attachment maps to a profile in
  `flight/weapons.ts` and belongs to one of three groups shown in the HUD
  bar at the bottom, each with its own cooldown or charge readout. Eleven
  weapons in all:
  - **1 Guns**, hold to fire, every mount on its own cooldown: Autocannon
    (fast tracers), Gauss Rifle (slow heavy slugs), Flak Cannon (seven-pellet
    spread that pops at the end of its flight), Plasma Repeater (green orbs),
    Point Defence Turret (pellet hose).
  - **2 Beam**, hold to charge then every beam mount discharges a hitscan
    beam at the first rock or ship in line; release early and the charge
    bleeds away: Pulse Lance (0.55 s charge, 160 range, 45 damage, pulsing
    cyan), Siege Beam (1.4 s charge, 230 range, 120 damage, thick orange,
    with shockwaves), Arc Caster (0.3 s charge, 95 range, jagged purple
    lightning that re-rolls 40 times a second). Logic in `flight/beam.ts`,
    ribbons in `flight/beamRenderer.ts`.
  - **3 Missiles**, click for a volley: Missile Pod (slow, hard-hitting),
    Rocket Pod (bursts of three fast rockets), Seeker Missiles (home on the
    nearest ship or rock within 90 units).
  Groups the ship has no mounts for are greyed out. Damage per hit is the
  weapon's, not a global number.
- **Damage rolls and hit markers.** A weapon's listed damage is its full
  hit. Most hits land at 88 to 100% of it, about one in ten glances for 60
  to 78%, and about one in eight crits for 1.75 to 2.2x (`flight/damageRoll.ts`).
  Every hit spawns a floating number with an X mark at the impact point:
  white on hull, blue on shields, sand on rocks and the comet, red for
  damage you take, orange and larger for crits. The markers are DOM, so
  they stay crisp under any pixelation setting, and a per-frame layout pass
  (`flight/markerLayout.ts`) keeps them from overlapping: older markers hold
  their place, newer ones move to the nearest free slot, upward first.
- **Everything aims at the cursor.** Each mount fires from its own muzzle
  towards the point under the mouse, so wing guns and beams converge there
  and cross when the cursor is close to the ship. An aim point sitting on a
  muzzle falls back to straight ahead. The enemy aims the same way, at you.
- **Shields and effects.** Shields are a flattened shell with a fresnel rim
  and faint grid, a ripple spreading from each hit, a flash when they
  collapse and a pulse when they return (`flight/shieldShell.ts`). Kills and
  heavy impacts throw expanding shockwave rings, debris and flashes.

## Performance notes

The target is many ships on screen at once (a battle of twenty or more).

- A ship is one merged geometry for lit surfaces and one for glow: two draw
  calls regardless of how many parts are fitted. The outline is a third only
  when enabled.
- Triangle counts with default loadouts are a few thousand per ship (the
  stats panel shows the live number). Twenty ships is well under 100k
  triangles.
- Tessellation is CPU work done only when the shape changes (hull or part
  swap); colour changes repaint the vertex colour buffer in place. Identical
  builds can share one geometry (the share code is a natural cache key).
- If more is needed later: LODs by dropping small detail primitives (plates,
  rings) at distance, and instancing identical ships with `InstancedMesh`.

## Adding content

- New attachment: add an object to the relevant file in `src/catalog/attachments/`.
  Build it from `box`, `taper`, `tube`, `cone`, `wing` and `plate`, with its
  base at z = 0 extending along +Z.
- New hull: add a file in `src/catalog/hulls/`, register it in `index.ts`.
  Author the starboard side and set `mirror: true` for anything symmetric.
  Slot positions are points on the surface; the tests will tell you if a
  mount floats or two defaults collide.
- New palette role or stat: extend the union in `core/palette.ts` /
  `core/types.ts`; the compiler will point at every place that needs updating.
