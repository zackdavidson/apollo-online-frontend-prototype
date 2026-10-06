import { ServerOpcodes } from '../opcodes';
import { inbound, oneOf, type Mechanic } from './mechanic';

/** Varps: numbered server variables the client only displays (score, weapon readiness, which hazard you are in). */
export const varps: Mechanic = {
  name: 'varps',
  outbound: [],
  inbound: [inbound(ServerOpcodes.VARP, 'varp', (m, w) => w.writeInt(m.id).writeInt(m.value), (r) => ({ id: r.readInt(), value: r.readInt() }))],
  apply(world, message) {
    if (!oneOf(message, ['varp'])) return false;
    world.varps.set(message.id, message.value);
    return true;
  },
};
