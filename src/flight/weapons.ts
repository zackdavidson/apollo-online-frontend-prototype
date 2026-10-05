/**
 * How each weapon attachment fires. Keyed by the catalog attachment id so
 * the ship you built decides what you shoot.
 */
export type ProjectileKind = 'tracer' | 'slug' | 'flak' | 'plasma' | 'pellet' | 'missile' | 'rocket' | 'seeker' | 'beam';

/** Firing mechanic a weapon belongs to; the player picks one with keys 1/2/3. */
export type WeaponGroup = 'guns' | 'beam' | 'missiles';

/** Visual style of a discharged beam. */
export type BeamStyle = 'lance' | 'siege' | 'arc';

export interface WeaponGroupInfo {
  readonly id: WeaponGroup;
  readonly key: string;
  readonly label: string;
  readonly hint: string;
}

export const WEAPON_GROUPS: readonly WeaponGroupInfo[] = [
  { id: 'guns', key: '1', label: 'Guns', hint: 'hold to fire' },
  { id: 'beam', key: '2', label: 'Beam', hint: 'hold to charge' },
  { id: 'missiles', key: '3', label: 'Missiles', hint: 'click for a volley' },
];

export interface WeaponProfile {
  readonly id: string;
  readonly kind: ProjectileKind;
  readonly group: WeaponGroup;
  readonly colour: string;
  readonly speed: number;
  readonly lifetime: number;
  readonly damage: number;
  /** Seconds between shots from one mount (guns, missiles) or after a beam discharge. */
  readonly fireInterval: number;
  /** Projectile size [width, height, length] in world units. */
  readonly size: readonly [number, number, number];
  readonly muzzleFlash: number;
  /** Leaves a smoke trail while flying. */
  readonly trail: boolean;
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
  readonly beamStyle?: BeamStyle;
  readonly beamWidth?: number;
  /** Mining tools: multiplier on resources dropped by rocks they break. */
  readonly mining?: number;
  /** Damage dealt to rock health when it differs from ship damage (mining tools). */
  readonly rockDamage?: number;
}

