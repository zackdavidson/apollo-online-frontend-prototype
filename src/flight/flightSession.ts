import { meshBounds, type SurfaceMesh } from '../core/mesh';
import type { ShipColours } from '../core/palette';
import { COMBAT_TUNING } from '../game/combat';
import { COMET_RESOURCES } from '../game/comet';
import { TurretAi, type ShipController } from '../game/controllers';
import { formatHit } from '../game/damageRoll';
import type { GameEvent } from '../game/events';
import { speedOf } from '../game/flightController';
import { RESOURCES, type ResourceKind } from '../game/loot';
import { defaultResolvedMap, type ResolvedMap } from '../game/map';
import { formatMapCoords } from '../game/mapCoords';
import { shipToWorld, type WeaponMount } from '../game/projectiles';
import { ROCK_KINDS, type Rock } from '../game/rocks';
import { WorldSim } from '../game/simulation';
import { sampleWarp } from '../game/warp';
import { WEAPON_GROUPS } from '../game/weapons';
import type { Pick, ShipEntity, ShipId } from '../game/world';
import { HitMarkers, type HitStyle } from '../hud/hitMarkers';
import { FlightHud } from '../hud/hud';
import { FlightInputTracker } from '../hud/input';
import { WorldLabels } from '../hud/labels';
import type { BeamVisual } from '../scene/beamRenderer';
import { GameScene, type ChargeGlow } from '../scene/gameScene';
import type { BarEntry } from '../scene/healthBars';
import { PIXEL_LEVELS, type PixelScope } from '../scene/pixelate';
import { rockTop } from '../scene/rockRenderer';

/** A ship as the hangar hands it over: looks plus loadout. */
export interface SessionShip {
  readonly name: string;
  readonly hullName: string;
  readonly surface: SurfaceMesh;
  readonly colours: ShipColours;
  readonly weaponMounts: readonly WeaponMount[];
}

/** An NPC to drop into the world. Sensible combat defaults; override what you need. */
export interface NpcSpawn extends SessionShip {
  readonly x: number;
  readonly z: number;
  readonly heading?: number;
  readonly team?: string;
  readonly maxShield?: number;
  readonly maxHull?: number;
  readonly respawnDelay?: number | null;
  readonly damageScale?: number;
  readonly controller?: ShipController;
  readonly accent?: string;
}

export interface FlightSessionOptions {
  readonly player: SessionShip;
  readonly npcs?: readonly NpcSpawn[];
  /** The sector to fly in; defaults to the starter sector. */
  readonly map?: ResolvedMap;
  readonly onExit: () => void;
}

const PLAYER_ID = 'player';
const MAX_FRAME_DT = 0.05;
const TILT_DEGREES_PER_SECOND = 50;
const LABEL_HEIGHT = 3.4;
const ROCK_BAR_RANGE = 220;
/** Only rocks this close to the player are pushed to the scene: the client's "in view" set a server would stream. */
const ROCK_VIEW_RADIUS = 340;
const ROCK_CHIP_COLOUR = '#9a8f80';
const MISSILE_SMOKE = '#8a8a8a';
const SHIELD_COLOUR = '#5fb4ff';
const COMET_ACCENT = '#9fd8ff';
const NPC_ACCENT = '#ff6a3a';
const PIXEL_SETTINGS_KEY = 'shipyard.pixelation';
const ROCK_BAR_COLOURS: Readonly<Record<Rock['kind'], string>> = {
  stone: '#d9b26a',
  iron: '#9fb4c8',
  ice: '#8fe3ff',
  crystal: '#d9a6ff',
  giant: '#ff9a5a',
};

/** Hit and collision radius for a hull from its mesh. */
export function shipRadiusFor(surface: SurfaceMesh): number {
  const bounds = meshBounds(surface);
  return 0.36 * Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
}

/**
 * Runs one flight: owns the simulation, the scene, the HUD and the input,
 * and is the only place that knows about all three. Every frame it feeds
 * player input into the simulation, steps it, turns the resulting events
 * into effects and messages, and pushes the new state into the scene.
 * NPCs can be added or removed at any time through `spawnNpc`.
 */
