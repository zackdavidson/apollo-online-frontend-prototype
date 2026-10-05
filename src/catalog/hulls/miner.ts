import { box, plate, taper } from '../../core/primitives';
import type { HullDefinition } from '../../core/types';

/**
 * Mule-class miner: a chamfered industrial body with a wider engine block,
 * a cab with a raked windscreen, flank racks for cargo, skids underneath and
 * a heavy collar on the nose for the tool. Roughly 13 units long.
 */
export const MINER: HullDefinition = {
  id: 'hull-miner',
  name: 'Mule',
  role: 'Miner',
  description: 'Industrial workhorse. Forward tool mount, flank cargo racks, one heavy engine plus auxiliaries.',
  stats: { mass: 45, mining: 2, cargo: 2 },
  primitives: [
    // Body, engine block, bands and engine face.
    box({ shape: 'chamfered', chamfer: 0.4, size: [3.0, 2.4, 8.0], at: [0, 0, -0.5], role: 'main' }),
    box({ shape: 'chamfered', chamfer: 0.35, size: [3.8, 2.8, 2.2], at: [0, 0, -5.6], role: 'main' }),
    box({ shape: 'chamfered', chamfer: 0.37, size: [3.9, 2.9, 0.3], at: [0, 0, -4.55], role: 'trim' }),
    box({ shape: 'chamfered', chamfer: 0.3, size: [3.4, 2.4, 0.3], at: [0, 0, -6.75], role: 'dark' }),
    // Nose collar for the tool, with a trim rim and hazard stripes.
    taper({ chamfer: 0.3, from: { width: 2.8, height: 2.2 }, to: { width: 2.3, height: 1.9 }, z: [3.5, 4.8], role: 'dark' }),
    box({ shape: 'chamfered', chamfer: 0.2, size: [2.4, 2.0, 0.25], at: [0, 0, 4.85], role: 'trim' }),
    plate({ size: [0.3, 1.6], at: [0.6, -0.35, 4.99], facing: 'z', role: 'dark', mirror: true }),
    plate({ size: [0.3, 1.6], at: [0, -0.35, 4.99], facing: 'z', role: 'dark' }),
    // Cab with windscreen and side windows.
    box({ shape: 'chamfered', chamfer: 0.15, size: [1.9, 0.9, 2.6], at: [0, 1.6, 1.4], role: 'main' }),
    taper({ chamfer: 0.12, from: { width: 1.7, height: 0.8, y: 1.6 }, to: { width: 1.3, height: 0.35, y: 1.45 }, z: [2.7, 3.45], role: 'glass' }),
    plate({ size: [1.4, 0.4], at: [0.96, 1.7, 1.5], facing: 'x', role: 'glass', mirror: true }),
    box({ size: [0.6, 0.25, 1.2], at: [0.9, 1.3, -2.5], role: 'metal', mirror: true }),
    // Flank racks and trim stripes.
    box({ shape: 'chamfered', chamfer: 0.1, size: [0.35, 1.8, 3.6], at: [1.6, -0.1, -1.0], role: 'dark', mirror: true }),
    plate({ size: [5.6, 0.45], at: [1.52, 0.65, -0.6], facing: 'x', role: 'trim', mirror: true }),
    plate({ size: [1.2, 0.3], at: [1.52, -0.6, 2.6], facing: 'x', role: 'trim', mirror: true }),
    // Skids with struts.
    box({ shape: 'chamfered', chamfer: 0.08, size: [0.5, 0.3, 2.6], at: [1.0, -1.45, -2.6], role: 'dark', mirror: true }),
    box({ shape: 'chamfered', chamfer: 0.08, size: [0.5, 0.3, 2.0], at: [1.0, -1.45, 2.2], role: 'dark', mirror: true }),
    box({ size: [0.2, 0.3, 0.5], at: [1.0, -1.3, -2.6], role: 'metal', mirror: true }),
    box({ size: [0.2, 0.3, 0.5], at: [1.0, -1.3, 2.2], role: 'metal', mirror: true }),
    // Headlights.
    box({ size: [0.35, 0.2, 0.15], at: [0.85, 0.7, 4.95], role: 'glow', mirror: true }),
  ],
  slots: [
    {
      id: 'tool',
      label: 'Forward tool mount',
      position: [0, 0, 5.0],
      facing: 'forward',
      accepts: ['mining'],
      size: 'large',
      defaultAttachment: 'mining-drill',
    },
    {
      id: 'engine-main',
      label: 'Main engine',
      position: [0, -0.25, -6.9],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'large',
      defaultAttachment: 'thruster-heavy-ion',
    },
    {
      id: 'engine-aux-port',
      label: 'Port auxiliary engine',
      position: [1.4, 0.95, -6.9],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
    },
    {
      id: 'engine-aux-starboard',
      label: 'Starboard auxiliary engine',
      position: [-1.4, 0.95, -6.9],
      facing: 'aft',
      accepts: ['thruster'],
      size: 'small',
    },
    {
      id: 'cargo-port',
      label: 'Port cargo rack',
      position: [1.78, -0.1, -1.0],
      facing: 'right',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-ore-hopper',
    },
    {
      id: 'cargo-starboard',
      label: 'Starboard cargo rack',
      position: [-1.78, -0.1, -1.0],
      facing: 'left',
      accepts: ['cargo'],
      size: 'large',
      defaultAttachment: 'cargo-ore-hopper',
    },
    {
      id: 'roof',
      label: 'Cab roof mount',
      position: [0, 2.05, 0.8],
      facing: 'up',
      accepts: ['utility'],
      size: 'small',
      defaultAttachment: 'utility-antenna',
    },
  ],
};
