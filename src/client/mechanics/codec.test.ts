import { describe, expect, it } from 'vitest';
import { createDefaultCatalog } from '../../catalog/catalog';
import { encodeFrame, FrameDecoder } from '../../net/framing';
import { PacketReader, PacketWriter } from '../../net/packet';
import { UNDEFINED, VAR_BYTE, VAR_SHORT } from '../../net/sizes';
import { createShipState } from '../../state/shipState';
import { EntityType, Graphics } from '../definitions';
import type { ClientMessage, EntityUpdate, ServerMessage } from '../messages';
import { CLIENT_SIZES, SERVER_SIZES, ServerOpcodes } from '../opcodes';
import { Masks, readEntityUpdate, writeEntityUpdate } from './entities';
import { CLIENT_OPCODES_IN_USE, decodeClientPacket, decodeServerPacket, encodeClientMessage, encodeServerMessage, MECHANICS, SERVER_OPCODES_IN_USE } from './index';
import { packFlightFlags } from './movement';

const catalog = createDefaultCatalog();
const build = createShipState(catalog.getHull('hull-fighter'), { main: '#5a2d2d', trim: '#e8e0c9' }, 'obsidian');
const emptyBuild = { hullId: '', colours: { main: '', trim: '' }, material: '', fitted: {} };
const movement = { teleport: false, x: 1.5, z: -2.25, vx: 10, vz: -4.5, heading: 0.75, throttle: 1 };
const appearance = { entityType: EntityType.SHIP, name: 'Raider', hullName: 'Bastion gunship', team: 'raiders', radius: 4.5, build, accent: '#ff6a3a', invulnerable: false, provokable: true, talkRange: 30, maxShield: 80, maxHull: 120 };
const plan = { fromX: 0, fromZ: 0, toX: 100, toZ: 200, distance: 223.5, heading: 0.5, startAt: 10, chargeUntil: 10.45, blankAt: 10.75, arriveAt: 11.5, doneAt: 12.05 };

/** Every mask at once, and a bare remove. */
const FULL_UPDATE: EntityUpdate = {
  index: 7,
  movement,
  face: 1.25,
  appearance,
  status: { alive: true, hostile: false, held: true },
  hit: { amount: 18, kind: 'critical', absorbed: true, x: 1, z: 2, shield: 10, hull: 90 },
  spotAnim: { graphic: Graphics.EXPLOSION, scale: 2.5, rgb: 0xff6a3a },
  chat: 'Ærø ✓ 🚀 日本',
  warp: plan,
  animation: 1,
};

/** One sample per server message type; the test fails if a type is missing so new packets always get a vector. */
const SERVER_SAMPLES: ServerMessage[] = [
  { type: 'login-response', status: 'ok', message: 'welcome', playerIndex: 7, serverTime: 12.345, tick: 0.05 },
  { type: 'login-response', status: 'server-full', message: 'full', playerIndex: -1, serverTime: 0, tick: 0 },
  { type: 'logout', reason: 'bye' },
  { type: 'rebuild-normal', name: 'Proving Ground', url: 'https://cdn.example/maps/proving-ground.json' },
  { type: 'player-info', t: 3.5, entities: [FULL_UPDATE, { index: 8, remove: true }, { index: 9, movement: { ...movement, teleport: true } }] },
  { type: 'npc-info', t: 3.5, entities: [{ index: 20, appearance: { ...appearance, entityType: EntityType.COMET, name: 'Comet', hullName: '', build: emptyBuild, talkRange: null, maxShield: 0, maxHull: 2400 }, status: { alive: true, hostile: true, held: false } }] },
  { type: 'npc-info', t: 4, entities: [] },
  { type: 'map-projanim', id: 55, item: 'weapon-missile-pod', x0: 1, z0: 2, y: 0.5, x1: 50, z1: -20, target: 7, delay: 0.1, duration: 2.5 },
  { type: 'map-projanim', id: 56, item: 'weapon-laser', x0: 1, z0: 2, y: 0.4, x1: 50, z1: -20, target: null, delay: 0, duration: 0.3 },
  { type: 'proj-del', id: 55 },
  { type: 'map-anim', graphic: Graphics.ROCK_BREAK, x: 1, z: 2, scale: 3, rgb: 0 },
  { type: 'hit-splat', amount: 4, kind: 'glancing', x: 1, z: 2 },
  { type: 'loc-add', id: 'rock-0001' },
  { type: 'loc-del', id: 'rock-0001' },
  { type: 'loc-health', id: 'rock-0001', hp: 12.5 },
  { type: 'obj-add', index: 9, item: 'iron-ore', count: 2, x: 1, z: 2, permanent: false },
  { type: 'obj-del', index: 9 },
  { type: 'update-inv-full', items: [{ item: 'stone', count: 1 }, { item: 'ice', count: 3 }] },
  { type: 'update-stat', stat: 'mining', level: 5, base: 4 },
  { type: 'varp', id: 3, value: -1 },
  { type: 'if-opensub', id: 7, props: { speaker: 'Navigator', text: 'Welcome, pilot.', portrait: 'assets/portraits/navigator.png' } },
  { type: 'if-opensub', id: 3, props: {} },
  { type: 'if-closesub', id: 4 },
  { type: 'if-setprops', id: 1, props: { tab: 2 } },
  { type: 'message-game', kind: 'game', text: 'You begin mining the rock.' },
  { type: 'message-game', kind: 'banner', text: 'Comet mined out' },
  { type: 'set-map-flag', flag: { x: 100, z: -200 } },
  { type: 'set-map-flag', flag: null },
];

