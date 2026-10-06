import type { PacketTransport, ConnectionStatus, Unsubscribe } from '../net/transport';
import type { ShipState } from '../state/shipState';
import { decodeServerPacket, encodeClientMessage } from './mechanics';
import type { ClientMessage, ServerMessage } from './messages';

/**
 * The client's connection to a game server over any packet transport. It
 * encodes outgoing messages, decodes incoming packets and hands them to
 * listeners in order, and keeps the two facts every mechanic needs: which
 * entity is ours, and what time it is on the server (estimated from the
 * latest timestamped packet, so interpolation and warp overlays run on
 * the server's clock). A payload that does not decode closes the
 * connection, as the server does with a frame it cannot read.
 */
export class GameConnection {
  private player: number | null = null;
  private clock: { readonly serverTime: number; readonly at: number } | null = null;
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly unsubscribe: Unsubscribe;

  constructor(
    readonly transport: PacketTransport,
    /** Local clock in seconds; `performance.now()` by default, injectable for tests. */
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    this.unsubscribe = transport.onPacket((packet) => {
      let message: ServerMessage;
      try {
        message = decodeServerPacket(packet);
      } catch (error) {
        transport.close(`Could not decode opcode ${packet.opcode}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.receive(message);
    });
  }

  get status(): ConnectionStatus {
    return this.transport.status;
  }

  /** The player entity this client drives, once the server has accepted the login. */
  get playerIndex(): number | null {
    return this.player;
  }

  /** Best estimate of the server's clock right now, in seconds; 0 before anything timestamped arrived. */
  serverTime(): number {
    return this.clock ? this.clock.serverTime + (this.now() - this.clock.at) : 0;
  }

  /** Present the gateway's access token and the build to fly. */
  handshake(jwt: string, build: ShipState): void {
    this.send({ type: 'handshake', jwt, build });
  }

  send(message: ClientMessage): void {
    const packet = encodeClientMessage(message);
    this.transport.send(packet.opcode, packet.bytes());
  }

  onMessage(listener: (message: ServerMessage) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus, reason: string | null) => void): Unsubscribe {
    return this.transport.onStatus(listener);
  }

  close(): void {
    if (this.transport.status === 'open') this.send({ type: 'logout' });
    this.unsubscribe();
    this.transport.close();
  }

  private receive(message: ServerMessage): void {
    if (message.type === 'login-response') {
      if (message.status === 'ok') {
        this.player = message.playerIndex;
        this.clock = { serverTime: message.serverTime, at: this.now() };
      }
    } else if (message.type === 'player-info' || message.type === 'npc-info') {
      this.clock = { serverTime: message.t, at: this.now() };
    }
    for (const listener of [...this.listeners]) listener(message);
  }
}
