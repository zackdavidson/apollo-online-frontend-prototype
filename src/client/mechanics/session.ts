import { ClientOpcodes, PROTOCOL_VERSION, ServerOpcodes } from '../opcodes';
import { LOGIN_STATUS_CODES, readBuild, readEnum, readSeconds, writeBuild, writeEnum, writeSeconds } from '../wire';
import { inbound, oneOf, outbound, type Mechanic } from './mechanic';

/**
 * Session: the handshake that presents the gateway's access token, the
 * login verdict, the keep-alive, and which sector to load. The handshake's
 * protocol number lets the server refuse a client built against an older
 * layout instead of misreading it.
 */
export const session: Mechanic = {
  name: 'session',
  outbound: [
    outbound(
      ClientOpcodes.HANDSHAKE,
      'handshake',
      (m, w) => {
        w.writeShort(PROTOCOL_VERSION).writeString(m.jwt);
        writeBuild(w, m.build);
      },
      (r) => {
        r.readUnsignedShort();
        return { jwt: r.readString(), build: readBuild(r) };
      },
    ),
    outbound(ClientOpcodes.LOGOUT, 'logout', () => {}, () => ({})),
    outbound(ClientOpcodes.IDLE, 'idle', () => {}, () => ({})),
  ],
  inbound: [
    inbound(
      ServerOpcodes.LOGIN_RESPONSE,
      'login-response',
      (m, w) => {
        writeEnum(w, LOGIN_STATUS_CODES, m.status === 'unknown' ? 'invalid-token' : m.status);
        w.writeString(m.message).writeInt(m.playerIndex);
        writeSeconds(w, m.serverTime);
        w.writeShort(Math.round(m.tick * 1000));
      },
      (r) => ({ status: readEnum(r, LOGIN_STATUS_CODES, 'unknown'), message: r.readString(), playerIndex: r.readInt(), serverTime: readSeconds(r), tick: r.readUnsignedShort() / 1000 }),
    ),
    inbound(ServerOpcodes.LOGOUT, 'logout', (m, w) => w.writeString(m.reason), (r) => ({ reason: r.readString() })),
    inbound(ServerOpcodes.REBUILD_NORMAL, 'rebuild-normal', (m, w) => w.writeString(m.name).writeString(m.url), (r) => ({ name: r.readString(), url: r.readString() })),
  ],
  apply(world, message) {
    if (!oneOf(message, ['login-response', 'logout', 'rebuild-normal'])) return false;
    if (message.type === 'login-response' && message.status === 'ok') world.playerIndex = message.playerIndex;
    // The map is fetched by the session (it is asynchronous); logout changes nothing in the world.
    return true;
  },
};
