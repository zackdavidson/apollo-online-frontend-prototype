import {
  AddEquation,
  CustomBlending,
  Mesh,
  NearestFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';

export type PixelScope = '3d' | 'all';

export interface PixelLevel {
  readonly id: string;
  readonly label: string;
  /** Screen pixels per rendered pixel. */
  readonly factor: number;
}

export const PIXEL_LEVELS: readonly PixelLevel[] = [
  { id: 'off', label: 'Off', factor: 1 },
  { id: 'light', label: 'Light', factor: 2 },
  { id: 'medium', label: 'Medium', factor: 3 },
  { id: 'heavy', label: 'Heavy', factor: 4 },
  { id: 'retro', label: 'Retro', factor: 6 },
];

/** Objects on this layer are the 2D backdrop; gameplay sits on the default layer. */
export const BACKGROUND_LAYER = 1;
export const FOREGROUND_LAYER = 0;
/** Objects on this layer (health bars) are always drawn sharp, after any pixelation. */
export const OVERLAY_LAYER = 2;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
  #include <colorspace_fragment>
}
`;

/**
 * Pixelation post-process. Renders into a small render target with nearest
 * filtering and blows it back up. Scope 'all' pixelates the whole frame;
 * scope '3d' draws the backdrop layer sharp first, then composites only the
 * gameplay layer from the low-res buffer over it (premultiplied blend so
 * additive glows survive). The overlay layer is drawn last at full
 * resolution in both scopes, and DOM UI is untouched either way.
 */
export class Pixelator {
  private level = 0;
  private scope: PixelScope = '3d';
  private target: WebGLRenderTarget | null = null;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly opaque: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly size = new Vector2();

  constructor(private readonly renderer: WebGLRenderer) {
    this.opaque = new ShaderMaterial({ uniforms: { tDiffuse: { value: null } }, vertexShader: VERTEX, fragmentShader: FRAGMENT, blending: NoBlending, depthTest: false, depthWrite: false });
    this.composite = new ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.opaque);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  get levelIndex(): number {
    return this.level;
  }

  get levelInfo(): PixelLevel {
    return PIXEL_LEVELS[this.level]!;
  }

  get currentScope(): PixelScope {
    return this.scope;
  }

  setLevel(index: number): void {
    this.level = Math.max(0, Math.min(PIXEL_LEVELS.length - 1, index));
  }

  cycleLevel(): void {
    this.setLevel((this.level + 1) % PIXEL_LEVELS.length);
  }

  setScope(scope: PixelScope): void {
    this.scope = scope;
  }

  toggleScope(): void {
    this.scope = this.scope === '3d' ? 'all' : '3d';
  }

  render(scene: Scene, camera: Camera): void {
    const factor = this.levelInfo.factor;
    if (factor <= 1) {
      camera.layers.enableAll();
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const target = this.ensureTarget(factor);
    if (this.scope === 'all') {
      camera.layers.set(BACKGROUND_LAYER);
      camera.layers.enable(FOREGROUND_LAYER);
      this.renderer.setRenderTarget(target);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(null);
      this.quad.material = this.opaque;
      this.opaque.uniforms['tDiffuse']!.value = target.texture;
      this.renderer.render(this.quadScene, this.quadCamera);
      this.renderOverlay(scene, camera);
      return;
    }

    // Sharp backdrop straight to the screen.
    camera.layers.set(BACKGROUND_LAYER);
    this.renderer.setRenderTarget(null);
    this.renderer.render(scene, camera);

    // Gameplay layer into the small buffer over transparent black.
    const background = scene.background;
    scene.background = null;
    camera.layers.set(FOREGROUND_LAYER);
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    scene.background = background;

    // Composite it over the backdrop.
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = false;
    this.quad.material = this.composite;
    this.composite.uniforms['tDiffuse']!.value = target.texture;
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.autoClear = true;
    this.renderOverlay(scene, camera);
  }

  /** Draw the overlay layer sharp on top of whatever is already on screen. */
  private renderOverlay(scene: Scene, camera: Camera): void {
    const background = scene.background;
    scene.background = null;
    camera.layers.set(OVERLAY_LAYER);
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = false;
    this.renderer.render(scene, camera);
    this.renderer.autoClear = true;
    scene.background = background;
    camera.layers.enableAll();
  }

  dispose(): void {
    this.target?.dispose();
    this.quad.geometry.dispose();
    this.opaque.dispose();
    this.composite.dispose();
  }

  private ensureTarget(factor: number): WebGLRenderTarget {
    this.renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.floor(this.size.x / factor));
    const height = Math.max(1, Math.floor(this.size.y / factor));
    if (!this.target || this.target.width !== width || this.target.height !== height) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(width, height, {
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        format: RGBAFormat,
        type: UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
    }
    return this.target;
  }
}