const CLIENT_SAMPLES: ClientMessage[] = [
  { type: 'handshake', jwt: 'eyJhbGciOiJIUzI1NiJ9.' + 'x'.repeat(260) + '.sig', build },
  { type: 'logout' },
  { type: 'idle' },
  { type: 'move-flight', seq: 12, thrust: 1, strafe: -1, boost: true, fire: true, aim: [12.5, -3.25] },
  { type: 'move-flight', seq: 65535, thrust: 0, strafe: 0, boost: false, fire: false, aim: null },
  { type: 'move-minimap-click', x: 100.5, z: -200.25 },
  { type: 'op-player', option: 10, index: 3 },
  { type: 'op-npc', option: 1, index: 20 },
  { type: 'op-loc', option: 1, locId: 'rock-0001' },
  { type: 'op-obj', option: 1, index: 9 },
  { type: 'op-held', option: 1, item: 'ice', slot: 4 },
  { type: 'if-button', interfaceId: 2, button: 1 },
  { type: 'close-modal', interfaceId: 4 },
  { type: 'resume-pause-button', interfaceId: 7 },
  { type: 'message-public', text: 'hello there' },
  { type: 'client-cheat', text: 'ui open 4 title=Objectives' },
];

/** Floats on the wire are single precision; compare with that tolerance. */
function roughly(value: unknown): unknown {
  if (typeof value === 'number') return expect.closeTo(value, 3);
  if (Array.isArray(value)) return value.map(roughly);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roughly(v)]));
  return value;
}

