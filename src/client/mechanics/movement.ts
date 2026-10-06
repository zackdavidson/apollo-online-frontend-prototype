import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * Movement: the client's flight input, twelve bytes a packet, and the map
 * flag. Thrust and strafe are -1, 0 or 1 from the keys, so they and the
 * buttons pack into one short:
 *
 *   bits 0-1 thrust + 1 · bits 2-3 strafe + 1 · bit 4 boost · bit 5 fire · bit 6 aim present
 */
export function packFlightFlags(thrust: number, strafe: number, boost: boolean, fire: boolean, hasAim: boolean): number {
  const clamp = (v: number): number => Math.max(0, Math.min(2, Math.round(v) + 1));
  return clamp(thrust) | (clamp(strafe) << 2) | (boost ? 1 << 4 : 0) | (fire ? 1 << 5 : 0) | (hasAim ? 1 << 6 : 0);
}

export const movement: Mechanic = {
  name: 'movement',
  outbound: [
    outbound(
      ClientOpcodes.MOVE_FLIGHT,
      'move-flight',
      (m, w) => {
        w.writeShort(m.seq).writeShort(packFlightFlags(m.thrust, m.strafe, m.boost, m.fire, m.aim !== null)).writeFloat(m.aim?.[0] ?? 0).writeFloat(m.aim?.[1] ?? 0);
      },
      (r) => {
        const seq = r.readUnsignedShort();
        const flags = r.readUnsignedShort();
        const aimX = r.readFloat();
        const aimZ = r.readFloat();
        return { seq, thrust: (flags & 3) - 1, strafe: ((flags >> 2) & 3) - 1, boost: !!(flags & (1 << 4)), fire: !!(flags & (1 << 5)), aim: flags & (1 << 6) ? ([aimX, aimZ] as const) : null };
      },
    ),
    outbound(ClientOpcodes.MOVE_MINIMAPCLICK, 'move-minimap-click', (m, w) => w.writeFloat(m.x).writeFloat(m.z), (r) => ({ x: r.readFloat(), z: r.readFloat() })),
  ],
  inbound: [
    inbound(
      ServerOpcodes.SET_MAP_FLAG,
      'set-map-flag',
      (m, w) => w.writeBoolean(m.flag !== null).writeFloat(m.flag?.x ?? 0).writeFloat(m.flag?.z ?? 0),
      (r) => {
        const set = r.readBoolean();
        const x = r.readFloat();
        const z = r.readFloat();
        return { flag: set ? { x, z } : null };
      },
    ),
  ],
  apply(world, message) {
    if (!oneOf(message, ['set-map-flag'])) return false;
    world.mapFlag = message.flag;
    return true;
  },
};
