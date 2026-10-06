import { clearSession, Gateway, GatewayError, loadSession, saveSession, type RegisteredServer, type StoredSession } from '../net/gateway';
import { el } from './dom';

export interface LoginResult {
  readonly username: string;
  readonly accessToken: string;
  /** WebSocket URL of the game server to join. */
  readonly serverUrl: string;
}

const GATEWAY_KEY = 'apollo.gateway';
const SERVER_KEY = 'apollo.server';
const DEFAULT_GATEWAY = 'http://localhost:8080';

/**
 * Log in through the gateway, pick a game server and connect. A small
 * modal over the hangar: gateway URL, username and password, then the
 * server list central knows about (or a WebSocket URL typed by hand,
 * since the game servers listen on TCP until a WebSocket bridge sits in
 * front of them). Resolves to null when dismissed.
 */
export function showLoginDialog(): Promise<LoginResult | null> {
  return new Promise((resolve) => {
    const stored = loadSession();
    const gatewayInput = el('input', { type: 'text', value: remembered(GATEWAY_KEY) ?? DEFAULT_GATEWAY });
    const usernameInput = el('input', { type: 'text', value: stored?.username ?? '' });
    usernameInput.autocomplete = 'username';
    const passwordInput = el('input', { type: 'password' });
    passwordInput.autocomplete = 'current-password';
    const serverSelect = el('select');
    const serverInput = el('input', { type: 'text', value: remembered(SERVER_KEY) ?? '' });
    serverInput.placeholder = 'ws://host:port (overrides the list)';
    const status = el('p', { className: 'login-status' });
    const loginButton = el('button', { type: 'button', text: 'Log in' });
    const registerButton = el('button', { type: 'button', text: 'Register' });
    const connectButton = el('button', { type: 'button', text: 'Connect' });
    const cancelButton = el('button', { type: 'button', text: 'Cancel' });
    connectButton.disabled = true;

    const root = el('div', { className: 'login-dialog' }, [
      el('div', { className: 'login-card ornate' }, [
        el('h2', { text: 'Play online' }),
        field('Gateway', gatewayInput),
        field('Username', usernameInput),
        field('Password', passwordInput),
        el('div', { className: 'login-row' }, [loginButton, registerButton]),
        field('Server', serverSelect),
        field('Or', serverInput),
        status,
        el('div', { className: 'login-row' }, [connectButton, cancelButton]),
      ]),
    ]);
    document.body.append(root);

    let session: StoredSession | null = stored && stored.accessExpiresAt > Date.now() + 30_000 ? stored : null;
    let servers: RegisteredServer[] = [];
    if (session) status.textContent = `Signed in as ${session.username}.`;

    const finish = (result: LoginResult | null): void => {
      root.remove();
      resolve(result);
    };
    const gateway = (): Gateway => new Gateway(gatewayInput.value.trim().replace(/\/$/, ''));
    const fail = (error: unknown): void => {
      status.textContent = error instanceof GatewayError ? `${error.detail} (HTTP ${error.status})` : error instanceof Error ? error.message : String(error);
    };
    const refreshServers = async (): Promise<void> => {
      try {
        servers = await gateway().servers();
        serverSelect.replaceChildren(...servers.map((server) => el('option', { value: String(server.id), text: `#${server.id} ${server.location} ${server.type}${server.activity ? ` · ${server.activity}` : ''} · ${server.address}:${server.port}` })));
        if (servers.length === 0) serverSelect.append(el('option', { value: '', text: 'No servers registered' }));
      } catch (error) {
        serverSelect.replaceChildren(el('option', { value: '', text: 'Server list unavailable' }));
        fail(error);
      }
      connectButton.disabled = !session;
    };

    const signIn = async (register: boolean): Promise<void> => {
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username || !password) {
        status.textContent = 'Enter a username and password.';
        return;
      }
      status.textContent = register ? 'Registering…' : 'Logging in…';
      try {
        const api = gateway();
        if (register) await api.register(username, password);
        const tokens = await api.login(username, password);
        session = { username, tokens, accessExpiresAt: Date.now() + tokens.expiresIn * 1000 };
        saveSession(session);
        remember(GATEWAY_KEY, gatewayInput.value.trim());
        status.textContent = `Signed in as ${username}.`;
        await refreshServers();
      } catch (error) {
        session = null;
        clearSession();
        fail(error);
      }
    };

    loginButton.addEventListener('click', () => void signIn(false));
    registerButton.addEventListener('click', () => void signIn(true));
    passwordInput.addEventListener('keydown', (event) => event.key === 'Enter' && void signIn(false));
    cancelButton.addEventListener('click', () => finish(null));
    connectButton.addEventListener('click', () => {
      if (!session) return;
      const typed = serverInput.value.trim();
      const chosen = servers.find((server) => String(server.id) === serverSelect.value);
      const serverUrl = typed || (chosen ? `ws://${chosen.address}:${chosen.port}` : '');
      if (!serverUrl) {
        status.textContent = 'Pick a server or type a WebSocket URL.';
        return;
      }
      remember(SERVER_KEY, typed);
      finish({ username: session.username, accessToken: session.tokens.accessToken, serverUrl });
    });
    void refreshServers();
    (session ? serverInput : usernameInput).focus();
  });
}

function field(label: string, input: HTMLElement): HTMLElement {
  return el('label', { className: 'login-field' }, [el('span', { text: label }), input]);
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Fine without.
  }
}

function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
