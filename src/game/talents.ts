/**
 * Talents: the skill sheet of a space MMO, laid out like an old-school
 * skills tab. The client only knows what each talent is called, what it is
 * for and which icon it wears; levels, experience and training all belong
 * to the server, which sends standings down. Until there is one, every
 * talent stands at 1/1.
 */

/** A talent id, as a server would key skill levels. */
export type TalentId = string;

/** The three arms of the economy a talent belongs to. */
export type TalentGroup = 'gathering' | 'processing' | 'combat';

export interface TalentDefinition {
  readonly id: TalentId;
  readonly name: string;
  readonly group: TalentGroup;
  /** What training it would do and what it feeds; shown on hover. */
  readonly description: string;
  /** Pixel-art icon file under `assets/talents`, from tools/generate-talent-icons.py. */
  readonly icon: string;
}

/** A talent's standing as the server reports it: `level` is the current (boostable) level, `base` the trained one, like an old-school skill. */
export interface TalentStanding {
  readonly id: TalentId;
  readonly level: number;
  readonly base: number;
}

/** What the side panel shows per talent: the definition joined with its standing. */
export type TalentReadout = TalentDefinition & TalentStanding;

/** The MVP sheet: five gathering talents, three that process and craft, three for combat. Every one feeds or drains another. */
export const TALENTS: readonly TalentDefinition[] = [
  {
    id: 'mining',
    name: 'Mining',
    group: 'gathering',
    description: 'Extract metals and rare ores from asteroid belts; the best belts lie in dangerous sectors. Raw ore is bulky and low-value, so it goes to refiners, and from there into the alloys behind hulls, modules and kinetic ammo.',
    icon: 'mining.png',
  },
  {
    id: 'gas-harvesting',
    name: 'Gas Harvesting',
    group: 'gathering',
    description: 'Fit a scoop and dive gas giants, clouds and nebulae. Deeper dives yield richer gas but pressure, heat and storms hurt the hull; higher levels go deeper and last longer. Hydrogen and helium-3 become fuel, volatiles go to Chemistry, exotic gases to Engineering. Raw gas leaks until refined, and a ship carrying it explodes harder.',
    icon: 'gas-harvesting.png',
  },
  {
    id: 'xenobiology',
    name: 'Xenobiology',
    group: 'gathering',
    description: 'Harvest flora and biomass from planets and nebulae, richest on hostile worlds. Plant and planetary material only; it exists to feed Chemistry.',
    icon: 'xenobiology.png',
  },
  {
    id: 'hunting',
    name: 'Hunting',
    group: 'gathering',
    description: 'Deploy traps (gravity snares, EMP nets, containment fields, bait pods) to take fast, elusive creatures and stray drones alive. Glands and venom go to Chemistry; chitin, bioluminescent organs and drone cores to Engineering. Traps degrade, bait is consumed, and other players can wreck or steal your traps.',
    icon: 'hunting.png',
  },
  {
    id: 'salvaging',
    name: 'Salvaging',
    group: 'gathering',
    description: 'Strip wrecks from PvP, NPC fights and destroyed ships for components, damaged modules and blueprint fragments. Top-tier fragments come only from salvage, so endgame crafting always depends on someone having fought.',
    icon: 'salvaging.png',
  },
  {
    id: 'refining',
    name: 'Refining',
    group: 'processing',
    description: 'Ore into alloys, gas into fuel: the link between Mining and Gas Harvesting. Every warp jump burns fuel, the most constant sink in the game, and high-level refiners get better yields.',
    icon: 'refining.png',
  },
  {
    id: 'chemistry',
    name: 'Chemistry',
    group: 'processing',
    description: 'Biomass, creature parts and volatile gases into combat boosters, repair nanites, shield overchargers, anti-toxins, fuel additives and hunting bait. Everything it makes is consumed, and top-tier boosters are strong enough that serious PvP players need them.',
    icon: 'chemistry.png',
  },
  {
    id: 'engineering',
    name: 'Engineering',
    group: 'processing',
    description: 'Build hulls, engines, weapon mounts, shields, targeting computers, sensor arrays, cloaking devices and gas canisters from alloys, exotic gases, components and creature materials. Nearly every other talent feeds it, and every ship lost is a new build in demand.',
    icon: 'engineering.png',
  },
  {
    id: 'gunnery',
    name: 'Gunnery',
    group: 'combat',
    description: 'Weapon accuracy, damage and access to higher weapon tiers. Kinetic weapons burn alloy ammo, energy and plasma weapons burn gas charges, so fighters drive demand for Mining and Gas Harvesting.',
    icon: 'gunnery.png',
  },
  {
    id: 'piloting',
    name: 'Piloting',
    group: 'combat',
    description: 'Unlocks ship classes (frigate, cruiser, battleship, capital), evasion, warp range and fuel efficiency. Decides who can reach dangerous, resource-rich space; high-level pilots sell escort and hauling.',
    icon: 'piloting.png',
  },
  {
    id: 'slayer',
    name: 'Slayer',
    group: 'combat',
    description: 'Randomised contracts from bounty masters to hunt specific dangerous creatures. Higher levels unlock prey only slayers can damage (Void Leviathans, Plasma Wraiths, Hive Queens) with drops found nowhere else; every endgame item needs at least one. Slayer points buy perks and are never tradeable.',
    icon: 'slayer.png',
  },
];

/** Where the icons live under the site root; prefix with the base URL to fetch one. */
export function talentAssetPath(file: string): string {
  return `assets/talents/${file}`;
}

/** The stand-in for a server's sheet: every talent at 1/1. */
export function freshTalents(): TalentStanding[] {
  return TALENTS.map((talent) => ({ id: talent.id, level: 1, base: 1 }));
}

export function totalLevel(standings: ReadonlyArray<Pick<TalentStanding, 'base'>>): number {
  return standings.reduce((sum, standing) => sum + standing.base, 0);
}

/** Join the definitions with the server's standings for display; talents it did not mention show as 1/1. */
export function talentReadouts(standings: readonly TalentStanding[]): TalentReadout[] {
  return TALENTS.map((talent) => ({ ...talent, ...(standings.find((candidate) => candidate.id === talent.id) ?? { level: 1, base: 1 }) }));
}
