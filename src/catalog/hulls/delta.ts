import { box, plate, taper, tube, wing } from '../../core/primitives';
import type { HullDefinition } from '../../core/types';

/**
 * Wedge-class scout: a slim hexagonal pod buried in a big delta wing, with
 * engine nacelles on the wing, underwing pylons, winglets and a long canopy.
 * About 11 long and 10 across.
 */
export const DELTA: HullDefinition = {
  id: 'hull-delta',
  name: 'Wedge',
  role: 'Scout',
  description: 'Flying-wing scout. Underwing hardpoints, three small engines along the trailing edge, nose and dorsal mounts.',
  stats: { mass: 24, thrust: 2, firepower: 1 },
  primitives: [
    // Central pod tapering to the nose, with a dark engine face at the back.
    taper({ shape: 'hexagon', from: { width: 1.7, height: 1.15 }, to: { width: 1.3, height: 0.95 }, z: [-5.0, 2.0], role: 'main' }),
    taper({ shape: 'hexagon', from: { width: 1.3, height: 0.95 }, to: { width: 0.55, height: 0.45, y: -0.05 }, z: [2.0, 5.4], role: 'main' }),
    taper({ shape: 'hexagon', from: { width: 0.55, height: 0.45, y: -0.05 }, to: { width: 0.3, height: 0.26, y: -0.06 }, z: [5.4, 6.0], role: 'dark' }),
    box({ shape: 'chamfered', chamfer: 0.15, size: [1.5, 1.0, 0.3], at: [0, 0, -5.15], role: 'dark' }),
    // Spine and canopy.
    taper({ chamfer: 0.1, from: { width: 0.95, height: 0.45, y: 0.65 }, to: { width: 0.9, height: 0.42, y: 0.64 }, z: [-3.2, -0.5], role: 'main' }),
    taper({ chamfer: 0.1, from: { width: 0.9, height: 0.45, y: 0.64 }, to: { width: 0.5, height: 0.16, y: 0.52 }, z: [-0.5, 1.9], role: 'glass' }),
    // Delta wing with a leading-edge stripe and dark flaps.
    wing({ points: [[0.5, 3.2], [0.5, -5.0], [5.2, -5.5], [5.2, -4.6]], thickness: [0.5, 0.12], at: [0, -0.1, 0], role: 'main', mirror: true }),
    wing({ points: [[0.8, 2.9], [0.8, 2.4], [5.1, -4.2], [5.1, -4.62]], thickness: [0.56, 0.18], at: [0, -0.1, 0], role: 'trim', mirror: true }),
    wing({ points: [[1.0, -4.6], [1.0, -5.05], [3.6, -5.33], [3.6, -4.9]], thickness: [0.5, 0.3], at: [0, -0.1, 0], role: 'dark', mirror: true }),
    // Engine nacelles on the wing.
    tube({ radius: 0.5, z: [-5.4, -3.0], at: [2.0, -0.1, 0], role: 'dark', mirror: true }),
    tube({ radius: 0.55, z: [-3.3, -3.0], at: [2.0, -0.1, 0], role: 'trim', mirror: true }),
    tube({ radius: [0.5, 0.2], z: [-3.0, -2.2], at: [2.0, -0.1, 0], role: 'main', mirror: true }),
    // Underwing pylons.
    box({ shape: 'chamfered', chamfer: 0.06, size: [0.3, 0.5, 1.5], at: [2.8, -0.5, -2.25], role: 'dark', mirror: true }),
    // Winglets.
    wing({ points: [[0, -4.65], [0, -3.7], [0.9, -4.35], [0.9, -4.7]], thickness: [0.12, 0.06], at: [5.2, -0.1, 0], rotation: [0, 0, 90], role: 'trim', mirror: true }),
    // Wing-root stripes and tip lights.
    plate({ size: [0.5, 2.0], at: [1.4, 0.15, -2.0], facing: 'y', role: 'trim', mirror: true }),
    box({ size: [0.25, 0.12, 0.3], at: [5.1, -0.1, -4.9], role: 'glow', mirror: true }),
  ],
  slots: [
    {
      id: 'nose',
      label: 'Nose mount',
      position: [0, -0.06, 6.05],
      facing: 'forward',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'utility-nose-cone',
    },
    {
      id: 'wing-port',
      label: 'Port underwing pylon',
      position: [2.8, -0.5, -1.5],
      facing: 'forward',
      accepts: ['weapon'],
      size: 'small',
      defaultAttachment: 'weapon-laser',
    },
    {
      id: 'wing-starboard',
      label: 'Starboard underwing pylon',
      position: [-2.8, -0.5, -1.5],
      facing: 'forward',
      accepts: ['weapon'],
      size: 'small',
      defaultAttachment: 'weapon-laser',
    },
    {
      id: 'engine-port',
      label: 'Port engine',
      position: [2.0, -0.1, -5.4],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-afterburner',
    },
    {
      id: 'engine-centre',
      label: 'Centre engine',
      position: [0, 0, -5.3],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-afterburner',
    },
    {
      id: 'engine-starboard',
      label: 'Starboard engine',
      position: [-2.0, -0.1, -5.4],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-afterburner',
    },
    {
      id: 'dorsal',
      label: 'Dorsal mount',
      position: [0, 0.88, -2.0],
      facing: 'up',
      accepts: ['utility'],
      size: 'small',
    },
  ],
};
