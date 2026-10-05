import { CanvasTexture, Color, DirectionalLight, HemisphereLight, OrthographicCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three';
import type { Catalog } from '../catalog/catalog';
import { meshBounds } from '../core/mesh';
import { DEFAULT_COLOURS } from '../core/palette';
import { partMesh } from '../core/ship';
import type { ItemCatalog, ItemDefinition, ItemId } from '../game/items';
import { ShipMesh } from '../render/shipMesh';

/**
 * Old-school item sprites: each item's 3D model is rendered once, at start,
 * into a small transparent image from a fixed three-quarter angle. The
 * result is reused everywhere the item shows up: as a billboard for drops
 * on the ground and as an icon in the inventory, so a hundred stones on the
 * floor cost a hundred quads, not a hundred meshes.
 */
export class ItemSpriteAtlas {
  private readonly textures = new Map<ItemId, CanvasTexture>();
  private readonly icons = new Map<ItemId, string>();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly parts: Catalog,
    private readonly items: ItemCatalog,
    private readonly size = 96,
  ) {}

  /** Render every item in the catalog. Call once after the renderer exists; safe to call again to rebuild. */
  renderAll(): void {
    const target = new WebGLRenderTarget(this.size, this.size, { colorSpace: SRGBColorSpace });
    const scene = new Scene();
    scene.add(new HemisphereLight(0xdfe8ff, 0x1a1a24, 1.0));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 4, -3);
    scene.add(key);
    const fill = new DirectionalLight(0x9fb4ff, 0.6);
    fill.position.set(3, 1, 2);
    scene.add(fill);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    const pixels = new Uint8Array(this.size * this.size * 4);

    const previousTarget = this.renderer.getRenderTarget();
    const previousColour = new Color();
    this.renderer.getClearColor(previousColour);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);

    for (const item of this.items.items) {
      const mesh = this.buildMesh(item);
      if (!mesh) continue;
      scene.add(mesh.mesh);
      this.frame(camera, mesh.bounds, item);
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(scene, camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, this.size, this.size, pixels);
      scene.remove(mesh.mesh);
      mesh.mesh.dispose();
      const canvas = toCanvas(pixels, this.size);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      this.textures.get(item.id)?.dispose();
      this.textures.set(item.id, texture);
      this.icons.set(item.id, canvas.toDataURL('image/png'));
    }

    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColour, previousAlpha);
    target.dispose();
  }

  textureFor(id: ItemId): CanvasTexture | undefined {
    return this.textures.get(id);
  }

  iconUrl(id: ItemId): string | undefined {
    return this.icons.get(id);
  }

  /** Every icon as a data URL, for the DOM side (inventory, tooltips). */
  iconUrls(): Readonly<Record<ItemId, string>> {
    return Object.fromEntries(this.icons);
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.icons.clear();
  }

  private buildMesh(item: ItemDefinition): { mesh: ShipMesh; bounds: ReturnType<typeof meshBounds> } | null {
    const model = item.visual.model;
    const primitives = model.kind === 'attachment' ? this.parts.findAttachment(model.attachmentId)?.primitives : model.primitives;
    if (!primitives || primitives.length === 0) return null;
    const surface = partMesh(primitives);
    const mesh = new ShipMesh({ ...DEFAULT_COLOURS, ...(model.kind === 'primitives' ? model.colours : {}) });
    mesh.setSurface(surface);
    return { mesh, bounds: meshBounds(surface) };
  }

  /** Point the camera at the model's bounds from the item's chosen three-quarter angle. */
  private frame(camera: OrthographicCamera, bounds: ReturnType<typeof meshBounds>, item: ItemDefinition): void {
    const centre = new Vector3((bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2);
    const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) || 1;
    const sprite = item.visual.sprite ?? {};
    const yaw = sprite.yaw ?? 0.8;
    const pitch = sprite.pitch ?? 0.55;
    const half = (extent * 0.68) / (sprite.zoom ?? 1);
    const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.position.copy(centre).addScaledVector(direction, 20);
    camera.lookAt(centre);
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0.1;
    camera.far = 60;
    camera.updateProjectionMatrix();
  }
}

/** GPU pixels come bottom-up; flip them into a canvas the DOM and textures can use. */
function toCanvas(pixels: Uint8Array, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(size, size);
  const rowBytes = size * 4;
  for (let y = 0; y < size; y++) {
    const source = (size - 1 - y) * rowBytes;
    image.data.set(pixels.subarray(source, source + rowBytes), y * rowBytes);
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
