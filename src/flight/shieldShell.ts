import { AdditiveBlending, Color, FrontSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';

const VERTEX = /* glsl */ `
varying vec3 vViewNormal;
varying vec3 vLocalDir;
void main() {
  vViewNormal = normalize(normalMatrix * normal);
  vLocalDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
uniform float uHit;
uniform vec3 uHitDir;
uniform float uTime;
uniform float uFlash;
varying vec3 vViewNormal;
varying vec3 vLocalDir;
void main() {
  float fresnel = pow(1.0 - abs(vViewNormal.z), 2.2);
  float lon = atan(vLocalDir.x, vLocalDir.z);
  float lat = asin(clamp(vLocalDir.y, -1.0, 1.0));
  float lines = max(abs(sin(lon * 14.0)), abs(sin(lat * 10.0 + uTime * 0.4)));
  float grid = smoothstep(0.93, 1.0, lines) * 0.35;
  float facing = clamp(dot(vLocalDir, uHitDir), 0.0, 1.0);
  float hitGlow = uHit * smoothstep(0.3, 1.0, facing);
  float ripple = uHit * 0.6 * smoothstep(0.0, 1.0, facing) * (0.5 + 0.5 * sin(facing * 34.0 - uTime * 42.0));
  float alpha = uOpacity * (fresnel * 0.9 + grid * fresnel + 0.015) + hitGlow * 0.85 + ripple * 0.45 + uFlash;
  vec3 colour = uColour * (1.0 + hitGlow * 1.4 + uFlash * 2.5) + vec3(ripple * 0.4);
  gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
}
`;

/**
 * A shield as a flattened translucent shell: bright at the rim (fresnel),
 * faint grid, a glowing ripple spreading from each hit, a bright flash when
 * the shield collapses and a soft pulse when it comes back.
 */
export class ShieldShell extends Mesh<SphereGeometry, ShaderMaterial> {
  private opacity = 0;
  private hadShield = true;

  constructor(radius: number, colour: string) {
    super(
      new SphereGeometry(1, 32, 20),
      new ShaderMaterial({
        uniforms: {
          uColour: { value: new Color(colour) },
          uOpacity: { value: 0 },
          uHit: { value: 0 },
          uHitDir: { value: [0, 0, 1] },
          uTime: { value: 0 },
          uFlash: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: FrontSide,
      }),
    );
    this.scale.set(radius * 1.25, radius * 0.6, radius * 1.25);
    this.position.y = 0.3;
    this.frustumCulled = false;
  }

  /** Light up the shell around a hit coming from `localDir` (in the ship's frame). */
  hit(localDirX: number, localDirZ: number): void {
    const length = Math.hypot(localDirX, localDirZ) || 1;
    this.material.uniforms['uHitDir']!.value = [localDirX / length, 0, localDirZ / length];
    this.material.uniforms['uHit']!.value = 1;
  }

  /** `shieldFraction` is current / max shield. */
  update(dt: number, shieldFraction: number, time: number): void {
    const uniforms = this.material.uniforms;
    const hasShield = shieldFraction > 0;
    if (this.hadShield && !hasShield) uniforms['uFlash']!.value = 0.9;
    if (!this.hadShield && hasShield) uniforms['uFlash']!.value = 0.35;
    this.hadShield = hasShield;

    const target = hasShield ? 0.16 + 0.14 * shieldFraction : 0;
    this.opacity += (target - this.opacity) * (1 - Math.exp(-6 * dt));
    uniforms['uOpacity']!.value = this.opacity;
    uniforms['uHit']!.value = Math.max(0, (uniforms['uHit']!.value as number) * Math.exp(-5 * dt));
    uniforms['uFlash']!.value = Math.max(0, (uniforms['uFlash']!.value as number) * Math.exp(-4 * dt));
    uniforms['uTime']!.value = time;
    this.visible = this.opacity > 0.01 || (uniforms['uHit']!.value as number) > 0.01 || (uniforms['uFlash']!.value as number) > 0.01;
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
