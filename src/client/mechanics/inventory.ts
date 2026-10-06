import { talentAt, talentIndex } from '../definitions';
import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { readItem, writeItem } from '../wire';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * The hold and the talent sheet. The server sends the whole hold whenever
 * it changes and one stat at a time, as RuneScape does; options on a held
 * item (drop, examine) go up as OPHELD.
 */
export const inventory: Mechanic = {
  name: 'inventory',
  outbound: [
    outbound(
      ClientOpcodes.OPHELD,
      'op-held',
      (m, w) => {
        w.writeShort(m.option);
        writeItem(w, m.item);
        w.writeShort(m.slot);
      },
      (r) => ({ option: r.readUnsignedShort(), item: readItem(r), slot: r.readUnsignedShort() }),
    ),
  ],
  inbound: [
    inbound(
      ServerOpcodes.UPDATE_INV_FULL,
      'update-inv-full',
      (m, w) => {
        w.writeShort(m.items.length);
        for (const entry of m.items) {
          writeItem(w, entry.item);
          w.writeInt(entry.count);
        }
      },
      (r) => {
        const count = r.readUnsignedShort();
        const items = [];
        for (let i = 0; i < count; i++) {
          const item = readItem(r);
          const amount = r.readInt();
          if (item) items.push({ item, count: amount });
        }
        return { items };
      },
    ),
    inbound(
      ServerOpcodes.UPDATE_STAT,
      'update-stat',
      (m, w) => w.writeShort(Math.max(0, talentIndex(m.stat))).writeShort(m.level).writeShort(m.base),
      (r) => ({ stat: talentAt(r.readUnsignedShort()) ?? '', level: r.readUnsignedShort(), base: r.readUnsignedShort() }),
    ),
  ],
  apply(world, message) {
    if (!oneOf(message, ['update-inv-full', 'update-stat'])) return false;
    if (message.type === 'update-inv-full') world.setInventory(message.items);
    else if (message.stat) world.stats.set(message.stat, { id: message.stat, level: message.level, base: message.base });
    return true;
  },
};
