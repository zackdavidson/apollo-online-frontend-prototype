import { box, plate, taper, wing } from '../../core/primitives';
import type { HullDefinition } from '../../core/types';

/**
 * Dart-class fighter: a hexagonal fuselage that tapers to a slim nose, a wide
 * rear block for twin engines, thin swept wings with tip pylons, a bubble
 * canopy on a raised spine and a V-tail. Roughly 12 units long.
 */
export const FIGHTER: HullDefinition = {
  id: 'hull-fighter',
  name: 'Dart',
  role: 'Fighter',
  description: 'Fast interceptor. Nose and wingtip hardpoints, twin engines, dorsal and belly mounts.',
  stats: { mass: 20, firepower: 2 },
  primitives: [
    // Fuselage, nose and nose tip.
    taper({ shape: 'hexagon', from: { width: 1.8, height: 1.2 }, to: { width: 1.5, height: 1.1 }, z: [-4.6, 1.5], role: 'main' }),
    taper({ shape: 'hexagon', from: { width: 1.5, height: 1.1 }, to: { width: 0.72, height: 0.6, y: -0.05 }, z: [1.5, 5.0], role: 'main' }),
    taper({ shape: 'hexagon', from: { width: 0.72, height: 0.6, y: -0.05 }, to: { width: 0.34, height: 0.28, y: -0.08 }, z: [5.0, 6.0], role: 'dark' }),
    // Rear engine block with a trim band and a dark engine face.
    box({ shape: 'chamfered', chamfer: 0.25, size: [3.0, 1.3, 1.7], at: [0, 0, -5.25], role: 'main' }),
    box({ shape: 'chamfered', chamfer: 0.27, size: [3.1, 1.38, 0.25], at: [0, 0, -4.5], role: 'trim' }),
    box({ shape: 'chamfered', chamfer: 0.2, size: [2.7, 1.05, 0.3], at: [0, 0, -6.05], role: 'dark' }),
    // Raised spine and canopy.
    taper({ chamfer: 0.12, from: { width: 1.0, height: 0.5, y: 0.75 }, to: { width: 0.92, height: 0.46, y: 0.73 }, z: [-3.4, -0.6], role: 'main' }),
    taper({ chamfer: 0.1, from: { width: 0.9, height: 0.5, y: 0.72 }, to: { width: 0.55, height: 0.2, y: 0.6 }, z: [-0.6, 2.1], role: 'glass' }),
    // Side intakes and belly keel.
    box({ shape: 'chamfered', chamfer: 0.1, size: [0.5, 0.62, 2.4], at: [1.02, 0.02, -2.5], role: 'dark', mirror: true }),
    box({ size: [0.5, 0.2, 0.3], at: [1.02, 0.02, -1.15], role: 'trim', mirror: true }),
    box({ shape: 'chamfered', chamfer: 0.05, size: [0.9, 0.16, 5.4], at: [0, -0.62, -1.3], role: 'dark' }),
    // Trim stripes along the upper fuselage.
    plate({ size: [3.8, 0.22], at: [0.62, 0.62, -1.0], facing: 'y', role: 'trim', mirror: true }),
    // Wings with a slight anhedral, leading-edge stripe and tip pylons.
    wing({ points: [[0.6, 1.2], [0.6, -3.9], [4.9, -4.7], [4.9, -3.4]], thickness: [0.26, 0.1], at: [0, -0.05, 0], rotation: [0, 0, -4], role: 'main', mirror: true }),
    wing({ points: [[0.9, 0.98], [0.9, 0.6], [4.8, -3.5], [4.8, -3.2]], thickness: [0.32, 0.16], at: [0, -0.05, 0], rotation: [0, 0, -4], role: 'trim', mirror: true }),
    box({ shape: 'chamfered', chamfer: 0.08, size: [0.36, 0.32, 1.7], at: [4.85, -0.39, -4.05], role: 'dark', mirror: true }),
    // V-tail with trim tips.
    wing({ points: [[0, -5.6], [0, -3.2], [1.5, -5.0], [1.5, -5.7]], thickness: [0.14, 0.06], at: [0.55, 0.5, 0], rotation: [0, 0, 65], role: 'main', mirror: true }),
    wing({ points: [[1.1, -5.15], [1.1, -5.68], [1.5, -5.0], [1.5, -5.7]], thickness: [0.18, 0.1], at: [0.55, 0.5, 0], rotation: [0, 0, 65], role: 'trim', mirror: true }),
  ],
  slots: [
    {
      id: 'nose',
      label: 'Nose mount',
      position: [0, -0.08, 6.0],
      facing: 'forward',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'weapon-autocannon',
    },
    {
      id: 'wing-port',
      label: 'Port wingtip pod',
      position: [4.85, -0.39, -3.2],
      facing: 'forward',
      accepts: ['weapon'],
      size: 'small',
      defaultAttachment: 'weapon-laser',
    },
    {
      id: 'wing-starboard',
      label: 'Starboard wingtip pod',
      position: [-4.85, -0.39, -3.2],
      facing: 'forward',
      accepts: ['weapon'],
      size: 'small',
      defaultAttachment: 'weapon-laser',
    },
    {
      id: 'engine-port',
      label: 'Port engine',
      position: [0.8, 0, -6.2],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-afterburner',
    },
    {
      id: 'engine-starboard',
      label: 'Starboard engine',
      position: [-0.8, 0, -6.2],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
      defaultAttachment: 'thruster-afterburner',
    },
    {
      id: 'dorsal',
      label: 'Dorsal mount',
      position: [0, 0.98, -2.2],
      facing: 'up',
      accepts: ['utility'],
      size: 'small',
    },
    {
      id: 'belly',
      label: 'Belly mount',
      position: [0, -0.7, -1.3],
      facing: 'down',
      accepts: ['weapon', 'utility'],
      size: 'small',
    },
  ],
};
