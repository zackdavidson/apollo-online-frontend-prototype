import { createDefaultCatalog, type Catalog } from '../catalog/catalog';
import type { ServerMessage } from '../client/messages';
import { ClientWorld } from '../client/world';
import { defaultResolvedMap, type ResolvedMap } from '../game/map';
import type { ShipState } from '../state/shipState';
import { smokeTrails } from './effects';
import { SandboxServer, type SandboxNpc } from './sandbox';
import { FlightShell } from './shell';

export type { SandboxNpc } from './sandbox';

export interface FlightSessionOptions {
  readonly player: { readonly name: string; readonly build: ShipState };
  readonly npcs?: readonly SandboxNpc[];
  /** The sector to fly in; defaults to the starter sector. */
  readonly map?: ResolvedMap;
  readonly catalog?: Catalog;
  readonly onExit: () => void;
}

/**
 * The offline flight: the shell on one side, the sandbox stand-in server
 * on the other, talking the same packets a real server would. Each frame
 * the player's input goes to the sandbox, the sandbox steps the
 * simulation and answers with packets, and the shell draws the world
 * those packets built.
 */
export class FlightSession {
  readonly world: ClientWorld;
  readonly shell: FlightShell;
  readonly sandbox: SandboxServer;
  private frameHandle = 0;
  private lastTime = performance.now();
  private disposed = false;

  constructor(container: HTMLElement, options: FlightSessionOptions) {
    const catalog = options.catalog ?? createDefaultCatalog();
    const map = options.map ?? defaultResolvedMap();
    this.world = new ClientWorld(catalog);
    this.sandbox = new SandboxServer({ map, player: options.player, npcs: options.npcs, catalog }, (message) => this.handle(message));
    this.shell = new FlightShell(container, catalog, this.world, { onExit: options.onExit, send: (message) => this.sandbox.receive(message) });
    this.world.setMap(map);
    this.shell.openSector(map, options.player.build);
    this.sandbox.login();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private handle(message: ServerMessage): void {
    this.shell.applyEffects(message);
    this.world.apply(message);
    this.shell.applyInterface(message);
  }

  private readonly frame = (nowMs: number): void => {
    const dt = FlightShell.frameDt(nowMs, this.lastTime);
    this.lastTime = nowMs;
    const snapshot = this.shell.pollInput();
    if (snapshot) this.sandbox.setInput(snapshot.flight);
    this.sandbox.step(dt);
    this.world.advance(this.sandbox.sim.time);
    if (this.shell.scene) smokeTrails(this.shell.scene, this.world);
    this.shell.present(dt, nowMs / 1000, snapshot?.cameraTilt ?? 0, snapshot?.pointerPx ?? null);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.shell.dispose();
  }
}