describe('packet codecs', () => {
  it('round-trip every server message through real frames', () => {
    const decoder = new FrameDecoder(SERVER_SIZES);
    for (const sample of SERVER_SAMPLES) {
      const packet = encodeServerMessage(sample);
      const frames = decoder.push(encodeFrame(packet.opcode, packet.bytes(), SERVER_SIZES));
      expect(frames).toHaveLength(1);
      const decoded = decodeServerPacket(new PacketReader(frames[0]!.opcode, frames[0]!.payload));
      expect(decoded).toEqual(roughly(sample));
    }
  });

  it('round-trip every client message through real frames', () => {
    const decoder = new FrameDecoder(CLIENT_SIZES);
    for (const sample of CLIENT_SAMPLES) {
      const packet = encodeClientMessage(sample);
      const frames = decoder.push(encodeFrame(packet.opcode, packet.bytes(), CLIENT_SIZES));
      expect(frames).toHaveLength(1);
      const decoded = decodeClientPacket(new PacketReader(frames[0]!.opcode, frames[0]!.payload));
      expect(decoded).toEqual(roughly(sample));
    }
  });

  it('covers every message type with a sample', () => {
    const serverTypes = new Set(MECHANICS.flatMap((m) => m.inbound.map((c) => c.type)));
    const clientTypes = new Set(MECHANICS.flatMap((m) => m.outbound.map((c) => c.type)));
    for (const type of serverTypes) expect(SERVER_SAMPLES.some((s) => s.type === type), `server sample for ${type}`).toBe(true);
    for (const type of clientTypes) expect(CLIENT_SAMPLES.some((s) => s.type === type), `client sample for ${type}`).toBe(true);
  });

  it('matches the size tables: every opcode has one codec and every codec an opcode', () => {
    expect(SERVER_OPCODES_IN_USE).toEqual(SERVER_SIZES.defined());
    expect(CLIENT_OPCODES_IN_USE).toEqual(CLIENT_SIZES.defined());
  });

  it('writes exactly the declared payload size for fixed opcodes and stays under the variable caps', () => {
    for (const sample of SERVER_SAMPLES) {
      const packet = encodeServerMessage(sample);
      const size = SERVER_SIZES.sizeOf(packet.opcode);
      expect(size).not.toBe(UNDEFINED);
      if (size === VAR_BYTE) expect(packet.size, `${sample.type} fits VAR_BYTE`).toBeLessThanOrEqual(255);
      else if (size === VAR_SHORT) expect(packet.size).toBeLessThanOrEqual(65535);
      else expect(packet.size, `${sample.type} fixed size`).toBe(size);
    }
    for (const sample of CLIENT_SAMPLES) {
      const packet = encodeClientMessage(sample);
      const size = CLIENT_SIZES.sizeOf(packet.opcode);
      if (size === VAR_BYTE) expect(packet.size, `${sample.type} fits VAR_BYTE`).toBeLessThanOrEqual(255);
      else if (size === VAR_SHORT) expect(packet.size).toBeLessThanOrEqual(65535);
      else expect(packet.size, `${sample.type} fixed size`).toBe(size);
    }
  });

  it('packs flight input into one short', () => {
    expect(packFlightFlags(1, -1, true, true, true)).toBe(2 | (0 << 2) | (1 << 4) | (1 << 5) | (1 << 6));
    expect(packFlightFlags(0, 0, false, false, false)).toBe(1 | (1 << 2));
    expect(packFlightFlags(-1, 1, false, false, false)).toBe(0 | (2 << 2));
  });

  it('writes only the blocks whose mask bits are set, in mask order', () => {
    const w = new PacketWriter(ServerOpcodes.PLAYER_INFO);
    writeEntityUpdate(w, { index: 5, status: { alive: false, hostile: true, held: false }, face: 2 });
    const bytes = w.bytes();
    // int index, short masks, float face, short status.
    expect(bytes.length).toBe(4 + 2 + 4 + 2);
    const r = new PacketReader(ServerOpcodes.PLAYER_INFO, bytes);
    expect(r.readInt()).toBe(5);
    expect(r.readUnsignedShort()).toBe(Masks.FACE | Masks.STATUS);
    expect(readEntityUpdate(new PacketReader(ServerOpcodes.PLAYER_INFO, bytes))).toEqual({ index: 5, face: 2, status: { alive: false, hostile: true, held: false } });
    const bare = new PacketWriter(ServerOpcodes.PLAYER_INFO);
    writeEntityUpdate(bare, { index: 6, remove: true });
    expect(bare.bytes().length).toBe(6);
  });

  it('drops unknown items on read and keeps the rest', () => {
    const w = new PacketWriter(ServerOpcodes.UPDATE_INV_FULL).writeShort(3).writeShort(0).writeInt(2).writeShort(0xffff).writeInt(9).writeShort(2).writeInt(1);
    const decoded = decodeServerPacket(new PacketReader(w.opcode, w.bytes()));
    expect(decoded).toEqual({ type: 'update-inv-full', items: [{ item: 'stone', count: 2 }, { item: 'ice', count: 1 }] });
  });
});
