import { box, cone, tube } from '../../core/primitives';
import type { AttachmentDefinition } from '../../core/types';

/** Large mining tools: a 2.2-wide collar on the mount and the business end along +Z. */
export const MINING_TOOLS: readonly AttachmentDefinition[] = [
  {
    id: 'mining-drill',
    name: 'Rock Drill',
    category: 'mining',
    size: 'large',
    description: 'Tapered drill head with cutting rings and a hardened tip.',
    stats: { mass: 9, mining: 8 },
    primitives: [
      tube({ radius: 1.1, z: [0, 0.4], role: 'trim' }),
      tube({ radius: [1.0, 0.22], z: [0.4, 3.8], role: 'dark' }),
      tube({ radius: [0.9, 0.84], z: [0.9, 1.1], role: 'metal' }),
      tube({ radius: [0.7, 0.64], z: [1.7, 1.9], role: 'metal' }),
      tube({ radius: [0.5, 0.44], z: [2.5, 2.7], role: 'metal' }),
      cone({ radius: 0.22, z: [3.8, 4.5], role: 'metal' }),
    ],
  },
  {
    id: 'mining-laser',
    name: 'Mining Laser',
    category: 'mining',
    size: 'large',
    description: 'Four guide rails around a cutting emitter.',
    stats: { mass: 8, mining: 7 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.25, size: [2.3, 2.3, 0.8], at: [0, 0, 0.4], role: 'dark' }),
      tube({ radius: 0.1, z: [0.8, 3.4], at: [0.9, 0.9, 0], role: 'trim', mirror: true }),
      tube({ radius: 0.1, z: [0.8, 3.4], at: [0.9, -0.9, 0], role: 'trim', mirror: true }),
      tube({ radius: 0.36, z: [0.8, 2.8], role: 'dark' }),
      tube({ radius: 0.42, z: [1.4, 1.6], role: 'metal' }),
      tube({ radius: 0.3, z: [2.8, 3.1], role: 'glow' }),
    ],
  },
  {
    id: 'mining-scoop',
    name: 'Ore Scoop',
    category: 'mining',
    size: 'large',
    description: 'Flared collector mouth for loose rubble.',
    stats: { mass: 7, mining: 5, cargo: 2 },
    primitives: [
      tube({ radius: [1.05, 1.4], z: [0, 2.4], role: 'dark', caps: [true, false] }),
      tube({ radius: [1.2, 0.3], z: [2.3, 0.5], role: 'dark', caps: [false, true] }),
      tube({ radius: [1.42, 1.44], z: [2.3, 2.5], role: 'trim', caps: [false, false] }),
      tube({ radius: [1.22, 1.42], z: [2.5, 2.5], role: 'trim', caps: [false, false] }),
    ],
  },
  {
    id: 'mining-claw',
    name: 'Salvage Claw',
    category: 'mining',
    size: 'large',
    description: 'Two articulated arms for grabbing wreckage.',
    stats: { mass: 7, mining: 4 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.2, size: [2.2, 2.2, 0.6], at: [0, 0, 0.3], role: 'dark' }),
      box({ size: [0.4, 1.3, 2.3], at: [0.85, 0, 1.6], rotation: [0, -12, 0], role: 'metal', mirror: true }),
      box({ size: [0.45, 1.4, 0.5], at: [0.45, 0, 2.95], rotation: [0, -35, 0], role: 'trim', mirror: true }),
      tube({ radius: 0.25, z: [0.6, 1.2], role: 'metal' }),
    ],
  },
];
