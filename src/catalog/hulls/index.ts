import type { HullDefinition } from '../../core/types';
import { DELTA } from './delta';
import { FIGHTER } from './fighter';
import { GUNSHIP } from './gunship';
import { HAULER } from './hauler';
import { MINER } from './miner';
import { SAUCER } from './saucer';

export const ALL_HULLS: readonly HullDefinition[] = [FIGHTER, DELTA, GUNSHIP, MINER, HAULER, SAUCER];
