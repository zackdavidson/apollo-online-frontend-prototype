import { box, taper, tube } from '../core/primitives';
import type { Primitive } from '../core/geometry';
import type { ShipColours } from '../core/palette';

/**
 * The item catalog: everything a ship can carry, fit or pick up is an item
 * described by data. Each entry has two halves:
 *
 * - `visual`: how it looks. A 3D model (an attachment from the parts
 *   catalog, or inline primitives for things like ore), an accent colour,
 *   sprite framing hints, and for weapons the look of what they fire. The
 *   client renders from this and nothing else.
 * - `behaviour`: what it does. Damage, speed, intervals, mining bonus. The
 *   simulation (the server, eventually) reads this; the client never needs
 *   to.
 *
 * The data is plain JSON-compatible objects (`DEFAULT_ITEMS`), validated by
 * `parseItemCatalog`, so the same catalog can be shipped as a file or sent
 * by a server.
 */
export type ItemId = string;
export type ItemCategory = 'weapon' | 'tool' | 'resource';

/** Projectile family a weapon fires; drives both the simulation and the effect renderer. */
export type ProjectileKind = 'tracer' | 'slug' | 'flak' | 'plasma' | 'pellet' | 'missile' | 'rocket' | 'seeker' | 'beam';
/** Firing mechanic a weapon belongs to; the player picks one with keys 1/2/3. */
export type WeaponGroup = 'guns' | 'beam' | 'missiles';
/** Visual style of a discharged beam. */
export type BeamStyle = 'lance' | 'siege' | 'arc';

/** Client-side: how the item's shots or beams look. */
export interface WeaponEffect {
  readonly colour: string;
  /** Projectile size [width, height, length] in world units. */
  readonly size: readonly [number, number, number];
  readonly muzzleFlash: number;
  /** Leaves a smoke trail while flying. */
  readonly trail: boolean;
  readonly beamStyle?: BeamStyle;
  readonly beamWidth?: number;
}

/** Server-side: what the item does when fired. */
export interface WeaponBehaviour {
  readonly kind: ProjectileKind;
  readonly group: WeaponGroup;
  readonly speed: number;
  readonly lifetime: number;
  readonly damage: number;
  /** Seconds between shots from one mount (guns, missiles) or after a beam discharge. */
  readonly fireInterval: number;
  /** Shotguns: pellets per shot and total cone angle in radians. */
  readonly pellets?: number;
  readonly spread?: number;
  /** Burst fire: shots per trigger pull and the gap between them. */
  readonly burst?: number;
  readonly burstGap?: number;
  /** Homing turn rate in radians per second. */
  readonly homing?: number;
  /** Beam weapons: seconds the trigger must be held before discharge. */
  readonly chargeTime?: number;
  /** Beam weapons: reach of the beam in world units. */
  readonly range?: number;
  /** Beam weapons: how long the beam stays visible. */
  readonly beamDuration?: number;
  /** Mining tools: multiplier on resources dropped by rocks they break. */
  readonly mining?: number;
  /** Damage dealt to rock health when it differs from ship damage (mining tools). */
  readonly rockDamage?: number;
}

export type ItemModel =
  /** A part from the ship catalog, so a fitted weapon and its item share one mesh. */
  | { readonly kind: 'attachment'; readonly attachmentId: string }
  /** Inline primitives, for things that are never fitted to a ship. */
  | { readonly kind: 'primitives'; readonly primitives: readonly Primitive[]; readonly colours?: Partial<ShipColours> };

export interface ItemVisual {
  readonly model: ItemModel;
  /** Accent for UI text, minimap marks and pickup glow. */
  readonly colour: string;
  /** Framing for the one-off sprite render: yaw and pitch in radians, zoom > 1 is closer. */
  readonly sprite?: { readonly yaw?: number; readonly pitch?: number; readonly zoom?: number };
  readonly effect?: WeaponEffect;
}

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly category: ItemCategory;
  readonly description: string;
  /** Stackable items (resources) pile up as counts; others are single pieces of kit. */
  readonly stackable: boolean;
  /** Rough worth, for a score line and trade. */
  readonly value: number;
  readonly visual: ItemVisual;
  readonly behaviour?: WeaponBehaviour;
}

