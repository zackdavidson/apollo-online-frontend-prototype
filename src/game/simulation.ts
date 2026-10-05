import { BeaconTracker } from './beacons';
import { HazardTracker } from './hazards';
import { INITIAL_BEAM_STATE, addBeamShots, beamReadout, rayCircle, stepBeam, type BeamPhase, type BeamShot } from './beam';
import { applyDamage, circleHit, collisionDamage, createVitals, regenerateShield } from './combat';
import { chunkResource, cometCollideShip, damageComet, spawnComet, stepComet, type CometState, type CometTuning } from './comet';
import type { ControllerView } from './controllers';
import { rollDamage } from './damageRoll';
import type { GameEvent } from './events';
import { DEFAULT_TUNING, IDLE_INPUT, stepFlight, type FlightInput, type FlightTuning } from './flightController';
import { LootField, emptyInventory, type ResourceKind } from './loot';
import { defaultResolvedMap, type ResolvedMap } from './map';
import { ProjectilePool, aimDirection, shipToWorld, type HomingTarget, type Projectile } from './projectiles';
import { createRng, type Rng } from './random';
import { RockField, dropsFor, type Rock } from './rocks';
import { planWarp, sampleWarp } from './warp';
import { WEAPON_GROUPS, type WeaponGroup } from './weapons';
import type { Pick, ShipEntity, ShipId, ShipSpec, Stance } from './world';

export interface WeaponGroupStatus {
  readonly id: WeaponGroup;
  readonly key: string;
  readonly label: string;
  readonly mounts: number;
  readonly active: boolean;
  readonly fill: number;
  readonly phase: BeamPhase;
}

const BEAM_HEIGHT = 0.4;
const HOMING_ROCK_RANGE = 120;

/**
 * The whole game world: ships (players and NPCs alike), rocks, loot, the
 * comet, and the rules that tie them together. Pure TypeScript with no
 * rendering or DOM, so it can run headless in tests or on a server. Each
 * `step` advances time and returns the events that happened, which the
 * presentation layer turns into effects, markers and messages.
 */
export class WorldSim implements ControllerView {
  readonly map: ResolvedMap;
  readonly halfExtent: number;
  readonly rocks: RockField;
  readonly loot: LootField;
  readonly beacons: BeaconTracker;
  readonly hazards: HazardTracker;
  comet: CometState;
  /** Simulation time in seconds. */
  time = 0;
  private readonly cometTuning: CometTuning;
  private readonly cometEnabled: boolean;
  private readonly ships = new Map<ShipId, ShipEntity>();
  private readonly cometRng: Rng;
  private readonly damageRng: Rng;
  private readonly dropRng: Rng;
  private readonly poolSeed: number;
  private poolsCreated = 0;
  /** Events raised between steps (by requests), flushed at the start of the next step. */
  private pending: GameEvent[] = [];

  constructor(map: ResolvedMap = defaultResolvedMap()) {
    this.map = map;
    this.halfExtent = map.halfExtent;
    this.rocks = new RockField(map.rockSpecs);
    this.loot = new LootField(createRng(map.seed + 4));
    for (const cache of map.caches) this.loot.spawn(cache.x, cache.z, cache.resource, cache.count, Infinity);
    this.beacons = new BeaconTracker(map.beacons);
    this.hazards = new HazardTracker(map.hazards);
    this.cometRng = createRng(map.seed + 5);
    this.damageRng = createRng(map.seed + 8);
    this.dropRng = createRng(map.seed + 1);
    this.poolSeed = map.seed + 100;
    this.cometTuning = map.comet.tuning;
    this.cometEnabled = map.comet.enabled;
    this.comet = spawnComet(this.cometRng, map.halfExtent, map.comet.firstNearStart, this.cometTuning);
    if (!this.cometEnabled) this.comet = { ...this.comet, alive: false, respawnAt: Infinity };
  }

  // ---- ships ---------------------------------------------------------------

