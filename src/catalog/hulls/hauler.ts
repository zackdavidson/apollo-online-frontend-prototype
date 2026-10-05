import { box, plate, taper, tube } from '../../core/primitives';
import type { HullDefinition } from '../../core/types';

/**
 * Barge-class hauler: a long chamfered deck with a tapered bow, a tall stern
 * block for the engines, a forward cab, side fuel tanks and four cargo bays
 * on the deck. Roughly 20 units long.
 */
export const HAULER: HullDefinition = {
  id: 'hull-hauler',
  name: 'Barge',
  role: 'Hauler',
  description: 'Wide flatbed with four cargo bays, twin heavy engines plus a booster, and a defensive nose mount.',
  stats: { mass: 80, cargo: 4 },
  primitives: [
    // Deck, bow and bow cap.
    box({ shape: 'chamfered', chamfer: 0.3, size: [4.6, 1.3, 14.0], at: [0, 0, -1.0], role: 'main' }),
    taper({ chamfer: 0.25, from: { width: 4.2, height: 1.2 }, to: { width: 1.5, height: 0.75, y: 0.05 }, z: [6.0, 9.2], role: 'main' }),
    box({ shape: 'chamfered', chamfer: 0.15, size: [1.55, 0.8, 0.25], at: [0, 0.05, 9.3], role: 'trim' }),
    // Stern block with band and engine face.
    box({ shape: 'chamfered', chamfer: 0.4, size: [6.0, 3.0, 2.6], at: [0, 0.3, -9.0], role: 'main' }),
    box({ shape: 'chamfered', chamfer: 0.42, size: [6.1, 3.1, 0.3], at: [0, 0.3, -7.75], role: 'trim' }),
    box({ shape: 'chamfered', chamfer: 0.3, size: [5.4, 2.5, 0.3], at: [0, 0.3, -10.4], role: 'dark' }),
    // Cab with windscreen and side windows.
    box({ shape: 'chamfered', chamfer: 0.15, size: [2.2, 1.2, 2.6], at: [0, 1.25, 4.4], role: 'main' }),
    taper({ chamfer: 0.12, from: { width: 2.0, height: 1.1, y: 1.25 }, to: { width: 1.5, height: 0.45, y: 1.05 }, z: [5.7, 6.5], role: 'glass' }),
    plate({ size: [1.6, 0.5], at: [1.11, 1.35, 4.4], facing: 'x', role: 'glass', mirror: true }),
    // Deck-edge trim stripes and a dark keel.
    plate({ size: [11.0, 0.4], at: [2.31, 0.15, -2.0], facing: 'x', role: 'trim', mirror: true }),
    box({ shape: 'chamfered', chamfer: 0.1, size: [1.6, 0.4, 12.0], at: [0, -0.8, -1.5], role: 'dark' }),
    // Side fuel tanks with struts.
    tube({ radius: 0.55, z: [-7.0, 2.5], at: [2.75, -0.1, 0], role: 'metal', mirror: true }),
    tube({ radius: [0.55, 0.3], z: [2.5, 3.4], at: [2.75, -0.1, 0], role: 'dark', mirror: true }),
    tube({ radius: [0.3, 0.55], z: [-7.9, -7.0], at: [2.75, -0.1, 0], role: 'dark', mirror: true }),
    tube({ radius: 0.6, z: [-1.6, -1.3], at: [2.75, -0.1, 0], role: 'trim', mirror: true }),
    box({ size: [0.5, 0.3, 6.0], at: [2.45, -0.1, -2.0], role: 'dark', mirror: true }),
    // Skids with struts.
    box({ shape: 'chamfered', chamfer: 0.1, size: [0.6, 0.35, 2.2], at: [1.6, -1.55, -7.5], role: 'dark', mirror: true }),
    box({ shape: 'chamfered', chamfer: 0.1, size: [0.6, 0.35, 2.2], at: [1.6, -1.55, 3.5], role: 'dark', mirror: true }),
    box({ size: [0.25, 0.8, 0.5], at: [1.6, -1.0, -7.5], role: 'metal', mirror: true }),
    box({ size: [0.25, 0.8, 0.5], at: [1.6, -1.0, 3.5], role: 'metal', mirror: true }),
    // Running lights.
    box({ size: [0.3, 0.15, 0.3], at: [2.0, 0.55, 5.9], role: 'glow', mirror: true }),
    box({ size: [0.5, 0.2, 0.15], at: [1.6, 1.5, -7.62], role: 'glow', mirror: true }),
  ],
  slots: [
    {
      id: 'engine-port',
      label: 'Port engine',
      position: [1.7, 0.3, -10.55],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'large',
      defaultAttachment: 'thruster-twin-fusion',
    },
    {
      id: 'engine-starboard',
      label: 'Starboard engine',
      position: [-1.7, 0.3, -10.55],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'large',
      defaultAttachment: 'thruster-twin-fusion',
    },
    {
      id: 'engine-centre',
      label: 'Centre booster',
      position: [0, -0.5, -10.55],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
    },
    {
      id: 'bay-aft-port',
      label: 'Aft port bay',
      position: [1.15, 0.65, -5.2],
      facing: 'up',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-container',
    },
    {
      id: 'bay-aft-starboard',
      label: 'Aft starboard bay',
      position: [-1.15, 0.65, -5.2],
      facing: 'up',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-container',
    },
    {
      id: 'bay-fore-port',
      label: 'Fore port bay',
      position: [1.15, 0.65, -2.2],
      facing: 'up',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-fuel-tank',
    },
    {
      id: 'bay-fore-starboard',
      label: 'Fore starboard bay',
      position: [-1.15, 0.65, -2.2],
      facing: 'up',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-container',
    },
    {
      id: 'roof',
      label: 'Cab roof mount',
      position: [0, 1.85, 4.4],
      facing: 'up',
      accepts: ['utility'],
      size: 'small',
      defaultAttachment: 'utility-radar',
    },
    {
      id: 'nose',
      label: 'Nose mount',
      position: [0, 0.05, 9.45],
      facing: 'forward',
      accepts: ['weapon', 'utility'],
      size: 'small',
      defaultAttachment: 'weapon-point-defence',
    },
  ],
};