/** The stackable resources rocks drop, in display order. Each is an item of category `resource`. */
export const RESOURCE_KINDS = ['stone', 'iron-ore', 'ice', 'crystal'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export class ItemParseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

export class ItemCatalog {
  private readonly byId = new Map<ItemId, ItemDefinition>();

  constructor(readonly items: readonly ItemDefinition[]) {
    for (const item of items) {
      if (this.byId.has(item.id)) throw new Error(`Duplicate item id "${item.id}"`);
      this.byId.set(item.id, item);
    }
  }

  get(id: ItemId): ItemDefinition | undefined {
    return this.byId.get(id);
  }

  require(id: ItemId): ItemDefinition {
    const item = this.byId.get(id);
    if (!item) throw new Error(`Unknown item "${id}"`);
    return item;
  }

  byCategory(category: ItemCategory): ItemDefinition[] {
    return this.items.filter((item) => item.category === category);
  }

  /** Items with behaviour: everything that can be fired. */
  get weapons(): ItemDefinition[] {
    return this.items.filter((item) => item.behaviour !== undefined);
  }

  /** The catalog with behaviour stripped: what a client needs. */
  clientView(): ItemCatalog {
    return new ItemCatalog(this.items.map(({ behaviour: _behaviour, ...item }) => item));
  }
}

// ---- helpers for the data ------------------------------------------------------

const attachment = (attachmentId: string): ItemModel => ({ kind: 'attachment', attachmentId });

function weapon(
  id: string,
  name: string,
  description: string,
  value: number,
  effect: WeaponEffect,
  behaviour: WeaponBehaviour,
  category: ItemCategory = 'weapon',
): ItemDefinition {
  return { id, name, category, description, stackable: false, value, visual: { model: attachment(id), colour: effect.colour, sprite: { yaw: 0.9, pitch: 0.5, zoom: 1.05 }, effect }, behaviour };
}

function resource(id: ResourceKind, name: string, description: string, value: number, colour: string, primitives: readonly Primitive[], colours: Partial<ShipColours>): ItemDefinition {
  return { id, name, category: 'resource', description, stackable: true, value, visual: { model: { kind: 'primitives', primitives, colours }, colour, sprite: { yaw: 0.7, pitch: 0.6, zoom: 1.1 } } };
}

/** Every item the prototype knows, as plain data. */
export const DEFAULT_ITEMS: readonly ItemDefinition[] = [
  // ---- resources ------------------------------------------------------------
  resource(
    'stone',
    'Stone',
    'A lump of common asteroid rock.',
    1,
    '#d9b26a',
    [
      box({ shape: 'chamfered', chamfer: 0.3, size: [1.2, 0.85, 1.0], at: [0, 0.42, 0], rotation: [0.1, 0.4, 0.05], role: 'main' }),
      box({ shape: 'chamfered', chamfer: 0.22, size: [0.7, 0.5, 0.6], at: [0.3, 0.8, -0.1], rotation: [0.3, 0.9, 0.2], role: 'trim' }),
    ],
    { main: '#7d7467', trim: '#978b7d' },
  ),
  resource(
    'iron-ore',
    'Iron ore',
    'Dark ore shot through with metal.',
    3,
    '#9fb4c8',
    [
      box({ shape: 'chamfered', chamfer: 0.34, size: [1.15, 0.9, 1.1], at: [0, 0.45, 0], rotation: [0.15, 0.6, 0.1], role: 'main' }),
      box({ shape: 'chamfered', chamfer: 0.12, size: [0.5, 0.3, 0.45], at: [-0.25, 0.8, 0.15], rotation: [0.4, 0.8, 0.1], role: 'metal' }),
      box({ shape: 'chamfered', chamfer: 0.1, size: [0.35, 0.25, 0.4], at: [0.35, 0.55, 0.3], rotation: [0.2, 0.2, 0.5], role: 'trim' }),
    ],
    { main: '#4f535c', trim: '#9fb4c8' },
  ),
  resource(
    'ice',
    'Ice',
    'A shard of ancient water ice.',
    2,
    '#8fe3ff',
    [
      taper({ from: { width: 0.9, height: 0.8 }, to: { width: 0.12, height: 0.12 }, z: [-0.4, 1.0], chamfer: 0.2, at: [0, 0.55, 0], rotation: [-1.15, 0.35, 0.25], role: 'main' }),
      taper({ from: { width: 0.4, height: 0.4 }, to: { width: 0.05, height: 0.05 }, z: [0, 0.7], chamfer: 0.12, at: [0.35, 0.35, 0.2], rotation: [-1.4, -0.4, 0.3], role: 'glass' }),
    ],
    { main: '#bfe0f0', trim: '#d4ecf7' },
  ),
  resource(
    'crystal',
    'Crystal',
    'A faceted crystal that hums faintly.',
    10,
    '#d9a6ff',
    [
      taper({ from: { width: 0.7, height: 0.7 }, to: { width: 0.05, height: 0.05 }, z: [0, 1.0], shape: 'hexagon', at: [0, 0.75, 0], rotation: [-1.1, 0.4, 0.3], role: 'trim' }),
      taper({ from: { width: 0.05, height: 0.05 }, to: { width: 0.7, height: 0.7 }, z: [-0.6, 0], shape: 'hexagon', at: [0, 0.75, 0], rotation: [-1.1, 0.4, 0.3], role: 'main' }),
      tube({ radius: 0.08, z: [0.95, 1.1], at: [0, 0.75, 0], rotation: [-1.1, 0.4, 0.3], role: 'glow' }),
    ],
    { main: '#8f6cc8', trim: '#c9a6ff' },
  ),
  // ---- guns -----------------------------------------------------------------
  weapon('weapon-autocannon', 'Autocannon', 'Long-barrelled kinetic gun.', 40, { colour: '#ffd36a', size: [0.14, 0.14, 1.7], muzzleFlash: 1.2, trail: false }, { kind: 'tracer', group: 'guns', speed: 190, lifetime: 1.1, damage: 4, fireInterval: 0.14 }),
  weapon('weapon-gauss-rifle', 'Gauss Rifle', 'Magnetic rail firing a dense slug.', 90, { colour: '#dfe8ff', size: [0.16, 0.16, 2.8], muzzleFlash: 2.0, trail: false }, { kind: 'slug', group: 'guns', speed: 310, lifetime: 1.4, damage: 18, fireInterval: 0.75 }),
  weapon('weapon-flak-cannon', 'Flak Cannon', 'Short-range spread of bursting shells.', 70, { colour: '#ffa64a', size: [0.16, 0.16, 0.6], muzzleFlash: 1.9, trail: false }, { kind: 'flak', group: 'guns', speed: 150, lifetime: 0.55, damage: 3, fireInterval: 0.55, pellets: 7, spread: 0.4 }),
  weapon('weapon-plasma', 'Plasma Repeater', 'Twin barrels, short and hot.', 80, { colour: '#8dff6a', size: [0.6, 0.6, 0.6], muzzleFlash: 1.5, trail: false }, { kind: 'plasma', group: 'guns', speed: 140, lifetime: 1.3, damage: 7, fireInterval: 0.22 }),
  weapon('weapon-point-defence', 'Point Defence', 'A rapid, light turret.', 35, { colour: '#ffffff', size: [0.08, 0.08, 0.9], muzzleFlash: 0.8, trail: false }, { kind: 'pellet', group: 'guns', speed: 230, lifetime: 0.7, damage: 2, fireInterval: 0.08 }),
  // ---- beams ----------------------------------------------------------------
  weapon('weapon-laser', 'Laser Cannon', 'Focused beam emitter with a glowing lens.', 110, { colour: '#7fe3ff', size: [0.22, 0.22, 1], muzzleFlash: 2.4, trail: false, beamStyle: 'lance', beamWidth: 0.55 }, { kind: 'beam', group: 'beam', speed: 0, lifetime: 0, damage: 45, fireInterval: 1.5, chargeTime: 0.55, range: 160, beamDuration: 0.3 }),
  weapon('weapon-siege-beam', 'Siege Beam', 'Slow to charge, devastating when it lands.', 260, { colour: '#ff7a4a', size: [0.3, 0.3, 1], muzzleFlash: 3.6, trail: false, beamStyle: 'siege', beamWidth: 1.4 }, { kind: 'beam', group: 'beam', speed: 0, lifetime: 0, damage: 120, fireInterval: 3.8, chargeTime: 1.4, range: 230, beamDuration: 0.6 }),
  weapon('weapon-arc-caster', 'Arc Caster', 'Crackling short-range arc.', 120, { colour: '#c9a6ff', size: [0.2, 0.2, 1], muzzleFlash: 1.8, trail: false, beamStyle: 'arc', beamWidth: 0.4 }, { kind: 'beam', group: 'beam', speed: 0, lifetime: 0, damage: 26, fireInterval: 0.75, chargeTime: 0.3, range: 95, beamDuration: 0.2 }),
  // ---- mining tools (count as beams; weak against ships, strong on rock) ----
  weapon('mining-laser', 'Mining Laser', 'Cuts rock quickly and ships barely.', 95, { colour: '#a6ff8a', size: [0.2, 0.2, 1], muzzleFlash: 1.6, trail: false, beamStyle: 'lance', beamWidth: 0.7 }, { kind: 'beam', group: 'beam', speed: 0, lifetime: 0, damage: 8, fireInterval: 0.9, chargeTime: 0.35, range: 70, beamDuration: 0.3, mining: 2, rockDamage: 48 }, 'tool'),
  weapon('mining-drill', 'Rock Drill', 'Point-blank drill with the best yield.', 85, { colour: '#ffd27a', size: [0.2, 0.2, 1], muzzleFlash: 1.2, trail: false, beamStyle: 'arc', beamWidth: 0.6 }, { kind: 'beam', group: 'beam', speed: 0, lifetime: 0, damage: 4, fireInterval: 0.5, chargeTime: 0.15, range: 25, beamDuration: 0.25, mining: 3, rockDamage: 34 }, 'tool'),
  // ---- missiles -------------------------------------------------------------
  weapon('weapon-missile-pod', 'Missile Pod', 'Boxy launcher with trim-coloured warheads.', 130, { colour: '#ffb070', size: [0.3, 0.3, 1.3], muzzleFlash: 2.2, trail: true }, { kind: 'missile', group: 'missiles', speed: 95, lifetime: 2.6, damage: 14, fireInterval: 2.4 }),
  weapon('weapon-rocket-pod', 'Rocket Pod', 'Bursts of three fast rockets.', 120, { colour: '#ffcf6a', size: [0.22, 0.22, 1.1], muzzleFlash: 1.6, trail: true }, { kind: 'rocket', group: 'missiles', speed: 150, lifetime: 1.6, damage: 9, fireInterval: 1.8, burst: 3, burstGap: 0.09 }),
  weapon('weapon-seeker-missiles', 'Seeker Missiles', 'Slow warheads that hunt their target.', 180, { colour: '#ff8ad0', size: [0.3, 0.3, 1.4], muzzleFlash: 2.0, trail: true }, { kind: 'seeker', group: 'missiles', speed: 85, lifetime: 3.5, damage: 22, fireInterval: 3.0, homing: 2.6 }),
];

let defaultCatalog: ItemCatalog | null = null;

export function defaultItemCatalog(): ItemCatalog {
  return (defaultCatalog ??= new ItemCatalog(DEFAULT_ITEMS));
}

// ---- parsing (for catalogs arriving as JSON) ---------------------------------------

const ITEM_CATEGORIES: readonly ItemCategory[] = ['weapon', 'tool', 'resource'];
const PROJECTILE_KINDS: readonly ProjectileKind[] = ['tracer', 'slug', 'flak', 'plasma', 'pellet', 'missile', 'rocket', 'seeker', 'beam'];
const WEAPON_GROUPS_LIST: readonly WeaponGroup[] = ['guns', 'beam', 'missiles'];
const BEAM_STYLES: readonly BeamStyle[] = ['lance', 'siege', 'arc'];

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ItemParseError(path, 'expected an object');
  return value as Record<string, unknown>;
}

