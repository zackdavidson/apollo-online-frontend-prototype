import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { readItem, writeItem } from '../wire';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/** Objs: stacks lying in space, added and removed by the server; "Take" goes up as OPOBJ. */
export const objs: Mechanic = {
  name: 'objs',
  outbound: [outbound(ClientOpcodes.OPOBJ, 'op-obj', (m, w) => w.writeShort(m.option).writeInt(m.index), (r) => ({ option: r.readUnsignedShort(), index: r.readInt() }))],
  inbound: [
    inbound(
      ServerOpcodes.OBJ_ADD,
      'obj-add',
      (m, w) => {
        w.writeInt(m.index);
        writeItem(w, m.item);
        w.writeInt(m.count).writeFloat(m.x).writeFloat(m.z).writeBoolean(m.permanent);
      },
      (r) => ({ index: r.readInt(), item: readItem(r), count: r.readInt(), x: r.readFloat(), z: r.readFloat(), permanent: r.readBoolean() }),
    ),
    inbound(ServerOpcodes.OBJ_DEL, 'obj-del', (m, w) => w.writeInt(m.index), (r) => ({ index: r.readInt() })),
  ],
  apply(world, message) {
    if (!oneOf(message, ['obj-add', 'obj-del'])) return false;
    if (message.type === 'obj-add') world.addGroundItem(message.index, message.item, message.count, message.x, message.z, message.permanent);
    else world.groundItems.delete(message.index);
    return true;
  },
};
