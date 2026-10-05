/**
 * Which colour a surface takes. `main` and `trim` are user-chosen per ship;
 * the rest are fixed material colours so details stay readable.
 */
export type PaletteRole = 'main' | 'trim' | 'dark' | 'metal' | 'glass' | 'glow' | 'plume';

/** The two user-customisable colours of a ship, as CSS hex strings. */
export interface ShipColours {
  readonly main: string;
  readonly trim: string;
}

/** Colours for roles the player does not control. */
export const FIXED_COLOURS: Readonly<Record<Exclude<PaletteRole, 'main' | 'trim'>, string>> = {
  dark: '#2e3139',
  metal: '#a3aab4',
  glass: '#6fc4ea',
  glow: '#4f9dff',
  /** Engine exhaust. Same hue as glow, but these triangles are animated by throttle. */
  plume: '#5aa6ff',
};

/** Roles that should render unlit (self-illuminated). */
export const EMISSIVE_ROLES: ReadonlySet<PaletteRole> = new Set<PaletteRole>(['glow', 'plume']);

export function colourForRole(role: PaletteRole, colours: ShipColours): string {
  switch (role) {
    case 'main':
      return colours.main;
    case 'trim':
      return colours.trim;
    default:
      return FIXED_COLOURS[role];
  }
}

export interface ColourPreset {
  readonly name: string;
  readonly colours: ShipColours;
}

export const COLOUR_PRESETS: readonly ColourPreset[] = [
  { name: 'Hangar Grey', colours: { main: '#8e96a3', trim: '#e8a33d' } },
  { name: 'Crimson Lance', colours: { main: '#b0372f', trim: '#f2e6c9' } },
  { name: 'Deep Navy', colours: { main: '#2b4a86', trim: '#d8b24a' } },
  { name: 'Forest Hauler', colours: { main: '#4b7a45', trim: '#f0773c' } },
  { name: 'Arctic', colours: { main: '#e9eef2', trim: '#3a7bd5' } },
  { name: 'Toxic', colours: { main: '#33373f', trim: '#9cff3c' } },
  { name: 'Rust Bucket', colours: { main: '#9a6531', trim: '#4f6d7a' } },
  { name: 'Royal', colours: { main: '#6a3796', trim: '#f5c542' } },
];

export const DEFAULT_COLOURS: ShipColours = COLOUR_PRESETS[0]!.colours;

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value);
}
