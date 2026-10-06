import { PacketSizes, VAR_BYTE, VAR_SHORT } from '../net/sizes';

/**
 * The game's opcodes, laid out like the server's `protocol/game` tables so
 * the two can be diffed side by side, and named after the RuneScape
 * packets they mirror. `HANDSHAKE` and `LOGIN_RESPONSE` are what the
 * server defines today; the rest is the client's proposal. Payload
 * layouts live with the mechanic module that owns each opcode and are
 * summarised in `src/net/README.md`.
 *
 * Sizes are bytes for fixed payloads, or VAR_BYTE / VAR_SHORT for a one-
 * or two-byte length header. Fixed sizes are the sum of the fields:
 * boolean 1, short 2, int 4, float 4, long 8, guid 16.
 */

/** Opcodes sent TO the server from the client. */
export const ClientOpcodes = {
  /**
   * The first packet: `short protocol, string jwt, build`. The server defines this as VAR_BYTE,
   * but an HS256 access token from the gateway is around 280 bytes, so it must become VAR_SHORT
   * on the server before a real token fits.
   */
  HANDSHAKE: 1,
  LOGOUT: 2,
  /** Keep-alive while nothing else is being sent. */
  IDLE: 3,
  // movement
  MOVE_FLIGHT: 10,
  MOVE_MINIMAPCLICK: 11,
  // options on things: the number of the option picked on the right-click menu
  OPPLAYER: 20,
  OPNPC: 21,
  OPLOC: 22,
  OPOBJ: 23,
  OPHELD: 24,
  // interfaces
  IF_BUTTON: 30,
  CLOSE_MODAL: 31,
  RESUME_PAUSEBUTTON: 32,
  // chat
  MESSAGE_PUBLIC: 40,
  CLIENT_CHEAT: 41,
} as const;

export const CLIENT_SIZES = new PacketSizes()
  .define(ClientOpcodes.HANDSHAKE, VAR_SHORT)
  .define(ClientOpcodes.LOGOUT, 0)
  .define(ClientOpcodes.IDLE, 0)
  .define(ClientOpcodes.MOVE_FLIGHT, 12)
  .define(ClientOpcodes.MOVE_MINIMAPCLICK, 8)
  .define(ClientOpcodes.OPPLAYER, 6)
  .define(ClientOpcodes.OPNPC, 6)
  .define(ClientOpcodes.OPLOC, VAR_BYTE)
  .define(ClientOpcodes.OPOBJ, 6)
  .define(ClientOpcodes.OPHELD, 6)
  .define(ClientOpcodes.IF_BUTTON, 6)
  .define(ClientOpcodes.CLOSE_MODAL, 4)
  .define(ClientOpcodes.RESUME_PAUSEBUTTON, 4)
  .define(ClientOpcodes.MESSAGE_PUBLIC, VAR_SHORT)
  .define(ClientOpcodes.CLIENT_CHEAT, VAR_SHORT);

/** Opcodes sent FROM the server to the client. */
export const ServerOpcodes = {
  // session
  LOGIN_RESPONSE: 1,
  LOGOUT: 2,
  /** Which sector to fly: `string name, string url`; the client fetches the map JSON itself. */
  REBUILD_NORMAL: 3,
  // entity updating
  PLAYER_INFO: 10,
  NPC_INFO: 11,
  // projectiles and graphics
  MAP_PROJANIM: 20,
  PROJ_DEL: 21,
  MAP_ANIM: 22,
  HIT_SPLAT: 23,
  // locs (map objects: rocks)
  LOC_ADD: 30,
  LOC_DEL: 31,
  LOC_HEALTH: 32,
  // objs (ground items)
  OBJ_ADD: 40,
  OBJ_DEL: 41,
  // the player's own state
  UPDATE_INV_FULL: 50,
  UPDATE_STAT: 51,
  VARP: 52,
  // interfaces
  IF_OPENSUB: 60,
  IF_CLOSESUB: 61,
  IF_SETPROPS: 62,
  // chat and the map flag
  MESSAGE_GAME: 70,
  SET_MAP_FLAG: 71,
} as const;

export const SERVER_SIZES = new PacketSizes()
  .define(ServerOpcodes.LOGIN_RESPONSE, VAR_BYTE)
  .define(ServerOpcodes.LOGOUT, VAR_BYTE)
  .define(ServerOpcodes.REBUILD_NORMAL, VAR_SHORT)
  .define(ServerOpcodes.PLAYER_INFO, VAR_SHORT)
  .define(ServerOpcodes.NPC_INFO, VAR_SHORT)
  .define(ServerOpcodes.MAP_PROJANIM, 34)
  .define(ServerOpcodes.PROJ_DEL, 4)
  .define(ServerOpcodes.MAP_ANIM, 18)
  .define(ServerOpcodes.HIT_SPLAT, 14)
  .define(ServerOpcodes.LOC_ADD, VAR_BYTE)
  .define(ServerOpcodes.LOC_DEL, VAR_BYTE)
  .define(ServerOpcodes.LOC_HEALTH, VAR_BYTE)
  .define(ServerOpcodes.OBJ_ADD, 19)
  .define(ServerOpcodes.OBJ_DEL, 4)
  .define(ServerOpcodes.UPDATE_INV_FULL, VAR_SHORT)
  .define(ServerOpcodes.UPDATE_STAT, 6)
  .define(ServerOpcodes.VARP, 8)
  .define(ServerOpcodes.IF_OPENSUB, VAR_SHORT)
  .define(ServerOpcodes.IF_CLOSESUB, 4)
  .define(ServerOpcodes.IF_SETPROPS, VAR_SHORT)
  .define(ServerOpcodes.MESSAGE_GAME, VAR_SHORT)
  .define(ServerOpcodes.SET_MAP_FLAG, 9);

/** The protocol number the handshake carries; bump when a layout changes. */
export const PROTOCOL_VERSION = 1;