  addShip(spec: ShipSpec): ShipEntity {
    if (this.ships.has(spec.id)) throw new Error(`Ship "${spec.id}" already exists`);
    const tuning: FlightTuning = { ...DEFAULT_TUNING, halfExtent: this.halfExtent, ...spec.tuning };
    const beamMounts = spec.weaponMounts.filter((mount) => mount.weapon.group === 'beam');
    const pool = new ProjectilePool(spec.weaponMounts, createRng(this.poolSeed + this.poolsCreated++));
    const ship: ShipEntity = {
      spec,
      tuning,
      state: { x: spec.spawn.x, z: spec.spawn.z, vx: 0, vz: 0, heading: spec.spawn.heading, throttle: 0 },
      vitals: createVitals(spec.maxShield, spec.maxHull),
      alive: true,
      stance: spec.stance ?? 'hostile',
      held: false,
      respawnAt: 0,
      input: IDLE_INPUT,
      activeGroup: 'guns',
      pool,
      beamMounts,
      beam: INITIAL_BEAM_STATE,
      beamSeed: 0,
      cargo: emptyInventory(),
      kills: 0,
      deaths: 0,
      warp: null,
      warpMoved: false,
    };
    ship.activeGroup = WEAPON_GROUPS.find((group) => this.groupMountCount(ship, group.id) > 0)?.id ?? 'guns';
    this.ships.set(spec.id, ship);
    return ship;
  }

  removeShip(id: ShipId): void {
    this.ships.delete(id);
  }

  getShip(id: ShipId): ShipEntity | undefined {
    return this.ships.get(id);
  }

  allShips(): IterableIterator<ShipEntity> {
    return this.ships.values();
  }

  /** Drive a ship without a controller (the local player, or a remote one). */
  setInput(id: ShipId, input: FlightInput): void {
    const ship = this.ships.get(id);
    if (ship) ship.input = input;
  }

  selectWeaponGroup(id: ShipId, group: WeaponGroup): boolean {
    const ship = this.ships.get(id);
    if (!ship || this.groupMountCount(ship, group) === 0) return false;
    ship.activeGroup = group;
    return true;
  }

  /** Start a warp; returns false when the ship is dead, already warping, or the target is on top of it. */
  requestWarp(id: ShipId, x: number, z: number): boolean {
    const ship = this.ships.get(id);
    if (!ship || !ship.alive || ship.warp) return false;
    const targetX = Math.max(-this.halfExtent, Math.min(this.halfExtent, x));
    const targetZ = Math.max(-this.halfExtent, Math.min(this.halfExtent, z));
    const plan = planWarp(ship.state.x, ship.state.z, targetX, targetZ, this.time);
    if (!plan) return false;
    ship.warp = plan;
    ship.warpMoved = false;
    this.pending.push({ type: 'warp-started', shipId: id, x: ship.state.x, z: ship.state.z, chargeUntil: plan.chargeUntil });
    return true;
  }

