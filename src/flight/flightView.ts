import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  Plane,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
} from 'three';
import { meshBounds, partitionSurfaceMesh, type SurfaceMesh } from '../core/mesh';
import { EMISSIVE_ROLES, type ShipColours } from '../core/palette';
import { ShipMesh } from '../render/shipMesh';
import { INITIAL_BEAM_STATE, addBeamShots, beamReadout, rayCircle, stepBeam, type BeamShot, type BeamState } from './beam';
import { BeamRenderer, type BeamVisual } from './beamRenderer';
import { CameraRig } from './cameraRig';
import { COMBAT_TUNING, applyDamage, circleHit, collisionDamage, createVitals, regenerateShield, type DamageResult, type Vitals } from './combat';
import { formatHit, rollDamage, type HitKind } from './damageRoll';
import { COMET_RESOURCES, COMET_TUNING, chunkResource, cometCollideShip, damageComet, spawnComet, stepComet, type CometState } from './comet';
import { CometVisual } from './cometVisual';
import { EffectsSystem, createGlowTexture } from './effects';
import { createEnemy, enemyAsFlightState, killEnemy, stepEnemy, type EnemyState } from './enemy';
import { DEFAULT_TUNING, IDLE_INPUT, INITIAL_FLIGHT_STATE, speedOf, stepFlight, type FlightState } from './flightController';
import { InstancedBars, type BarEntry } from './healthBars';
import { HitMarkers, type HitStyle } from './hitMarkers';
import { FlightHud, type WeaponGroupReadout } from './hud';
import { FlightInputTracker } from './input';
import { WorldLabels } from './labels';
import { formatMapCoords } from './mapCoords';
import { LootField, RESOURCES, emptyInventory, type Inventory, type ResourceKind } from './loot';
import { LootRenderer } from './lootRenderer';
import { createBoundary, createParallaxWorld, type ParallaxWorld } from './parallax';
import { BACKGROUND_LAYER, OVERLAY_LAYER, PIXEL_LEVELS, Pixelator, type PixelScope } from './pixelate';
import { ProjectileRenderer } from './projectileRenderer';
import { ProjectilePool, aimDirection, shipToWorld, type AimPoint, type FireEvent, type HomingTarget, type Projectile, type WeaponMount } from './projectiles';
import { createRng } from './random';
import { RockRenderer, rockTop } from './rockRenderer';
import { ROCK_KINDS, RockField, dropsFor, type Rock } from './rocks';
import { RESOURCES as RESOURCE_INFO } from './loot';
import { ShieldShell } from './shieldShell';
import { planWarp, sampleWarp, type WarpPlan } from './warp';
import { WarpTunnel } from './warpTunnel';
import { WEAPON_GROUPS, type WeaponGroup } from './weapons';

export interface FlightShip {
  readonly name: string;
  /** Hull class for tooltips, e.g. "Bastion gunship". */
  readonly hullName: string;
  readonly surface: SurfaceMesh;
  readonly colours: ShipColours;
  readonly weaponMounts: readonly WeaponMount[];
}

export interface FlightSpec {
  readonly player: FlightShip;
  readonly enemy: FlightShip;
}

export interface FlightViewEvents {
  onExit: () => void;
}

const MAP_SEED = 20261003;
const MAX_FRAME_DT = 0.05;
const TILT_DEGREES_PER_SECOND = 50;
const ROCK_CHIP_COLOUR = '#9a8f80';
const ENEMY_ACCENT = '#ff6a3a';
const ENEMY_DAMAGE_SCALE = 0.35;
const MISSILE_SMOKE = '#8a8a8a';
const SHIELD_COLOUR = '#5fb4ff';
const ENEMY_SPAWN: readonly [number, number] = [70, 95];
const LABEL_HEIGHT = 3.4;
const BEAM_HEIGHT = 0.4;
const PIXEL_SETTINGS_KEY = 'shipyard.pixelation';
const ROCK_BAR_RANGE = 220;
const MAX_ROCK_BARS = 600;
const ROCK_BAR_COLOURS: Readonly<Record<Rock['kind'], string>> = {
  stone: '#d9b26a',
  iron: '#9fb4c8',
  ice: '#8fe3ff',
  crystal: '#d9a6ff',
  giant: '#ff9a5a',
};

type Hovered = { readonly kind: 'rock'; readonly rock: Rock } | { readonly kind: 'enemy' } | { readonly kind: 'comet' } | null;
const COMET_ACCENT = '#9fd8ff';

/** One ship in the arena: mesh, shield shell and the circle used for hits. */
class ShipActor {
  readonly group = new Group();
  readonly mesh: ShipMesh;
  readonly shell: ShieldShell;
  readonly radius: number;
  private readonly outline: Mesh<BufferGeometry, MeshBasicMaterial>;

  constructor(ship: FlightShip, outlineColour: string) {
    this.mesh = new ShipMesh(ship.colours);
    this.mesh.setSurface(ship.surface);
    const bounds = meshBounds(ship.surface);
    this.radius = 0.36 * Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
    this.shell = new ShieldShell(this.radius, SHIELD_COLOUR);
    // Inverted hull of the lit surface, slightly enlarged, shown while hovered.
    const lit = partitionSurfaceMesh(ship.surface, (role) => EMISSIVE_ROLES.has(role)).rest;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(lit.positions, 3));
    this.outline = new Mesh(geometry, new MeshBasicMaterial({ color: outlineColour, side: BackSide, transparent: true, opacity: 0.9 }));
    this.outline.scale.setScalar(1.08);
    this.outline.visible = false;
    this.group.add(this.mesh, this.shell, this.outline);
  }

  setOutlined(outlined: boolean): void {
    this.outline.visible = outlined;
  }

  place(x: number, z: number, heading: number): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
  }

  /** Ripple the shield from the world point the hit came from. */
  shieldHit(atX: number, atZ: number): void {
    const dx = atX - this.group.position.x;
    const dz = atZ - this.group.position.z;
    const h = this.group.rotation.y;
    // World to ship-local: inverse of the yaw used in shipToWorld.
    this.shell.hit(dx * Math.cos(h) - dz * Math.sin(h), dx * Math.sin(h) + dz * Math.cos(h));
  }

  update(dt: number, vitals: Vitals, time: number): void {
    this.mesh.update(time);
    this.shell.update(dt, vitals.maxShield > 0 ? vitals.shield / vitals.maxShield : 0, time);
  }

  dispose(): void {
    this.mesh.dispose();
    this.shell.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }
}

