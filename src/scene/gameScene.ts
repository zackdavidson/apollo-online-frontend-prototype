import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  HemisphereLight,
  NoToneMapping,
  Plane,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Beacon } from '../game/beacons';
import type { Hazard } from '../game/hazards';
import type { CometState } from '../game/comet';
import type { Pickup } from '../game/loot';
import type { ResolvedScenery } from '../game/map';
import type { Projectile } from '../game/projectiles';
import { createRng } from '../game/random';
import type { Rock } from '../game/rocks';
import { BeaconRenderer } from './beaconRenderer';
import { HazardRenderer } from './hazardRenderer';
import { BeamRenderer, type BeamVisual } from './beamRenderer';
import { CameraRig, type CameraMode } from './cameraRig';
import { CometVisual } from './cometVisual';
import { EffectsSystem, createGlowTexture } from './effects';
import { InstancedBars, type BarEntry } from './healthBars';
import { createDefaultCatalog } from '../catalog/catalog';
import { defaultItemCatalog } from '../game/items';
import type { SurfaceMesh } from '../core/mesh';
import type { ShipColours } from '../core/palette';
import { ItemSpriteAtlas } from './itemSprites';
import { LootRenderer } from './lootRenderer';
import { createBoundary, createParallaxWorld, type ParallaxWorld } from './parallax';
import { BACKGROUND_LAYER, OVERLAY_LAYER, Pixelator, type PixelScope } from './pixelate';
import { ProjectileRenderer } from './projectileRenderer';
import { RockRenderer } from './rockRenderer';
import { ShipActor, type ShipVisualSpec } from './shipActor';
import { WarpTunnel } from './warpTunnel';

export interface SceneOptions {
  readonly seed: number;
  readonly halfExtent: number;
  readonly boundaryColour: string;
  readonly scenery: ResolvedScenery;
}

export interface ShipPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** 0 idle, 1 full thrust, above 1 for boost. */
  readonly throttle: number;
  readonly visible: boolean;
  /** Random positional shake in world units (warp spool-up). */
  readonly jitter?: number;
}

export interface ChargeGlow {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly colour: string;
  /** 0..1 charge; sizes and brightens the glow. */
  readonly charge: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

const MAX_HEALTH_BARS = 640;
const MAX_CHARGE_GLOWS = 8;
const projected = new Vector3();

/**
 * Everything drawn in the flight view, behind an API that speaks in game
 * terms: ships by id, rocks, loot, shots, beams, the comet, effects and
 * the camera. It never reads the simulation; the session (or a network
 * client) pushes state in every frame and plays effects for events.
 */
export class GameScene {
  readonly camera = new CameraRig();
  private readonly renderer: WebGLRenderer;
  private readonly pixelator: Pixelator;
  private readonly scene = new Scene();
  private readonly world: ParallaxWorld;
  private readonly ships = new Map<string, ShipActor>();
  private readonly rockRenderer = new RockRenderer();
  private readonly lootRenderer: LootRenderer;
  /** Every item rendered once to a sprite; drops and inventory icons draw from it. */
  readonly items: ItemSpriteAtlas;
  private readonly shotRenderer = new ProjectileRenderer();
  private readonly beamRenderer = new BeamRenderer();
  private readonly bars = new InstancedBars(MAX_HEALTH_BARS);
  private readonly effects: EffectsSystem;
  private readonly glowTexture = createGlowTexture();
  private readonly cometVisual: CometVisual;
  private readonly beacons: BeaconRenderer;
  private readonly hazards: HazardRenderer;
  private readonly tunnel: WarpTunnel;
  private readonly chargeGlows: Sprite[] = [];
  private readonly raycaster = new Raycaster();
  private readonly shipPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly canvasHost: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private rocks: readonly Rock[] = [];
  private hoveredRockId: string | null = null;
  private pickups: readonly Pickup[] = [];
  private hoveredPickupId: number | null = null;
  private projectiles: readonly Projectile[] = [];
  private beams: readonly BeamVisual[] = [];
  private comet: CometState | null = null;
  private cometHovered = false;
  private warpOverlay = { opacity: 0, intensity: 0 };

