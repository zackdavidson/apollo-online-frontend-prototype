import { describe, expect, it } from 'vitest';
import { createDefaultCatalog } from '../catalog/catalog';
import { EntityType, EXAMINE_OPTION, HUD_INTERFACE_IDS, INTERFACE_IDS, MAP_BUTTONS, Varps, WEAPON_GROUP_BY_INDEX } from '../client/definitions';
import type { ServerMessage } from '../client/messages';
import { ClientWorld } from '../client/world';
import { IdleController } from '../game/controllers';
import { IDLE_INPUT } from '../game/flightController';
import { provingGroundMapDefinition, resolveMap } from '../game/map';
import { createShipState, withAttachment } from '../state/shipState';
import { SandboxServer } from './sandbox';

const catalog = createDefaultCatalog();
const map = resolveMap(provingGroundMapDefinition());
const lines = [{ speaker: 'Nav', text: 'Hello pilot.' }, { speaker: 'Nav', text: 'Fly safe.' }];

/** A sandbox wired to a client world, so every packet it sends is both recorded and applied the way the session applies it. */
function harness() {
  const world = new ClientWorld(catalog);
  world.setMap(map);
  const sent: ServerMessage[] = [];
  const build = withAttachment(createShipState(catalog.getHull('hull-miner')), catalog, catalog.getHull('hull-miner').slots[0]!.id, 'mining-laser');
  const sandbox = new SandboxServer(
    {
      map,
      player: { name: 'Pilot', build },
      npcs: [{ name: 'Navigator', build: createShipState(catalog.getHull('hull-hauler')), x: map.spawn.x + 200, z: map.spawn.z, team: 'guild', stance: 'friendly', invulnerable: true, controller: new IdleController(), respawnDelay: null, dialogue: { range: 30, lines } }],
      catalog,
    },
    (message) => {
      sent.push(message);
      world.apply(message);
    },
  );
  sandbox.login();
  const step = (seconds = 1 / 60, times = 1): void => {
    for (let i = 0; i < times; i++) sandbox.step(seconds);
    world.advance(sandbox.sim.time);
  };
  const messages = (): string[] => sent.filter((m): m is Extract<ServerMessage, { type: 'message-game' }> => m.type === 'message-game').map((m) => m.text);
  return { world, sent, sandbox, step, messages };
}