  nearestEnemy(ship: ShipEntity): ShipEntity | null {
    let best: ShipEntity | null = null;
    let bestDistance = Infinity;
    for (const other of this.ships.values()) {
      if (other === ship || !other.alive || other.spec.team === ship.spec.team) continue;
      const distance = Math.hypot(other.state.x - ship.state.x, other.state.z - ship.state.z);
      if (distance < bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    return best;
  }

  groupMountCount(ship: ShipEntity, group: WeaponGroup): number {
    return group === 'beam' ? ship.beamMounts.length : ship.pool.countFor(group);
  }

  weaponStatus(id: ShipId): WeaponGroupStatus[] {
    const ship = this.ships.get(id);
    if (!ship) return [];
    return WEAPON_GROUPS.map((group) => {
      const mounts = this.groupMountCount(ship, group.id);
      const active = ship.activeGroup === group.id;
      if (group.id === 'beam') {
        const profile = ship.beamMounts[0]?.weapon;
        const readout = profile ? beamReadout(ship.beam, profile) : { fill: 1, phase: 'ready' as const };
        return { id: group.id, key: group.key, label: group.label, mounts, active, ...readout };
      }
      const fill = ship.pool.readiness(group.id);
      return { id: group.id, key: group.key, label: group.label, mounts, active, fill, phase: fill >= 1 ? 'ready' : 'cooldown' };
    });
  }

  /** What sits under a world point: the comet, a living ship, a beacon, a dropped stack, a rock, or a hazard. */
  pick(x: number, z: number): Pick {
    if (this.comet.alive && circleHit(x, z, this.comet.x, this.comet.z, this.comet.radius * 1.2)) return { kind: 'comet' };
    for (const ship of this.ships.values()) {
      if (ship.alive && circleHit(x, z, ship.state.x, ship.state.z, ship.spec.radius * 1.15)) return { kind: 'ship', ship };
    }
    const beacon = this.beacons.at(x, z);
    if (beacon) return { kind: 'beacon', beacon };
    const pickup = this.loot.at(x, z);
    if (pickup) return { kind: 'pickup', pickup };
    const rock = this.rocks.hoverAt(x, z);
    if (rock) return { kind: 'rock', rockId: rock.id };
    const hazard = this.hazards.at(x, z);
    return hazard ? { kind: 'hazard', hazard } : null;
  }

  // ---- stepping ------------------------------------------------------------

  step(dt: number): GameEvent[] {
    this.time += dt;
    const now = this.time;
    const events: GameEvent[] = this.pending;
    this.pending = [];

    if (this.cometEnabled) {
      const cometStep = stepComet(this.comet, dt, now, this.halfExtent, this.cometRng, this.cometTuning);
      this.comet = cometStep.comet;
      if (cometStep.entered) events.push({ type: 'comet-entered' });
      if (cometStep.left) events.push({ type: 'comet-left' });
    }

    for (const rock of this.rocks.step(now)) events.push({ type: 'rock-respawned', rock });

    for (const ship of this.ships.values()) {
      if (!ship.spec.controller || !ship.alive) continue;
      ship.input = ship.spec.controller.decide(ship, this, dt, now);
      if (ship.stance === 'friendly' && ship.spec.controller.wantsToAttack?.(ship, this, dt, now)) this.changeStance(ship, 'hostile', null, 'ambush', events);
    }

    for (const ship of [...this.ships.values()]) {
      if (!ship.alive) {
        if (ship.spec.respawnDelay !== null && now >= ship.respawnAt) this.respawn(ship, events);
        continue;
      }
      if (ship.held) {
        ship.input = IDLE_INPUT;
        ship.state = { ...ship.state, vx: 0, vz: 0, throttle: 0 };
      }
      if (ship.warp) this.stepWarp(ship, now, events);
      else this.stepFlightAndCollisions(ship, dt, now, events);
    }

    for (const ship of this.ships.values()) this.stepWeapons(ship, dt, now, events);
    for (const ship of this.ships.values()) this.resolveProjectileHits(ship, dt, now, events);

    for (const ship of this.ships.values()) {
      if (ship.alive && !ship.warp) {
        for (const beacon of this.beacons.update(ship.spec.id, ship.state.x, ship.state.z)) events.push({ type: 'beacon-reached', shipId: ship.spec.id, beacon });
      }
      if (ship.spec.collectsLoot && ship.alive && !ship.warp) {
        const collected = this.loot.step(dt, { x: ship.state.x, z: ship.state.z, radius: ship.spec.radius });
        for (const [kind, count] of Object.entries(collected) as Array<[ResourceKind, number | undefined]>) {
          if (!count) continue;
          ship.cargo = { ...ship.cargo, [kind]: ship.cargo[kind] + count };
          events.push({ type: 'pickup-collected', shipId: ship.spec.id, kind, count });
        }
      }
      this.stepHazards(ship, now, events);
      ship.vitals = regenerateShield(ship.vitals, dt, now);
    }
    if (![...this.ships.values()].some((ship) => ship.spec.collectsLoot && ship.alive && !ship.warp)) this.loot.step(dt, null);

    return events;
  }

  private stepFlightAndCollisions(ship: ShipEntity, dt: number, now: number, events: GameEvent[]): void {
    ship.state = stepFlight(ship.state, ship.input, dt, ship.tuning);
    const collision = this.rocks.resolveShipCollision(ship.state, ship.spec.radius);
    ship.state = collision.state;
    if (collision.impactSpeed > 0) this.collide(ship, collisionDamage(collision.impactSpeed), now, events);
    const bump = cometCollideShip(ship.state, this.comet, ship.spec.radius);
    ship.state = bump.state;
    if (bump.impactSpeed > 0) this.collide(ship, collisionDamage(bump.impactSpeed), now, events);
  }

  private collide(ship: ShipEntity, damage: number, now: number, events: GameEvent[]): void {
    if (damage < 0.5) return;
    events.push({ type: 'ship-collided', shipId: ship.spec.id, x: ship.state.x, z: ship.state.z, damage });
    this.hurt(ship, damage, ship.state.x, ship.state.z, now, null, events);
  }

  /** Spool, blank out (and move), tunnel, reveal. */
  private stepWarp(ship: ShipEntity, now: number, events: GameEvent[]): void {
    const plan = ship.warp;
    if (!plan) return;
    const sample = sampleWarp(plan, now);
    if (sample.phase === 'charging' || sample.phase === 'entering') {
      const diff = Math.atan2(Math.sin(plan.heading - ship.state.heading), Math.cos(plan.heading - ship.state.heading));
      const heading = ship.state.heading + diff * Math.min(1, 0.25 + sample.chargeProgress);
      ship.state = { ...ship.state, vx: 0, vz: 0, heading, throttle: 1.45 };
      return;
    }
    if (!ship.warpMoved) {
      ship.warpMoved = true;
      ship.state = { ...ship.state, x: plan.toX, z: plan.toZ, vx: 0, vz: 0, heading: plan.heading, throttle: 1.0 };
      ship.pool.clear();
      events.push({ type: 'warp-blanked', shipId: ship.spec.id, x: plan.toX, z: plan.toZ });
    }
    if (sample.phase === 'tunnel') return;
    if (sample.phase === 'exiting') {
      if (ship.state.throttle >= 1.0) events.push({ type: 'warp-arrived', shipId: ship.spec.id, x: plan.toX, z: plan.toZ });
      ship.state = { ...ship.state, throttle: Math.max(0.4, ship.state.throttle - 0.02) };
      return;
    }
    ship.warp = null;
    events.push({ type: 'warp-done', shipId: ship.spec.id });
  }

  private stepWeapons(ship: ShipEntity, dt: number, now: number, events: GameEvent[]): void {
    const input = ship.alive && !ship.warp ? ship.input : IDLE_INPUT;
    const firing = input.fire ? (ship.spec.controller ? 'all' : ship.activeGroup) : false;
    const update = ship.pool.update(dt, ship.state, firing, this.homingTargetsFor(ship), input.aim);
    for (const fired of update.fired) events.push({ type: 'shot-fired', shipId: ship.spec.id, x: fired.x, z: fired.z, weapon: fired.mount.weapon });
    for (const expired of update.expired) events.push({ type: 'projectile-expired', x: expired.x, z: expired.z, weapon: expired.weapon });

    const lead = ship.beamMounts[0]?.weapon;
    if (!lead) return;
    const holding = input.fire && (ship.spec.controller ? true : ship.activeGroup === 'beam');
    const beamStep = stepBeam(ship.beam, dt, holding, lead);
    ship.beam = beamStep.state;
    if (!beamStep.fire) return;

    const shots: BeamShot[] = [];
    for (const mount of ship.beamMounts) {
      const profile = mount.weapon;
      const [x0, z0] = shipToWorld(ship.state, mount.position);
      const [fx, fz] = aimDirection(x0, z0, ship.state.heading, input.aim);
      const range = profile.range ?? 60;
      let reach = range;
      let target: { kind: 'ship'; ship: ShipEntity } | { kind: 'rock'; rock: Rock } | { kind: 'comet' } | null = null;
      for (const other of this.ships.values()) {
        if (other === ship || !other.alive || other.spec.team === ship.spec.team) continue;
        const t = rayCircle(x0, z0, fx, fz, other.state.x, other.state.z, other.spec.radius);
        if (t !== null && t < reach) {
          reach = t;
          target = { kind: 'ship', ship: other };
        }
      }
      if (this.comet.alive) {
        const t = rayCircle(x0, z0, fx, fz, this.comet.x, this.comet.z, this.comet.radius);
        if (t !== null && t < reach) {
          reach = t;
          target = { kind: 'comet' };
        }
      }
      for (const rock of this.rocks.overlapping(x0 + fx * range * 0.5, z0 + fz * range * 0.5, range * 0.5 + 8)) {
        const t = rayCircle(x0, z0, fx, fz, rock.x, rock.z, rock.radius);
        if (t !== null && t < reach) {
          reach = t;
          target = { kind: 'rock', rock };
        }
      }
      const x1 = x0 + fx * reach;
      const z1 = z0 + fz * reach;
      shots.push({
        x0,
        z0,
        x1,
        z1,
        timeLeft: profile.beamDuration ?? 0.25,
        duration: profile.beamDuration ?? 0.25,
        style: profile.beamStyle ?? 'lance',
        width: profile.beamWidth ?? 0.5,
        colour: profile.colour,
        y: mount.position[1] + BEAM_HEIGHT,
      });
      if (target?.kind === 'ship') this.hitShip(ship, target.ship, profile.damage, x1, z1, now, events);
      else if (target?.kind === 'comet') this.hitComet(ship, profile.rockDamage ?? profile.damage, profile.mining ?? 1, x1, z1, now, events);
      else if (target?.kind === 'rock') this.hitRock(ship, target.rock, profile.rockDamage ?? profile.damage, profile.mining ?? 1, x1, z1, now, events);
    }
    ship.beamSeed += 1;
    ship.beam = addBeamShots(ship.beam, shots);
    events.push({ type: 'beam-fired', shipId: ship.spec.id, weapon: lead, shots });
  }

  private resolveProjectileHits(ship: ShipEntity, dt: number, now: number, events: GameEvent[]): void {
    const shots = ship.pool.projectiles;
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i]!;
      const victim = this.shipAt(shot, ship);
      if (victim) {
        ship.pool.removeAt(i);
        this.hitShip(ship, victim, shot.weapon.damage, shot.x, shot.z, now, events);
        continue;
      }
      if (this.comet.alive && circleHit(shot.x, shot.z, this.comet.x, this.comet.z, this.comet.radius)) {
        ship.pool.removeAt(i);
        this.hitComet(ship, shot.weapon.rockDamage ?? shot.weapon.damage, shot.weapon.mining ?? 1, shot.x, shot.z, now, events);
        continue;
      }
      // Sweep from where the shot was last frame so it cannot skip a small rock.
      const hit = this.rocks.firstAlong(shot.x - shot.vx * dt, shot.z - shot.vz * dt, shot.x, shot.z);
      if (!hit) continue;
      ship.pool.removeAt(i);
      this.hitRock(ship, hit.rock, shot.weapon.rockDamage ?? shot.weapon.damage, shot.weapon.mining ?? 1, hit.x, hit.z, now, events);
    }
  }

