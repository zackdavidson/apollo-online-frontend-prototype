import { createDefaultCatalog, type Catalog } from '../catalog/catalog';
import type { GameConnection } from '../client/connection';
import { InputSender } from '../client/inputSender';
import type { ServerMessage } from '../client/messages';
import { ClientWorld } from '../client/world';
import { MapParseError, parseMapDefinition, resolveMap } from '../game/map';
import type { ShipState } from '../state/shipState';
import { smokeTrails } from './effects';
import { FlightShell } from './shell';

export interface OnlineSessionOptions {
  readonly connection: GameConnection;
  /** The gateway's access token, presented on handshake. */
  readonly jwt: string;
  readonly build: ShipState;
  readonly catalog?: Catalog;
  /** How far behind the server clock remote entities are drawn, so there is always a later snapshot to interpolate to. */
  readonly renderDelay?: number;
  readonly onExit: () => void;
}

/** Seconds a closing message stays up before the session hands back to the hangar. */
const EXIT_DELAY_MS = 1800;

/**
 * A flight on a real server: packets in, packets out, nothing simulated
 * locally. The handshake goes as soon as the socket opens; the sector is
 * fetched when REBUILD_NORMAL names it; after that every frame sends the
 * flight input and draws whatever the server has said so far.
 */
export class OnlineSession {
  readonly world: ClientWorld;
  readonly shell: FlightShell;
  private readonly connection: GameConnection;
  private readonly inputSender: InputSender;
  private readonly renderDelay: number;
  private readonly build: ShipState;
  private frameHandle = 0;
  private lastTime = performance.now();
  private disposed = false;
  private exiting = false;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    private readonly options: OnlineSessionOptions,
  ) {
    const catalog = options.catalog ?? createDefaultCatalog();
    this.connection = options.connection;
    this.build = options.build;
    this.renderDelay = options.renderDelay ?? 0.1;
    this.world = new ClientWorld(catalog);
    this.shell = new FlightShell(container, catalog, this.world, { onExit: () => this.exit(), send: (message) => this.connection.send(message) });
    this.inputSender = new InputSender((message) => this.connection.send(message));
    this.shell.setStatus('Connecting…');
    this.unsubscribe.push(this.connection.onMessage((message) => this.handle(message)));
    this.unsubscribe.push(
      this.connection.onStatus((status, reason) => {
        if (status === 'open') this.connection.handshake(options.jwt, this.build);
        else if (status === 'closed') this.leave(reason ? `Disconnected: ${reason}` : 'Disconnected');
      }),
    );
    if (this.connection.status === 'open') this.connection.handshake(options.jwt, this.build);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'login-response':
        if (message.status !== 'ok') {
          this.leave(message.message || `Login refused (${message.status})`);
          return;
        }
        this.world.apply(message);
        this.shell.setStatus('Loading sector…');
        return;
      case 'rebuild-normal':
        void this.loadSector(message.name, message.url);
        return;
      case 'logout':
        this.leave(message.reason || 'Logged out');
        return;
      default:
        this.shell.applyEffects(message);
        this.world.apply(message);
        this.shell.applyInterface(message);
    }
  }

  private async loadSector(name: string, url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const map = resolveMap(parseMapDefinition((await response.json()) as unknown));
      if (this.disposed) return;
      this.world.setMap(map);
      this.shell.openSector(map, this.build);
      this.inputSender.reset();
      if (!this.frameHandle) this.frameHandle = requestAnimationFrame(this.frame);
    } catch (error) {
      const detail = error instanceof MapParseError || error instanceof Error ? error.message : String(error);
      this.leave(`Could not load sector "${name}": ${detail}`);
    }
  }

  private readonly frame = (nowMs: number): void => {
    const dt = FlightShell.frameDt(nowMs, this.lastTime);
    this.lastTime = nowMs;
    const snapshot = this.shell.pollInput();
    if (snapshot && this.connection.status === 'open') this.inputSender.update(snapshot.flight, nowMs / 1000);
    this.world.advance(Math.max(0, this.connection.serverTime() - this.renderDelay));
    if (this.shell.scene) smokeTrails(this.shell.scene, this.world);
    this.shell.present(dt, nowMs / 1000, snapshot?.cameraTilt ?? 0, snapshot?.pointerPx ?? null);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /** Show why the flight is over, then hand back to the hangar. */
  private leave(reason: string): void {
    if (this.exiting || this.disposed) return;
    this.exiting = true;
    this.shell.setStatus(reason);
    this.shell.say(reason);
    window.setTimeout(() => this.exit(), EXIT_DELAY_MS);
  }

  private exit(): void {
    if (this.disposed) return;
    this.options.onExit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    for (const off of this.unsubscribe) off();
    this.connection.close();
    this.shell.dispose();
  }
}
