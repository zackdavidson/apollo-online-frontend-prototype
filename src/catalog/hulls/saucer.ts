import { box, plate, tube } from '../../core/primitives';
import type { HullDefinition } from '../../core/types';

/**
 * Halo-class explorer: a bevelled disc with a trim band, a stepped glass
 * dome, a dark underside bulge on three landing legs, and three engine
 * nacelles on the rear rim. About 7 across.
 */
export const SAUCER: HullDefinition = {
  id: 'hull-saucer',
  name: 'Halo',
  role: 'Explorer',
  description: 'Survey saucer. Glass dome, three rim engines, side and forward mounts and a ventral survey bay.',
  stats: { mass: 35, cargo: 2, mining: 1 },
  primitives: [
    // Disc with bevelled rims and a trim band.
    tube({ radius: [3.1, 3.6], z: [-0.3, 0.05], axis: 'y', role: 'main' }),
    tube({ radius: 3.6, z: [0.05, 0.5], axis: 'y', role: 'main' }),
    tube({ radius: [3.6, 2.6], z: [0.5, 0.95], axis: 'y', role: 'main' }),
    tube({ radius: 3.64, z: [0.15, 0.4], axis: 'y', role: 'trim' }),
    // Stepped dome.
    tube({ radius: [2.1, 1.7], z: [0.95, 1.25], axis: 'y', role: 'dark' }),
    tube({ radius: [1.7, 1.05], z: [1.25, 1.8], axis: 'y', role: 'glass' }),
    tube({ radius: [1.05, 0.45], z: [1.8, 2.1], axis: 'y', role: 'glass' }),
    // Underside bulge and landing legs.
    tube({ radius: [2.5, 1.7], z: [-0.3, -0.9], axis: 'y', role: 'dark' }),
    box({ shape: 'chamfered', chamfer: 0.06, size: [0.45, 0.5, 0.45], at: [0, -1.05, 2.1], role: 'dark' }),
    box({ shape: 'chamfered', chamfer: 0.06, size: [0.45, 0.5, 0.45], at: [1.9, -1.05, -1.1], role: 'dark', mirror: true }),
    // Rear engine nacelles with trim rings.
    tube({ radius: 0.5, z: [-4.6, -2.4], at: [0, 0.3, 0], role: 'dark' }),
    tube({ radius: 0.55, z: [-3.7, -3.5], at: [0, 0.3, 0], role: 'trim' }),
    tube({ radius: 0.5, z: [-3.85, -1.7], at: [2.2, 0.3, 0], role: 'dark', mirror: true }),
    tube({ radius: 0.55, z: [-3.0, -2.8], at: [2.2, 0.3, 0], role: 'trim', mirror: true }),
    // Radial deck stripes and running lights.
    plate({ size: [0.35, 1.0], at: [1.55, 0.97, 1.55], facing: 'y', rotation: [0, 45, 0], role: 'trim', mirror: true }),
    plate({ size: [0.35, 1.0], at: [1.55, 0.97, -1.55], facing: 'y', rotation: [0, 135, 0], role: 'trim', mirror: true }),
    box({ size: [0.25, 0.12, 0.35], at: [3.35, 0.62, 0.9], role: 'glow', mirror: true }),
    box({ size: [0.5, 0.12, 0.25], at: [0, 0.62, 3.4], role: 'glow' }),
  ],
  slots: [
    {
      id: 'engine-centre',
      label: 'Centre engine',
      position: [0, 0.3, -4.6],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-pulse',
    },
    {
      id: 'engine-port',
      label: 'Port engine',
      position: [2.2, 0.3, -3.85],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-pulse',
    },
    {
      id: 'engine-starboard',
      label: 'Starboard engine',
      position: [-2.2, 0.3, -3.85],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-pulse',
    },
    {
      id: 'dome',
      label: 'Dome mount',
      position: [0, 2.1, 0],
      facing: 'up',
      accepts: ['utility'],
      size: 'small',
      defaultAttachment: 'utility-antenna',
    },
    {
      id: 'rim-port',
      label: 'Port rim mount',
      position: [3.6, 0.3, 0.6],
      facing: 'right',
      accepts: ['weapon', 'utility'],
      size: 'small',
    },
    {
      id: 'rim-starboard',
      label: 'Starboard rim mount',
      position: [-3.6, 0.3, 0.6],
      facing: 'left',
      accepts: ['weapon', 'utility'],
      size: 'small',
    },
    {
      id: 'bow',
      label: 'Bow mount',
      position: [0, 0.3, 3.6],
      facing: 'forward',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'utility-sensor',
    },
    {
      id: 'belly',
      label: 'Ventral survey bay',
      position: [0, -0.9, 0],
      facing: 'down',
      accepts: ['cargo', 'mining'],
      size: 'large',
      defaultAttachment: 'mining-laser',
    },
  ],
};