  private shipAt(shot: Projectile, attacker: ShipEntity): ShipEntity | null {
    for (const other of this.ships.values()) {
      if (other === attacker || !other.alive || other.spec.team === attacker.spec.team || other.warp) continue;
      if (circleHit(shot.x, shot.z, other.state.x, other.state.z, other.spec.radius)) return other;
    }
    return null;
  }

  private hitShip(attacker: ShipEntity, victim: ShipEntity, baseDamage: number, x: number, z: number, now: number, events: GameEvent[]): void {
    const roll = rollDamage(baseDamage * (attacker.spec.damageScale ?? 1), this.damageRng);
    const result = this.hurt(victim, roll.amount, x, z, now, attacker, events);
    // An invulnerable target reports a zero hit, so no damage number appears.
    const amount = victim.spec.invulnerable ? 0 : roll.amount;
    events.push({ type: 'hit', attackerId: attacker.spec.id, target: { kind: 'ship', shipId: victim.spec.id }, x, z, amount, kind: roll.kind, absorbed: result.hullDamage <= 0 });
    // Shooting a friendly ship provokes it (if it survived).
    if (victim.alive && victim.stance === 'friendly' && victim.spec.provokable !== false && victim.spec.team !== attacker.spec.team) {
      this.changeStance(victim, 'hostile', attacker.spec.id, 'provoked', events);
    }
  }

