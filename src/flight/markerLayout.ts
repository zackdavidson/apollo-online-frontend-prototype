/**
 * Screen-space layout that keeps floating labels from overlapping. Items are
 * placed in order (earlier items have priority); each later item that would
 * overlap something already placed is moved to the nearest free offset,
 * preferring its previous offset (so it does not jitter), then straight up,
 * then sideways and diagonals.
 */

export interface LayoutItem {
  /** Desired centre in pixels. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Offset used last frame, tried first for stability. */
  readonly previousOffset: readonly [number, number];
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const RINGS = 6;

export function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return a.x0 < b.x1 + gap && a.x1 + gap > b.x0 && a.y0 < b.y1 + gap && a.y1 + gap > b.y0;
}

function rectAt(item: LayoutItem, dx: number, dy: number): Rect {
  const hw = item.width / 2;
  const hh = item.height / 2;
  return { x0: item.x + dx - hw, y0: item.y + dy - hh, x1: item.x + dx + hw, y1: item.y + dy + hh };
}

/** Candidate offsets for an item, nearest first: up, then down, then sideways and diagonals, in growing rings. */
export function candidateOffsets(item: LayoutItem, gap: number): Array<readonly [number, number]> {
  const stepY = item.height + gap;
  const stepX = item.width + gap;
  const out: Array<readonly [number, number]> = [item.previousOffset, [0, 0]];
  for (let k = 1; k <= RINGS; k++) {
    out.push([0, -k * stepY], [0, k * stepY], [-stepX, -(k - 1) * stepY], [stepX, -(k - 1) * stepY], [-stepX, k * stepY], [stepX, k * stepY], [-k * stepX, 0], [k * stepX, 0]);
  }
  return out;
}

/** Offsets per item such that no two placed rectangles overlap (within the search range). */
export function layoutMarkers(items: readonly LayoutItem[], gap = 4): Array<readonly [number, number]> {
  const placed: Rect[] = [];
  const offsets: Array<readonly [number, number]> = [];
  for (const item of items) {
    let chosen: readonly [number, number] | null = null;
    for (const offset of candidateOffsets(item, gap)) {
      const rect = rectAt(item, offset[0], offset[1]);
      if (!placed.some((other) => rectsOverlap(rect, other, gap))) {
        chosen = offset;
        break;
      }
    }
    // Out of candidates: fall back to stacking far above everything placed so far.
    if (!chosen) {
      const top = placed.reduce((min, rect) => Math.min(min, rect.y0), item.y);
      chosen = [0, top - item.height - gap - item.y];
    }
    offsets.push(chosen);
    placed.push(rectAt(item, chosen[0], chosen[1]));
  }
  return offsets;
}
