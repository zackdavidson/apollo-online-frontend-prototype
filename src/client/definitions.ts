import { defaultItemCatalog } from '../game/items';
import { TALENTS } from '../game/talents';
import type { WeaponGroup } from '../game/weapons';
import { INTERFACE_IDS } from '../hud/interfaces';

/**
 * The client's "cache": the numbers both sides agree on. Items and talents
 * travel by index into the shipped catalogs, graphics and animations by
 * id into the tables here, and varps (server-side variables the client
 * displays) by number. Nothing in this file is sent by anyone; it is what
 * the numbers in packets mean.
 */

// ---- items and talents by index ----------------------------------------------------

const itemIds = defaultItemCatalog().items.map((item) => item.id);

/** The wire index of a catalog item, or -1 for one the catalog does not know. */
export function itemIndex(id: string): number {
  return itemIds.indexOf(id);
}

export function itemAt(index: number): string | null {
  return itemIds[index] ?? null;
}

export function talentIndex(id: string): number {
  return TALENTS.findIndex((talent) => talent.id === id);
}

export function talentAt(index: number): string | null {
  return TALENTS[index]?.id ?? null;
}

export const WEAPON_GROUP_BY_INDEX: readonly WeaponGroup[] = ['guns', 'beam', 'missiles'];

// ---- entity types ------------------------------------------------------------------

/** What an NPC_INFO appearance describes. Players are always ships. */
export const EntityType = { SHIP: 0, COMET: 1 } as const;

// ---- options -----------------------------------------------------------------------

/**
 * Option numbers on right-click menus. Each entity kind has up to five
 * numbered options the server acts on; `EXAMINE` is the same number for
 * everything. The strings are what the menu shows; the server only ever
 * sees the number.
 */
export const EXAMINE_OPTION = 10;

export interface OptionDefinition {
  readonly option: number;
  readonly label: string;
}

/** NPC options by entity type. A ship only shows "Talk-to" when it is within talking range. */
export const NPC_OPTIONS: Readonly<Record<number, readonly OptionDefinition[]>> = {
  [EntityType.SHIP]: [{ option: 1, label: 'Talk-to' }],
  [EntityType.COMET]: [{ option: 1, label: 'Mine' }],
};

/** Loc (map object) options by loc kind. */
export const LOC_OPTIONS = {
  rock: [{ option: 1, label: 'Mine' }],
  beacon: [] as readonly OptionDefinition[],
  hazard: [] as readonly OptionDefinition[],
} as const;

/** Ground item options. */
export const OBJ_OPTIONS: readonly OptionDefinition[] = [{ option: 1, label: 'Take' }];

/** Options on an item in the hold. */
export const HELD_OPTIONS: readonly OptionDefinition[] = [{ option: 1, label: 'Drop' }];

// ---- interfaces and their buttons --------------------------------------------------

export { INTERFACE_IDS };

/** Interfaces the server addresses that are not windows in the interface store. */
export const HUD_INTERFACE_IDS = {
  /** The weapon bar; buttons 1-3 select a group. */
  weapons: 6,
  /** The NPC dialogue box; opened one line at a time with `{ speaker, text, portrait }`. */
  dialogue: 7,
} as const;

export const MAP_BUTTONS = { warp: 1 } as const;

// ---- graphics (spot anims) -----------------------------------------------------------

/** Ids for `MAP_ANIM` and the SPOTANIM entity mask; the recipes live in `flight/graphics.ts`. */
export const Graphics = {
  MUZZLE_FLASH: 1,
  FLAK_POP: 2,
  BEAM_IMPACT: 3,
  SIEGE_SHOCK: 4,
  HULL_SPARKS: 5,
  EXPLOSION: 6,
  RESPAWN: 7,
  ROCK_CHIPS: 8,
  ROCK_BREAK: 9,
  ROCK_RESPAWN: 10,
  COMET_SPARK: 11,
  COMET_CHUNK: 12,
  COMET_BURST: 13,
  PICKUP: 14,
  WARP_SPOOL: 15,
  WARP_ARRIVE: 16,
  BEACON_PULSE: 17,
  HOSTILE: 18,
  GAS_PUFF: 19,
} as const;

/** Ids for the ANIMATION entity mask. */
export const Animations = { NONE: 0, WARP_SPOOL: 1 } as const;

// ---- varps -------------------------------------------------------------------------

/** Server variables the client displays. Percentages travel as 0..1000. */
export const Varps = {
  KILLS: 0,
  DEATHS: 1,
  ROCKS_BROKEN: 2,
  /** Index into WEAPON_GROUP_BY_INDEX. */
  ACTIVE_WEAPON_GROUP: 3,
  GUNS_READY: 4,
  BEAM_CHARGE: 5,
  /** 0 ready, 1 charging, 2 cooldown. */
  BEAM_PHASE: 6,
  MISSILES_READY: 7,
  /** Index into the map's hazards, or -1. */
  INSIDE_HAZARD: 8,
} as const;

// ---- game message types ------------------------------------------------------------

export const MessageType = { GAME: 0, BANNER: 1, BOTH: 2 } as const;

/** Colours travel packed as 0xRRGGBB; 0 means "use the default for the graphic". */
export function packRgb(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  return match ? parseInt(match[1]!, 16) : 0;
}

export function unpackRgb(rgb: number): string | null {
  return rgb <= 0 ? null : `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}
