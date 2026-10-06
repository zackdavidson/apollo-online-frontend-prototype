import type { PacketReader, PacketWriter } from '../../net/packet';
import type { EntityUpdate } from '../messages';
import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { HIT_KIND_CODES, readBuild, readEnum, readSeconds, writeBuild, writeEnum, writeSeconds } from '../wire';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * Entity updating, the way RuneScape does it: one PLAYER_INFO and one
 * NPC_INFO per tick listing every entity that changed, each with a mask
 * of which blocks follow. New entities carry an appearance; departing ones
 * carry only the remove bit. Clicking an option on an entity goes back up
 * as OPPLAYER / OPNPC with the option number.
 *
 *   int serverTimeMs, short count, then per entity:
 *   int index, short masks,
 *   [MOVEMENT]   boolean teleport, float x, z, vx, vz, heading, throttle
 *   [FACE]       float heading
 *   [APPEARANCE] short type, string name, string hullName, string team, float radius, build,
 *                string accent, boolean invulnerable, boolean provokable, float talkRange (<0 none),
 *                float maxShield, float maxHull
 *   [STATUS]     short flags (bit0 alive, bit1 hostile, bit2 held)
 *   [HIT]        float amount, short kind, boolean absorbed, float x, float z, float shield, float hull
 *   [SPOTANIM]   short graphic, float scale, int rgb
 *   [CHAT]       string text
 *   [WARP]       float fromX, fromZ, toX, toZ, distance, heading, int startMs, chargeUntilMs, blankMs, arriveMs, doneMs
 *   [ANIMATION]  short animation
 */
export const Masks = {
  MOVEMENT: 1 << 0,
  FACE: 1 << 1,
  APPEARANCE: 1 << 2,
  STATUS: 1 << 3,
  HIT: 1 << 4,
  SPOTANIM: 1 << 5,
  CHAT: 1 << 6,
  WARP: 1 << 7,
  ANIMATION: 1 << 8,
  REMOVE: 1 << 15,
} as const;

function masksOf(update: EntityUpdate): number {
  let masks = 0;
  if (update.remove) masks |= Masks.REMOVE;
  if (update.movement) masks |= Masks.MOVEMENT;
  if (update.face !== undefined) masks |= Masks.FACE;
  if (update.appearance) masks |= Masks.APPEARANCE;
  if (update.status) masks |= Masks.STATUS;
  if (update.hit) masks |= Masks.HIT;
  if (update.spotAnim) masks |= Masks.SPOTANIM;
  if (update.chat !== undefined) masks |= Masks.CHAT;
  if (update.warp) masks |= Masks.WARP;
  if (update.animation !== undefined) masks |= Masks.ANIMATION;
  return masks;
}

export function writeEntityUpdate(w: PacketWriter, update: EntityUpdate): void {
  w.writeInt(update.index).writeShort(masksOf(update));
  if (update.movement) {
    const m = update.movement;
    w.writeBoolean(m.teleport).writeFloat(m.x).writeFloat(m.z).writeFloat(m.vx).writeFloat(m.vz).writeFloat(m.heading).writeFloat(m.throttle);
  }
  if (update.face !== undefined) w.writeFloat(update.face);
  if (update.appearance) {
    const a = update.appearance;
    w.writeShort(a.entityType).writeString(a.name).writeString(a.hullName).writeString(a.team).writeFloat(a.radius);
    writeBuild(w, a.build);
    w.writeString(a.accent).writeBoolean(a.invulnerable).writeBoolean(a.provokable).writeFloat(a.talkRange ?? -1).writeFloat(a.maxShield).writeFloat(a.maxHull);
  }
  if (update.status) w.writeShort((update.status.alive ? 1 : 0) | (update.status.hostile ? 2 : 0) | (update.status.held ? 4 : 0));
  if (update.hit) {
    const h = update.hit;
    w.writeFloat(h.amount);
    writeEnum(w, HIT_KIND_CODES, h.kind);
    w.writeBoolean(h.absorbed).writeFloat(h.x).writeFloat(h.z).writeFloat(h.shield).writeFloat(h.hull);
  }
  if (update.spotAnim) w.writeShort(update.spotAnim.graphic).writeFloat(update.spotAnim.scale).writeInt(update.spotAnim.rgb);
  if (update.chat !== undefined) w.writeString(update.chat);
  if (update.warp) {
    const p = update.warp;
    w.writeFloat(p.fromX).writeFloat(p.fromZ).writeFloat(p.toX).writeFloat(p.toZ).writeFloat(p.distance).writeFloat(p.heading);
    for (const t of [p.startAt, p.chargeUntil, p.blankAt, p.arriveAt, p.doneAt]) writeSeconds(w, t);
  }
  if (update.animation !== undefined) w.writeShort(update.animation);
}

