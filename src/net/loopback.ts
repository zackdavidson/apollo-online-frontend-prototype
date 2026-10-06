import type { PacketSizes } from './sizes';
import { TransportBase, type PacketTransport } from './transport';

/**
 * Two transports joined back to back in memory: bytes one sends, the other
 * receives at once, framing and all, so tests can play the server's side
 * of a conversation without a socket. Closing either end closes both.
 */
export interface Loopback {
  /** The client's end: sends client opcodes, receives server opcodes. */
  readonly client: PacketTransport;
  /** The server's end: sends server opcodes, receives client opcodes. */
  readonly server: PacketTransport;
}

export function createLoopback(clientSizes: PacketSizes, serverSizes: PacketSizes): Loopback {
  let client: TransportBase;
  let server: TransportBase;
  client = new TransportBase(clientSizes, serverSizes, (bytes) => server.receive(bytes));
  server = new TransportBase(serverSizes, clientSizes, (bytes) => client.receive(bytes));
  const closeBoth = (reason: string | null): void => {
    client.setStatus('closed', reason);
    server.setStatus('closed', reason);
  };
  client.onStatus((status, reason) => status === 'closed' && closeBoth(reason));
  server.onStatus((status, reason) => status === 'closed' && closeBoth(reason));
  client.setStatus('open');
  server.setStatus('open');
  return { client, server };
}
