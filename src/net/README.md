# Client ↔ game server protocol

The client speaks the Apollo server's own framing (`protocol/core` in
`apollo-online`) over a WebSocket that carries the raw TCP byte stream, and
a packet set modelled on RuneScape's: the client sends clicks and input, the
server sends entity updates with masks, projectiles, graphics and interface
commands. The server decides everything.

## Framing (mirrors `PacketEncoder` / `PacketDecoder`)

```
opcode (1 byte, unsigned) · [length] · payload
```

- Fixed-size opcodes carry no length. `VAR_BYTE` opcodes carry a 1-byte
  length (max 255), `VAR_SHORT` a 2-byte big-endian length (max 65535).
- An opcode missing from the direction's size table corrupts the stream;
  both sides drop the rest and close, as `PacketDecoder` does.
- Payload primitives are exactly `Packet.java`'s: `boolean` (1 byte),
  `short` (2, read unsigned), `int` (4, signed), `long` (8), `float` (4,
  IEEE 754), `guid` (16, canonical order), `string` (UTF-8 + NUL).
- Code: `src/net/packet.ts`, `src/net/framing.ts`, `src/net/sizes.ts`.
  Tests reuse the Java test vectors byte for byte.

**Transport.** Browsers cannot open TCP. The client sends the identical byte
stream inside WebSocket binary frames and treats what it receives as a
stream (frame boundaries carry no meaning). Put either a WebSocket handler
in the Netty pipeline before `PacketDecoder` (`WebSocketServerProtocolHandler`
plus a `BinaryWebSocketFrame` → `ByteBuf` unwrap) or a TCP↔WebSocket bridge
such as websockify in front of the game server port.

## Login flow

1. `POST {gateway}/api/auth/login` → `{ accessToken, refreshToken, ... }`
   (`src/net/gateway.ts`, dialog in `src/ui/loginDialog.ts`).
2. `GET /api/servers` lists registered servers; the client connects to
   `ws://{address}:{port}` (or a URL typed by hand).
3. First packet: `HANDSHAKE` with the JWT and the hangar build. The server
   verifies it with `AccessTokenVerifier` and answers `LOGIN_RESPONSE`.
4. On `ok`, the server sends `REBUILD_NORMAL` (which sector), then the
   first `PLAYER_INFO` / `NPC_INFO` with appearances, `UPDATE_INV_FULL`,
   `UPDATE_STAT` per talent, `VARP`s and `SET_MAP_FLAG`.

> **Server change needed:** `ClientOpcodes.HANDSHAKE` is `VAR_BYTE` on the
> server today. An HS256 access token is ~280 bytes, so the handshake must
> be `VAR_SHORT` (the client already sends it that way).

Times on the wire are `int` milliseconds of the server clock. Entities
(players, NPCs, projectiles, ground items) go by `int` index; locs (rocks,
beacons, hazards) keep their string ids from the map file; items and
talents travel by index into the shipped catalogs (`src/client/definitions.ts`).

## Client → server (`src/client/opcodes.ts` → `ClientOpcodes`)

| Op | Name | Size | Payload |
|---:|------|------|---------|
| 1 | HANDSHAKE | VAR_SHORT | `short protocol, string jwt, build` |
| 2 | LOGOUT | 0 | |
| 3 | IDLE | 0 | keep-alive |
| 10 | MOVE_FLIGHT | 12 | `short seq, short flags, float aimX, float aimZ` — flags: bits 0-1 thrust+1, 2-3 strafe+1, 4 boost, 5 fire, 6 aim present |
| 11 | MOVE_MINIMAPCLICK | 8 | `float x, float z` — put the map flag here |
| 20 | OPPLAYER | 6 | `short option, int index` |
| 21 | OPNPC | 6 | `short option, int index` |
| 22 | OPLOC | VAR_BYTE | `short option, string locId` |
| 23 | OPOBJ | 6 | `short option, int index` |
| 24 | OPHELD | 6 | `short option, short item, short slot` |
| 30 | IF_BUTTON | 6 | `int interfaceId, short button` |
| 31 | CLOSE_MODAL | 4 | `int interfaceId` |
| 32 | RESUME_PAUSEBUTTON | 4 | `int interfaceId` (dialogue "continue") |
| 40 | MESSAGE_PUBLIC | VAR_SHORT | `string text` |
| 41 | CLIENT_CHEAT | VAR_SHORT | `string text` (slash command without the slash) |

`build` is `string hullId, string main, string trim, string material, short n, (string slot, string attachment) × n`.

Option numbers (`src/client/definitions.ts`): option 1 is the default verb
("Mine" on a rock or the comet, "Talk-to" on a ship, "Take" on a ground
item, "Drop" on a held item); `10` is Examine on anything. The server
writes examine text and sends it as `MESSAGE_GAME`. Mining is `OPLOC 1` on
a rock; the server keeps aiming and firing until input or distance
interrupts it, exactly as RuneScape keeps mining. Warp is `IF_BUTTON` on
the map interface (id 2, button 1) after `MOVE_MINIMAPCLICK` set the flag.
Weapon group selection is `IF_BUTTON` on the weapon bar (id 6, buttons 1-3).

