import type { Catalog } from '../catalog/catalog';
import { Animations, EntityType, Varps } from '../client/definitions';
import type { ClientPick } from '../client/pick';
import type { ClientEntity, ClientWorld } from '../client/world';
import { COMET_RESOURCES } from '../game/comet';
import { speedOf } from '../game/flightController';
import { defaultItemCatalog } from '../game/items';
import { surfaceFor } from '../game/loadout';
import { RESOURCES } from '../game/loot';
import { shipToWorld, type Projectile } from '../game/projectiles';
import { ROCK_KINDS, rockDropItems } from '../game/rocks';
import { talentReadouts } from '../game/talents';
import { sampleWarp } from '../game/warp';
import { WEAPON_GROUPS, type WeaponGroup } from '../game/weapons';
import type { HitMarkers } from '../hud/hitMarkers';
import type { FlightHud, HudInfo } from '../hud/hud';
import type { WorldLabels } from '../hud/labels';
import type { BeamVisual } from '../scene/beamRenderer';
import type { ChargeGlow, GameScene } from '../scene/gameScene';
import type { BarEntry } from '../scene/healthBars';
import { rockTop } from '../scene/rockRenderer';
import { COMET_ACCENT, FRIENDLY_ACCENT, ROCK_BAR_COLOURS } from './colours';

const LABEL_HEIGHT = 3.4;
/** How close the comet has to be before its bar shows. */
const COMET_BAR_RANGE = 440;
/** Only rocks this close to the player are pushed to the scene: the client's "in view" set. */
export const ROCK_VIEW_RADIUS = 340;
/** Reach of the warp drive from the ship, in world units, for the map's range ring. */
export const WARP_RANGE = 1000;

/** What the shell knows that the world does not: UI state for this frame. */
export interface PresenterFrame {
  readonly dt: number;
  /** Local seconds, for animations. */
  readonly time: number;
  readonly hovered: ClientPick;
  readonly pointerPx: { readonly x: number; readonly y: number } | null;
  readonly banner: string | null;
  /** The NPC Space would talk to right now. */
  readonly talkable: ClientEntity | null;
  readonly dialogueOpen: boolean;
}

/**
 * Draws the client's world: ship actors, projectiles, beams, rocks, loot,
 * the comet, health bars, labels, hit markers and the HUD readout, every
 * frame, from `ClientWorld` alone. It does not care whether the world was
 * filled by packets or by the offline simulation.
 */
export class FlightPresenter {
  private readonly shown = new Set<string>();

  constructor(
    private readonly scene: GameScene,
    private readonly hud: FlightHud,
    private readonly labels: WorldLabels,
    private readonly hitMarkers: HitMarkers,
    private readonly world: ClientWorld,
    private readonly catalog: Catalog,
  ) {}

  /** The outline, label and tooltip colour an entity wears right now. */
  accentFor(entity: ClientEntity): string {
    if (entity.index === this.world.playerIndex) return entity.appearance?.build.colours.trim ?? FRIENDLY_ACCENT;
    return entity.hostile ? (entity.appearance?.accent ?? FRIENDLY_ACCENT) : FRIENDLY_ACCENT;
  }

  frame(f: PresenterFrame): void {
    this.syncShips();
    const player = this.world.player;
    if (player) this.scene.camera.update(player.pose.x, player.pose.z, player.pose.vx, player.pose.vz, f.dt);
    this.pushState(f);
    this.scene.update(f.dt, f.time);
    this.updateOverlays(f);
    this.scene.render();
  }

  /** Give new ships actors and take them from ships that left. */
  private syncShips(): void {
    const present = new Set<string>();
    for (const ship of this.world.ships()) {
      const id = String(ship.index);
      present.add(id);
      if (this.scene.hasShip(id)) continue;
      const { build } = ship.appearance!;
      if (!this.catalog.findHull(build.hullId)) continue;
      this.scene.addShip(id, { surface: surfaceFor(build, this.catalog), colours: build.colours, material: build.material, accent: this.accentFor(ship), radius: ship.appearance!.radius });
      this.shown.add(id);
    }
    for (const id of this.shown) {
      if (present.has(id)) continue;
      this.scene.removeShip(id);
      this.labels.remove(id);
      this.shown.delete(id);
    }
  }