export class FlightSession {
  readonly sim: WorldSim;
  readonly scene: GameScene;
  private readonly hud: FlightHud;
  private readonly labels: WorldLabels;
  private readonly hitMarkers: HitMarkers;
  private readonly input: FlightInputTracker;
  private readonly accents = new Map<ShipId, string>();
  private hovered: Pick = null;
  private message: { text: string; until: number } | null = null;
  private npcCounter = 0;
  private frameHandle = 0;
  private lastTime = performance.now();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    options: FlightSessionOptions,
  ) {
    container.replaceChildren();
    const map = options.map ?? defaultResolvedMap();
    this.sim = new WorldSim(map);
    this.scene = new GameScene(container, { seed: map.seed, halfExtent: map.halfExtent, boundaryColour: options.player.colours.trim, scenery: map.scenery });
    this.scene.setBeacons(map.beacons);
    const labelRoot = document.createElement('div');
    labelRoot.className = 'flight-labels';
    const hudRoot = document.createElement('div');
    hudRoot.className = 'flight-hud';
    container.append(labelRoot, hudRoot);
    this.labels = new WorldLabels(labelRoot);
    this.hitMarkers = new HitMarkers(labelRoot);
    this.loadPixelSettings();

    const player = options.player;
    const radius = shipRadiusFor(player.surface);
    this.sim.addShip({
      id: PLAYER_ID,
      name: player.name,
      hullName: player.hullName,
      team: 'players',
      radius,
      weaponMounts: player.weaponMounts,
      maxShield: COMBAT_TUNING.playerShield,
      maxHull: COMBAT_TUNING.playerHull,
      spawn: map.spawn,
      respawnDelay: COMBAT_TUNING.playerRespawnDelay,
      collectsLoot: true,
    });
    this.scene.addShip(PLAYER_ID, { surface: player.surface, colours: player.colours, accent: player.colours.trim, radius });
    this.accents.set(PLAYER_ID, player.colours.trim);
    for (const npc of options.npcs ?? []) this.spawnNpc(npc);

    this.hud = new FlightHud(hudRoot, {
      onExit: options.onExit,
      onToggleCamera: () => this.scene.camera.toggleMode(),
      onPixelLevel: (index) => this.setPixelation(index, this.scene.pixelScope),
      onPixelScope: (scope) => this.setPixelation(this.scene.pixelLevel, scope),
      onTeleport: (x, z) => this.sim.requestWarp(PLAYER_ID, x, z),
    });
    this.input = new FlightInputTracker(this.scene.surface, {
      onExit: options.onExit,
      onToggleCamera: () => this.scene.camera.toggleMode(),
      onZoom: (factor) => this.scene.camera.zoomBy(factor),
      onSelectGroup: (index) => {
        const group = WEAPON_GROUPS[index];
        if (group) this.sim.selectWeaponGroup(PLAYER_ID, group.id);
      },
      onCyclePixelation: () => this.setPixelation((this.scene.pixelLevel + 1) % PIXEL_LEVELS.length, this.scene.pixelScope),
      onTogglePixelScope: () => this.setPixelation(this.scene.pixelLevel, this.scene.pixelScope === '3d' ? 'all' : '3d'),
    });
    this.input.attach();
    this.scene.camera.snapTo(map.spawn.x, map.spawn.z);
    this.message = { text: map.name, until: 3 };
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  /** Add an NPC ship to the world and the scene. Returns its id for later removal. */
  spawnNpc(npc: NpcSpawn): ShipId {
    const id = `npc-${++this.npcCounter}`;
    const radius = shipRadiusFor(npc.surface);
    this.sim.addShip({
      id,
      name: npc.name,
      hullName: npc.hullName,
      team: npc.team ?? 'raiders',
      radius,
      weaponMounts: npc.weaponMounts,
      maxShield: npc.maxShield ?? COMBAT_TUNING.enemyShield,
      maxHull: npc.maxHull ?? COMBAT_TUNING.enemyHull,
      spawn: { x: npc.x, z: npc.z, heading: npc.heading ?? Math.PI },
      respawnDelay: npc.respawnDelay === undefined ? COMBAT_TUNING.enemyRespawnDelay : npc.respawnDelay,
      tuning: { turnRate: COMBAT_TUNING.enemyTurnRate, accel: 0, strafeAccel: 0, reverseAccel: 0 },
      damageScale: npc.damageScale ?? 0.35,
      controller: npc.controller ?? new TurretAi(),
    });
    const accent = npc.accent ?? NPC_ACCENT;
    this.scene.addShip(id, { surface: npc.surface, colours: npc.colours, accent, radius });
    this.accents.set(id, accent);
    return id;
  }

  removeShip(id: ShipId): void {
    if (id === PLAYER_ID) return;
    this.sim.removeShip(id);
    this.scene.removeShip(id);
    this.labels.remove(id);
    this.accents.delete(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.input.detach();
    this.labels.dispose();
    this.hitMarkers.dispose();
    this.scene.dispose();
    this.container.replaceChildren();
  }

  // ---- frame ---------------------------------------------------------------

  private readonly frame = (nowMs: number): void => {
    const dt = Math.min(MAX_FRAME_DT, (nowMs - this.lastTime) / 1000);
    this.lastTime = nowMs;
    const time = nowMs / 1000;

    const { flight, cameraTilt, pointerPx } = this.input.snapshot((x, y) => this.scene.aimPoint(x, y));
    this.sim.setInput(PLAYER_ID, flight);
    if (cameraTilt !== 0) this.scene.camera.tiltBy(cameraTilt * TILT_DEGREES_PER_SECOND * dt);

    for (const event of this.sim.step(dt)) this.handleEvent(event);
    this.smokeTrails();
    if (this.message && this.sim.time > this.message.until) this.message = null;

    this.hovered = flight.aim ? this.sim.pick(flight.aim[0], flight.aim[1]) : null;
    this.hud.setTooltip(this.tooltipFor(this.hovered, pointerPx));
    this.pushState(time);

    const player = this.sim.getShip(PLAYER_ID)!;
    this.scene.camera.update(player.state.x, player.state.z, player.state.vx, player.state.vz, dt);
    this.scene.update(dt, time);
    this.updateOverlays(dt, player);
    this.scene.render();
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /** Mirror the simulation into the scene. */
  private pushState(time: number): void {
    const player = this.sim.getShip(PLAYER_ID)!;
    const projectiles = [];
    const beams: BeamVisual[] = [];
    for (const ship of this.sim.allShips()) {
      if (!this.scene.hasShip(ship.spec.id)) continue;
      const warp = ship.warp ? sampleWarp(ship.warp, this.sim.time) : null;
      const spooling = warp !== null && (warp.phase === 'charging' || warp.phase === 'entering');
      this.scene.setShipPose(ship.spec.id, {
        x: ship.state.x,
        z: ship.state.z,
        heading: ship.state.heading,
        throttle: ship.alive ? ship.state.throttle : 0,
        visible: ship.alive,
        jitter: spooling ? 0.14 * (warp?.chargeProgress ?? 0) : 0,
      });
      this.scene.setShipShield(ship.spec.id, ship.vitals.maxShield > 0 ? ship.vitals.shield / ship.vitals.maxShield : 0);
      this.scene.setShipOutlined(ship.spec.id, this.hovered?.kind === 'ship' && this.hovered.ship === ship);
      projectiles.push(...ship.pool.projectiles);
      ship.beam.shots.forEach((shot, index) =>
        beams.push({
          x0: shot.x0,
          z0: shot.z0,
          x1: shot.x1,
          z1: shot.z1,
          y: shot.y ?? 0.4,
          width: shot.width ?? 0.5,
          colour: shot.colour ?? '#7fe3ff',
          fade: Math.min(1, shot.timeLeft / shot.duration),
          style: shot.style ?? 'lance',
          seed: ship.beamSeed * 10 + index,
        }),
      );
    }
    this.scene.syncProjectiles(projectiles);
    this.scene.syncBeams(beams);
    this.scene.syncRocks(this.sim.rocks.inView(player.state.x, player.state.z, ROCK_VIEW_RADIUS), this.hovered?.kind === 'rock' ? this.hovered.rockId : null);
    this.scene.syncLoot(this.sim.loot.pickups);
    this.scene.syncComet(this.sim.comet, this.hovered?.kind === 'comet');
    this.scene.syncHealthBars(this.healthBars(player));

    // Charge glows on the player's beam muzzles.
    const glows: ChargeGlow[] = player.alive && player.beam.charge > 0
      ? player.beamMounts.map((mount) => {
          const [x, z] = shipToWorld(player.state, mount.position);
          return { x, y: mount.position[1], z, colour: mount.weapon.colour, charge: player.beam.charge };
        })
      : [];
    this.scene.setChargeGlows(glows, time);

    // Warp blank-out follows the player's warp.
    const warp = player.warp ? sampleWarp(player.warp, this.sim.time) : null;
    this.scene.setWarpOverlay(warp?.overlay ?? 0, warp?.intensity ?? 0);
  }

  private healthBars(player: ShipEntity): BarEntry[] {
    const entries: BarEntry[] = [];
    const comet = this.sim.comet;
    if (comet.alive && Math.hypot(comet.x - player.state.x, comet.z - player.state.z) < ROCK_BAR_RANGE * 2) {
      entries.push({ x: comet.x, y: comet.radius + 2.2, z: comet.z, width: 12, height: 0.7, fraction: comet.hp / comet.maxHp, colour: COMET_ACCENT });
    }
    for (const rock of this.sim.rocks.overlapping(player.state.x, player.state.z, ROCK_BAR_RANGE)) {
      entries.push({
        x: rock.x,
        y: rockTop(rock) + 0.9 + rock.radius * 0.15,
        z: rock.z,
        width: Math.min(7, Math.max(1.8, rock.radius * 1.1)),
        height: rock.kind === 'giant' ? 0.5 : 0.34,
        fraction: rock.hp / rock.maxHp,
        colour: ROCK_BAR_COLOURS[rock.kind],
      });
    }
    return entries;
  }

  /** Labels, hit markers, comet arrow and the HUD readout. */
  private updateOverlays(dt: number, player: ShipEntity): void {
    const { width, height } = this.scene.size;
    this.hitMarkers.update(dt, this.scene.camera.camera, width, height);
    for (const ship of this.sim.allShips()) {
      const screen = ship.alive ? this.scene.project(ship.state.x, LABEL_HEIGHT, ship.state.z) : null;
      this.labels.update(ship.spec.id, screen, { name: ship.spec.name, vitals: ship.vitals, accent: this.accents.get(ship.spec.id) ?? NPC_ACCENT });
    }

    const comet = this.sim.comet;
    if (comet.alive) {
      const { screen, onScreen } = this.scene.projectRaw(comet.x, 0.5, comet.z);
      this.hud.setCometIndicator({ screen, onScreen, distance: Math.hypot(comet.x - player.state.x, comet.z - player.state.z), width, height });
    } else {
      this.hud.setCometIndicator(null);
    }

    const enemies = [...this.sim.allShips()]
      .filter((ship) => ship.alive && ship.spec.team !== player.spec.team)
      .map((ship) => ({ x: ship.state.x, z: ship.state.z }))
      .sort((a, b) => Math.hypot(a.x - player.state.x, a.z - player.state.z) - Math.hypot(b.x - player.state.x, b.z - player.state.z));
    this.hud.update({
      x: player.state.x,
      z: player.state.z,
      heading: player.state.heading,
      speed: speedOf(player.state),
      mode: this.scene.cameraMode,
      tiltDegrees: this.scene.camera.tiltDegrees,
      zoomDistance: this.scene.camera.zoomDistance,
      halfExtent: this.sim.halfExtent,
      planets: this.scene.planetPositions,
      rocks: [...this.sim.rocks.defined],
      rocksBroken: this.sim.rocks.brokenCount,
      kills: player.kills,
      deaths: player.deaths,
      enemies,
      message: this.message?.text ?? (player.warp ? this.warpMessage(player) : null),
      weapons: this.sim.weaponStatus(PLAYER_ID),
      cargo: player.cargo,
      pixelLevel: this.scene.pixelLevel,
      pixelScope: this.scene.pixelScope,
      beacons: this.sim.beacons.beacons,
      comet: comet.alive ? comet : null,
    });
  }

  private warpMessage(player: ShipEntity): string | null {
    if (!player.warp) return null;
    const sample = sampleWarp(player.warp, this.sim.time);
    if (sample.phase === 'tunnel') return `In warp · ${Math.max(0, player.warp.arriveAt - this.sim.time).toFixed(1)}s`;
    if (sample.phase === 'charging' || sample.phase === 'entering') return 'Spooling warp drive';
    return null;
  }

  // ---- events --------------------------------------------------------------

  private handleEvent(event: GameEvent): void {
    const now = this.sim.time;
    switch (event.type) {
      case 'shot-fired':
        this.scene.flash(event.x, event.z, event.weapon.muzzleFlash);
        return;
      case 'projectile-expired':
        if (event.weapon.kind === 'flak') {
          this.scene.flash(event.x, event.z, 1.3);
          this.scene.burst(event.x, event.z, 4, 5, event.weapon.colour);
        }
        return;
      case 'beam-fired':
        for (const shot of event.shots) {
          this.scene.flash(shot.x0, shot.z0, event.weapon.muzzleFlash);
          this.scene.burst(shot.x1, shot.z1, 10, 9, event.weapon.colour);
          if (event.weapon.beamStyle === 'siege') {
            this.scene.shockwave(shot.x0, shot.z0, 4, event.weapon.colour);
            this.scene.shockwave(shot.x1, shot.z1, 6, event.weapon.colour);
          }
        }
        return;
      case 'hit': {
        const style: HitStyle =
          event.target.kind === 'ship' ? (event.target.shipId === PLAYER_ID ? 'incoming' : event.absorbed ? 'shield' : 'hull') : 'rock';
        if (event.amount > 0) this.hitMarkers.spawn(event.x, 1.2, event.z, formatHit(event.amount), style, event.kind);
        return;
      }
      case 'ship-damaged': {
        if (event.shieldAbsorbed > 0) this.scene.shipShieldHit(event.shipId, event.x, event.z);
        this.scene.flash(event.x, event.z, event.hullDamage > 0 ? 2.4 : 1.6);
        if (event.hullDamage > 0) this.scene.burst(event.x, event.z, 8, 9, this.scene.shipColours(event.shipId)?.trim ?? '#ffffff');
        return;
      }
      case 'ship-collided':
        this.hitMarkers.spawn(event.x, 1.2, event.z, formatHit(event.damage), event.shipId === PLAYER_ID ? 'incoming' : 'hull', 'normal');
        return;
      case 'ship-destroyed': {
        const colours = this.scene.shipColours(event.shipId);
        const ship = this.sim.getShip(event.shipId);
        this.scene.explode(event.x, event.z, ship?.spec.radius ?? 3, colours?.main ?? '#888888', this.accents.get(event.shipId) ?? NPC_ACCENT);
        this.message =
          event.shipId === PLAYER_ID
            ? { text: 'Ship destroyed. Respawning...', until: now + COMBAT_TUNING.playerRespawnDelay }
            : { text: `${ship?.spec.name ?? 'Enemy'} destroyed`, until: now + 3 };
        return;
      }
      case 'ship-respawned': {
        const radius = this.sim.getShip(event.shipId)?.spec.radius ?? 3;
        this.scene.flash(event.x, event.z, radius * 3);
        this.scene.shockwave(event.x, event.z, radius * 3, SHIELD_COLOUR);
        if (event.shipId === PLAYER_ID) this.scene.camera.snapTo(event.x, event.z);
        return;
      }
      case 'ship-removed':
        this.scene.removeShip(event.shipId);
        this.labels.remove(event.shipId);
        return;
      case 'rock-damaged':
        this.scene.burst(event.x, event.z, 6, 7, chipColour(event.rock));
        this.scene.flash(event.x, event.z, 1.6);
        return;
      case 'rock-destroyed': {
        const rock = event.rock;
        this.scene.burst(rock.x, rock.z, 14 + Math.round(rock.radius * 6), 6 + rock.radius * 2, chipColour(rock));
        this.scene.flash(rock.x, rock.z, rock.radius * 2.5);
        if (rock.radius > 3) this.scene.shockwave(rock.x, rock.z, rock.radius * 3, '#c9b89a');
        return;
      }
      case 'rock-respawned':
        this.scene.flash(event.rock.x, event.rock.z, event.rock.radius * 1.5);
        return;
      case 'comet-damaged':
        this.scene.flash(event.x, event.z, 1.8);
        this.scene.burst(event.x, event.z, 6, 8, COMET_ACCENT);
        return;
      case 'comet-chunk':
        this.scene.flash(event.x, event.z, 3);
        return;
      case 'comet-destroyed':
        this.scene.burst(event.x, event.z, 120, 30, COMET_ACCENT);
        this.scene.burst(event.x, event.z, 60, 18, '#ffffff');
        this.scene.flash(event.x, event.z, event.radius * 6);
        this.scene.shockwave(event.x, event.z, event.radius * 4, COMET_ACCENT);
        this.message = { text: 'Comet mined out', until: now + 3 };
        return;
      case 'comet-entered':
        this.message = { text: 'A comet has entered the sector', until: now + 4 };
        return;
      case 'comet-left':
        this.message = { text: 'The comet has left the sector', until: now + 3 };
        return;
      case 'pickup-collected': {
        if (event.shipId !== PLAYER_ID) return;
        const player = this.sim.getShip(PLAYER_ID)!;
        this.scene.flash(player.state.x, player.state.z, 1.4);
        this.scene.burst(player.state.x, player.state.z, 5, 6, RESOURCES[event.kind].colour);
        if (event.kind === 'crystal') this.message = { text: `+${event.count} crystal`, until: now + 1.5 };
        return;
      }
      case 'warp-started': {
        const radius = this.sim.getShip(event.shipId)?.spec.radius ?? 3;
        this.scene.shockwave(event.x, event.z, radius * 2.5, SHIELD_COLOUR);
        return;
      }
      case 'warp-blanked':
        if (event.shipId === PLAYER_ID) this.scene.camera.snapTo(event.x, event.z);
        return;
      case 'warp-arrived': {
        const radius = this.sim.getShip(event.shipId)?.spec.radius ?? 3;
        this.scene.flash(event.x, event.z, radius * 3.5);
        this.scene.shockwave(event.x, event.z, radius * 3, SHIELD_COLOUR);
        if (event.shipId === PLAYER_ID) this.message = { text: `Arrived at ${formatMapCoords(event.x, event.z, this.sim.halfExtent)}`, until: now + 2.5 };
        return;
      }
      case 'warp-done':
        return;
      case 'beacon-reached':
        this.scene.flash(event.beacon.x, event.beacon.z, event.beacon.radius * 0.6);
        this.scene.shockwave(event.beacon.x, event.beacon.z, event.beacon.radius * 1.6, event.beacon.colour);
        if (event.shipId === PLAYER_ID) this.message = { text: `Reached ${event.beacon.label}`, until: now + 3 };
        return;
    }
  }

  /** Missiles leave a thin smoke trail: one slow grey chip per frame. */
  private smokeTrails(): void {
    for (const ship of this.sim.allShips()) {
      for (const p of ship.pool.projectiles) {
        if (p.weapon.trail) this.scene.burst(p.x, p.z, 1, 1.2, MISSILE_SMOKE);
      }
    }
  }

  // ---- tooltips and settings ----------------------------------------------

  private tooltipFor(pick: Pick, pointerPx: { x: number; y: number } | null): Parameters<FlightHud['setTooltip']>[0] {
    if (!pick || !pointerPx) return null;
    if (pick.kind === 'ship') {
      const { spec, vitals } = pick.ship;
      return {
        title: spec.name,
        lines: [spec.hullName, `shield ${Math.ceil(vitals.shield)} / ${vitals.maxShield}`, `hull ${Math.ceil(vitals.hull)} / ${vitals.maxHull}`],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: this.accents.get(spec.id) ?? NPC_ACCENT,
      };
    }
    if (pick.kind === 'beacon') {
      return {
        title: pick.beacon.label,
        lines: [pick.beacon.description || 'beacon', 'fly through to activate'],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: pick.beacon.colour,
      };
    }
    if (pick.kind === 'comet') {
      const comet = this.sim.comet;
      return {
        title: 'Comet',
        lines: [
          `shooting star · ${Math.ceil(comet.hp)} / ${comet.maxHp} hp`,
          `drops ${COMET_RESOURCES.map((kind) => RESOURCES[kind].label.toLowerCase()).join(', ')}`,
          'sheds chunks as you mine it',
        ],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: COMET_ACCENT,
      };
    }
    const rock = this.sim.rocks.get(pick.rockId);
    if (!rock) return null;
    const info = ROCK_KINDS[rock.kind];
    const size = rock.kind === 'giant' ? 'giant' : rock.radius >= 4 ? 'large' : rock.radius >= 2.5 ? 'medium' : 'small';
    return {
      title: `${info.label} rock`,
      lines: [`${size} · ${Math.ceil(rock.hp)} / ${rock.maxHp} hp`, `drops ${info.resources.map((kind: ResourceKind) => RESOURCES[kind].label.toLowerCase()).join(', ')}`],
      x: pointerPx.x,
      y: pointerPx.y,
      accent: ROCK_BAR_COLOURS[rock.kind],
    };
  }

  private setPixelation(level: number, scope: PixelScope): void {
    this.scene.setPixelation(level, scope);
    try {
      window.localStorage.setItem(PIXEL_SETTINGS_KEY, JSON.stringify({ level: this.scene.pixelLevel, scope }));
    } catch {
      // Storage may be unavailable; the setting just will not persist.
    }
  }

  private loadPixelSettings(): void {
    try {
      const raw = window.localStorage.getItem(PIXEL_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { level?: unknown; scope?: unknown };
      const level = typeof parsed.level === 'number' ? parsed.level : this.scene.pixelLevel;
      const scope = parsed.scope === '3d' || parsed.scope === 'all' ? parsed.scope : this.scene.pixelScope;
      this.scene.setPixelation(level, scope);
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }
}

function chipColour(rock: Rock): string {
  return rock.kind === 'ice' ? '#bfe0f0' : rock.kind === 'crystal' ? '#c9a6ff' : ROCK_CHIP_COLOUR;
}