  /** Freeze or release a ship: a held ship stops dead, ignores input and cannot fire until released. */
  setHeld(id: ShipId, held: boolean): void {
    const ship = this.ships.get(id);
    if (!ship) return;
    ship.held = held;
    if (held) ship.state = { ...ship.state, vx: 0, vz: 0, throttle: 0 };
  }

  /** Force a stance, e.g. a server script making a trader turn on a pirate. Raises `ship-stance-changed` on the next step. */
  setShipStance(id: ShipId, stance: Stance): void {
    const ship = this.ships.get(id);
    if (ship) this.changeStance(ship, stance, null, 'set', this.pending);
  }

  private changeStance(ship: ShipEntity, stance: Stance, byShipId: ShipId | null, reason: 'provoked' | 'ambush' | 'set', events: GameEvent[]): void {
    if (ship.stance === stance) return;
    ship.stance = stance;
    events.push({ type: 'ship-stance-changed', shipId: ship.spec.id, stance, byShipId, reason });
  }

  private hitRock(attacker: ShipEntity, rock: Rock, baseDamage: number, miningBonus: number, x: number, z: number, now: number, events: GameEvent[]): void {
    const roll = rollDamage(baseDamage, this.damageRng);
    const hit = this.rocks.damage(rock, roll.amount, now);
    events.push({ type: 'hit', attackerId: attacker.spec.id, target: { kind: 'rock', rockId: rock.id }, x, z, amount: roll.amount, kind: roll.kind, absorbed: false });
    if (hit.destroyed) {
      const drops = dropsFor(rock, this.dropRng, miningBonus);
      for (const [kind, count] of Object.entries(drops) as Array<[ResourceKind, number | undefined]>) {
        if (count) this.loot.spawn(rock.x, rock.z, kind, count);
      }
      events.push({ type: 'rock-destroyed', rock, drops });
    } else {
      events.push({ type: 'rock-damaged', rock, x, z });
    }
  }

