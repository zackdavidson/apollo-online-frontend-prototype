/** A fixed marker on the map that fires an event when a ship flies through it. World coordinates. */
export interface Beacon {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly label: string;
  readonly description: string;
  readonly colour: string;
  /** Trigger and hover radius. */
  readonly radius: number;
}

/** Tracks which ships are inside which beacons so entering fires exactly once per visit. */
export class BeaconTracker {
  private readonly inside = new Set<string>();

  constructor(readonly beacons: readonly Beacon[]) {}

  /** Beacons the ship has just entered this step. */
  update(shipId: string, x: number, z: number): Beacon[] {
    const entered: Beacon[] = [];
    for (const beacon of this.beacons) {
      const key = `${shipId}:${beacon.id}`;
      const within = Math.hypot(beacon.x - x, beacon.z - z) <= beacon.radius;
      if (within && !this.inside.has(key)) {
        this.inside.add(key);
        entered.push(beacon);
      } else if (!within) {
        this.inside.delete(key);
      }
    }
    return entered;
  }

  /** The beacon whose hover circle contains the point, if any. */
  at(x: number, z: number): Beacon | null {
    return this.beacons.find((beacon) => Math.hypot(beacon.x - x, beacon.z - z) <= beacon.radius * 1.3) ?? null;
  }
}
