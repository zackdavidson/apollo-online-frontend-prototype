import { CanvasTexture, Color, DirectionalLight, HemisphereLight, OrthographicCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three';
import type { Catalog } from '../catalog/catalog';
import { meshBounds, type Bounds, type SurfaceMesh } from '../core/mesh';
import { DEFAULT_COLOURS, type ShipColours } from '../core/palette';
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
  /** Solid white, dilated copies of each sprite: the hover outline, drawn behind the item at the same scale. */
  private readonly outlines = new Map<ItemId, CanvasTexture>();
  private readonly icons = new Map<ItemId, string>();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly parts: Catalog,
    private readonly items: ItemCatalog,
    private readonly size = 96,
  ) {}

  /** Render every item in the catalog. Call once after the renderer exists; safe to call again to rebuild. */
  renderAll(): void {
    this.withStage(this.size, (stage) => {
      for (const item of this.items.items) {
        const mesh = this.buildMesh(item);
        if (!mesh) continue;
        const canvas = stage.render(mesh.mesh, mesh.bounds, item.visual.sprite ?? {});
        mesh.mesh.dispose();
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        this.textures.get(item.id)?.dispose();
        this.textures.set(item.id, texture);
        const outline = new CanvasTexture(outlineOf(canvas, OUTLINE_PX));
        outline.colorSpace = SRGBColorSpace;
        this.outlines.get(item.id)?.dispose();
        this.outlines.set(item.id, outline);
        this.icons.set(item.id, canvas.toDataURL('image/png'));
      }
    });
  }

  /** A one-off portrait of any surface (a whole ship, say) as a data URL, framed like the item sprites. */
  renderSurface(surface: SurfaceMesh, colours: ShipColours, framing: SpriteFraming = {}, size = 128): string {
    let url = '';
    this.withStage(size, (stage) => {
      const mesh = new ShipMesh(colours);
      mesh.setSurface(surface);
      url = stage.render(mesh, meshBounds(surface), framing).toDataURL('image/png');
      mesh.dispose();
    });
    return url;
  }

  /** A lit scene, an orthographic camera and a render target of `size`, torn down after `work`. */
  private withStage(size: number, work: (stage: { render(mesh: ShipMesh, bounds: Bounds, framing: SpriteFraming): HTMLCanvasElement }) => void): void {
    const target = new WebGLRenderTarget(size, size, { colorSpace: SRGBColorSpace });
    const scene = new Scene();
    scene.add(new HemisphereLight(0xdfe8ff, 0x1a1a24, 1.0));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 4, -3);
    scene.add(key);
    const fill = new DirectionalLight(0x9fb4ff, 0.6);
    fill.position.set(3, 1, 2);
    scene.add(fill);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    const pixels = new Uint8Array(size * size * 4);

    const previousTarget = this.renderer.getRenderTarget();
    const previousColour = new Color();
    this.renderer.getClearColor(previousColour);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);

    work({
      render: (mesh, bounds, framing) => {
        scene.add(mesh);
        frameCamera(camera, bounds, framing);
        this.renderer.setRenderTarget(target);
        this.renderer.clear();
        this.renderer.render(scene, camera);
        this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        scene.remove(mesh);
        return toCanvas(pixels, size);
      },
    });

    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColour, previousAlpha);
    target.dispose();
  }

  textureFor(id: ItemId): CanvasTexture | undefined {
    return this.textures.get(id);
  }

  /** The item's hover outline: its silhouette grown by a few pixels, in white, on the same canvas size. */
  outlineTextureFor(id: ItemId): CanvasTexture | undefined {
    return this.outlines.get(id);
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
    for (const texture of this.outlines.values()) texture.dispose();
    this.textures.clear();
    this.outlines.clear();
    this.icons.clear();
  }

  private buildMesh(item: ItemDefinition): { mesh: ShipMesh; bounds: Bounds } | null {
    const model = item.visual.model;
    const primitives = model.kind === 'attachment' ? this.parts.findAttachment(model.attachmentId)?.primitives : model.primitives;
    if (!primitives || primitives.length === 0) return null;
    const surface = partMesh(primitives);
    const mesh = new ShipMesh({ ...DEFAULT_COLOURS, ...(model.kind === 'primitives' ? model.colours : {}) });
    mesh.setSurface(surface);
    return { mesh, bounds: meshBounds(surface) };
  }

}

export interface SpriteFraming {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly zoom?: number;
}

/** Point the camera at the model's bounds from a three-quarter angle. */
function frameCamera(camera: OrthographicCamera, bounds: Bounds, sprite: SpriteFraming): void {
  const centre = new Vector3((bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2);
  const extent = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) || 1;
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

/** Outline thickness in sprite pixels: about a tenth of the 96 px sprite, so it stays a bold edge at play zoom. */
const OUTLINE_PX = 10;

/**
 * Grow a sprite's alpha by `radius` pixels and paint it solid white: drawn
 * behind the sprite at the same size it reads as an even outline around the
 * whole shape, however irregular.
 */
function outlineOf(source: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const size = source.width;
  const alpha = source.getContext('2d')!.getImageData(0, 0, size, size).data;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const out = context.createImageData(size, size);
  const offsets: Array<[number, number]> = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius + radius) offsets.push([dx, dy]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = 0;
      for (const [dx, dy] of offsets) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
        const a = alpha[(sy * size + sx) * 4 + 3]!;
        if (a > best) {
          best = a;
          if (best === 255) break;
        }
      }
      if (best === 0) continue;
      const i = (y * size + x) * 4;
      out.data[i] = 255;
      out.data[i + 1] = 255;
      out.data[i + 2] = 255;
      out.data[i + 3] = best;
    }
  }
  context.putImageData(out, 0, 0);
  return canvas;
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
