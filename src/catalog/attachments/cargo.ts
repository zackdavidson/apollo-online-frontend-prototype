import { box, tube } from '../../core/primitives';
import type { AttachmentDefinition } from '../../core/types';

/**
 * Large cargo modules: about 2.2 across, extending along +Z. Mounted facing up
 * on a hauler's deck they stand on end; racked on a miner's flank they lie along X.
 */
export const CARGO_MODULES: readonly AttachmentDefinition[] = [
  {
    id: 'cargo-container',
    name: 'Standard Container',
    category: 'cargo',
    size: 'large',
    description: 'Painted in ship colours with trim corner rails.',
    stats: { mass: 8, cargo: 6 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.12, size: [2.2, 2.2, 2.2], at: [0, 0, 1.1], role: 'main' }),
      box({ size: [0.16, 0.16, 2.3], at: [1.05, 1.05, 1.1], role: 'trim', mirror: true }),
      box({ size: [0.16, 0.16, 2.3], at: [1.05, -1.05, 1.1], role: 'trim', mirror: true }),
      box({ size: [1.6, 1.6, 0.1], at: [0, 0, 2.22], role: 'dark' }),
      box({ size: [0.5, 0.12, 0.12], at: [0, 0, 2.3], role: 'trim' }),
    ],
  },
  {
    id: 'cargo-fuel-tank',
    name: 'Fuel Tank',
    category: 'cargo',
    size: 'large',
    description: 'Rounded pressure vessel with a trim band and a valve cap.',
    stats: { mass: 6, cargo: 3, thrust: 2 },
    primitives: [
      tube({ radius: [0.55, 1.05], z: [0, 0.35], role: 'metal' }),
      tube({ radius: 1.05, z: [0.35, 1.9], role: 'metal' }),
      tube({ radius: [1.05, 0.55], z: [1.9, 2.25], role: 'metal' }),
      tube({ radius: 1.1, z: [1.0, 1.25], role: 'trim' }),
      tube({ radius: 0.25, z: [2.25, 2.55], role: 'dark' }),
    ],
  },
  {
    id: 'cargo-ore-hopper',
    name: 'Ore Hopper',
    category: 'cargo',
    size: 'large',
    description: 'Open bin with a trim rim and a few lumps of ore.',
    stats: { mass: 7, cargo: 5, mining: 1 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.1, size: [2.3, 2.3, 1.8], at: [0, 0, 0.9], role: 'dark' }),
      box({ size: [2.45, 2.45, 0.2], at: [0, 0, 1.8], role: 'trim' }),
      box({ size: [2.1, 2.1, 0.05], at: [0, 0, 1.9], role: 'dark' }),
      box({ shape: 'chamfered', size: [0.6, 0.5, 0.5], at: [0.3, 0.2, 2.1], rotation: [20, 30, 0], role: 'metal' }),
      box({ shape: 'chamfered', size: [0.5, 0.45, 0.45], at: [-0.5, -0.3, 2.05], rotation: [0, 15, 25], role: 'metal' }),
      box({ shape: 'chamfered', size: [0.45, 0.4, 0.5], at: [0.1, -0.6, 2.0], rotation: [35, 0, 10], role: 'metal' }),
    ],
  },
  {
    id: 'cargo-habitat',
    name: 'Habitat Module',
    category: 'cargo',
    size: 'large',
    description: 'Crew quarters with portholes.',
    stats: { mass: 6, cargo: 2 },
    primitives: [
      tube({ radius: 1.1, z: [0, 2.2], role: 'main' }),
      tube({ radius: 1.15, z: [1.0, 1.2], role: 'trim' }),
      tube({ radius: 0.2, z: [1.0, 1.2], at: [0, 0, 0.7], axis: 'x', role: 'glass' }),
      tube({ radius: 0.2, z: [-1.2, -1.0], at: [0, 0, 0.7], axis: 'x', role: 'glass' }),
      tube({ radius: 0.2, z: [1.0, 1.2], at: [0, 0, 1.6], axis: 'x', role: 'glass' }),
      tube({ radius: 0.2, z: [-1.2, -1.0], at: [0, 0, 1.6], axis: 'x', role: 'glass' }),
      tube({ radius: [1.1, 0.6], z: [2.2, 2.5], role: 'dark' }),
    ],
  },
];
