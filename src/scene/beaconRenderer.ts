import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, Sprite, SpriteMaterial, type Texture } from 'three';
import type { Beacon } from '../game/beacons';

/** Beacons as slim pylons with a glowing tip and a pulsing ring marking their trigger radius. */
export class BeaconRenderer extends Group {
  private readonly rings: { mesh: Mesh<RingGeometry, MeshBasicMaterial>; radius: number; phase: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly glowTexture: Texture) {
    super();
  }

  setBeacons(beacons: readonly Beacon[]): void {
    this.clear();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.rings.length = 0;
    const pylonGeometry = new CylinderGeometry(0.35, 0.6, 5, 6);
    this.disposables.push(pylonGeometry);
    beacons.forEach((beacon, i) => {
      const material = new MeshStandardMaterial({ color: '#aab4c4', emissive: beacon.colour, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.4, flatShading: true });
      this.disposables.push(material);
      const pylon = new Mesh(pylonGeometry, material);
      pylon.position.set(beacon.x, 2.5, beacon.z);
      this.add(pylon);

      const glowMaterial = new SpriteMaterial({ map: this.glowTexture, color: beacon.colour, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false });
      this.disposables.push(glowMaterial);
      const glow = new Sprite(glowMaterial);
      glow.position.set(beacon.x, 5.6, beacon.z);
      glow.scale.set(4, 4, 1);
      this.add(glow);

      const ringGeometry = new RingGeometry(0.9, 1, 48);
      const ringMaterial = new MeshBasicMaterial({ color: beacon.colour, transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false });
      this.disposables.push(ringGeometry, ringMaterial);
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(beacon.x, 0.3, beacon.z);
      ring.scale.setScalar(beacon.radius);
      this.add(ring);
      this.rings.push({ mesh: ring, radius: beacon.radius, phase: i * 1.7 });
    });
  }

  update(time: number): void {
    for (const ring of this.rings) {
      const pulse = 0.9 + 0.1 * Math.sin(time * 2 + ring.phase);
      ring.mesh.scale.setScalar(ring.radius * pulse);
      ring.mesh.material.opacity = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(time * 2 + ring.phase));
    }
  }

  override dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
