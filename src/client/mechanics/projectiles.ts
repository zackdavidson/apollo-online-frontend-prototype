import { ServerOpcodes } from '../opcodes';
import { readItem, writeItem } from '../wire';
import { inbound, oneOf, type Mechanic } from './mechanic';

/**
 * Projectiles as RuneScape sends them: a start point, an end point or a
 * target to follow, a delay and a duration; the client flies it. A beam
 * weapon's "projectile" is the line it drew, shown for the duration. A
 * shot that ends early (it hit a rock) is deleted by id.
 */
export const projectiles: Mechanic = {
  name: 'projectiles',
  outbound: [],
  inbound: [
    inbound(
      ServerOpcodes.MAP_PROJANIM,
      'map-projanim',
      (m, w) => {
        w.writeInt(m.id);
        writeItem(w, m.item);
        w.writeFloat(m.x0).writeFloat(m.z0).writeFloat(m.y).writeFloat(m.x1).writeFloat(m.z1).writeInt(m.target ?? -1).writeShort(Math.round(m.delay * 1000)).writeShort(Math.round(m.duration * 1000));
      },
      (r) => {
        const id = r.readInt();
        const item = readItem(r);
        const x0 = r.readFloat();
        const z0 = r.readFloat();
        const y = r.readFloat();
        const x1 = r.readFloat();
        const z1 = r.readFloat();
        const target = r.readInt();
        return { id, item, x0, z0, y, x1, z1, target: target < 0 ? null : target, delay: r.readUnsignedShort() / 1000, duration: r.readUnsignedShort() / 1000 };
      },
    ),
    inbound(ServerOpcodes.PROJ_DEL, 'proj-del', (m, w) => w.writeInt(m.id), (r) => ({ id: r.readInt() })),
  ],
  apply(world, message) {
    if (!oneOf(message, ['map-projanim', 'proj-del'])) return false;
    if (message.type === 'map-projanim') world.addProjectile(message);
    else world.projectiles.delete(message.id);
    return true;
  },
};