  /** Mirror the world into the scene. */
  private pushState(f: PresenterFrame): void {
    const world = this.world;
    const player = world.player;
    const hovered = f.hovered;
    for (const ship of world.ships()) {
      const id = String(ship.index);
      if (!this.scene.hasShip(id)) continue;
      const warp = ship.warp ? sampleWarp(ship.warp, world.time) : null;
      const spooling = ship.animation === Animations.WARP_SPOOL || (warp !== null && (warp.phase === 'charging' || warp.phase === 'entering'));
      this.scene.setShipPose(id, {
        x: ship.pose.x,
        z: ship.pose.z,
        heading: ship.pose.heading,
        throttle: ship.alive ? ship.pose.throttle : 0,
        visible: ship.alive,
        jitter: spooling ? 0.14 * (warp?.chargeProgress ?? 1) : 0,
      });
      this.scene.setShipShield(id, ship.vitals.maxShield > 0 ? ship.vitals.shield / ship.vitals.maxShield : 0);
      this.scene.setShipOutlined(id, hovered?.kind === 'entity' && hovered.entity === ship);
    }
    const shots: Projectile[] = [];
    const beams: BeamVisual[] = [];
    for (const projectile of world.projectiles.values()) {
      const at = world.projectilePosition(projectile);
      if (projectile.weapon.kind === 'beam') {
        const target = projectile.target === null ? null : world.entities.get(projectile.target);
        beams.push({
          x0: projectile.x0,
          z0: projectile.z0,
          x1: target ? target.pose.x : projectile.x1,
          z1: target ? target.pose.z : projectile.z1,
          y: projectile.y,
          width: projectile.weapon.beamWidth ?? 0.5,
          colour: projectile.weapon.colour,
          fade: 1 - at.progress,
          style: projectile.weapon.beamStyle ?? 'lance',
          seed: projectile.id,
        });
      } else if (world.time >= projectile.startAt) {
        shots.push({ id: projectile.id, x: at.x, y: projectile.y, z: at.z, vx: at.vx, vz: at.vz, life: (1 - at.progress) * projectile.duration, weapon: projectile.weapon });
      }
    }
    this.scene.syncProjectiles(shots);
    this.scene.syncBeams(beams);
    const here = player?.pose ?? { x: 0, z: 0 };
    if (world.rocks) this.scene.syncRocks(world.rocks.inView(here.x, here.z, ROCK_VIEW_RADIUS), hovered?.kind === 'rock' ? hovered.rock.id : null);
    this.scene.syncLoot([...world.groundItems.values()], hovered?.kind === 'obj' ? hovered.item.id : null);
    const comet = world.comet;
    this.scene.syncComet(comet, hovered?.kind === 'entity' && hovered.entity.index === comet?.index);
    this.scene.setHazardHovered(hovered?.kind === 'hazard' ? hovered.hazard.id : null);
    this.scene.setHazardFocus(player?.alive && player.appearance ? { x: player.pose.x, z: player.pose.z, radius: player.appearance.radius * 2.4 } : null);
    this.scene.syncHealthBars(this.healthBars(here));

    const charge = world.beamCharge;
    const glows: ChargeGlow[] =
      player?.alive && charge > 0
        ? player.beamMounts.map((mount) => {
            const [x, z] = shipToWorld(player.pose, mount.position);
            return { x, y: mount.position[1], z, colour: mount.weapon.colour, charge };
          })
        : [];
    this.scene.setChargeGlows(glows, f.time);

    const warp = player?.warp ? sampleWarp(player.warp, world.time) : null;
    this.scene.setWarpOverlay(warp?.overlay ?? 0, warp?.intensity ?? 0);
  }

