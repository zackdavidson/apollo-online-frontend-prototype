import { OrthographicCamera, PerspectiveCamera, type Camera } from 'three';

export type CameraMode = 'perspective' | 'orthographic';

const FOV_DEGREES = 50;
const MIN_DISTANCE = 35;
const MAX_DISTANCE = 170;
const MIN_TILT = 0;
const MAX_TILT = 62;
const FOLLOW_RATE = 6;
const LOOKAHEAD_SECONDS = 0.35;
const MAX_LOOKAHEAD = 14;

/**
 * Follow camera for the top-down view. Sits `distance` away from a point
 * just ahead of the ship, tilted back by `tiltDegrees` from vertical so the
 * ship reads as 2.5D rather than a flat plan view. Keeps a perspective and an
 * orthographic camera in step so the player can toggle between them. North
 * (world +Z) always points up the screen.
 */
export class CameraRig {
  readonly perspective = new PerspectiveCamera(FOV_DEGREES, 1, 0.5, 14000);
  readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.1, 14000);
  private currentMode: CameraMode = 'perspective';
  private distance = 80;
  private tilt = 32;
  private aspect = 1;
  private followX = 0;
  private followZ = 0;

  constructor() {
    // World +Z is "up the screen"; the camera sits towards -Z looking forward and down.
    this.perspective.up.set(0, 0, 1);
    this.orthographic.up.set(0, 0, 1);
  }

  get camera(): Camera {
    return this.currentMode === 'perspective' ? this.perspective : this.orthographic;
  }

  get mode(): CameraMode {
    return this.currentMode;
  }

  get zoomDistance(): number {
    return this.distance;
  }

  get tiltDegrees(): number {
    return this.tilt;
  }

  /** Vertical height of the camera above the ship plane; drives parallax factors. */
  get height(): number {
    return this.distance * Math.cos((this.tilt * Math.PI) / 180);
  }

  toggleMode(): void {
    this.currentMode = this.currentMode === 'perspective' ? 'orthographic' : 'perspective';
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
  }

  zoomBy(factor: number): void {
    this.distance = clamp(this.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
  }

  tiltBy(degrees: number): void {
    this.tilt = clamp(this.tilt + degrees, MIN_TILT, MAX_TILT);
  }

  snapTo(x: number, z: number): void {
    this.followX = x;
    this.followZ = z;
  }

  update(targetX: number, targetZ: number, vx: number, vz: number, dt: number): void {
    let aheadX = vx * LOOKAHEAD_SECONDS;
    let aheadZ = vz * LOOKAHEAD_SECONDS;
    const ahead = Math.hypot(aheadX, aheadZ);
    if (ahead > MAX_LOOKAHEAD) {
      aheadX *= MAX_LOOKAHEAD / ahead;
      aheadZ *= MAX_LOOKAHEAD / ahead;
    }
    const blend = 1 - Math.exp(-FOLLOW_RATE * dt);
    this.followX += (targetX + aheadX - this.followX) * blend;
    this.followZ += (targetZ + aheadZ - this.followZ) * blend;

    const tiltRadians = (this.tilt * Math.PI) / 180;
    const offsetY = this.distance * Math.cos(tiltRadians);
    const offsetZ = -this.distance * Math.sin(tiltRadians);
    for (const camera of [this.perspective, this.orthographic]) {
      camera.position.set(this.followX, offsetY, this.followZ + offsetZ);
      camera.lookAt(this.followX, 0, this.followZ);
    }

    const halfHeight = this.distance * Math.tan((FOV_DEGREES * Math.PI) / 360);
    const halfWidth = halfHeight * this.aspect;
    this.orthographic.left = -halfWidth;
    this.orthographic.right = halfWidth;
    this.orthographic.top = halfHeight;
    this.orthographic.bottom = -halfHeight;
    this.orthographic.updateProjectionMatrix();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