  private hitComet(attacker: ShipEntity, baseDamage: number, miningBonus: number, x: number, z: number, now: number, events: GameEvent[]): void {
    const roll = rollDamage(baseDamage, this.damageRng);
    const result = damageComet(this.comet, roll.amount, now, this.cometTuning);
    this.comet = result.comet;
    events.push({ type: 'hit', attackerId: attacker.spec.id, target: { kind: 'comet' }, x, z, amount: roll.amount, kind: roll.kind, absorbed: false });
    events.push({ type: 'comet-damaged', x, z });
    const chunks = Math.round(result.chunks * miningBonus);
    for (let i = 0; i < chunks; i++) this.loot.spawn(result.comet.x, result.comet.z, chunkResource(this.cometRng, this.cometTuning), 1);
    if (chunks > 0) events.push({ type: 'comet-chunk', x: result.comet.x, z: result.comet.z, count: chunks });
    if (result.destroyed) {
      for (const [kind, count] of Object.entries(this.cometTuning.finalDrops) as Array<[ResourceKind, number]>) {
        this.loot.spawn(result.comet.x, result.comet.z, kind, Math.round(count * miningBonus));
      }
      events.push({ type: 'comet-destroyed', x: result.comet.x, z: result.comet.z, radius: result.comet.radius });
    }
  }

