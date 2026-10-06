import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  NoToneMapping,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MaterialDefinition } from '../core/materials';
import type { Bounds, SurfaceMesh } from '../core/mesh';
import type { ShipColours } from '../core/palette';
import type { SlotDefinition, SlotId } from '../core/types';
import { ShipMesh } from './shipMesh';
import { SlotMarkers } from './slotMarkers';

export interface SceneViewEvents {
  onSlotClick?: (slotId: SlotId) => void;
  onSlotHover?: (slotId: SlotId | null) => void;
}

const CLICK_DRAG_TOLERANCE_PX = 5;
const FRAME_MARGIN = 0.9;

/** Owns the Three.js scene, camera, controls and picking for the builder viewport. */
export class SceneView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly shipMesh: ShipMesh;
  private readonly slotMarkers = new SlotMarkers();
  private readonly grid: GridHelper;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly resizeObserver: ResizeObserver;
  private hovered: SlotId | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;
  private frameHandle = 0;
  private active = true;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: SceneViewEvents = {},
    initialColours: ShipColours,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x14161c);
    this.camera = new PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(16, 11, 18);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 70;
    this.controls.maxPolarAngle = Math.PI * 0.95;

    this.scene.add(new AmbientLight(0xffffff, 0.25));
    this.scene.add(new HemisphereLight(0xcfe0ff, 0x3a3842, 1.0));
    const key = new DirectionalLight(0xffffff, 2.0);
    key.position.set(8, 14, 10);
    this.scene.add(key);
    const fill = new DirectionalLight(0x9fb4ff, 0.7);
    fill.position.set(-10, 4, -12);
    this.scene.add(fill);

    this.grid = new GridHelper(80, 80, 0x3a4150, 0x23272f);
    this.grid.position.y = -3;
    this.scene.add(this.grid);

    this.shipMesh = new ShipMesh(initialColours);
    this.shipMesh.setThrottle(0.65);
    this.scene.add(this.shipMesh, this.slotMarkers);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.frameHandle = requestAnimationFrame(this.renderFrame);
  }

  setShip(surface: SurfaceMesh, colours: ShipColours): void {
    this.shipMesh.setColours(colours);
    this.shipMesh.setSurface(surface);
  }

  setColours(colours: ShipColours): void {
    this.shipMesh.setColours(colours);
  }

  setMaterial(material: MaterialDefinition): void {
    this.shipMesh.setMaterial(material);
  }

  /**
   * Move the camera so the whole ship fits in view, keeping the current
   * viewing direction. Called when the hull changes, not on every tweak, so
   * the player's chosen angle is not disturbed while fitting parts.
   */
  frameShip(shipBounds: Bounds): void {
    const bounds = new Box3(new Vector3(...shipBounds.min), new Vector3(...shipBounds.max));
    if (bounds.isEmpty()) return;
    const centre = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() / 2;
    this.grid.position.y = bounds.min.y - 1.5;

    const verticalFov = (this.camera.fov * Math.PI) / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const fov = Math.min(verticalFov, horizontalFov);
    const distance = (radius / Math.sin(fov / 2)) * FRAME_MARGIN;

    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(0.6, 0.45, 0.65).normalize();
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).addScaledVector(direction, distance);
    this.controls.update();
  }

  setSlots(slots: readonly SlotDefinition[], emptySlotIds: ReadonlySet<SlotId>): void {
    this.slotMarkers.setSlots(slots, emptySlotIds);
  }

  setSlotMarkersVisible(visible: boolean): void {
    this.slotMarkers.visible = visible;
  }

  setOutlineVisible(visible: boolean): void {
    this.shipMesh.setOutlineVisible(visible);
  }

  /** Triangles currently drawn for the ship. */
  get shipTriangleCount(): number {
    return this.shipMesh.triangleCount;
  }

  highlightSlot(slotId: SlotId | null): void {
    this.slotMarkers.setHighlight(slotId ?? this.hovered);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.shipMesh.dispose();
    this.slotMarkers.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  /** Pause or resume rendering, e.g. while another view owns the screen. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) this.frameHandle = requestAnimationFrame(this.renderFrame);
    else cancelAnimationFrame(this.frameHandle);
  }

  private readonly renderFrame = (): void => {
    this.controls.update();
    this.shipMesh.update(performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
    this.frameHandle = requestAnimationFrame(this.renderFrame);
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private pickSlot(event: PointerEvent): SlotId | null {
    if (!this.slotMarkers.visible) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.slotMarkers.pick(this.raycaster);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.pointerDownAt) return;
    const slotId = this.pickSlot(event);
    if (slotId === this.hovered) return;
    this.hovered = slotId;
    this.renderer.domElement.style.cursor = slotId ? 'pointer' : '';
    this.slotMarkers.setHighlight(slotId);
    this.events.onSlotHover?.(slotId);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!start || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > CLICK_DRAG_TOLERANCE_PX) return;
    const slotId = this.pickSlot(event);
    if (slotId) this.events.onSlotClick?.(slotId);
  };

  private readonly onPointerLeave = (): void => {
    this.pointerDownAt = null;
    if (this.hovered === null) return;
    this.hovered = null;
    this.slotMarkers.setHighlight(null);
    this.events.onSlotHover?.(null);
  };
}
