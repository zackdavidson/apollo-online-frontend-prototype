import type { AttachmentDefinition } from '../../core/types';
import { CARGO_MODULES } from './cargo';
import { MINING_TOOLS } from './mining';
import { THRUSTERS } from './thrusters';
import { UTILITY_PARTS } from './utility';
import { WEAPONS } from './weapons';

export const ALL_ATTACHMENTS: readonly AttachmentDefinition[] = [
  ...THRUSTERS,
  ...WEAPONS,
  ...MINING_TOOLS,
  ...CARGO_MODULES,
  ...UTILITY_PARTS,
];
