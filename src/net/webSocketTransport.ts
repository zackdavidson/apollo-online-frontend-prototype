import type { PacketSizes } from './sizes';
import { TransportBase, type PacketTransport } from './transport';

/** The subset of the browser's WebSocket the transport needs; injectable for tests. */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface WebSocketTransportOptions {
  /** Sizes of the opcodes the client sends. */
  readonly outbound: PacketSizes;
  /** Sizes of the opcodes the client receives. */
  readonly inbound: PacketSizes;
  /** Socket factory; the browser's `WebSocket` by default. */
  readonly connect?: (url: string) => SocketLike;
}

const OPEN = 1;

/**
 * The game server speaks its binary framing over TCP, which a browser
 * cannot open, so the same byte stream travels inside WebSocket binary
 * frames. Frame boundaries carry no meaning: bytes are fed to the packet
 * decoder as a stream, so this works through a plain TCP-to-WebSocket
 * bridge as well as through a WebSocket handler in the server's own
 * pipeline. Frames sent before the socket opens are queued.
 */
export function connectWebSocket(url: string, options: WebSocketTransportOptions): PacketTransport {
  const socket = (options.connect ?? ((target) => new WebSocket(target) as unknown as SocketLike))(url);
  socket.binaryType = 'arraybuffer';
  const queue: Uint8Array[] = [];
  const transport = new TransportBase(options.outbound, options.inbound, (bytes) => {
    if (socket.readyState === OPEN) socket.send(bytes);
    else queue.push(bytes);
  });
  socket.onopen = () => {
    for (const bytes of queue.splice(0)) socket.send(bytes);
    transport.setStatus('open');
  };
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) transport.receive(new Uint8Array(event.data));
  };
  socket.onclose = (event) => transport.setStatus('closed', event.reason || null);
  socket.onerror = () => transport.setStatus('closed', 'socket error');
  transport.onStatus((status) => status === 'closed' && socket.close());
  return transport;
}