/**
 * The flying prototype: the built ship over a parallax starfield, with a
 * tilted follow camera, WASD + mouse controls, weapon groups, shootable
 * rocks and a lone enemy to fight. Owns its own renderer and tears
 * everything down on `dispose()`.
 */
export class FlightView {
  private readonly renderer: WebGLRenderer;
  private readonly pixelator: Pixelator;
  private readonly scene = new Scene();
  private readonly rig = new CameraRig();
  private readonly world: ParallaxWorld;
  private readonly rocks: RockField;
  private readonly rockRenderer = new RockRenderer();
  private readonly rockBars = new InstancedBars(MAX_ROCK_BARS);
  private hovered: Hovered = null;
  private readonly cometRng = createRng(MAP_SEED + 5);
  private comet: CometState;
  private readonly cometVisual: CometVisual;
  private warp: WarpPlan | null = null;
  private warpMoved = false;
  private readonly damageRng = createRng(MAP_SEED + 8);
  private readonly hitMarkers: HitMarkers;
  private readonly tunnel = new WarpTunnel(createRng(MAP_SEED + 7));
  private readonly loot: LootField;
  private readonly lootRenderer = new LootRenderer();
  private cargo: Inventory = emptyInventory();
  private readonly effects: EffectsSystem;
  private readonly effectsRng = createRng(MAP_SEED + 1);
  private readonly glowTexture = createGlowTexture();
  private readonly player: ShipActor;
  private readonly enemy: ShipActor;
  private readonly playerShots: ProjectilePool;
  private readonly enemyShots: ProjectilePool;
  private readonly shotRenderer = new ProjectileRenderer();
  private readonly beamRenderer = new BeamRenderer();
  private readonly beamMounts: readonly WeaponMount[];
  private readonly chargeSprites: Sprite[] = [];
  private beam: BeamState = INITIAL_BEAM_STATE;
  private beamSeed = 0;
  private activeGroup: WeaponGroup;
  /** Where the cursor currently points on the ship plane; every mount fires towards it. */
  private aim: AimPoint | null = null;
  private readonly input: FlightInputTracker;
  private readonly hud: FlightHud;
  private readonly labels: WorldLabels;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private readonly shipPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly canvasHost: HTMLElement;
  private state: FlightState = INITIAL_FLIGHT_STATE;
  private playerVitals = createVitals(COMBAT_TUNING.playerShield, COMBAT_TUNING.playerHull);
  private playerDeadUntil: number | null = null;
  private enemyState: EnemyState = createEnemy(ENEMY_SPAWN[0], ENEMY_SPAWN[1]);
  private kills = 0;
  private deaths = 0;
  private message: { text: string; until: number } | null = null;
  private frameHandle = 0;
  private lastTime = performance.now();
  private lastDt = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly spec: FlightSpec,
    events: FlightViewEvents,
  ) {
    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'flight-canvas';
    const hudRoot = document.createElement('div');
    hudRoot.className = 'flight-hud';
    const labelRoot = document.createElement('div');
    labelRoot.className = 'flight-labels';
    container.replaceChildren(this.canvasHost, labelRoot, this.tunnel.canvas, hudRoot);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = NoToneMapping;
    this.canvasHost.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x05060c);
    this.pixelator = new Pixelator(this.renderer);
    this.loadPixelSettings();

    this.scene.add(new HemisphereLight(0xbfd4ff, 0x1a1a24, 0.8));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(-30, 90, -50);
    this.scene.add(key);

    const rng = createRng(MAP_SEED);
    this.world = createParallaxWorld(rng, DEFAULT_TUNING.halfExtent);
    const boundary = createBoundary(DEFAULT_TUNING.halfExtent, spec.player.colours.trim);
    // The 2D backdrop lives on its own layer so it can stay sharp when only the 3D is pixelated.
    for (const object of [...this.world.layers, boundary]) {
      object.traverse((child) => child.layers.set(BACKGROUND_LAYER));
      this.scene.add(object);
    }

    this.rocks = RockField.generate(rng, DEFAULT_TUNING.halfExtent);
    this.scene.add(this.rockRenderer.mesh, this.rockRenderer.gems, this.rockRenderer.outline, this.rockBars.group);
    // Health bars stay crisp whatever the pixelation setting.
    this.rockBars.group.traverse((child) => child.layers.set(OVERLAY_LAYER));
    this.loot = new LootField(createRng(MAP_SEED + 4));
    this.scene.add(this.lootRenderer.mesh);
    this.effects = new EffectsSystem(this.effectsRng);
    this.scene.add(this.effects);
    this.comet = spawnComet(this.cometRng, DEFAULT_TUNING.halfExtent, true);
    this.cometVisual = new CometVisual(createRng(MAP_SEED + 6), this.glowTexture);
    this.scene.add(this.cometVisual);

    this.player = new ShipActor(spec.player, spec.player.colours.trim);
    this.enemy = new ShipActor(spec.enemy, ENEMY_ACCENT);
    this.enemy.place(this.enemyState.x, this.enemyState.z, this.enemyState.heading);
    this.enemy.mesh.setThrottle(0.15);
    this.scene.add(this.player.group, this.enemy.group);

    this.playerShots = new ProjectilePool(spec.player.weaponMounts, createRng(MAP_SEED + 2));
    this.enemyShots = new ProjectilePool(spec.enemy.weaponMounts, createRng(MAP_SEED + 3));
    this.scene.add(this.shotRenderer.group, this.beamRenderer.mesh);

    // Beam weapons: a charge glow per laser mount.
    this.beamMounts = spec.player.weaponMounts.filter((mount) => mount.weapon.group === 'beam');
    for (const mount of this.beamMounts) {
      const charge = new Sprite(
        new SpriteMaterial({ map: this.glowTexture, color: mount.weapon.colour, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
      );
      charge.visible = false;
      this.chargeSprites.push(charge);
      this.scene.add(charge);
    }
    this.activeGroup = WEAPON_GROUPS.find((group) => this.groupMountCount(group.id) > 0)?.id ?? 'guns';

    this.labels = new WorldLabels(labelRoot);
    this.hitMarkers = new HitMarkers(labelRoot);
    this.hud = new FlightHud(hudRoot, {
      onExit: events.onExit,
      onToggleCamera: () => this.rig.toggleMode(),
      onPixelLevel: (index) => this.setPixelation(index, this.pixelator.currentScope),
      onPixelScope: (scope) => this.setPixelation(this.pixelator.levelIndex, scope),
      onTeleport: (x, z) => this.teleport(x, z),
    });
    this.input = new FlightInputTracker(this.canvasHost, {
      onExit: events.onExit,
      onToggleCamera: () => this.rig.toggleMode(),
      onZoom: (factor) => this.rig.zoomBy(factor),
      onSelectGroup: (index) => {
        const group = WEAPON_GROUPS[index];
        if (group && this.groupMountCount(group.id) > 0) this.activeGroup = group.id;
      },
      onCyclePixelation: () => this.setPixelation((this.pixelator.levelIndex + 1) % PIXEL_LEVELS.length, this.pixelator.currentScope),
      onTogglePixelScope: () => this.setPixelation(this.pixelator.levelIndex, this.pixelator.currentScope === '3d' ? 'all' : '3d'),
    });
    this.input.attach();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rig.snapTo(0, 0);
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.input.detach();
    this.resizeObserver.disconnect();
    this.labels.dispose();
    this.hitMarkers.dispose();
    this.world.dispose();
    this.rockRenderer.dispose();
    this.rockBars.dispose();
    this.cometVisual.dispose();
    this.lootRenderer.dispose();
    this.effects.dispose();
    this.player.dispose();
    this.enemy.dispose();
    this.glowTexture.dispose();
    this.shotRenderer.dispose();
    this.beamRenderer.dispose();
    for (const charge of this.chargeSprites) (charge.material as SpriteMaterial).dispose();
    this.tunnel.dispose();
    this.pixelator.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.container.replaceChildren();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
    this.tunnel.resize(width, height, Math.min(window.devicePixelRatio, 1.5));
  }

  private readonly resolveAim = (ndcX: number, ndcY: number): readonly [number, number] | null => {
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.rig.camera);
    const hit = this.raycaster.ray.intersectPlane(this.shipPlane, new Vector3());
    return hit ? [hit.x, hit.z] : null;
  };

  private readonly frame = (nowMs: number): void => {
    const dt = Math.min(MAX_FRAME_DT, (nowMs - this.lastTime) / 1000);
    this.lastTime = nowMs;
    this.lastDt = dt;
    const now = nowMs / 1000;

    const { flight, cameraTilt, pointerPx } = this.input.snapshot(this.resolveAim);
    const alive = this.playerDeadUntil === null;
    const warping = this.warp !== null;
    const input = alive && !warping ? flight : IDLE_INPUT;
    this.aim = flight.aim;

    // Player movement: either the warp sequence or normal flight with ramming into rocks or the comet.
    this.stepCometState(dt, now);
    if (this.warp) {
      this.stepWarp(now, dt);
    } else {
      this.tunnel.update(dt, 0, 0);
      this.state = stepFlight(this.state, input, dt);
      const collision = this.rocks.resolveShipCollision(this.state, this.player.radius);
      this.state = collision.state;
      if (alive && collision.impactSpeed > 0) this.hurtPlayerMarked(collisionDamage(collision.impactSpeed), 'normal', now, this.state.x, this.state.z);
      const cometBump = cometCollideShip(this.state, this.comet, this.player.radius);
      this.state = cometBump.state;
      if (alive && cometBump.impactSpeed > 0) this.hurtPlayerMarked(collisionDamage(cometBump.impactSpeed), 'normal', now, this.state.x, this.state.z);
    }

    // Shots from both sides, with muzzle flashes, missile smoke and flak pops.
    const homing = this.homingTargets();
    const playerFire = this.playerShots.update(dt, this.state, input.fire ? this.activeGroup : false, homing, this.aim);
    this.muzzleFlashes(playerFire.fired);
    this.flakPops(playerFire.expired);
    this.updateBeam(dt, input.fire && this.activeGroup === 'beam', now);

    const enemyStep = stepEnemy(this.enemyState, this.state, dt, now);
    this.enemyState = enemyStep.enemy;
    if (enemyStep.respawned) {
      this.enemy.group.visible = true;
      this.effects.flash(this.enemyState.x, this.enemyState.z, this.enemy.radius * 3);
      this.effects.shockwave(this.enemyState.x, this.enemyState.z, this.enemy.radius * 3, SHIELD_COLOUR);
    }
    const enemyFire = this.enemyShots.update(
      dt,
      enemyAsFlightState(this.enemyState),
      enemyStep.fire && this.enemyState.alive ? 'all' : false,
      [this.state],
      [this.state.x, this.state.z],
    );
    this.muzzleFlashes(enemyFire.fired);
    this.flakPops(enemyFire.expired);
    this.smokeTrails(this.playerShots.projectiles);
    this.smokeTrails(this.enemyShots.projectiles);
    this.resolveHits(now);

    // Pickups drift towards the ship and are collected on contact.
    const collected = this.loot.step(dt, alive ? { x: this.state.x, z: this.state.z, radius: this.player.radius } : null);
    this.collect(collected, now);

    // Regeneration and respawns.
    this.playerVitals = regenerateShield(this.playerVitals, dt, now);
    if (this.playerDeadUntil !== null && now >= this.playerDeadUntil) this.respawnPlayer();
    if (this.message && now > this.message.until) this.message = null;

    // Hover feedback: outline and tooltip for the rock or enemy under the cursor.
    this.hovered = this.resolveHover(flight.aim);
    this.enemy.setOutlined(this.hovered?.kind === 'enemy');
    this.hud.setTooltip(this.tooltipFor(this.hovered, pointerPx));

    // Visuals.
    this.effects.update(dt);
    this.rockRenderer.sync(this.rocks.rocks, now, this.hovered?.kind === 'rock' ? this.hovered.rock : null);
    this.cometVisual.update(this.comet, dt, now, this.hovered?.kind === 'comet');
    this.syncRockBars();
    this.lootRenderer.sync(this.loot.pickups, now);
    if (cameraTilt !== 0) this.rig.tiltBy(cameraTilt * TILT_DEGREES_PER_SECOND * dt);
    this.player.place(this.state.x, this.state.z, this.state.heading);
    this.player.mesh.setThrottle(alive ? this.state.throttle : 0);
    this.applyWarpVisuals(now);
    this.player.update(dt, this.playerVitals, now);
    this.enemy.place(this.enemyState.x, this.enemyState.z, this.enemyState.heading);
    this.enemy.update(dt, this.enemyState.vitals, now);
    this.updateBeamVisuals(now);

    this.rig.update(this.state.x, this.state.z, this.state.vx, this.state.vz, dt);
    this.world.update(this.rig.mode, this.rig.height, this.rig.camera.position.x, this.rig.camera.position.z, now);
    this.shotRenderer.sync([...this.playerShots.projectiles, ...this.enemyShots.projectiles]);
    this.updateLabels();

    this.hud.update({
      x: this.state.x,
      z: this.state.z,
      heading: this.state.heading,
      speed: speedOf(this.state),
      mode: this.rig.mode,
      tiltDegrees: this.rig.tiltDegrees,
      zoomDistance: this.rig.zoomDistance,
      halfExtent: DEFAULT_TUNING.halfExtent,
      planets: this.world.planetPositions,
      rocks: this.rocks.rocks,
      rocksBroken: this.rocks.brokenCount,
      kills: this.kills,
      deaths: this.deaths,
      enemy: this.enemyState.alive ? this.enemyState : null,
      message: this.message?.text ?? null,
      weapons: this.weaponReadouts(),
      cargo: this.cargo,
      pixelLevel: this.pixelator.levelIndex,
      pixelScope: this.pixelator.currentScope,
      comet: this.comet.alive ? this.comet : null,
    });

    this.pixelator.render(this.scene, this.rig.camera);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /** Start a warp to a map position: spool up, blank out, reappear there after a distance-scaled time. */
  private teleport(x: number, z: number): void {
    if (this.playerDeadUntil !== null || this.warp) return;
    const half = DEFAULT_TUNING.halfExtent;
    const targetX = Math.max(-half, Math.min(half, x));
    const targetZ = Math.max(-half, Math.min(half, z));
    const now = performance.now() / 1000;
    const plan = planWarp(this.state.x, this.state.z, targetX, targetZ, now);
    if (!plan) return;
    this.warp = plan;
    this.warpMoved = false;
    this.effects.shockwave(this.state.x, this.state.z, this.player.radius * 2.5, SHIELD_COLOUR);
    this.message = { text: 'Spooling warp drive', until: plan.chargeUntil + 0.1 };
  }

  /**
   * Drive the warp sequence. The ship sits still while the drive spools and
   * the view blanks out, is moved to its destination the moment the tunnel
   * covers the screen, and is revealed there when the tunnel fades.
   */
  private stepWarp(now: number, dt: number): void {
    const plan = this.warp;
    if (!plan) return;
    const sample = sampleWarp(plan, now);
    this.tunnel.update(dt, sample.overlay, sample.intensity);

    if (sample.phase === 'charging' || sample.phase === 'entering') {
      // Swing the nose onto the warp heading while the drive spools; hold position.
      const diff = Math.atan2(Math.sin(plan.heading - this.state.heading), Math.cos(plan.heading - this.state.heading));
      const heading = this.state.heading + diff * Math.min(1, 0.25 + sample.chargeProgress);
      this.state = { ...this.state, vx: 0, vz: 0, heading, throttle: 1.45 };
      if (sample.phase === 'entering' && sample.overlay > 0.5 && !this.warpMoved) {
        this.effects.flash(plan.fromX, plan.fromZ, this.player.radius * 4);
      }
      return;
    }

    if (!this.warpMoved) {
      // Covered by the tunnel: jump the ship and camera to the destination unseen.
      this.warpMoved = true;
      this.state = { ...this.state, x: plan.toX, z: plan.toZ, vx: 0, vz: 0, heading: plan.heading, throttle: 1.0 };
      this.rig.snapTo(plan.toX, plan.toZ);
      this.playerShots.clear();
    }

    if (sample.phase === 'tunnel') {
      const seconds = Math.max(0, plan.arriveAt - now);
      this.message = { text: `In warp · ${seconds.toFixed(1)}s`, until: now + 0.5 };
      return;
    }
    if (sample.phase === 'exiting') {
      if (this.message?.text.startsWith('In warp')) {
        this.effects.flash(plan.toX, plan.toZ, this.player.radius * 3.5);
        this.effects.shockwave(plan.toX, plan.toZ, this.player.radius * 3, SHIELD_COLOUR);
        this.message = { text: `Arrived at ${formatMapCoords(plan.toX, plan.toZ, DEFAULT_TUNING.halfExtent)}`, until: plan.doneAt + 2 };
      }
      this.state = { ...this.state, throttle: Math.max(0.4, this.state.throttle - dt) };
      return;
    }
    this.warp = null;
    this.tunnel.update(dt, 0, 0);
  }

  /** A nervous shiver while the drive spools; nothing else is visible during the jump. */
  private applyWarpVisuals(now: number): void {
    if (!this.warp) return;
    const sample = sampleWarp(this.warp, now);
    if (sample.phase !== 'charging' && sample.phase !== 'entering') return;
    const shake = 0.14 * sample.chargeProgress;
    this.player.group.position.x += (this.effectsRng() - 0.5) * shake;
    this.player.group.position.z += (this.effectsRng() - 0.5) * shake;
  }

  private setPixelation(level: number, scope: PixelScope): void {
    this.pixelator.setLevel(level);
    this.pixelator.setScope(scope);
    try {
      window.localStorage.setItem(PIXEL_SETTINGS_KEY, JSON.stringify({ level: this.pixelator.levelIndex, scope }));
    } catch {
      // Storage may be unavailable; the setting just will not persist.
    }
  }

  private loadPixelSettings(): void {
    try {
      const raw = window.localStorage.getItem(PIXEL_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { level?: unknown; scope?: unknown };
      if (typeof parsed.level === 'number') this.pixelator.setLevel(parsed.level);
      if (parsed.scope === '3d' || parsed.scope === 'all') this.pixelator.setScope(parsed.scope);
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }

  /** Advance the comet and announce arrivals and departures. */
  private stepCometState(dt: number, now: number): void {
    const step = stepComet(this.comet, dt, now, DEFAULT_TUNING.halfExtent, this.cometRng);
    this.comet = step.comet;
    if (step.entered) this.message = { text: 'A comet has entered the sector', until: now + 4 };
    if (step.left) this.message = { text: 'The comet has left the sector', until: now + 3 };
  }

  /** Things the player's homing missiles may chase: the enemy, the comet and nearby rocks. */
  private homingTargets(): HomingTarget[] {
    const targets: HomingTarget[] = [];
    if (this.enemyState.alive) targets.push(this.enemyState);
    if (this.comet.alive) targets.push(this.comet);
    for (const rock of this.rocks.overlapping(this.state.x, this.state.z, 120)) targets.push(rock);
    return targets;
  }

  /** Player shots against rocks and the enemy; enemy shots against the player. */
  private resolveHits(now: number): void {
    const shots = this.playerShots.projectiles;
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i]!;
      if (this.enemyState.alive && circleHit(shot.x, shot.z, this.enemyState.x, this.enemyState.z, this.enemy.radius)) {
        this.playerShots.removeAt(i);
        const roll = rollDamage(shot.weapon.damage, this.damageRng);
        const result = this.hurtEnemy(roll.amount, now, shot.x, shot.z);
        this.markHit(shot.x, shot.z, roll.amount, roll.kind, result.hullDamage > 0 ? 'hull' : 'shield');
        continue;
      }
      if (this.comet.alive && circleHit(shot.x, shot.z, this.comet.x, this.comet.z, this.comet.radius)) {
        this.playerShots.removeAt(i);
        const roll = rollDamage(shot.weapon.rockDamage ?? shot.weapon.damage, this.damageRng);
        this.mineComet(shot.x, shot.z, roll.amount, shot.weapon.mining ?? 1, now);
        this.markHit(shot.x, shot.z, roll.amount, roll.kind, 'rock');
        continue;
      }
      const rock = this.rocks.findAt(shot.x, shot.z);
      if (!rock) continue;
      this.playerShots.removeAt(i);
      const roll = rollDamage(shot.weapon.rockDamage ?? shot.weapon.damage, this.damageRng);
      this.damageRock(rock, shot.x, shot.z, roll.amount, shot.weapon.mining ?? 1);
      this.markHit(shot.x, shot.z, roll.amount, roll.kind, 'rock');
    }

    if (this.playerDeadUntil !== null) return;
    const incoming = this.enemyShots.projectiles;
    for (let i = incoming.length - 1; i >= 0; i--) {
      const shot = incoming[i]!;
      if (!circleHit(shot.x, shot.z, this.state.x, this.state.z, this.player.radius)) continue;
      this.enemyShots.removeAt(i);
      const roll = rollDamage(shot.weapon.damage * ENEMY_DAMAGE_SCALE, this.damageRng);
      this.hurtPlayerMarked(roll.amount, roll.kind, now, shot.x, shot.z);
    }
  }

  /** Floating damage number plus hit mark at a world point, drawn on the DOM layer. */
  private markHit(x: number, z: number, amount: number, kind: HitKind, style: HitStyle): void {
    if (amount <= 0) return;
    this.hitMarkers.spawn(x, 1.2, z, formatHit(amount), style, kind);
  }

  private hurtPlayerMarked(amount: number, kind: HitKind, now: number, atX: number, atZ: number): void {
    if (amount < 0.5) return;
    this.hurtPlayer(amount, now, atX, atZ);
    this.markHit(atX, atZ, amount, kind, 'incoming');
  }

  /** Chip the comet; every so often it sheds a chunk, and at zero it bursts with its payload. */
  private mineComet(atX: number, atZ: number, amount: number, miningBonus: number, now: number): void {
    const result = damageComet(this.comet, amount, now);
    this.comet = result.comet;
    this.effects.flash(atX, atZ, 1.8);
    this.effects.burst(atX, atZ, 6, 8, COMET_ACCENT);
    const chunks = Math.round(result.chunks * miningBonus);
    for (let i = 0; i < chunks; i++) this.loot.spawn(result.comet.x, result.comet.z, chunkResource(this.cometRng), 1);
    if (chunks > 0) this.effects.flash(result.comet.x, result.comet.z, 3);
    if (result.destroyed) {
      this.effects.burst(result.comet.x, result.comet.z, 120, 30, COMET_ACCENT);
      this.effects.burst(result.comet.x, result.comet.z, 60, 18, '#ffffff');
      this.effects.flash(result.comet.x, result.comet.z, result.comet.radius * 6);
      this.effects.shockwave(result.comet.x, result.comet.z, result.comet.radius * 4, COMET_ACCENT);
      for (const [kind, count] of Object.entries(COMET_TUNING.finalDrops) as Array<[ResourceKind, number]>) {
        this.loot.spawn(result.comet.x, result.comet.z, kind, Math.round(count * miningBonus));
      }
      this.message = { text: 'Comet mined out', until: now + 3 };
    }
  }

  /** Which rock, comet or enemy the cursor is over, if any. */
  private resolveHover(aim: readonly [number, number] | null): Hovered {
    if (!aim) return null;
    if (this.comet.alive && circleHit(aim[0], aim[1], this.comet.x, this.comet.z, this.comet.radius * 1.2)) return { kind: 'comet' };
    if (this.enemyState.alive && circleHit(aim[0], aim[1], this.enemyState.x, this.enemyState.z, this.enemy.radius * 1.15)) return { kind: 'enemy' };
    const rock = this.rocks.hoverAt(aim[0], aim[1]);
    return rock ? { kind: 'rock', rock } : null;
  }

  private tooltipFor(hovered: Hovered, pointerPx: { x: number; y: number } | null): Parameters<FlightHud['setTooltip']>[0] {
    if (!hovered || !pointerPx) return null;
    if (hovered.kind === 'enemy') {
      const vitals = this.enemyState.vitals;
      return {
        title: this.spec.enemy.name,
        lines: [this.spec.enemy.hullName, `shield ${Math.ceil(vitals.shield)} / ${vitals.maxShield}`, `hull ${Math.ceil(vitals.hull)} / ${vitals.maxHull}`],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: ENEMY_ACCENT,
      };
    }
    if (hovered.kind === 'comet') {
      return {
        title: 'Comet',
        lines: [
          `shooting star · ${Math.ceil(this.comet.hp)} / ${this.comet.maxHp} hp`,
          `drops ${COMET_RESOURCES.map((kind) => RESOURCE_INFO[kind].label.toLowerCase()).join(', ')}`,
          'sheds chunks as you mine it',
        ],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: COMET_ACCENT,
      };
    }
    const rock = hovered.rock;
    const info = ROCK_KINDS[rock.kind];
    const size = rock.kind === 'giant' ? 'giant' : rock.radius >= 4 ? 'large' : rock.radius >= 2.5 ? 'medium' : 'small';
    return {
      title: `${info.label} rock`,
      lines: [`${size} · ${Math.ceil(rock.hp)} / ${rock.maxHp} hp`, `drops ${info.resources.map((kind) => RESOURCE_INFO[kind].label.toLowerCase()).join(', ')}`],
      x: pointerPx.x,
      y: pointerPx.y,
      accent: ROCK_BAR_COLOURS[rock.kind],
    };
  }

  /** Small health bars above every rock near the ship, and a bigger one over the comet. */
  private syncRockBars(): void {
    const entries: BarEntry[] = [];
    if (this.comet.alive && Math.hypot(this.comet.x - this.state.x, this.comet.z - this.state.z) < ROCK_BAR_RANGE * 2) {
      entries.push({
        x: this.comet.x,
        y: this.comet.radius + 2.2,
        z: this.comet.z,
        width: 12,
        height: 0.7,
        fraction: this.comet.hp / this.comet.maxHp,
        colour: COMET_ACCENT,
      });
    }
    for (const rock of this.rocks.overlapping(this.state.x, this.state.z, ROCK_BAR_RANGE)) {
      if (entries.length >= MAX_ROCK_BARS) break;
      const width = Math.min(7, Math.max(1.8, rock.radius * 1.1));
      entries.push({
        x: rock.x,
        y: rockTop(rock) + 0.9 + rock.radius * 0.15,
        z: rock.z,
        width,
        height: rock.kind === 'giant' ? 0.5 : 0.34,
        fraction: rock.hp / rock.maxHp,
        colour: ROCK_BAR_COLOURS[rock.kind],
      });
    }
    this.rockBars.sync(entries, this.rig.camera.quaternion);
  }

  /** Chip or shatter a rock; shattered rocks scatter resource pickups (more with mining tools). */
  private damageRock(rock: Rock, atX: number, atZ: number, amount: number, miningBonus = 1): void {
    const chipColour = rock.kind === 'ice' ? '#bfe0f0' : rock.kind === 'crystal' ? '#c9a6ff' : ROCK_CHIP_COLOUR;
    const hit = this.rocks.damage(rock, amount, this.effectsRng);
    if (hit.destroyed) {
      this.effects.burst(rock.x, rock.z, 14 + Math.round(rock.radius * 6), 6 + rock.radius * 2, chipColour);
      this.effects.flash(rock.x, rock.z, rock.radius * 2.5);
      if (rock.radius > 3) this.effects.shockwave(rock.x, rock.z, rock.radius * 3, '#c9b89a');
      for (const [kind, count] of Object.entries(dropsFor(rock, this.effectsRng, miningBonus))) {
        if (count) this.loot.spawn(rock.x, rock.z, kind as ResourceKind, count);
      }
    } else {
      this.effects.burst(atX, atZ, 6, 7, chipColour);
      this.effects.flash(atX, atZ, 1.6);
    }
  }

  private collect(collected: Partial<Record<ResourceKind, number>>, now: number): void {
    let any = false;
    for (const [kind, count] of Object.entries(collected) as Array<[ResourceKind, number | undefined]>) {
      if (!count) continue;
      this.cargo = { ...this.cargo, [kind]: this.cargo[kind] + count };
      any = true;
      if (kind === 'crystal') this.message = { text: `+${count} crystal`, until: now + 1.5 };
    }
    if (any) {
      this.effects.flash(this.state.x, this.state.z, 1.4);
      const first = (Object.keys(collected) as ResourceKind[])[0];
      if (first) this.effects.burst(this.state.x, this.state.z, 5, 6, RESOURCES[first].colour);
    }
  }

  private muzzleFlashes(events: readonly FireEvent[]): void {
    for (const event of events) this.effects.flash(event.x, event.z, event.mount.weapon.muzzleFlash);
  }

  /** Flak bursts at the end of its short flight, chipping anything nearby. */
  private flakPops(expired: readonly Projectile[]): void {
    for (const p of expired) {
      if (p.weapon.kind !== 'flak') continue;
      this.effects.flash(p.x, p.z, 1.3);
      this.effects.burst(p.x, p.z, 4, 5, p.weapon.colour);
    }
  }

  /** Missiles leave a thin smoke trail: one slow grey chip per frame. */
  private smokeTrails(projectiles: readonly Projectile[]): void {
    for (const p of projectiles) {
      if (p.weapon.trail) this.effects.burst(p.x, p.z, 1, 1.2, MISSILE_SMOKE);
    }
  }

  private groupMountCount(group: WeaponGroup): number {
    return group === 'beam' ? this.beamMounts.length : this.playerShots.countFor(group);
  }

  private weaponReadouts(): WeaponGroupReadout[] {
    return WEAPON_GROUPS.map((group) => {
      const mounts = this.groupMountCount(group.id);
      if (group.id === 'beam') {
        const profile = this.beamMounts[0]?.weapon;
        const readout = profile ? beamReadout(this.beam, profile) : { fill: 1, phase: 'ready' as const };
        return { id: group.id, key: group.key, label: group.label, mounts, active: this.activeGroup === group.id, ...readout };
      }
      const fill = this.playerShots.readiness(group.id);
      return { id: group.id, key: group.key, label: group.label, mounts, active: this.activeGroup === group.id, fill, phase: fill >= 1 ? 'ready' : 'cooldown' };
    });
  }

  /** Charge while the trigger is held on the beam group; discharge every beam mount at full charge. */
  private updateBeam(dt: number, holding: boolean, now: number): void {
    const lead = this.beamMounts[0]?.weapon;
    if (!lead) return;
    const step = stepBeam(this.beam, dt, holding && this.playerDeadUntil === null, lead);
    this.beam = step.state;
    if (!step.fire) return;

    const shots: BeamShot[] = [];
    for (const mount of this.beamMounts) {
      const profile = mount.weapon;
      const [x0, z0] = shipToWorld(this.state, mount.position);
      // Each beam leaves its own muzzle towards the cursor, so beams cross when the cursor is close.
      const [fx, fz] = aimDirection(x0, z0, this.state.heading, this.aim);
      const range = profile.range ?? 60;
      let reach = range;
      let hitRock: Rock | null = null;
      let hitEnemy = false;
      let hitComet = false;
      if (this.enemyState.alive) {
        const t = rayCircle(x0, z0, fx, fz, this.enemyState.x, this.enemyState.z, this.enemy.radius);
        if (t !== null && t < reach) {
          reach = t;
          hitEnemy = true;
        }
      }
      if (this.comet.alive) {
        const t = rayCircle(x0, z0, fx, fz, this.comet.x, this.comet.z, this.comet.radius);
        if (t !== null && t < reach) {
          reach = t;
          hitComet = true;
          hitEnemy = false;
        }
      }
      for (const rock of this.rocks.overlapping(x0 + fx * range * 0.5, z0 + fz * range * 0.5, range * 0.5 + 8)) {
        const t = rayCircle(x0, z0, fx, fz, rock.x, rock.z, rock.radius);
        if (t !== null && t < reach) {
          reach = t;
          hitRock = rock;
          hitEnemy = false;
          hitComet = false;
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
      this.effects.flash(x0, z0, profile.muzzleFlash);
      if (profile.beamStyle === 'siege') this.effects.shockwave(x0, z0, 4, profile.colour);
      if (hitEnemy) {
        const roll = rollDamage(profile.damage, this.damageRng);
        const result = this.hurtEnemy(roll.amount, now, x1, z1);
        this.markHit(x1, z1, roll.amount, roll.kind, result.hullDamage > 0 ? 'hull' : 'shield');
        this.effects.burst(x1, z1, 12, 10, profile.colour);
      } else if (hitComet) {
        const roll = rollDamage(profile.rockDamage ?? profile.damage, this.damageRng);
        this.mineComet(x1, z1, roll.amount, profile.mining ?? 1, now);
        this.markHit(x1, z1, roll.amount, roll.kind, 'rock');
      } else if (hitRock) {
        this.effects.burst(x1, z1, 10, 9, profile.colour);
        const roll = rollDamage(profile.rockDamage ?? profile.damage, this.damageRng);
        this.damageRock(hitRock, x1, z1, roll.amount, profile.mining ?? 1);
        this.markHit(x1, z1, roll.amount, roll.kind, 'rock');
      }
      if (profile.beamStyle === 'siege' && reach < range) this.effects.shockwave(x1, z1, 6, profile.colour);
    }
    this.beamSeed += 1;
    this.beam = addBeamShots(this.beam, shots);
  }

  /** Charge glows at each muzzle and the fading beam ribbons. */
  private updateBeamVisuals(time: number): void {
    this.beamMounts.forEach((mount, i) => {
      const charge = this.chargeSprites[i]!;
      const [mx, mz] = shipToWorld(this.state, mount.position);
      charge.position.set(mx, mount.position[1], mz);
      charge.visible = this.beam.charge > 0 && this.playerDeadUntil === null;
      const pulse = 1 + 0.12 * Math.sin(time * 28);
      const size = (0.8 + this.beam.charge * 3.6) * pulse;
      charge.scale.set(size, size, 1);
      (charge.material as SpriteMaterial).opacity = 0.15 + this.beam.charge * 0.75;
    });
    const visuals: BeamVisual[] = this.beam.shots.map((shot, index) => ({
      x0: shot.x0,
      z0: shot.z0,
      x1: shot.x1,
      z1: shot.z1,
      y: shot.y ?? BEAM_HEIGHT,
      width: shot.width ?? 0.5,
      colour: shot.colour ?? '#7fe3ff',
      fade: Math.min(1, shot.timeLeft / shot.duration),
      style: shot.style ?? 'lance',
      seed: this.beamSeed * 10 + index,
    }));
    this.beamRenderer.sync(visuals, time);
  }

  private hurtEnemy(amount: number, now: number, atX: number, atZ: number): DamageResult {
    const result = applyDamage(this.enemyState.vitals, amount, now);
    this.enemyState = { ...this.enemyState, vitals: result.vitals };
    if (result.shieldAbsorbed > 0) this.enemy.shieldHit(atX, atZ);
    this.effects.flash(atX, atZ, result.hullDamage > 0 ? 2.4 : 1.6);
    if (result.hullDamage > 0) this.effects.burst(atX, atZ, 8, 9, this.spec.enemy.colours.trim);
    if (result.destroyed) {
      this.explode(this.enemyState.x, this.enemyState.z, this.enemy.radius, this.spec.enemy.colours.main, ENEMY_ACCENT);
      this.enemyState = killEnemy(this.enemyState, now);
      this.enemy.group.visible = false;
      this.enemyShots.clear();
      this.kills += 1;
      this.message = { text: 'Raider destroyed', until: now + 3 };
    }
    return result;
  }

  private hurtPlayer(amount: number, now: number, atX: number, atZ: number): void {
    if (amount <= 0) return;
    const result = applyDamage(this.playerVitals, amount, now);
    this.playerVitals = result.vitals;
    if (result.shieldAbsorbed > 0) this.player.shieldHit(atX, atZ);
    if (result.hullDamage > 0) {
      this.effects.flash(atX, atZ, 2.2);
      this.effects.burst(atX, atZ, 8, 9, this.spec.player.colours.trim);
    }
    if (result.destroyed) {
      this.explode(this.state.x, this.state.z, this.player.radius, this.spec.player.colours.main, this.spec.player.colours.trim);
      this.player.group.visible = false;
      this.playerDeadUntil = now + COMBAT_TUNING.playerRespawnDelay;
      this.deaths += 1;
      this.message = { text: 'Ship destroyed. Respawning...', until: now + COMBAT_TUNING.playerRespawnDelay };
    }
  }

  private explode(x: number, z: number, radius: number, hullColour: string, accent: string): void {
    this.effects.burst(x, z, 110, 28, hullColour);
    this.effects.burst(x, z, 50, 16, accent);
    this.effects.burst(x, z, 40, 40, '#ffffff');
    this.effects.flash(x, z, radius * 5);
    this.effects.shockwave(x, z, radius * 3.2, accent);
    this.effects.shockwave(x, z, radius * 2.0, '#ffffff');
  }

  private respawnPlayer(): void {
    this.playerDeadUntil = null;
    this.state = INITIAL_FLIGHT_STATE;
    this.playerVitals = createVitals(COMBAT_TUNING.playerShield, COMBAT_TUNING.playerHull);
    this.player.group.visible = true;
    this.rig.snapTo(0, 0);
    this.effects.flash(0, 0, this.player.radius * 3);
    this.effects.shockwave(0, 0, this.player.radius * 3, SHIELD_COLOUR);
  }

  private updateLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const camera = this.rig.camera;
    this.hitMarkers.update(this.lastDt, camera, width, height);
    const playerScreen = this.playerDeadUntil === null ? project(camera, this.state.x, LABEL_HEIGHT, this.state.z, width, height) : null;
    this.labels.update('player', playerScreen, { name: this.spec.player.name, vitals: this.playerVitals, accent: this.spec.player.colours.trim });
    const enemyScreen = this.enemyState.alive ? project(camera, this.enemyState.x, LABEL_HEIGHT, this.enemyState.z, width, height) : null;
    this.labels.update('enemy', enemyScreen, { name: this.spec.enemy.name, vitals: this.enemyState.vitals, accent: ENEMY_ACCENT });

    if (this.comet.alive) {
      projected.set(this.comet.x, 0.5, this.comet.z).project(camera);
      const onScreen = projected.z < 1 && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98;
      // Behind the camera the projection flips; mirror it so the arrow still points the right way.
      const flip = projected.z > 1 ? -1 : 1;
      this.hud.setCometIndicator({
        screen: { x: ((projected.x * flip + 1) / 2) * width, y: ((1 - projected.y * flip) / 2) * height },
        onScreen,
        distance: Math.hypot(this.comet.x - this.state.x, this.comet.z - this.state.z),
        width,
        height,
      });
    } else {
      this.hud.setCometIndicator(null);
    }
  }
}

const projected = new Vector3();

/** World point to CSS pixels, or null when off screen. */
function project(camera: Camera, x: number, y: number, z: number, width: number, height: number): { x: number; y: number } | null {
  projected.set(x, y, z).project(camera);
  if (projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) return null;
  return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
}
