import { describe, expect, it } from 'vitest';
import { layoutMarkers, rectsOverlap, type LayoutItem, type Rect } from './markerLayout';

const item = (x: number, y: number, previousOffset: readonly [number, number] = [0, 0], width = 40, height = 18): LayoutItem => ({ x, y, width, height, previousOffset });

function placedRects(items: readonly LayoutItem[], offsets: Array<readonly [number, number]>): Rect[] {
  return items.map((it, i) => ({
    x0: it.x + offsets[i]![0] - it.width / 2,
    y0: it.y + offsets[i]![1] - it.height / 2,
    x1: it.x + offsets[i]![0] + it.width / 2,
    y1: it.y + offsets[i]![1] + it.height / 2,
  }));
}

function expectNoOverlaps(rects: Rect[], gap: number): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(rectsOverlap(rects[i]!, rects[j]!, gap), `${i} overlaps ${j}`).toBe(false);
    }
  }
}

describe('layoutMarkers', () => {
  it('leaves non-overlapping items where they are', () => {
    const items = [item(100, 100), item(300, 100), item(100, 300)];
    expect(layoutMarkers(items)).toEqual([[0, 0], [0, 0], [0, 0]]);
  });

  it('separates items that land on the same point, stacking upward first', () => {
    const items = [item(200, 200), item(200, 200), item(200, 200)];
    const offsets = layoutMarkers(items, 4);
    expect(offsets[0]).toEqual([0, 0]);
    expect(offsets[1]![1]).toBeLessThan(0);
    expectNoOverlaps(placedRects(items, offsets), 4);
  });

  it('never overlaps even with many items piled on one spot', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(400 + (i % 3) * 2, 300 + (i % 5)));
    const offsets = layoutMarkers(items, 4);
    expectNoOverlaps(placedRects(items, offsets), 4);
  });

  it('keeps an item in its previous slot while that slot is still free', () => {
    const items = [item(200, 200), item(200, 200, [60, -22])];
    const offsets = layoutMarkers(items, 4);
    expect(offsets[1]).toEqual([60, -22]);
  });

  it('gives earlier items priority', () => {
    const items = [item(200, 200), item(205, 203)];
    const offsets = layoutMarkers(items, 4);
    expect(offsets[0]).toEqual([0, 0]);
    expect(offsets[1]).not.toEqual([0, 0]);
  });
});
