import { encodeFrame, FrameDecoder } from './framing';
import { CorruptedFrameError, PacketReader } from './packet';
import type { PacketSizes } from './sizes';

/**
 * A packet transport: sends opcode-plus-payload frames one way and hands
 * decoded packets back the other, over whatever carries the bytes (a
 * WebSocket to the game server, or a loopback in tests). The game never
 * touches bytes or sockets; it only sees this.
 */
export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type Unsubscribe = () => void;

export interface PacketTransport {
  readonly status: ConnectionStatus;
  send(opcode: number, payload: Uint8Array): void;
  onPacket(listener: (packet: PacketReader) => void): Unsubscribe;
  onStatus(listener: (status: ConnectionStatus, reason: string | null) => void): Unsubscribe;
  close(reason?: string): void;
}

/**
 * Framing plus listener bookkeeping. A concrete transport supplies
 * `write` for outbound bytes and calls `receive` with inbound ones. A
 * corrupt inbound stream closes the connection, as Netty's pipeline does.
 */
export class TransportBase implements PacketTransport {
  status: ConnectionStatus = 'connecting';
  private readonly decoder: FrameDecoder;
  private readonly packetListeners = new Set<(packet: PacketReader) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus, reason: string | null) => void>();

  constructor(
    /** Sizes of the opcodes this end sends. */
    private readonly outbound: PacketSizes,
    /** Sizes of the opcodes this end receives. */
    inbound: PacketSizes,
    private readonly write: (bytes: Uint8Array) => void,
  ) {
    this.decoder = new FrameDecoder(inbound);
  }

  send(opcode: number, payload: Uint8Array): void {
    if (this.status === 'closed') return;
    this.write(encodeFrame(opcode, payload, this.outbound));
  }

  onPacket(listener: (packet: PacketReader) => void): Unsubscribe {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus, reason: string | null) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(reason: string | null = null): void {
    this.setStatus('closed', reason);
  }

  /** Feed inbound bytes; every completed frame reaches the packet listeners in order. */
  receive(bytes: Uint8Array): void {
    if (this.status === 'closed') return;
    let frames;
    try {
      frames = this.decoder.push(bytes);
    } catch (error) {
      if (error instanceof CorruptedFrameError) {
        this.close(error.message);
        return;
      }
      throw error;
    }
    for (const frame of frames) {
      const packet = new PacketReader(frame.opcode, frame.payload);
      for (const listener of [...this.packetListeners]) listener(packet);
      // A listener may have closed the connection; the rest of the chunk is then dropped.
      if ((this.status as ConnectionStatus) === 'closed') return;
    }
  }

  setStatus(status: ConnectionStatus, reason: string | null = null): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status, reason);
  }
}
