import { box, cone, taper, tube } from '../../core/primitives';
import type { AttachmentDefinition } from '../../core/types';

/** Small utility parts; most slots for them face up, so +Z becomes "up". */
export const UTILITY_PARTS: readonly AttachmentDefinition[] = [
  {
    id: 'utility-nose-cone',
    name: 'Nose Cone',
    category: 'utility',
    size: 'small',
    description: 'Plain aerodynamic fairing in ship colours.',
    stats: { mass: 1 },
    primitives: [
      taper({ shape: 'hexagon', from: { width: 0.8, height: 0.7 }, to: { width: 0.12, height: 0.1 }, z: [0, 1.7], role: 'main' }),
      tube({ radius: 0.06, z: [1.7, 2.0], role: 'trim' }),
    ],
  },
  {
    id: 'utility-antenna',
    name: 'Comms Antenna',
    category: 'utility',
    size: 'small',
    description: 'Tall mast with a blinking tip.',
    stats: { mass: 1 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.08, size: [0.5, 0.5, 0.25], at: [0, 0, 0.125], role: 'dark' }),
      tube({ radius: 0.06, z: [0.25, 2.6], role: 'metal' }),
      box({ size: [0.6, 0.05, 0.05], at: [0, 0, 1.8], role: 'metal' }),
      tube({ radius: 0.1, z: [2.6, 2.8], role: 'glow' }),
    ],
  },
  {
    id: 'utility-radar',
    name: 'Radar Panel',
    category: 'utility',
    size: 'small',
    description: 'Flat scanning array on a short stalk.',
    stats: { mass: 2 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.08, size: [0.5, 0.5, 0.2], at: [0, 0, 0.1], role: 'dark' }),
      tube({ radius: 0.08, z: [0.2, 1.0], role: 'metal' }),
      box({ size: [1.4, 0.08, 0.9], at: [0, 0, 1.45], role: 'metal' }),
      box({ size: [1.0, 0.1, 0.12], at: [0, 0, 1.45], role: 'trim' }),
    ],
  },
  {
    id: 'utility-shield',
    name: 'Shield Emitter',
    category: 'utility',
    size: 'small',
    description: 'Glowing projector dome.',
    stats: { mass: 2 },
    primitives: [
      tube({ radius: 0.48, z: [0, 0.2], role: 'trim' }),
      tube({ radius: [0.42, 0.28], z: [0.2, 0.5], role: 'dark' }),
      cone({ radius: 0.28, z: [0.5, 0.95], role: 'glow' }),
    ],
  },
  {
    id: 'utility-sensor',
    name: 'Sensor Array',
    category: 'utility',
    size: 'small',
    description: 'Stacked sensor pods with a trim housing.',
    stats: { mass: 2, mining: 1, firepower: 1 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.08, size: [0.7, 0.6, 0.3], at: [0, 0, 0.15], role: 'metal' }),
      box({ size: [0.24, 0.3, 0.6], at: [0.2, 0, 0.6], role: 'dark', mirror: true }),
      box({ size: [0.2, 0.5, 0.7], at: [0, 0, 0.65], role: 'trim' }),
      tube({ radius: 0.08, z: [1.0, 1.15], role: 'glow' }),
    ],
  },
  {
    id: 'utility-cargo-clamp',
    name: 'Cargo Clamp',
    category: 'utility',
    size: 'small',
    description: 'Magnetic grapple for towing.',
    stats: { mass: 2, cargo: 1 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.08, size: [0.6, 0.6, 0.3], at: [0, 0, 0.15], role: 'dark' }),
      box({ size: [0.12, 0.4, 0.9], at: [0.26, 0, 0.75], role: 'metal', mirror: true }),
      box({ size: [0.14, 0.44, 0.2], at: [0.2, 0, 1.25], rotation: [0, 25, 0], role: 'trim', mirror: true }),
    ],
  },
];
