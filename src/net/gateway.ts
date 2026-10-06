/**
 * The HTTP side of logging in: the Spring gateway's `/api/auth` endpoints
 * hand out the access token (a JWT) the game server checks on handshake,
 * and `/api/servers` lists the game servers central knows about. Nothing
 * here touches the game; it only gets a player to the point of connecting.
 */
export interface GatewayTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
}

export interface GatewayAccount {
  readonly id: string;
  readonly username: string;
}

/** One game server as central registered it. */
export interface RegisteredServer {
  readonly id: number;
  readonly location: string;
  readonly type: string;
  readonly activity: string;
  readonly port: number;
  readonly address: string;
  readonly connectedAt: string;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class Gateway {
  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  register(username: string, password: string): Promise<GatewayAccount> {
    return this.post<GatewayAccount>('/api/auth/register', { username, password });
  }

  login(username: string, password: string): Promise<GatewayTokens> {
    return this.post<GatewayTokens>('/api/auth/login', { username, password });
  }

  refresh(refreshToken: string): Promise<GatewayTokens> {
    return this.post<GatewayTokens>('/api/auth/refresh', { refreshToken });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.post<unknown>('/api/auth/logout', { refreshToken });
  }

  /** The account behind an access token; a cheap way to check a stored token still works. */
  me(accessToken: string): Promise<GatewayAccount> {
    return this.request<GatewayAccount>('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${accessToken}` });
  }

  servers(): Promise<RegisteredServer[]> {
    return this.request<RegisteredServer[]>('GET', '/api/servers');
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new GatewayError(response.status, await problemDetail(response));
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** Spring returns RFC 9457 problem details; use their `detail` when present. */
async function problemDetail(response: { status: number; text(): Promise<string> }): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; title?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (typeof parsed.title === 'string') return parsed.title;
  } catch {
    // Not JSON; fall through to the status line.
  }
  return text || `HTTP ${response.status}`;
}

// ---- token storage --------------------------------------------------------------

const TOKENS_KEY = 'apollo.tokens';

export interface StoredSession {
  readonly username: string;
  readonly tokens: GatewayTokens;
  /** Epoch milliseconds when the access token stops working. */
  readonly accessExpiresAt: number;
}

export function saveSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(TOKENS_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable; the player just logs in again next time.
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.username !== 'string' || typeof parsed.accessExpiresAt !== 'number' || !parsed.tokens) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKENS_KEY);
  } catch {
    // Nothing to clear.
  }
}
