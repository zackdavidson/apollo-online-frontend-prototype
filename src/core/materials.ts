import { PALETTE_ROLES, isHexColour, type PaletteRole } from './palette';

/** A hull material id, as used in ship state, share codes and NPC spawns. */
export type MaterialId = string;

/** The self-lit part of a material: a mask tile and how it shines. */
export interface MaterialGlow {
  /** Greyscale tile under `assets/materials`, mapped like `texture`: white glows, black does not. */
  readonly mask: string;
  /** Glow colour as CSS hex. */
  readonly colour: string;
  /** Glow brightness; around 1 reads as a lit white surface, higher blooms. */
  readonly intensity: number;
  /** 0 steady; 1 breathes all the way out and back, a little over once a second, travelling across the hull. */
  readonly pulse: number;
  /**
   * 0 none; otherwise a second copy of the mask drifts at this multiple of
   * `scroll` (negative runs the other way), so heat seems to move under the
   * crust rather than with it.
   */
  readonly drift: number;
}

/**
 * A finish a hull can wear over its paint. Plain data, the shape a server
 * could send: the client only needs the files and the numbers.
 */
export interface MaterialDefinition {
  readonly id: MaterialId;
  readonly name: string;
  readonly description: string;
  /**
   * Seamless colour tile under `assets/materials`, or null to paint the hull
   * colour alone. The tile is an overlay on the hull colour: mid grey leaves
   * the paint as it is, lighter and darker texels shade it and coloured
   * texels tint it, so one tile serves every hull colour.
   */
  readonly texture: string | null;
  /** World units covered by one repeat of the tile. */
  readonly scale: number;
  /** Tile drift in repeats per second along its two axes; `[0, 0]` holds still. */
  readonly scroll: readonly [number, number];
  /** Painted surfaces the material covers; the rest keep their paint. */
  readonly roles: readonly PaletteRole[];
  readonly glow: MaterialGlow | null;
}

export const DEFAULT_MATERIAL_ID: MaterialId = 'plain';

/** Where the tiles live under the site root; prefix with the base URL to fetch one. */
export function materialAssetPath(file: string): string {
  return `assets/materials/${file}`;
}

export const HULL_MATERIALS: readonly MaterialDefinition[] = [
  {
    id: 'plain',
    name: 'Painted',
    description: 'Plain painted plating.',
    texture: null,
    scale: 1,
    scroll: [0, 0],
    roles: [],
    glow: null,
  },
  {
    id: 'stone',
    name: 'Stone',
    description: 'Fitted flagstones. The hull colour shows through the grey.',
    texture: 'stone.png',
    scale: 6,
    scroll: [0, 0],
    roles: ['main'],
    glow: null,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Dark volcanic glass threaded with faintly glowing purple veins.',
    texture: 'obsidian.png',
    scale: 7,
    scroll: [0, 0],
    roles: ['main'],
    glow: { mask: 'obsidian-glow.png', colour: '#b45cff', intensity: 0.9, pulse: 0.35, drift: 0 },
  },
  {
    id: 'lava',
    name: 'Lava',
    description: 'Cooling crust over molten rock. The cracks glow and the whole flow creeps along the hull.',
    texture: 'lava.png',
    scale: 6,
    scroll: [0.02, 0.008],
    roles: ['main'],
    glow: { mask: 'lava-glow.png', colour: '#ff7a1a', intensity: 2.2, pulse: 0.4, drift: -0.6 },
  },
];

export function findMaterial(id: unknown): MaterialDefinition | undefined {
  return typeof id === 'string' ? HULL_MATERIALS.find((material) => material.id === id) : undefined;
}

/** The material with this id, or the plain finish for anything unknown. */
export function materialFor(id: MaterialId | undefined): MaterialDefinition {
  return findMaterial(id) ?? HULL_MATERIALS[0]!;
}

export function isMaterialId(value: unknown): value is MaterialId {
  return findMaterial(value) !== undefined;
}

/** Validate a material definition from JSON. Throws with a readable message on the first problem. */
export function parseMaterialDefinition(raw: unknown): MaterialDefinition {
  if (!isRecord(raw)) throw new Error('material must be an object');
  const id = raw['id'];
  if (typeof id !== 'string' || id.length === 0) throw new Error('material.id must be a non-empty string');
  const name = typeof raw['name'] === 'string' ? raw['name'] : id;
  const description = typeof raw['description'] === 'string' ? raw['description'] : '';
  const texture = raw['texture'] === undefined || raw['texture'] === null ? null : raw['texture'];
  if (texture !== null && typeof texture !== 'string') throw new Error(`material ${id}: texture must be a file name or null`);
  const scale = raw['scale'] ?? 1;
  if (typeof scale !== 'number' || !(scale > 0)) throw new Error(`material ${id}: scale must be a positive number`);
  const scroll = raw['scroll'] ?? [0, 0];
  if (!Array.isArray(scroll) || scroll.length !== 2 || !scroll.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`material ${id}: scroll must be [u, v] repeats per second`);
  }
  const roles = raw['roles'] ?? (texture ? ['main'] : []);
  if (!Array.isArray(roles) || !roles.every((role) => PALETTE_ROLES.includes(role))) {
    throw new Error(`material ${id}: roles must be palette roles (${PALETTE_ROLES.join(', ')})`);
  }
  const rawGlow = raw['glow'] ?? null;
  let glow: MaterialGlow | null = null;
  if (rawGlow !== null) {
    if (!isRecord(rawGlow) || typeof rawGlow['mask'] !== 'string') throw new Error(`material ${id}: glow needs a mask file`);
    if (!isHexColour(rawGlow['colour'])) throw new Error(`material ${id}: glow.colour must be a hex colour`);
    const intensity = rawGlow['intensity'] ?? 1;
    const pulse = rawGlow['pulse'] ?? 0;
    const drift = rawGlow['drift'] ?? 0;
    if (![intensity, pulse, drift].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error(`material ${id}: glow intensity, pulse and drift must be numbers`);
    }
    glow = { mask: rawGlow['mask'], colour: rawGlow['colour'], intensity: intensity as number, pulse: pulse as number, drift: drift as number };
  }
  return { id, name, description, texture, scale, scroll: [scroll[0] as number, scroll[1] as number], roles: roles as PaletteRole[], glow };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
