/**
 * Player-facing map coordinates. The world frame has its origin at the map
 * centre with screen-right being -X (starboard in a right-handed, Y-up,
 * nose-along-+Z frame). The map frame shown in the HUD puts (0, 0) at the
 * bottom-left corner, x increasing to the right on screen and y increasing
 * up the screen (north), so both axes run 0..2 * halfExtent.
 */

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export function toMapCoords(worldX: number, worldZ: number, halfExtent: number): MapPoint {
  return { x: halfExtent - worldX, y: worldZ + halfExtent };
}

export function fromMapCoords(mapX: number, mapY: number, halfExtent: number): { readonly x: number; readonly z: number } {
  return { x: halfExtent - mapX, z: mapY - halfExtent };
}

export function formatMapCoords(worldX: number, worldZ: number, halfExtent: number): string {
  const point = toMapCoords(worldX, worldZ, halfExtent);
  return `${point.x.toFixed(0)}, ${point.y.toFixed(0)}`;
}

/**
 * Compass bearing of a world heading in degrees clockwise from north
 * (map +y). World heading 0 is north; +π/2 points to world +X, which is
 * screen-left / map west, so it reads 270.
 */
export function headingBearing(heading: number): number {
  const degrees = (-heading * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** Rotate a screen-space vector (x right, y down) clockwise by `angle` radians. */
export function rotateScreen(x: number, y: number, angle: number): readonly [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

/** Map-frame direction (x right, y up) of a world XZ vector. */
export function worldVectorToMap(worldX: number, worldZ: number): readonly [number, number] {
  return [0 - worldX, worldZ];
}