describe('SandboxServer', () => {
  it('logs the player in, sends appearances on the first tick and keeps the HUD state in varps', () => {
    const { world, sent, sandbox, step } = harness();
    expect(sent[0]).toMatchObject({ type: 'login-response', status: 'ok', playerIndex: 1 });
    expect(world.talents.length).toBeGreaterThan(0);
    step();
    expect(world.player?.appearance?.name).toBe('Pilot');
    expect(world.player?.appearance?.entityType).toBe(EntityType.SHIP);
    const navigator = world.entity('npc', 2);
    expect(navigator?.appearance).toMatchObject({ name: 'Navigator', talkRange: 30, invulnerable: true });
    expect(navigator?.hostile).toBe(false);
    // The miner hull carries no guns, so the beam group is active from the start.
    expect(WEAPON_GROUP_BY_INDEX[world.varp(Varps.ACTIVE_WEAPON_GROUP)]).toBe(sandbox.sim.getShip('player')!.activeGroup);
    expect(world.groundItems.size).toBe(map.caches.length);
    // The Proving Ground ships without a comet; the entity exists exactly when the simulation has one alive.
    expect(world.comet !== null).toBe(sandbox.sim.comet.alive);
  });

  it('moves the player from MOVE_FLIGHT and streams movement every tick', () => {
    const { world, sandbox, step } = harness();
    step();
    sandbox.receive({ type: 'move-flight', seq: 1, thrust: 1, strafe: 0, boost: false, fire: false, aim: null });
    step(1 / 60, 60);
    expect(world.player!.pose.z).toBeGreaterThan(map.spawn.z + 5);
    expect(world.player!.pose.z).toBeCloseTo(sandbox.sim.getShip('player')!.state.z, 1);
    sandbox.receive({ type: 'move-flight', seq: 2, ...IDLE_INPUT });
  });

  it('runs dialogue through the dialogue interface: Talk-to, continue, close', () => {
    const { sandbox, sent, step, messages } = harness();
    step();
    sandbox.receive({ type: 'op-npc', option: 1, index: 2 });
    expect(messages()).toContain("You're too far away to talk.");
    // Park beside the Navigator and try again.
    const player = sandbox.sim.getShip('player')!;
    player.state = { ...player.state, x: map.spawn.x + 180, z: map.spawn.z };
    sandbox.receive({ type: 'op-npc', option: 1, index: 2 });
    expect(sent.at(-1)).toEqual({ type: 'if-opensub', id: HUD_INTERFACE_IDS.dialogue, props: { speaker: 'Nav', text: 'Hello pilot.', portrait: '' } });
    expect(player.held).toBe(true);
    sandbox.receive({ type: 'resume-pause-button', interfaceId: HUD_INTERFACE_IDS.dialogue });
    expect(sent.at(-1)).toMatchObject({ type: 'if-opensub', props: { text: 'Fly safe.' } });
    sandbox.receive({ type: 'resume-pause-button', interfaceId: HUD_INTERFACE_IDS.dialogue });
    expect(sent.at(-1)).toEqual({ type: 'if-closesub', id: HUD_INTERFACE_IDS.dialogue });
    expect(player.held).toBe(false);
    sandbox.receive({ type: 'op-npc', option: EXAMINE_OPTION, index: 2 });
    expect(messages().at(-1)).toContain('Nothing you have can scratch it');
  });

  it('mines a rock through OPLOC, refusing when out of range, and reports rock health as locs', () => {
    const { sandbox, sent, step, messages } = harness();
    step();
    const rock = [...sandbox.sim.rocks.defined][0]!;
    sandbox.receive({ type: 'op-loc', option: EXAMINE_OPTION, locId: rock.id });
    expect(messages().at(-1)).toContain('hp.');
    sandbox.receive({ type: 'op-loc', option: 1, locId: rock.id });
    expect(messages().at(-1)).toBe('You begin mining the rock.');
    const player = sandbox.sim.getShip('player')!;
    player.state = { ...player.state, x: rock.x - 20, z: rock.z, vx: 0, vz: 0 };
    step(1 / 60, 90);
    expect(sent.some((m) => m.type === 'map-projanim' && m.item === 'mining-laser')).toBe(true);
    expect(sent.some((m) => m.type === 'loc-health' && m.id === rock.id)).toBe(true);
    expect(sent.some((m) => m.type === 'hit-splat')).toBe(true);
    expect(rock.hp).toBeLessThan(rock.maxHp);
    // Far away, mining stops with a reason.
    player.state = { ...player.state, x: rock.x - 400 };
    sandbox.receive({ type: 'op-loc', option: 1, locId: rock.id });
    step();
    expect(messages().at(-1)).toMatch(/within \d+ units/);
  });

  it('sets the map flag from a minimap click and warps on the map button', () => {
    const { world, sandbox, sent, step, messages } = harness();
    step();
    sandbox.receive({ type: 'if-button', interfaceId: INTERFACE_IDS.map, button: MAP_BUTTONS.warp });
    expect(messages().at(-1)).toMatch(/No waypoint/);
    const target = { x: map.spawn.x + 150, z: map.spawn.z + 100 };
    sandbox.receive({ type: 'move-minimap-click', ...target });
    expect(world.mapFlag).toEqual(target);
    sandbox.receive({ type: 'if-button', interfaceId: INTERFACE_IDS.map, button: MAP_BUTTONS.warp });
    step();
    expect(world.player?.warp).not.toBeNull();
    step(1 / 60, 240);
    expect(sent.some((m) => (m.type === 'player-info' || m.type === 'npc-info') && m.entities.some((e) => e.index === 1 && e.movement?.teleport))).toBe(true);
    expect(world.player!.pose.x).toBeCloseTo(target.x, 0);
    expect(world.mapFlag).toBeNull();
    // Clicking the flag again clears it.
    sandbox.receive({ type: 'move-minimap-click', x: 10, z: 10 });
    sandbox.receive({ type: 'move-minimap-click', x: 12, z: 10 });
    expect(world.mapFlag).toBeNull();
    expect(messages().at(-1)).toBe('Waypoint cleared.');
  });

  it('echoes public chat as the CHAT mask on the player and opens windows from /ui commands', () => {
    const { sandbox, sent, step } = harness();
    step();
    sandbox.receive({ type: 'message-public', text: 'hello' });
    step();
    expect(sent.some((m) => m.type === 'player-info' && m.entities.some((e) => e.index === 1 && e.chat === 'hello'))).toBe(true);
    sandbox.receive({ type: 'client-cheat', text: 'ui open 4 title=Objectives lines=Mine iron|Talk' });
    expect(sent.at(-1)).toEqual({ type: 'if-opensub', id: 4, props: { title: 'Objectives', lines: ['Mine iron', 'Talk'] } });
    sandbox.receive({ type: 'if-button', interfaceId: HUD_INTERFACE_IDS.weapons, button: 2 });
    step();
    expect(sandbox.sim.getShip('player')!.activeGroup).toBe('beam');
  });
});
