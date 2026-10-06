import { ClientOpcodes, ServerOpcodes } from '../opcodes';
import { readProps, writeProps } from '../wire';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * Interfaces: the server opens, closes and fills windows by id; the client
 * reports button clicks, closed windows and "click to continue". The
 * dialogue box is an interface like any other, opened one line at a time.
 */
export const interfaces: Mechanic = {
  name: 'interfaces',
  outbound: [
    outbound(ClientOpcodes.IF_BUTTON, 'if-button', (m, w) => w.writeInt(m.interfaceId).writeShort(m.button), (r) => ({ interfaceId: r.readInt(), button: r.readUnsignedShort() })),
    outbound(ClientOpcodes.CLOSE_MODAL, 'close-modal', (m, w) => w.writeInt(m.interfaceId), (r) => ({ interfaceId: r.readInt() })),
    outbound(ClientOpcodes.RESUME_PAUSEBUTTON, 'resume-pause-button', (m, w) => w.writeInt(m.interfaceId), (r) => ({ interfaceId: r.readInt() })),
  ],
  inbound: [
    inbound(
      ServerOpcodes.IF_OPENSUB,
      'if-opensub',
      (m, w) => {
        w.writeInt(m.id);
        writeProps(w, m.props);
      },
      (r) => ({ id: r.readInt(), props: readProps(r) }),
    ),
    inbound(ServerOpcodes.IF_CLOSESUB, 'if-closesub', (m, w) => w.writeInt(m.id), (r) => ({ id: r.readInt() })),
    inbound(
      ServerOpcodes.IF_SETPROPS,
      'if-setprops',
      (m, w) => {
        w.writeInt(m.id);
        writeProps(w, m.props);
      },
      (r) => ({ id: r.readInt(), props: readProps(r) }),
    ),
  ],
  // Windows live in the HUD, not the world; the session applies these.
  apply: (_world, message) => oneOf(message, ['if-opensub', 'if-closesub', 'if-setprops']),
};