export const WEAPON_PROFILES: Readonly<Record<string, WeaponProfile>> = {
  // ---- guns -------------------------------------------------------------
  'weapon-autocannon': {
    id: 'weapon-autocannon',
    kind: 'tracer',
    group: 'guns',
    colour: '#ffd36a',
    speed: 190,
    lifetime: 1.1,
    damage: 4,
    fireInterval: 0.14,
    size: [0.14, 0.14, 1.7],
    muzzleFlash: 1.2,
    trail: false,
  },
  'weapon-gauss-rifle': {
    id: 'weapon-gauss-rifle',
    kind: 'slug',
    group: 'guns',
    colour: '#dfe8ff',
    speed: 310,
    lifetime: 1.4,
    damage: 18,
    fireInterval: 0.75,
    size: [0.16, 0.16, 2.8],
    muzzleFlash: 2.0,
    trail: false,
  },
  'weapon-flak-cannon': {
    id: 'weapon-flak-cannon',
    kind: 'flak',
    group: 'guns',
    colour: '#ffa64a',
    speed: 150,
    lifetime: 0.55,
    damage: 3,
    fireInterval: 0.55,
    size: [0.16, 0.16, 0.6],
    muzzleFlash: 1.9,
    trail: false,
    pellets: 7,
    spread: 0.4,
  },
  'weapon-plasma': {
    id: 'weapon-plasma',
    kind: 'plasma',
    group: 'guns',
    colour: '#8dff6a',
    speed: 140,
    lifetime: 1.3,
    damage: 7,
    fireInterval: 0.22,
    size: [0.6, 0.6, 0.6],
    muzzleFlash: 1.5,
    trail: false,
  },
  'weapon-point-defence': {
    id: 'weapon-point-defence',
    kind: 'pellet',
    group: 'guns',
    colour: '#ffffff',
    speed: 230,
    lifetime: 0.7,
    damage: 2,
    fireInterval: 0.08,
    size: [0.08, 0.08, 0.9],
    muzzleFlash: 0.8,
    trail: false,
  },
  // ---- beams ------------------------------------------------------------
  'weapon-laser': {
    id: 'weapon-laser',
    kind: 'beam',
    group: 'beam',
    colour: '#7fe3ff',
    speed: 0,
    lifetime: 0,
    damage: 45,
    fireInterval: 1.5,
    size: [0.22, 0.22, 1],
    muzzleFlash: 2.4,
    trail: false,
    chargeTime: 0.55,
    range: 160,
    beamDuration: 0.3,
    beamStyle: 'lance',
    beamWidth: 0.55,
  },
  'weapon-siege-beam': {
    id: 'weapon-siege-beam',
    kind: 'beam',
    group: 'beam',
    colour: '#ff7a4a',
    speed: 0,
    lifetime: 0,
    damage: 120,
    fireInterval: 3.8,
    size: [0.3, 0.3, 1],
    muzzleFlash: 3.6,
    trail: false,
    chargeTime: 1.4,
    range: 230,
    beamDuration: 0.6,
    beamStyle: 'siege',
    beamWidth: 1.4,
  },
  'weapon-arc-caster': {
    id: 'weapon-arc-caster',
    kind: 'beam',
    group: 'beam',
    colour: '#c9a6ff',
    speed: 0,
    lifetime: 0,
    damage: 26,
    fireInterval: 0.75,
    size: [0.2, 0.2, 1],
    muzzleFlash: 1.8,
    trail: false,
    chargeTime: 0.3,
    range: 95,
    beamDuration: 0.2,
    beamStyle: 'arc',
    beamWidth: 0.4,
  },
  // ---- mining tools (count as beams; weak against ships, strong on rock) --
  'mining-laser': {
    id: 'mining-laser',
    kind: 'beam',
    group: 'beam',
    colour: '#a6ff8a',
    speed: 0,
    lifetime: 0,
    damage: 8,
    fireInterval: 0.9,
    size: [0.2, 0.2, 1],
    muzzleFlash: 1.6,
    trail: false,
    chargeTime: 0.35,
    range: 70,
    beamDuration: 0.3,
    beamStyle: 'lance',
    beamWidth: 0.7,
    mining: 2,
    rockDamage: 48,
  },
  'mining-drill': {
    id: 'mining-drill',
    kind: 'beam',
    group: 'beam',
    colour: '#ffd27a',
    speed: 0,
    lifetime: 0,
    damage: 4,
    fireInterval: 0.5,
    size: [0.2, 0.2, 1],
    muzzleFlash: 1.2,
    trail: false,
    chargeTime: 0.15,
    range: 9,
    beamDuration: 0.25,
    beamStyle: 'arc',
    beamWidth: 0.6,
    mining: 3,
    rockDamage: 34,
  },
  // ---- missiles ---------------------------------------------------------
  'weapon-missile-pod': {
    id: 'weapon-missile-pod',
    kind: 'missile',
    group: 'missiles',
    colour: '#ffb070',
    speed: 95,
    lifetime: 2.6,
    damage: 14,
    fireInterval: 2.4,
    size: [0.3, 0.3, 1.3],
    muzzleFlash: 2.2,
    trail: true,
  },
  'weapon-rocket-pod': {
    id: 'weapon-rocket-pod',
    kind: 'rocket',
    group: 'missiles',
    colour: '#ffcf6a',
    speed: 150,
    lifetime: 1.6,
    damage: 9,
    fireInterval: 1.8,
    size: [0.22, 0.22, 1.1],
    muzzleFlash: 1.6,
    trail: true,
    burst: 3,
    burstGap: 0.09,
  },
  'weapon-seeker-missiles': {
    id: 'weapon-seeker-missiles',
    kind: 'seeker',
    group: 'missiles',
    colour: '#ff8ad0',
    speed: 85,
    lifetime: 3.5,
    damage: 22,
    fireInterval: 3.0,
    size: [0.3, 0.3, 1.4],
    muzzleFlash: 2.0,
    trail: true,
    homing: 2.6,
  },
};

/** What a ship with no weapons fitted still gets: a token nose gun. */
export const DEFAULT_WEAPON: WeaponProfile = {
  id: 'default',
  kind: 'pellet',
  group: 'guns',
  colour: '#c8d0dc',
  speed: 170,
  lifetime: 0.9,
  damage: 2,
  fireInterval: 0.25,
  size: [0.1, 0.1, 1.0],
  muzzleFlash: 0.8,
  trail: false,
};

export function weaponProfileFor(attachmentId: string | undefined): WeaponProfile {
  return (attachmentId && WEAPON_PROFILES[attachmentId]) || DEFAULT_WEAPON;
}
