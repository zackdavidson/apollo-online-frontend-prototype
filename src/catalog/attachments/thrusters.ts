import { box, cone, plate, tube } from '../../core/primitives';
import type { AttachmentDefinition } from '../../core/types';

/**
 * Thrusters: a bell extending along +Z with a glowing plume at the far end;
 * the slot flips them aft. Small bells are about 0.9 across, large about 2.3.
 */
export const THRUSTERS: readonly AttachmentDefinition[] = [
  {
    id: 'thruster-pulse',
    name: 'Pulse Jet',
    category: 'thruster',
    size: 'small',
    description: 'Compact, dependable, a little underpowered.',
    stats: { mass: 3, thrust: 4 },
    primitives: [
      tube({ radius: [0.42, 0.46], z: [0, 0.9], role: 'dark' }),
      tube({ radius: 0.5, z: [0, 0.14], role: 'trim' }),
      tube({ radius: 0.3, z: [0.85, 1.0], role: 'glow' }),
      cone({ radius: 0.32, z: [1.0, 3.2], role: 'plume' }),
    ],
  },
  {
    id: 'thruster-afterburner',
    name: 'Afterburner',
    category: 'thruster',
    size: 'small',
    description: 'Long racing nozzle with a flared bell and a bright plume.',
    stats: { mass: 4, thrust: 7 },
    primitives: [
      tube({ radius: 0.4, z: [0, 0.7], role: 'dark' }),
      tube({ radius: [0.4, 0.56], z: [0.7, 1.5], role: 'dark' }),
      tube({ radius: 0.47, z: [0, 0.15], role: 'trim' }),
      tube({ radius: 0.46, z: [0.65, 0.78], role: 'trim' }),
      tube({ radius: 0.44, z: [1.45, 1.55], role: 'glow' }),
      cone({ radius: 0.46, z: [1.55, 5.8], role: 'plume' }),
    ],
  },
  {
    id: 'thruster-ion-pod',
    name: 'Ion Pod',
    category: 'thruster',
    size: 'small',
    description: 'Stubby ion emitter. Efficient, not fast.',
    stats: { mass: 2, thrust: 3 },
    primitives: [
      tube({ radius: 0.46, z: [0, 0.5], role: 'metal' }),
      tube({ radius: 0.5, z: [0.1, 0.2], role: 'trim' }),
      tube({ radius: 0.36, z: [0.45, 0.6], role: 'glow' }),
      cone({ radius: 0.32, z: [0.6, 2.1], role: 'plume' }),
    ],
  },
  {
    id: 'thruster-vectored',
    name: 'Vectored Nozzle',
    category: 'thruster',
    size: 'small',
    description: 'Gimballed nozzle with steering vanes.',
    stats: { mass: 3, thrust: 5 },
    primitives: [
      tube({ radius: [0.44, 0.4], z: [0, 1.0], role: 'dark' }),
      tube({ radius: 0.48, z: [0, 0.12], role: 'trim' }),
      plate({ size: [0.8, 0.5], at: [0, 0.52, 0.75], facing: 'y', role: 'trim' }),
      plate({ size: [0.8, 0.5], at: [0, -0.52, 0.75], facing: 'y', role: 'trim' }),
      tube({ radius: 0.3, z: [0.95, 1.1], role: 'glow' }),
      cone({ radius: 0.3, z: [1.1, 3.0], role: 'plume' }),
    ],
  },
  {
    id: 'thruster-heavy-ion',
    name: 'Heavy Ion Drive',
    category: 'thruster',
    size: 'large',
    description: 'Single large bell with a bright core.',
    stats: { mass: 10, thrust: 12 },
    primitives: [
      tube({ radius: [0.95, 1.15], z: [0, 1.8], role: 'dark' }),
      tube({ radius: 1.05, z: [0, 0.2], role: 'trim' }),
      tube({ radius: 1.18, z: [1.55, 1.7], role: 'trim' }),
      tube({ radius: 0.82, z: [1.7, 1.9], role: 'glow' }),
      cone({ radius: 0.86, z: [1.9, 7.2], role: 'plume' }),
    ],
  },
  {
    id: 'thruster-twin-fusion',
    name: 'Twin Fusion Nozzles',
    category: 'thruster',
    size: 'large',
    description: 'Two outboard nozzles on a shared mounting plate.',
    stats: { mass: 11, thrust: 14 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.2, size: [2.4, 2.4, 0.35], at: [0, 0, 0.175], role: 'dark' }),
      box({ size: [0.5, 1.6, 0.4], at: [0, 0, 0.5], role: 'trim' }),
      tube({ radius: [0.5, 0.58], z: [0.35, 1.7], at: [0.65, 0, 0], role: 'dark', mirror: true }),
      tube({ radius: 0.56, z: [0.35, 0.5], at: [0.65, 0, 0], role: 'trim', mirror: true }),
      tube({ radius: 0.42, z: [1.65, 1.8], at: [0.65, 0, 0], role: 'glow', mirror: true }),
      cone({ radius: 0.44, z: [1.8, 5.6], at: [0.65, 0, 0], role: 'plume', mirror: true }),
    ],
  },
  {
    id: 'thruster-industrial-bank',
    name: 'Industrial Bank',
    category: 'thruster',
    size: 'large',
    description: 'Four stubby nozzles in a frame. Ugly, effective.',
    stats: { mass: 12, thrust: 16 },
    primitives: [
      box({ shape: 'chamfered', chamfer: 0.15, size: [2.4, 2.4, 0.5], at: [0, 0, 0.25], role: 'dark' }),
      box({ size: [2.5, 0.16, 0.5], at: [0, 1.17, 0.25], role: 'trim' }),
      box({ size: [2.5, 0.16, 0.5], at: [0, -1.17, 0.25], role: 'trim' }),
      tube({ radius: 0.42, z: [0.5, 1.3], at: [0.6, 0.6, 0], role: 'dark', mirror: true }),
      tube({ radius: 0.42, z: [0.5, 1.3], at: [0.6, -0.6, 0], role: 'dark', mirror: true }),
      tube({ radius: 0.3, z: [1.25, 1.4], at: [0.6, 0.6, 0], role: 'glow', mirror: true }),
      tube({ radius: 0.3, z: [1.25, 1.4], at: [0.6, -0.6, 0], role: 'glow', mirror: true }),
      cone({ radius: 0.3, z: [1.4, 3.6], at: [0.6, 0.6, 0], role: 'plume', mirror: true }),
      cone({ radius: 0.3, z: [1.4, 3.6], at: [0.6, -0.6, 0], role: 'plume', mirror: true }),
    ],
  },
];
