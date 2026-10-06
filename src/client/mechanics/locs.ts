import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * Locs: the map's fixed objects. Rocks come from the map file; the server
 * only says when one is mined out (LOC_DEL), comes back (LOC_ADD) or
 * loses health. Options on any loc (mine a rock, examine a beacon) go up
 * as OPLOC with the loc's id from the map.
 */
export const locs: Mechanic = {
  name: 'locs',
  outbound: [outbound(ClientOpcodes.OPLOC, 'op-loc', (m, w) => w.writeShort(m.option).writeString(m.locId), (r) => ({ option: r.readUnsignedShort(), locId: r.readString() }))],
  inbound: [
    inbound(ServerOpcodes.LOC_ADD, 'loc-add', (m, w) => w.writeString(m.id), (r) => ({ id: r.readString() })),
    inbound(ServerOpcodes.LOC_DEL, 'loc-del', (m, w) => w.writeString(m.id), (r) => ({ id: r.readString() })),
    inbound(ServerOpcodes.LOC_HEALTH, 'loc-health', (m, w) => w.writeString(m.id).writeFloat(m.hp), (r) => ({ id: r.readString(), hp: r.readFloat() })),
  ],
  apply(world, message) {
    if (!oneOf(message, ['loc-add', 'loc-del', 'loc-health'])) return false;
    const rock = world.rocks?.get(message.id);
    if (!rock) return true;
    if (message.type === 'loc-add') rock.hp = rock.maxHp;
    else if (message.type === 'loc-del') rock.hp = 0;
    else rock.hp = message.hp;
    return true;
  },
};