  /** Apply damage to a ship, handling shields, death and kill credit. */
  /** Gas clouds and the like: entering, leaving, and the damage ticks while inside. */
  private stepHazards(ship: ShipEntity, now: number, events: GameEvent[]): void {
    const active = ship.alive && !ship.warp;
    const update = this.hazards.update(ship.spec.id, ship.state.x, ship.state.z, now, active);
    if (!active) return; // state cleared; a dead or warping ship neither enters nor leaves out loud
    for (const hazard of update.entered) events.push({ type: 'hazard-entered', shipId: ship.spec.id, hazard });
    for (const hazard of update.left) events.push({ type: 'hazard-left', shipId: ship.spec.id, hazard });
    for (const tick of update.ticks) {
      if (!ship.alive) break;
      events.push({ type: 'hazard-damage', shipId: ship.spec.id, hazard: tick.hazard, amount: tick.amount, x: ship.state.x, z: ship.state.z });
      this.hurt(ship, tick.amount, ship.state.x, ship.state.z, now, null, events);
    }
  }

  private hurt(ship: ShipEntity, amount: number, x: number, z: number, now: number, attacker: ShipEntity | null, events: GameEvent[]): ReturnType<typeof applyDamage> {
    // Nothing touches an invulnerable ship: no damage, no event, no death.
    if (ship.spec.invulnerable) return { vitals: ship.vitals, shieldAbsorbed: 0, hullDamage: 0, destroyed: false };
    const result = applyDamage(ship.vitals, amount, now);
    ship.vitals = result.vitals;
    events.push({ type: 'ship-damaged', shipId: ship.spec.id, x, z, shieldAbsorbed: result.shieldAbsorbed, hullDamage: result.hullDamage });
    if (result.destroyed && ship.alive) {
      ship.alive = false;
      ship.deaths += 1;
      ship.warp = null;
      ship.pool.clear();
      ship.respawnAt = now + (ship.spec.respawnDelay ?? 0);
      if (attacker) attacker.kills += 1;
      events.push({ type: 'ship-destroyed', shipId: ship.spec.id, x: ship.state.x, z: ship.state.z, byShipId: attacker?.spec.id ?? null });
      if (ship.spec.respawnDelay === null) {
        this.ships.delete(ship.spec.id);
        events.push({ type: 'ship-removed', shipId: ship.spec.id });
      }
    }
    return result;
  }

  private respawn(ship: ShipEntity, events: GameEvent[]): void {
    ship.alive = true;
    ship.stance = ship.spec.stance ?? 'hostile';
    ship.state = { x: ship.spec.spawn.x, z: ship.spec.spawn.z, vx: 0, vz: 0, heading: ship.spec.spawn.heading, throttle: 0 };
    ship.vitals = createVitals(ship.spec.maxShield, ship.spec.maxHull);
    ship.beam = INITIAL_BEAM_STATE;
    events.push({ type: 'ship-respawned', shipId: ship.spec.id, x: ship.state.x, z: ship.state.z });
  }

  private homingTargetsFor(ship: ShipEntity): HomingTarget[] {
    const targets: HomingTarget[] = [];
    for (const other of this.ships.values()) {
      // Missiles never lock onto friendly ships; aimed shots can still provoke them.
      if (other !== ship && other.alive && other.spec.team !== ship.spec.team && other.stance !== 'friendly') targets.push(other.state);
    }
    if (this.comet.alive) targets.push(this.comet);
    for (const rock of this.rocks.overlapping(ship.state.x, ship.state.z, HOMING_ROCK_RANGE)) targets.push(rock);
    return targets;
  }
}
