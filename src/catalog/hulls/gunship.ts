import { box, plate, taper, tube, wing } from '../../core/primitives';
import type { HullDefinition } from '../../core/types';

/**
 * Bastion-class gunship: a broad chamfered slab with a forward taper, a glass
 * cockpit dome, cheek sponsons carrying hardpoints, a dorsal turret ring, a
 * ventral bay and a tall rear block for twin heavy engines. About 15 long.
 */
export const GUNSHIP: HullDefinition = {
  id: 'hull-gunship',
  name: 'Bastion',
  role: 'Gunship',
  description: 'Heavy combat hull. Twin nose guns, cheek hardpoints, a dorsal turret, a ventral bay and twin heavy engines.',
  stats: { mass: 55, firepower: 4 },
  primitives: [
    // Main slab, forward taper and dark nose cap.
    box({ shape: 'chamfered', chamfer: 0.3, size: [4.2, 1.4, 8.0], at: [0, 0, -1.0], role: 'main' }),
    taper({ chamfer: 0.25, from: { width: 4.2, height: 1.4 }, to: { width: 2.6, height: 1.0 }, z: [3.0, 6.5], role: 'main' }),
    taper({ chamfer: 0.2, from: { width: 2.6, height: 1.0 }, to: { width: 2.2, height: 0.8 }, z: [6.5, 7.3], role: 'dark' }),
    // Rear block with trim band and engine face.
    box({ shape: 'chamfered', chamfer: 0.35, size: [5.0, 2.6, 2.4], at: [0, 0, -6.2], role: 'main' }),
    box({ shape: 'chamfered', chamfer: 0.37, size: [5.1, 2.7, 0.3], at: [0, 0, -5.05], role: 'trim' }),
    box({ shape: 'chamfered', chamfer: 0.3, size: [4.6, 2.2, 0.3], at: [0, 0, -7.5], role: 'dark' }),
    // Cockpit dome.
    tube({ radius: [1.15, 0.95], z: [0, 0.3], axis: 'y', at: [0, 0.7, 2.2], role: 'dark' }),
    tube({ radius: [0.95, 0.6], z: [0.3, 0.75], axis: 'y', at: [0, 0.7, 2.2], role: 'glass' }),
    tube({ radius: [0.6, 0.2], z: [0.75, 0.95], axis: 'y', at: [0, 0.7, 2.2], role: 'glass' }),
    // Cheek sponsons with trim tops and dark hardpoint faces.
    box({ shape: 'chamfered', chamfer: 0.15, size: [1.0, 0.9, 4.0], at: [2.4, -0.1, 1.5], role: 'main', mirror: true }),
    plate({ size: [3.0, 0.5], at: [2.4, 0.37, 1.3], facing: 'y', role: 'trim', mirror: true }),
    box({ size: [1.05, 0.95, 0.25], at: [2.4, -0.1, 3.4], role: 'dark', mirror: true }),
    // Turret ring, ventral bay recess and forward keel.
    tube({ radius: 0.75, z: [0, 0.25], axis: 'y', at: [0, 0.7, -2.5], role: 'dark' }),
    tube({ radius: 0.85, z: [0, 0.1], axis: 'y', at: [0, 0.7, -2.5], role: 'trim' }),
    box({ shape: 'chamfered', chamfer: 0.08, size: [2.6, 0.3, 3.0], at: [0, -0.8, -1.5], role: 'dark' }),
    box({ shape: 'chamfered', chamfer: 0.08, size: [1.2, 0.25, 4.5], at: [0, -0.75, 2.25], role: 'dark' }),
    // Side stripes and top vents.
    plate({ size: [6.5, 0.35], at: [2.11, 0.1, -1.0], facing: 'x', role: 'trim', mirror: true }),
    box({ size: [0.9, 0.2, 1.6], at: [1.3, 0.75, -3.8], role: 'metal', mirror: true }),
    // Twin tail fins with trim tips.
    wing({ points: [[0, -7.3], [0, -5.0], [1.3, -6.5], [1.3, -7.3]], thickness: [0.16, 0.08], at: [1.9, 1.3, 0], rotation: [0, 0, 90], role: 'main', mirror: true }),
    wing({ points: [[0.95, -6.7], [0.95, -7.3], [1.3, -6.5], [1.3, -7.3]], thickness: [0.2, 0.12], at: [1.9, 1.3, 0], rotation: [0, 0, 90], role: 'trim', mirror: true }),
    // Running lights.
    box({ size: [0.3, 0.15, 0.3], at: [1.9, 0.3, 3.1], role: 'glow', mirror: true }),
  ],
  slots: [
    {
      id: 'nose-port',
      label: 'Port nose gun',
      position: [0.6, 0, 7.35],
      facing: 'forward',
      accepts: ['weapon'],
      size: 'small',
      defaultAttachment: 'weapon-autocannon',
    },
    {
      id: 'nose-starboard',
      label: 'Starboard nose gun',
      position: [-0.6, 0, 7.35],
      facing: 'forward',
      accepts: ['weapon'],
      size: 'small',
      defaultAttachment: 'weapon-autocannon',
    },
    {
      id: 'cheek-port',
      label: 'Port cheek hardpoint',
      position: [2.4, -0.1, 3.55],
      facing: 'forward',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'weapon-missile-pod',
    },
    {
      id: 'cheek-starboard',
      label: 'Starboard cheek hardpoint',
      position: [-2.4, -0.1, 3.55],
      facing: 'forward',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'weapon-missile-pod',
    },
    {
      id: 'turret',
      label: 'Dorsal turret ring',
      position: [0, 0.95, -2.5],
      facing: 'up',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'weapon-point-defence',
    },
    {
      id: 'engine-port',
      label: 'Port engine',
      position: [1.35, 0, -7.65],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'large',
      defaultAttachment: 'thruster-heavy-ion',
    },
    {
      id: 'engine-starboard',
      label: 'Starboard engine',
      position: [-1.35, 0, -7.65],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'large',
      defaultAttachment: 'thruster-heavy-ion',
    },
    {
      id: 'ventral',
      label: 'Ventral bay',
      position: [0, -0.95, -1.5],
      facing: 'down',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-container',
    },
  ],
};