  constructor(
    private readonly container: HTMLElement,
    options: SceneOptions,
  ) {
    this.canvasHost = document.createElement('div');
    this.canvasHost.className = 'flight-canvas';
    container.append(this.canvasHost);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = NoToneMapping;
    this.canvasHost.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x05060c);
    this.pixelator = new Pixelator(this.renderer);
    this.items = new ItemSpriteAtlas(this.renderer, createDefaultCatalog(), defaultItemCatalog());
    this.items.renderAll();
    this.lootRenderer = new LootRenderer(this.items, OVERLAY_LAYER);

    this.scene.add(new HemisphereLight(0xbfd4ff, 0x1a1a24, 0.8));
    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(-30, 90, -50);
    this.scene.add(key);

    // The 2D backdrop lives on its own layer so it can stay sharp when only the 3D is pixelated.
    this.world = createParallaxWorld(createRng(options.seed), options.halfExtent, options.scenery);
    for (const object of [...this.world.layers, createBoundary(options.halfExtent, options.boundaryColour)]) {
      object.traverse((child) => child.layers.set(BACKGROUND_LAYER));
      this.scene.add(object);
    }

    this.effects = new EffectsSystem(createRng(options.seed + 1));
    this.cometVisual = new CometVisual(createRng(options.seed + 6), this.glowTexture);
    this.beacons = new BeaconRenderer(this.glowTexture);
    this.hazards = new HazardRenderer(this.glowTexture);
    this.tunnel = new WarpTunnel(createRng(options.seed + 7));
    container.append(this.tunnel.canvas);
    this.scene.add(
      this.rockRenderer.mesh,
      this.rockRenderer.gems,
      this.rockRenderer.outline,
      this.lootRenderer.group,
      this.shotRenderer.group,
      this.beamRenderer.mesh,
      this.effects,
      this.cometVisual,
      this.beacons,
      this.hazards,
      this.bars.group,
    );
    // Health bars stay crisp whatever the pixelation setting.
    this.bars.group.traverse((child) => child.layers.set(OVERLAY_LAYER));
    for (let i = 0; i < MAX_CHARGE_GLOWS; i++) {
      const sprite = new Sprite(new SpriteMaterial({ map: this.glowTexture, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      sprite.visible = false;
      this.chargeGlows.push(sprite);
      this.scene.add(sprite);
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** The element to attach pointer handlers to. */
  get surface(): HTMLElement {
    return this.canvasHost;
  }

  get size(): { readonly width: number; readonly height: number } {
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  get planetPositions(): ReadonlyArray<readonly [number, number]> {
    return this.world.planetPositions;
  }

  // ---- ships ---------------------------------------------------------------

  addShip(id: string, spec: ShipVisualSpec): void {
    if (this.ships.has(id)) this.removeShip(id);
    const actor = new ShipActor(spec);
    this.ships.set(id, actor);
    this.scene.add(actor.group);
  }

  removeShip(id: string): void {
    const actor = this.ships.get(id);
    if (!actor) return;
    this.scene.remove(actor.group);
    actor.dispose();
    this.ships.delete(id);
  }

  hasShip(id: string): boolean {
    return this.ships.has(id);
  }

  setShipPose(id: string, pose: ShipPose): void {
    const actor = this.ships.get(id);
    if (!actor) return;
    actor.group.visible = pose.visible;
    actor.place(pose.x, pose.z, pose.heading, pose.jitter ?? 0);
    actor.mesh.setThrottle(pose.throttle);
  }

  setShipShield(id: string, fraction: number): void {
    this.ships.get(id)?.setShield(fraction);
  }

  shipShieldHit(id: string, x: number, z: number): void {
    this.ships.get(id)?.shieldHit(x, z);
  }

  setShipOutlined(id: string, outlined: boolean): void {
    this.ships.get(id)?.setOutlined(outlined);
  }

  shipColours(id: string): ShipVisualSpec['colours'] | null {
    return this.ships.get(id)?.spec.colours ?? null;
  }

  // ---- world content -------------------------------------------------------

  syncRocks(rocks: readonly Rock[], hoveredRockId: string | null): void {
    this.rocks = rocks;
    this.hoveredRockId = hoveredRockId;
  }

  syncLoot(pickups: readonly Pickup[], hoveredId: number | null = null): void {
    this.hoveredPickupId = hoveredId;
    this.pickups = pickups;
  }

  syncProjectiles(projectiles: readonly Projectile[]): void {
    this.projectiles = projectiles;
  }

  syncBeams(beams: readonly BeamVisual[]): void {
    this.beams = beams;
  }

  syncComet(comet: CometState | null, hovered: boolean): void {
    this.comet = comet;
    this.cometHovered = hovered;
  }

  /** Beacons are static; set them once per map. */
  setBeacons(beacons: readonly Beacon[]): void {
    this.beacons.setBeacons(beacons);
  }

  /** A portrait of a ship surface for the HUD, rendered once like the item sprites. */
  shipPortrait(surface: SurfaceMesh, colours: ShipColours): string {
    return this.items.renderSurface(surface, colours, { yaw: 0.85, pitch: 0.5, zoom: 1.55 }, 128);
  }

  /** Data URLs of every item's sprite, for DOM inventories and tooltips. */
  itemIconUrls(): Readonly<Record<string, string>> {
    return this.items.iconUrls();
  }

  /**
   * Gas clouds and other area hazards; static per map. They live on the
   * overlay layer, so pixelation leaves them alone: the pixelator's small
   * buffer would both chunk them and blow their point sizes up.
   */
  setHazards(hazards: readonly Hazard[]): void {
    this.hazards.setHazards(hazards);
    this.hazards.traverse((child) => child.layers.set(OVERLAY_LAYER));
  }

  setHazardHovered(id: string | null): void {
    this.hazards.setHovered(id);
  }

  /** Gas thins around this point (the player's ship) so it stays visible inside a cloud. */
  setHazardFocus(point: { readonly x: number; readonly z: number; readonly radius: number } | null): void {
    this.hazards.setFocus(point);
  }

  syncHealthBars(entries: readonly BarEntry[]): void {
    this.bars.sync(entries, this.camera.camera.quaternion);
  }

  setChargeGlows(glows: readonly ChargeGlow[], time: number): void {
    this.chargeGlows.forEach((sprite, i) => {
      const glow = glows[i];
      if (!glow || glow.charge <= 0) {
        sprite.visible = false;
        return;
      }
      const material = sprite.material as SpriteMaterial;
      material.color.set(glow.colour);
      const pulse = 1 + 0.12 * Math.sin(time * 28);
      const size = (0.8 + glow.charge * 3.6) * pulse;
      sprite.position.set(glow.x, glow.y, glow.z);
      sprite.scale.set(size, size, 1);
      material.opacity = 0.15 + glow.charge * 0.75;
      sprite.visible = true;
    });
  }

  // ---- effects -------------------------------------------------------------

  flash(x: number, z: number, size: number): void {
    this.effects.flash(x, z, size);
  }

  burst(x: number, z: number, count: number, speed: number, colour: string): void {
    this.effects.burst(x, z, count, speed, colour);
  }

  shockwave(x: number, z: number, radius: number, colour: string): void {
    this.effects.shockwave(x, z, radius, colour);
  }

  /** Big ship-death explosion in the ship's colours. */
  explode(x: number, z: number, radius: number, hullColour: string, accent: string): void {
    this.effects.burst(x, z, 110, 28, hullColour);
    this.effects.burst(x, z, 50, 16, accent);
    this.effects.burst(x, z, 40, 40, '#ffffff');
    this.effects.flash(x, z, radius * 5);
    this.effects.shockwave(x, z, radius * 3.2, accent);
    this.effects.shockwave(x, z, radius * 2.0, '#ffffff');
  }

  setWarpOverlay(opacity: number, intensity: number): void {
    this.warpOverlay = { opacity, intensity };
  }

  // ---- camera and pixelation -----------------------------------------------

  get cameraMode(): CameraMode {
    return this.camera.mode;
  }

  setPixelation(level: number, scope: PixelScope): void {
    this.pixelator.setLevel(level);
    this.pixelator.setScope(scope);
  }

  get pixelLevel(): number {
    return this.pixelator.levelIndex;
  }

  get pixelScope(): PixelScope {
    return this.pixelator.currentScope;
  }

  // ---- queries -------------------------------------------------------------

  /** Where a normalised device coordinate hits the ship plane. */
  aimPoint(ndcX: number, ndcY: number): readonly [number, number] | null {
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera.camera);
    const hit = this.raycaster.ray.intersectPlane(this.shipPlane, new Vector3());
    return hit ? [hit.x, hit.z] : null;
  }

  /** World point to CSS pixels, or null when well outside the view. */
  project(x: number, y: number, z: number): ScreenPoint | null {
    projected.set(x, y, z).project(this.camera.camera);
    if (projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) return null;
    const { width, height } = this.size;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
  }

  /** Projection without clipping, flagging points behind the camera and whether they are on screen. */
  projectRaw(x: number, y: number, z: number): { readonly screen: ScreenPoint; readonly onScreen: boolean } {
    projected.set(x, y, z).project(this.camera.camera);
    const onScreen = projected.z < 1 && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98;
    const flip = projected.z > 1 ? -1 : 1;
    const { width, height } = this.size;
    return { screen: { x: ((projected.x * flip + 1) / 2) * width, y: ((1 - projected.y * flip) / 2) * height }, onScreen };
  }

  // ---- frame ---------------------------------------------------------------

  /** Push the latest synced state into the GPU objects and advance animations. */
  update(dt: number, time: number): void {
    this.effects.update(dt);
    for (const actor of this.ships.values()) actor.update(dt, time);
    this.rockRenderer.sync(this.rocks, time, this.hoveredRockId === null ? null : (this.rocks.find((rock) => rock.id === this.hoveredRockId) ?? null));
    this.lootRenderer.sync(this.pickups, time, this.hoveredPickupId);
    this.shotRenderer.sync(this.projectiles);
    this.beamRenderer.sync(this.beams, time);
    if (this.comet) this.cometVisual.update(this.comet, dt, time, this.cometHovered);
    this.beacons.update(time);
    this.hazards.update(dt, time);
    this.tunnel.update(dt, this.warpOverlay.opacity, this.warpOverlay.intensity);
    this.world.update(this.camera.mode, this.camera.height, this.camera.camera.position.x, this.camera.camera.position.z, time);
  }

  render(): void {
    this.pixelator.render(this.scene, this.camera.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const id of [...this.ships.keys()]) this.removeShip(id);
    this.world.dispose();
    this.rockRenderer.dispose();
    this.lootRenderer.dispose();
    this.items.dispose();
    this.shotRenderer.dispose();
    this.beamRenderer.dispose();
    this.bars.dispose();
    this.effects.dispose();
    this.cometVisual.dispose();
    this.beacons.dispose();
    this.hazards.dispose();
    this.tunnel.dispose();
    for (const sprite of this.chargeGlows) (sprite.material as SpriteMaterial).dispose();
    this.glowTexture.dispose();
    this.pixelator.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvasHost.remove();
  }

  private resize(): void {
    const { width, height } = this.size;
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.setAspect(Math.max(1, width) / Math.max(1, height));
    this.tunnel.resize(Math.max(1, width), Math.max(1, height), Math.min(window.devicePixelRatio, 1.5));
  }
}