export function readEntityUpdate(r: PacketReader): EntityUpdate {
  const index = r.readInt();
  const masks = r.readUnsignedShort();
  const update: { -readonly [K in keyof EntityUpdate]: EntityUpdate[K] } = { index };
  if (masks & Masks.REMOVE) update.remove = true;
  if (masks & Masks.MOVEMENT) update.movement = { teleport: r.readBoolean(), x: r.readFloat(), z: r.readFloat(), vx: r.readFloat(), vz: r.readFloat(), heading: r.readFloat(), throttle: r.readFloat() };
  if (masks & Masks.FACE) update.face = r.readFloat();
  if (masks & Masks.APPEARANCE) {
    const entityType = r.readUnsignedShort();
    const name = r.readString();
    const hullName = r.readString();
    const team = r.readString();
    const radius = r.readFloat();
    const build = readBuild(r);
    const accent = r.readString();
    const invulnerable = r.readBoolean();
    const provokable = r.readBoolean();
    const talkRange = r.readFloat();
    update.appearance = { entityType, name, hullName, team, radius, build, accent, invulnerable, provokable, talkRange: talkRange < 0 ? null : talkRange, maxShield: r.readFloat(), maxHull: r.readFloat() };
  }
  if (masks & Masks.STATUS) {
    const flags = r.readUnsignedShort();
    update.status = { alive: !!(flags & 1), hostile: !!(flags & 2), held: !!(flags & 4) };
  }
  if (masks & Masks.HIT) {
    const amount = r.readFloat();
    const kind = readEnum(r, HIT_KIND_CODES, 'normal');
    update.hit = { amount, kind, absorbed: r.readBoolean(), x: r.readFloat(), z: r.readFloat(), shield: r.readFloat(), hull: r.readFloat() };
  }
  if (masks & Masks.SPOTANIM) update.spotAnim = { graphic: r.readUnsignedShort(), scale: r.readFloat(), rgb: r.readInt() };
  if (masks & Masks.CHAT) update.chat = r.readString();
  if (masks & Masks.WARP) {
    const fromX = r.readFloat();
    const fromZ = r.readFloat();
    const toX = r.readFloat();
    const toZ = r.readFloat();
    const distance = r.readFloat();
    const heading = r.readFloat();
    update.warp = { fromX, fromZ, toX, toZ, distance, heading, startAt: readSeconds(r), chargeUntil: readSeconds(r), blankAt: readSeconds(r), arriveAt: readSeconds(r), doneAt: readSeconds(r) };
  }
  if (masks & Masks.ANIMATION) update.animation = r.readUnsignedShort();
  return update;
}

function writeInfo(m: { readonly t: number; readonly entities: readonly EntityUpdate[] }, w: PacketWriter): void {
  writeSeconds(w, m.t);
  w.writeShort(m.entities.length);
  for (const entity of m.entities) writeEntityUpdate(w, entity);
}

function readInfo(r: PacketReader): { t: number; entities: EntityUpdate[] } {
  const t = readSeconds(r);
  const count = r.readUnsignedShort();
  const entities: EntityUpdate[] = [];
  for (let i = 0; i < count; i++) entities.push(readEntityUpdate(r));
  return { t, entities };
}

export const entities: Mechanic = {
  name: 'entities',
  outbound: [
    outbound(ClientOpcodes.OPPLAYER, 'op-player', (m, w) => w.writeShort(m.option).writeInt(m.index), (r) => ({ option: r.readUnsignedShort(), index: r.readInt() })),
    outbound(ClientOpcodes.OPNPC, 'op-npc', (m, w) => w.writeShort(m.option).writeInt(m.index), (r) => ({ option: r.readUnsignedShort(), index: r.readInt() })),
  ],
  inbound: [inbound(ServerOpcodes.PLAYER_INFO, 'player-info', writeInfo, readInfo), inbound(ServerOpcodes.NPC_INFO, 'npc-info', writeInfo, readInfo)],
  apply(world, message) {
    if (!oneOf(message, ['player-info', 'npc-info'])) return false;
    const kind = message.type === 'player-info' ? 'player' : 'npc';
    for (const update of message.entities) world.updateEntity(kind, update, message.t);
    return true;
  },
};
