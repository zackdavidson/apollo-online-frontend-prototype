import type { HitKind } from '../game/damageRoll';
import type { WarpPlan } from '../game/warp';
import type { ShipState } from '../state/shipState';

/**
 * Packets as the game sees them, decoded into plain objects: one union
 * per direction, named after the RuneScape packets they mirror. Times are
 * seconds of server clock (the wire carries milliseconds). Players, NPCs,
 * projectiles and ground items go by the server's int index; locs (rocks,
 * beacons, hazards) keep the string ids from the map file; items and
 * talents travel by index into the shipped catalogs and are decoded to
 * their ids here.
 */

export type LoginStatus = 'ok' | 'invalid-token' | 'server-full' | 'already-online' | 'bad-build' | 'protocol-mismatch' | 'unknown';

// ---- client → server ---------------------------------------------------------------

export type ClientMessage =
  // session
  | { readonly type: 'handshake'; readonly jwt: string; readonly build: ShipState }
  | { readonly type: 'logout' }
  | { readonly type: 'idle' }
  // movement
  | { readonly type: 'move-flight'; readonly seq: number; readonly thrust: number; readonly strafe: number; readonly boost: boolean; readonly fire: boolean; readonly aim: readonly [number, number] | null }
  /** Put the map flag (the warp destination) here. */
  | { readonly type: 'move-minimap-click'; readonly x: number; readonly z: number }
  // options: the number of the option picked on a right-click menu
  | { readonly type: 'op-player'; readonly option: number; readonly index: number }
  | { readonly type: 'op-npc'; readonly option: number; readonly index: number }
  | { readonly type: 'op-loc'; readonly option: number; readonly locId: string }
  | { readonly type: 'op-obj'; readonly option: number; readonly index: number }
  | { readonly type: 'op-held'; readonly option: number; readonly item: string; readonly slot: number }
  // interfaces
  | { readonly type: 'if-button'; readonly interfaceId: number; readonly button: number }
  | { readonly type: 'close-modal'; readonly interfaceId: number }
  | { readonly type: 'resume-pause-button'; readonly interfaceId: number }
  // chat
  | { readonly type: 'message-public'; readonly text: string }
  | { readonly type: 'client-cheat'; readonly text: string };

export type ClientMessageType = ClientMessage['type'];

// ---- entity updating -------------------------------------------------------------------

export interface EntityMovement {
  /** True when the entity jumped (warp, respawn): do not interpolate from where it was. */
  readonly teleport: boolean;
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly heading: number;
  readonly throttle: number;
}

/** Everything needed to show an entity for the first time. */
export interface EntityAppearance {
  /** `EntityType`: a ship or the comet. */
  readonly entityType: number;
  readonly name: string;
  readonly hullName: string;
  readonly team: string;
  readonly radius: number;
  /** The build to render; empty for the comet. */
  readonly build: ShipState;
  /** Outline and label colour while hostile. */
  readonly accent: string;
  readonly invulnerable: boolean;
  readonly provokable: boolean;
  /** Centre-to-centre distance within which "Talk-to" is offered; null for ships with nothing to say. */
  readonly talkRange: number | null;
  readonly maxShield: number;
  readonly maxHull: number;
}

export interface EntityStatus {
  readonly alive: boolean;
  readonly hostile: boolean;
  readonly held: boolean;
}

export interface EntityHit {
  readonly amount: number;
  readonly kind: HitKind;
  /** The shield soaked the whole hit. */
  readonly absorbed: boolean;
  /** Where it landed. */
  readonly x: number;
  readonly z: number;
  readonly shield: number;
  readonly hull: number;
}

export interface SpotAnim {
  readonly graphic: number;
  readonly scale: number;
  /** 0xRRGGBB, or 0 for the graphic's default colour. */
  readonly rgb: number;
}

/** One entity's changes this tick: whichever masks the server set. */
export interface EntityUpdate {
  readonly index: number;
  readonly remove?: boolean;
  readonly movement?: EntityMovement;
  /** Turned without moving. */
  readonly face?: number;
  readonly appearance?: EntityAppearance;
  readonly status?: EntityStatus;
  readonly hit?: EntityHit;
  readonly spotAnim?: SpotAnim;
  /** Public chat, shown over the entity and in the log. */
  readonly chat?: string;
  readonly warp?: WarpPlan;
  readonly animation?: number;
}

// ---- server → client ---------------------------------------------------------------

export type GameMessageKind = 'game' | 'banner' | 'both';

export type ServerMessage =
  // session
  | { readonly type: 'login-response'; readonly status: LoginStatus; readonly message: string; readonly playerIndex: number; readonly serverTime: number; readonly tick: number }
  | { readonly type: 'logout'; readonly reason: string }
  | { readonly type: 'rebuild-normal'; readonly name: string; readonly url: string }
  // entity updating
  | { readonly type: 'player-info'; readonly t: number; readonly entities: readonly EntityUpdate[] }
  | { readonly type: 'npc-info'; readonly t: number; readonly entities: readonly EntityUpdate[] }
  // projectiles and graphics
  /** A shot (or a beam, when the item is a beam weapon) from a point to a point, or to an NPC it follows. */
  | { readonly type: 'map-projanim'; readonly id: number; readonly item: string; readonly x0: number; readonly z0: number; readonly y: number; readonly x1: number; readonly z1: number; readonly target: number | null; readonly delay: number; readonly duration: number }
  | { readonly type: 'proj-del'; readonly id: number }
  | { readonly type: 'map-anim'; readonly graphic: number; readonly x: number; readonly z: number; readonly scale: number; readonly rgb: number }
  /** A damage number on something that is not an entity (a rock). */
  | { readonly type: 'hit-splat'; readonly amount: number; readonly kind: HitKind; readonly x: number; readonly z: number }
  // locs
  | { readonly type: 'loc-add'; readonly id: string }
  | { readonly type: 'loc-del'; readonly id: string }
  | { readonly type: 'loc-health'; readonly id: string; readonly hp: number }
  // objs
  | { readonly type: 'obj-add'; readonly index: number; readonly item: string; readonly count: number; readonly x: number; readonly z: number; readonly permanent: boolean }
  | { readonly type: 'obj-del'; readonly index: number }
  // the player's own state
  | { readonly type: 'update-inv-full'; readonly items: ReadonlyArray<{ readonly item: string; readonly count: number }> }
  | { readonly type: 'update-stat'; readonly stat: string; readonly level: number; readonly base: number }
  | { readonly type: 'varp'; readonly id: number; readonly value: number }
  // interfaces
  | { readonly type: 'if-opensub'; readonly id: number; readonly props: Readonly<Record<string, unknown>> }
  | { readonly type: 'if-closesub'; readonly id: number }
  | { readonly type: 'if-setprops'; readonly id: number; readonly props: Readonly<Record<string, unknown>> }
  // chat and the map flag
  | { readonly type: 'message-game'; readonly kind: GameMessageKind; readonly text: string }
  | { readonly type: 'set-map-flag'; readonly flag: { readonly x: number; readonly z: number } | null };

export type ServerMessageType = ServerMessage['type'];
