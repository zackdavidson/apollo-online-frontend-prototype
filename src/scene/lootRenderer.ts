import { Group, Sprite, SpriteMaterial } from 'three';
import type { Pickup } from '../game/loot';
import type { ItemSpriteAtlas } from './itemSprites';

const MAX_PICKUPS = 400;
/** World-space size of a dropped item's sprite. */
const SPRITE_SIZE = 2.4;

/**
 * Dropped items as billboard sprites of their item art, old-school style:
 * one shared material per item kind, a pooled sprite per pickup, sitting
 * still where they fell and shrinking away in their last seconds. The
 * hovered stack gets a white silhouette outline, like a hovered rock.
 */
export class LootRenderer {
  readonly group = new Group();
  private readonly sprites: Sprite[] = [];
  private readonly materials = new Map<string, SpriteMaterial>();
  private readonly outlineMaterials = new Map<string, SpriteMaterial>();
  private readonly fallback = new SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  /** A flat silhouette of the hovered stack, drawn a little larger behind it. */
  private readonly outline = new Sprite(this.fallback);

  /** `layer` keeps the sprites out of the pixelation pass (the overlay layer renders sharp on top). */
  constructor(
    private readonly atlas: ItemSpriteAtlas,
    private readonly layer: number | null = null,
  ) {
    this.outline.center.set(0.5, 0.1);
    this.outline.visible = false;
    this.outline.renderOrder = -1;
    if (this.layer !== null) this.outline.layers.set(this.layer);
    this.group.add(this.outline);
  }

  sync(pickups: readonly Pickup[], time: number, hoveredId: number | null = null): void {
    const count = Math.min(pickups.length, MAX_PICKUPS);
    let hovered = false;
    while (this.sprites.length < count) {
      const sprite = new Sprite(this.fallback);
      sprite.center.set(0.5, 0.1);
      if (this.layer !== null) sprite.layers.set(this.layer);
      this.sprites.push(sprite);
      this.group.add(sprite);
    }
    for (let i = 0; i < count; i++) {
      const p = pickups[i]!;
      const sprite = this.sprites[i]!;
      sprite.visible = true;
      sprite.material = this.materialFor(p.kind);
      // Stacks sit still where they fell; `time` only drives nothing now, kept for the signature.
      void time;
      sprite.position.set(p.x, 0.3, p.z);
      const fade = Math.min(1, p.life / 3);
      // Bigger stacks read a little bigger.
      const stack = 1 + Math.min(0.3, Math.log10(Math.max(1, p.count)) * 0.3);
      const size = SPRITE_SIZE * stack * (0.6 + 0.4 * fade);
      sprite.scale.set(size, size, 1);
      if (p.id === hoveredId) {
        hovered = true;
        this.outline.material = this.outlineMaterialFor(p.kind);
        this.outline.position.copy(sprite.position);
        // Same size as the item: the outline texture already carries the grown edge.
        this.outline.scale.set(size, size, 1);
      }
    }
    this.outline.visible = hovered;
    for (let i = count; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    for (const material of this.outlineMaterials.values()) material.dispose();
    this.materials.clear();
    this.outlineMaterials.clear();
    this.fallback.dispose();
    this.group.clear();
    this.sprites.length = 0;
  }

  /** The item's dilated white silhouette: an even outline around the whole shape, like a hovered rock. */
  private outlineMaterialFor(kind: string): SpriteMaterial {
    let material = this.outlineMaterials.get(kind);
    if (!material) {
      const map = this.atlas.outlineTextureFor(kind);
      material = new SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 1, ...(map ? { map } : {}) });
      this.outlineMaterials.set(kind, material);
    }
    return material;
  }

  private materialFor(kind: string): SpriteMaterial {
    let material = this.materials.get(kind);
    if (!material) {
      const map = this.atlas.textureFor(kind);
      material = map ? new SpriteMaterial({ map, transparent: true, depthWrite: false, alphaTest: 0.05 }) : this.fallback;
      this.materials.set(kind, material);
    }
    return material;
  }
}