## Server → client (`ServerOpcodes`)

| Op | Name | Size | Payload |
|---:|------|------|---------|
| 1 | LOGIN_RESPONSE | VAR_BYTE | `short status, string message, int playerIndex, int serverTimeMs, short tickMs` — status 0 ok, 1 invalid token, 2 full, 3 already online, 4 bad build, 5 protocol mismatch |
| 2 | LOGOUT | VAR_BYTE | `string reason` |
| 3 | REBUILD_NORMAL | VAR_SHORT | `string mapName, string url` — the client fetches the map JSON |
| 10 | PLAYER_INFO | VAR_SHORT | entity update block (below) |
| 11 | NPC_INFO | VAR_SHORT | entity update block |
| 20 | MAP_PROJANIM | 34 | `int id, short item, float x0, z0, y, x1, z1, int targetIndex (-1), short delayMs, short durationMs` |
| 21 | PROJ_DEL | 4 | `int id` (a shot that ended early) |
| 22 | MAP_ANIM | 18 | `short graphic, float x, float z, float scale, int rgb (0 = default)` |
| 23 | HIT_SPLAT | 14 | `float amount, short kind, float x, float z` (damage on a loc) |
| 30 | LOC_ADD | VAR_BYTE | `string id` (rock back) |
| 31 | LOC_DEL | VAR_BYTE | `string id` (rock mined out) |
| 32 | LOC_HEALTH | VAR_BYTE | `string id, float hp` |
| 40 | OBJ_ADD | 19 | `int index, short item, int count, float x, float z, boolean permanent` |
| 41 | OBJ_DEL | 4 | `int index` |
| 50 | UPDATE_INV_FULL | VAR_SHORT | `short n, (short item, int count) × n` |
| 51 | UPDATE_STAT | 6 | `short talent, short level, short base` |
| 52 | VARP | 8 | `int id, int value` |
| 60 | IF_OPENSUB | VAR_SHORT | `int id, string propsJson` |
| 61 | IF_CLOSESUB | 4 | `int id` |
| 62 | IF_SETPROPS | VAR_SHORT | `int id, string propsJson` |
| 70 | MESSAGE_GAME | VAR_SHORT | `short kind (0 log, 1 banner, 2 both), string text` |
| 71 | SET_MAP_FLAG | 9 | `boolean set, float x, float z` |

### Entity update block (`PLAYER_INFO`, `NPC_INFO`)

```
int serverTimeMs, short count, then per entity:
int index, short masks,
[MOVEMENT 0x001]   boolean teleport, float x, z, vx, vz, heading, throttle
[FACE     0x002]   float heading                       (turned without moving)
[APPEARANCE 0x004] short type, string name, string hullName, string team, float radius,
                   build, string accent, boolean invulnerable, boolean provokable,
                   float talkRange (<0 none), float maxShield, float maxHull
[STATUS   0x008]   short flags: bit0 alive, bit1 hostile, bit2 held
[HIT      0x010]   float amount, short kind, boolean absorbed, float x, z, float shield, float hull
[SPOTANIM 0x020]   short graphic, float scale, int rgb
[CHAT     0x040]   string text                         (public chat, shown overhead)
[WARP     0x080]   float fromX, fromZ, toX, toZ, distance, heading, int startMs, chargeUntilMs, blankMs, arriveMs, doneMs
[ANIMATION 0x100]  short animation
[REMOVE   0x8000]  (no fields; the entity left)
```

Entity type 0 is a ship (players and NPC ships), 1 is the comet (an NPC with
no build; its health rides in `hull`). The server sends MOVEMENT for every
entity that moved each tick, APPEARANCE once, STATUS when it changes, and the
rest as they happen. The client interpolates MOVEMENT a little behind the
server clock (`src/client/interpolation.ts`); `teleport` resets that.

Graphics ids, animation ids, varp ids and interface ids are in
`src/client/definitions.ts`; what each graphic draws is in
`src/flight/graphics.ts`. Projectile `item` is the weapon's catalog index;
a beam weapon's "projectile" is the line it drew, shown for `duration`.

## Where things live

- `src/net/` — bytes: packet reader/writer, framing, size tables, transports, gateway HTTP.
- `src/client/` — the game protocol: opcodes, typed messages, one module per packet group under `mechanics/` (wire layout both ways + effect on the world), `world.ts` (the replicated state), `connection.ts`, `inputSender.ts`, `pick.ts`, `definitions.ts`.
- `src/flight/` — presentation: `shell.ts` (HUD, input, menus → packets, server windows), `presenter.ts` (draws the world), `effects.ts` + `graphics.ts`, `onlineSession.ts` (real server), `flightSession.ts` + `sandbox.ts` (offline stand-in speaking the same packets).

`src/client/mechanics/codec.test.ts` round-trips a sample of every message
through real frames in both directions; keep it green when a layout changes
and the server can be checked against the same bytes.