  private healthBars(here: { readonly x: number; readonly z: number }): BarEntry[] {
    const entries: BarEntry[] = [];
    const comet = this.world.comet;
    if (comet && Math.hypot(comet.x - here.x, comet.z - here.z) < COMET_BAR_RANGE) {
      entries.push({ x: comet.x, y: comet.radius + 2.2, z: comet.z, width: 12, height: 0.7, fraction: comet.hp / Math.max(1, comet.maxHp), colour: COMET_ACCENT });
    }
    for (const rock of this.world.rocks?.damagedInView(here.x, here.z, ROCK_VIEW_RADIUS) ?? []) {
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

  /** Labels, hit markers, edge arrows and the HUD readout. */
  private updateOverlays(f: PresenterFrame): void {
    const world = this.world;
    const player = world.player;
    const { width, height } = this.scene.size;
    this.hitMarkers.update(f.dt, this.scene.camera.camera, width, height);
    for (const ship of world.ships()) {
      const id = String(ship.index);
      const own = ship.index === world.playerIndex;
      const appearance = ship.appearance!;
      const screen = !ship.alive ? null : own ? this.scene.project(ship.pose.x, 0, ship.pose.z - appearance.radius - 1.2) : this.scene.project(ship.pose.x, LABEL_HEIGHT, ship.pose.z);
      this.labels.update(id, screen, { name: appearance.name, vitals: ship.vitals, accent: this.accentFor(ship), showBars: !appearance.invulnerable, own });
    }
    this.hud.setTooltip(this.tooltipFor(f.hovered, f.pointerPx));
    if (!player?.appearance) return;

    const comet = world.comet;
    if (comet) {
      const { screen, onScreen } = this.scene.projectRaw(comet.x, 0.5, comet.z);
      this.hud.setCometIndicator({ screen, onScreen, distance: Math.hypot(comet.x - player.pose.x, comet.z - player.pose.z), width, height });
    } else {
      this.hud.setCometIndicator(null);
    }
    const flag = world.mapFlag;
    if (flag && player.alive) {
      const { screen, onScreen } = this.scene.projectRaw(flag.x, 0.5, flag.z);
      this.hud.setWaypointIndicator({ screen, onScreen, distance: Math.hypot(flag.x - player.pose.x, flag.z - player.pose.z), width, height });
    } else {
      this.hud.setWaypointIndicator(null);
    }

    const byDistance = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
      Math.hypot(a.x - player.pose.x, a.z - player.pose.z) - Math.hypot(b.x - player.pose.x, b.z - player.pose.z);
    const others = [...world.ships()].filter((ship) => ship.alive && ship !== player && ship.appearance!.team !== player.appearance!.team);
    const enemies = others.filter((ship) => ship.hostile).map((ship) => ({ x: ship.pose.x, z: ship.pose.z })).sort(byDistance);
    const neutrals = others.filter((ship) => !ship.hostile).map((ship) => ({ x: ship.pose.x, z: ship.pose.z })).sort(byDistance);
    const map = world.map;
    this.hud.update({
      x: player.pose.x,
      z: player.pose.z,
      heading: player.pose.heading,
      speed: speedOf(player.pose),
      mode: this.scene.cameraMode,
      tiltDegrees: this.scene.camera.tiltDegrees,
      zoomDistance: this.scene.camera.zoomDistance,
      halfExtent: map?.halfExtent ?? 0,
      planets: this.scene.planetPositions,
      rocks: world.rocks ? [...world.rocks.defined] : [],
      rocksBroken: world.varp(Varps.ROCKS_BROKEN),
      kills: world.varp(Varps.KILLS),
      deaths: world.varp(Varps.DEATHS),
      enemies,
      neutrals,
      message: f.banner ?? this.warpMessage(player),
      weapons: this.weaponReadouts(player),
      cargo: world.cargo,
      pixelLevel: this.scene.pixelLevel,
      pixelScope: this.scene.pixelScope,
      beacons: map?.beacons ?? [],
      hazards: map?.hazards ?? [],
      drops: [...world.groundItems.values()].map((pickup) => ({ x: pickup.x, z: pickup.z, kind: pickup.kind, label: pickup.count > 1 ? `${RESOURCES[pickup.kind].label} × ${pickup.count}` : RESOURCES[pickup.kind].label })),
      markers: map?.markers ?? [],
      talents: talentReadouts(world.talents),
      mapName: map?.name ?? '',
      ship: { name: player.appearance.name, hullName: player.appearance.hullName, shield: player.vitals.shield, maxShield: player.vitals.maxShield, hull: player.vitals.hull, maxHull: player.vitals.maxHull },
      fitted: this.fittedItems(player),
      waypoint: flag,
      warpRange: WARP_RANGE,
      comet,
    });
    const insideIndex = player.alive ? world.varp(Varps.INSIDE_HAZARD, -1) : -1;
    const inside = insideIndex >= 0 ? map?.hazards[insideIndex] : undefined;
    this.hud.setHazardWarning(inside ? { label: inside.label, damagePerSecond: inside.damagePerSecond, colour: inside.colour } : null);
    this.hud.setInteractPrompt(f.talkable?.appearance && !f.dialogueOpen ? { key: 'Space', text: `Talk to ${f.talkable.appearance.name}` } : null);
  }

  /** The weapon bar from varps: active group, readiness per group, beam phase. */
  private weaponReadouts(player: ClientEntity): HudInfo['weapons'] {
    const world = this.world;
    const active = world.activeWeaponGroup;
    const fills: Record<WeaponGroup, number> = { guns: world.varp(Varps.GUNS_READY, 1000) / 1000, beam: world.varp(Varps.BEAM_CHARGE, 1000) / 1000, missiles: world.varp(Varps.MISSILES_READY, 1000) / 1000 };
    const beamPhase = (['ready', 'charging', 'cooldown'] as const)[world.varp(Varps.BEAM_PHASE)] ?? 'ready';
    return WEAPON_GROUPS.map((group) => {
      const mounts = player.mounts.filter((mount) => mount.weapon.group === group.id).length;
      const fill = fills[group.id];
      return { id: group.id, key: group.key, label: group.label, mounts, active: active === group.id, fill, phase: group.id === 'beam' ? beamPhase : fill >= 1 ? 'ready' : 'cooldown' };
    });
  }

  /** Weapon items fitted to a ship, one entry per item with how many mounts carry it. */
  private fittedItems(ship: ClientEntity): HudInfo['fitted'] {
    const counts = new Map<string, { name: string; group: WeaponGroup; mounts: number }>();
    for (const mount of ship.mounts) {
      const item = defaultItemCatalog().get(mount.weapon.id);
      if (!item) continue;
      const entry = counts.get(item.id) ?? { name: item.name, group: mount.weapon.group, mounts: 0 };
      entry.mounts += 1;
      counts.set(item.id, entry);
    }
    return [...counts].map(([itemId, entry]) => ({ itemId, ...entry }));
  }

  private warpMessage(player: ClientEntity): string | null {
    if (!player.warp) return null;
    const sample = sampleWarp(player.warp, this.world.time);
    if (sample.phase === 'tunnel') return `In warp · ${Math.max(0, player.warp.arriveAt - this.world.time).toFixed(1)}s`;
    if (sample.phase === 'charging' || sample.phase === 'entering') return 'Spooling warp drive';
    return null;
  }

  tooltipFor(pick: ClientPick, pointerPx: { readonly x: number; readonly y: number } | null): Parameters<FlightHud['setTooltip']>[0] {
    if (!pick || !pointerPx) return null;
    const { x, y } = pointerPx;
    switch (pick.kind) {
      case 'entity': {
        const { entity } = pick;
        const appearance = entity.appearance;
        if (!appearance) return null;
        if (appearance.entityType === EntityType.COMET) {
          return {
            title: appearance.name,
            lines: [`shooting star · ${Math.ceil(entity.vitals.hull)} / ${entity.vitals.maxHull} hp`, `drops ${COMET_RESOURCES.map((kind) => RESOURCES[kind].label.toLowerCase()).join(', ')}`, 'sheds chunks as you mine it'],
            x,
            y,
            accent: COMET_ACCENT,
          };
        }
        const own = entity.index === this.world.playerIndex;
        const stanceLine = own ? [] : [entity.hostile ? 'hostile' : appearance.provokable ? 'friendly · will turn on you if attacked' : 'friendly'];
        const vitalsLines = appearance.invulnerable ? ['cannot be harmed'] : [`shield ${Math.ceil(entity.vitals.shield)} / ${entity.vitals.maxShield}`, `hull ${Math.ceil(entity.vitals.hull)} / ${entity.vitals.maxHull}`];
        return { title: appearance.name, lines: [appearance.hullName, ...stanceLine, ...vitalsLines], x, y, accent: this.accentFor(entity) };
      }
      case 'beacon':
        return { title: pick.beacon.label, lines: [pick.beacon.description || 'beacon', 'fly through to activate'], x, y, accent: pick.beacon.colour };
      case 'obj': {
        const { item } = pick;
        const definition = defaultItemCatalog().require(item.kind);
        return { title: item.count > 1 ? `${definition.name} × ${item.count}` : definition.name, lines: [definition.description, `worth ${definition.value * item.count}${item.life === Infinity ? ' · cache' : ''}`], x, y, accent: definition.visual.colour };
      }
      case 'hazard': {
        const { hazard } = pick;
        return { title: hazard.label, lines: [`gas cloud · ${hazard.damagePerSecond} damage/s inside`, `radius ${hazard.radius.toFixed(0)} · shields soak it first`], x, y, accent: hazard.colour };
      }
      case 'rock': {
        const { rock } = pick;
        const info = ROCK_KINDS[rock.kind];
        const size = rock.kind === 'giant' ? 'giant' : rock.radius >= 4 ? 'large' : rock.radius >= 2.5 ? 'medium' : 'small';
        return { title: `${info.label} rock`, lines: [`${size} · ${Math.ceil(rock.hp)} / ${rock.maxHp} hp`, `drops ${rockDropItems(rock.kind).map((kind) => RESOURCES[kind].label.toLowerCase()).join(', ')}`], x, y, accent: ROCK_BAR_COLOURS[rock.kind] };
      }
    }
  }
}
