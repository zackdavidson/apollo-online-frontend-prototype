import type { Rock } from '../game/rocks';

/** Accents and effect colours the flight presentation shares. */
export const NPC_ACCENT = '#ff6a3a';
/** Label and tooltip colour for ships that are friendly right now. */
export const FRIENDLY_ACCENT = '#7fe3a0';
export const COMET_ACCENT = '#9fd8ff';
export const SHIELD_COLOUR = '#5fb4ff';
export const MISSILE_SMOKE = '#8a8a8a';
const ROCK_CHIP_COLOUR = '#9a8f80';

export const ROCK_BAR_COLOURS: Readonly<Record<Rock['kind'], string>> = {
  stone: '#d9b26a',
  iron: '#9fb4c8',
  ice: '#8fe3ff',
  crystal: '#d9a6ff',
  giant: '#ff9a5a',
};

export function chipColour(rock: Pick<Rock, 'kind'>): string {
  return rock.kind === 'ice' ? '#bfe0f0' : rock.kind === 'crystal' ? '#c9a6ff' : ROCK_CHIP_COLOUR;
}
