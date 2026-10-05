import { defaultItemCatalog, type BeamStyle, type ProjectileKind, type WeaponBehaviour, type WeaponEffect, type WeaponGroup } from './items';

/**
 * How each weapon item fires. Profiles are derived from the item catalog:
 * the item's `behaviour` (what the simulation needs) merged with its
 * `visual.effect` (what the renderer needs), keyed by item id, which is
 * also the ship catalog attachment id, so the ship you built decides what
 * you shoot.
 */
export type { BeamStyle, ProjectileKind, WeaponGroup };

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

/** Behaviour and effect of one weapon item, flattened for the simulation and the renderers. */
export type WeaponProfile = { readonly id: string } & WeaponBehaviour & WeaponEffect;

export const WEAPON_PROFILES: Readonly<Record<string, WeaponProfile>> = Object.fromEntries(
  defaultItemCatalog()
    .weapons.filter((item) => item.visual.effect)
    .map((item) => [item.id, { id: item.id, ...item.behaviour!, ...item.visual.effect! }]),
);

/** What a ship with no weapons fitted still gets: a token nose gun. Not an item; nobody can pick it up. */
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