function str(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0) throw new ItemParseError(path, 'expected a non-empty string');
  return value;
}

function num(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ItemParseError(path, 'expected a number');
  return value;
}

function optNum(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : num(value, path);
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) throw new ItemParseError(path, `expected one of ${options.join(', ')}`);
  return value as T;
}

/** Validate a JSON catalog (e.g. `JSON.parse` of a file or a server message) into an ItemCatalog. */
export function parseItemCatalog(input: unknown): ItemCatalog {
  if (!Array.isArray(input)) throw new ItemParseError('items', 'expected an array of items');
  const items = input.map((raw, index): ItemDefinition => {
    const p = `items[${index}]`;
    const r = record(raw, p);
    const id = str(r['id'], `${p}.id`);
    const visualRaw = record(r['visual'], `${p}.visual`);
    const modelRaw = record(visualRaw['model'], `${p}.visual.model`);
    const modelKind = oneOf(modelRaw['kind'], `${p}.visual.model.kind`, ['attachment', 'primitives'] as const);
    const model: ItemModel =
      modelKind === 'attachment'
        ? { kind: 'attachment', attachmentId: str(modelRaw['attachmentId'], `${p}.visual.model.attachmentId`) }
        : {
            kind: 'primitives',
            primitives: (Array.isArray(modelRaw['primitives']) ? modelRaw['primitives'] : (() => {
              throw new ItemParseError(`${p}.visual.model.primitives`, 'expected an array');
            })()) as readonly Primitive[],
            ...(modelRaw['colours'] !== undefined ? { colours: record(modelRaw['colours'], `${p}.visual.model.colours`) as Partial<ShipColours> } : {}),
          };
    const spriteRaw = visualRaw['sprite'] === undefined ? undefined : record(visualRaw['sprite'], `${p}.visual.sprite`);
    const effectRaw = visualRaw['effect'] === undefined ? undefined : record(visualRaw['effect'], `${p}.visual.effect`);
    const effect: WeaponEffect | undefined = effectRaw && {
      colour: str(effectRaw['colour'], `${p}.visual.effect.colour`),
      size: (() => {
        const size = effectRaw['size'];
        if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => typeof n === 'number')) throw new ItemParseError(`${p}.visual.effect.size`, 'expected [w, h, l]');
        return size as [number, number, number];
      })(),
      muzzleFlash: num(effectRaw['muzzleFlash'], `${p}.visual.effect.muzzleFlash`, 1),
      trail: effectRaw['trail'] === true,
      ...(effectRaw['beamStyle'] !== undefined ? { beamStyle: oneOf(effectRaw['beamStyle'], `${p}.visual.effect.beamStyle`, BEAM_STYLES) } : {}),
      ...(effectRaw['beamWidth'] !== undefined ? { beamWidth: num(effectRaw['beamWidth'], `${p}.visual.effect.beamWidth`) } : {}),
    };
    const behaviourRaw = r['behaviour'] === undefined ? undefined : record(r['behaviour'], `${p}.behaviour`);
    const behaviour: WeaponBehaviour | undefined = behaviourRaw && {
      kind: oneOf(behaviourRaw['kind'], `${p}.behaviour.kind`, PROJECTILE_KINDS),
      group: oneOf(behaviourRaw['group'], `${p}.behaviour.group`, WEAPON_GROUPS_LIST),
      speed: num(behaviourRaw['speed'], `${p}.behaviour.speed`),
      lifetime: num(behaviourRaw['lifetime'], `${p}.behaviour.lifetime`),
      damage: num(behaviourRaw['damage'], `${p}.behaviour.damage`),
      fireInterval: num(behaviourRaw['fireInterval'], `${p}.behaviour.fireInterval`),
      ...optional('pellets', optNum(behaviourRaw['pellets'], `${p}.behaviour.pellets`)),
      ...optional('spread', optNum(behaviourRaw['spread'], `${p}.behaviour.spread`)),
      ...optional('burst', optNum(behaviourRaw['burst'], `${p}.behaviour.burst`)),
      ...optional('burstGap', optNum(behaviourRaw['burstGap'], `${p}.behaviour.burstGap`)),
      ...optional('homing', optNum(behaviourRaw['homing'], `${p}.behaviour.homing`)),
      ...optional('chargeTime', optNum(behaviourRaw['chargeTime'], `${p}.behaviour.chargeTime`)),
      ...optional('range', optNum(behaviourRaw['range'], `${p}.behaviour.range`)),
      ...optional('beamDuration', optNum(behaviourRaw['beamDuration'], `${p}.behaviour.beamDuration`)),
      ...optional('mining', optNum(behaviourRaw['mining'], `${p}.behaviour.mining`)),
      ...optional('rockDamage', optNum(behaviourRaw['rockDamage'], `${p}.behaviour.rockDamage`)),
    };
    if (behaviour && !effect) throw new ItemParseError(`${p}.visual.effect`, 'a weapon needs an effect so the client can draw its shots');
    return {
      id,
      name: str(r['name'], `${p}.name`),
      category: oneOf(r['category'], `${p}.category`, ITEM_CATEGORIES),
      description: str(r['description'], `${p}.description`, ''),
      stackable: r['stackable'] === true,
      value: num(r['value'], `${p}.value`, 0),
      visual: {
        model,
        colour: str(visualRaw['colour'], `${p}.visual.colour`),
        ...(spriteRaw
          ? {
              sprite: {
                ...optional('yaw', optNum(spriteRaw['yaw'], `${p}.visual.sprite.yaw`)),
                ...optional('pitch', optNum(spriteRaw['pitch'], `${p}.visual.sprite.pitch`)),
                ...optional('zoom', optNum(spriteRaw['zoom'], `${p}.visual.sprite.zoom`)),
              },
            }
          : {}),
        ...(effect ? { effect } : {}),
      },
      ...(behaviour ? { behaviour } : {}),
    };
  });
  const catalog = new ItemCatalog(items);
  for (const kind of RESOURCE_KINDS) {
    if (catalog.get(kind)?.category !== 'resource') throw new ItemParseError('items', `missing resource item "${kind}"`);
  }
  return catalog;
}

function optional<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}
