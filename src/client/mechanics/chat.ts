import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { MESSAGE_KIND_CODES, readEnum, writeEnum } from '../wire';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * Chat: what the player says goes up as MESSAGE_PUBLIC and comes back to
 * everyone as the CHAT mask on their entity; slash commands go up as
 * CLIENT_CHEAT; the server's own lines (and the big banner text) come down
 * as MESSAGE_GAME.
 */
export const chat: Mechanic = {
  name: 'chat',
  outbound: [
    outbound(ClientOpcodes.MESSAGE_PUBLIC, 'message-public', (m, w) => w.writeString(m.text), (r) => ({ text: r.readString() })),
    outbound(ClientOpcodes.CLIENT_CHEAT, 'client-cheat', (m, w) => w.writeString(m.text), (r) => ({ text: r.readString() })),
  ],
  inbound: [
    inbound(
      ServerOpcodes.MESSAGE_GAME,
      'message-game',
      (m, w) => {
        writeEnum(w, MESSAGE_KIND_CODES, m.kind);
        w.writeString(m.text);
      },
      (r) => ({ kind: readEnum(r, MESSAGE_KIND_CODES, 'game'), text: r.readString() }),
    ),
  ],
  apply: (_world, message) => oneOf(message, ['message-game']),
};
