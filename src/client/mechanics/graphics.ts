import { ServerOpcodes } from '../opcodes';
import { HIT_KIND_CODES, readEnum, writeEnum } from '../wire';
import { inbound, oneOf, type Mechanic } from './mechanic';

/** Graphics at a place in the world, and damage numbers on things that are not entities. Nothing to keep. */
export const graphics: Mechanic = {
  name: 'graphics',
  outbound: [],
  inbound: [
    inbound(
      ServerOpcodes.MAP_ANIM,
      'map-anim',
      (m, w) => w.writeShort(m.graphic).writeFloat(m.x).writeFloat(m.z).writeFloat(m.scale).writeInt(m.rgb),
      (r) => ({ graphic: r.readUnsignedShort(), x: r.readFloat(), z: r.readFloat(), scale: r.readFloat(), rgb: r.readInt() }),
    ),
    inbound(
      ServerOpcodes.HIT_SPLAT,
      'hit-splat',
      (m, w) => {
        w.writeFloat(m.amount);
        writeEnum(w, HIT_KIND_CODES, m.kind);
        w.writeFloat(m.x).writeFloat(m.z);
      },
      (r) => {
        const amount = r.readFloat();
        const kind = readEnum(r, HIT_KIND_CODES, 'normal');
        return { amount, kind, x: r.readFloat(), z: r.readFloat() };
      },
    ),
  ],
  apply: (_world, message) => oneOf(message, ['map-anim', 'hit-splat']),
};
