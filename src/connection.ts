import { MA_API_VERSION, type MaCommandArgs, type MaCommandName, type MaCommandResult } from './generated/commands.js';
import type { AuthUser, EventMap, EventName, MaEvent, Player, PlayerQueue, ServerInfo } from './types.js';

/** Keys of T that are not optional. */
type RequiredKeys<T> = { [K in keyof T]-?: T extends Record<K, T[K]> ? K : never }[keyof T];

/** Arguments of {@link MusicAssistantConnection.call}: `args` may be left out when no argument is required. */
export type MaCallParams<C extends MaCommandName> =
    RequiredKeys<MaCommandArgs<C>> extends never ? [args?: MaCommandArgs<C>, options?: { timeoutMs?: number }] : [args: MaCommandArgs<C>, options?: { timeoutMs?: number }];

/** Schema version this client's types were generated from (see MA_API_VERSION). */
export const CLIENT_SCHEMA_VERSION: number = MA_API_VERSION.schema;

/** Minimal WebSocket surface we need — satisfied by the browser/Node 22+ global and by the `ws` package. */
export interface WebSocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (ev: any) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ClientLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface ClientOptions {
    /** Base URL of the MA server, e.g. `http://192.168.1.10:8095`. */
    url: string;
    /** Long-lived access token (MA → Settings → Profile). */
    token: string;
    /** Defaults to the global `WebSocket`. Pass one (e.g. from `ws`) on runtimes without it. */
    webSocketFactory?: WebSocketFactory;
    requestTimeoutMs?: number;
    reconnectInitialDelayMs?: number;
    reconnectMaxDelayMs?: number;
    logger?: ClientLogger;
}

export type ConnectionState = 'stopped' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting' | 'auth_failed';

export class MaApiError extends Error {
    constructor(readonly code: number, readonly details: string, readonly command: string) {
        super(`${command} failed (${code}): ${details}`);
        this.name = 'MaApiError';
    }
}

/** MA error code for a missing/invalid token. */
const ERROR_AUTH_REQUIRED = 20;

interface PendingRequest {
    command: string;
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    partial?: unknown[];
}

type Listener<T> = (payload: T) => void;

/**
 * Connection to the Music Assistant WebSocket API — the transport under {@link MusicAssistantClient}.
 *
 * - Authenticates with a long-lived token, then keeps `players` and `queues` in sync via events.
 * - Reconnects automatically with exponential backoff (except after an auth failure).
 * - `send()` runs any API command; the typed convenience commands live in client.ts.
 */
export class MusicAssistantConnection {
    readonly players = new Map<string, Player>();
    readonly queues = new Map<string, PlayerQueue>();
    serverInfo: ServerInfo | undefined;
    /** Server clock minus local clock, in seconds (measured on connect with `time`). */
    clockOffset = 0;
    user: AuthUser | undefined;

    private _state: ConnectionState = 'stopped';
    private ws: WebSocketLike | undefined;
    private nextMessageId = 1;
    private readonly pending = new Map<string, PendingRequest>();
    private readonly eventListeners = new Map<string, Set<Listener<any>>>();
    private readonly stateListeners = new Set<Listener<ConnectionState>>();
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private reconnectDelay: number;
    private readonly opts: Required<Omit<ClientOptions, 'logger' | 'webSocketFactory'>> & Pick<ClientOptions, 'logger'>;
    private readonly wsFactory: WebSocketFactory;

    constructor(options: ClientOptions) {
        this.opts = {
            requestTimeoutMs: 10_000,
            reconnectInitialDelayMs: 1_000,
            reconnectMaxDelayMs: 30_000,
            ...options,
        };
        this.reconnectDelay = this.opts.reconnectInitialDelayMs;
        this.wsFactory = options.webSocketFactory ?? ((url) => {
            const Ctor = (globalThis as any).WebSocket;
            if (!Ctor) throw new Error('No global WebSocket available — pass options.webSocketFactory');
            return new Ctor(url) as WebSocketLike;
        });
    }

    get state(): ConnectionState {
        return this._state;
    }

    /** Base URL of the server this client talks to. */
    get url(): string {
        return this.opts.url;
    }

    get isConnected(): boolean {
        return this._state === 'connected';
    }

    /** True when the server has a newer schema than the one the types were generated from (still compatible). */
    get isServerNewer(): boolean {
        return !!this.serverInfo && this.serverInfo.schema_version > CLIENT_SCHEMA_VERSION;
    }

    /** True when the server says it can no longer talk to a client of our schema version. */
    get isSchemaIncompatible(): boolean {
        return !!this.serverInfo && this.serverInfo.min_supported_schema_version > CLIENT_SCHEMA_VERSION;
    }

    start(): void {
        if (this._state !== 'stopped' && this._state !== 'auth_failed') return;
        this.reconnectDelay = this.opts.reconnectInitialDelayMs;
        this.openSocket();
    }

    /**
     * Start (if needed) and wait until connected, with players and queues loaded — handy for
     * scripts. Rejects when the token is rejected or `timeoutMs` passes (0 = wait forever); the
     * client is then stopped, so a script can exit.
     */
    connect(options: { timeoutMs?: number } = {}): Promise<void> {
        const timeoutMs = options.timeoutMs ?? 15_000;
        if (this._state === 'connected') return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const settle = (error?: Error) => {
                clearTimeout(timer);
                unsubscribe();
                if (!error) return resolve();
                this.stop();
                reject(error);
            };
            const unsubscribe = this.onStateChange((state) => {
                if (state === 'connected') settle();
                else if (state === 'auth_failed') settle(new MaApiError(ERROR_AUTH_REQUIRED, 'token rejected', 'auth'));
                else if (state === 'stopped') settle(new Error('Client stopped'));
            });
            if (timeoutMs > 0) timer = setTimeout(() => settle(new Error(`Could not connect to ${this.opts.url} within ${timeoutMs} ms`)), timeoutMs);
            this.start();
        });
    }

    stop(): void {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.setState('stopped');
        const ws = this.ws;
        this.ws = undefined;
        ws?.close();
        this.rejectAllPending(new Error('Client stopped'));
    }

    // ---- events ---------------------------------------------------------------------------

    /** Subscribe to a server event. Returns an unsubscribe function. */
    on<E extends EventName>(event: E, listener: (data: EventMap[E], objectId: string | null | undefined) => void): () => void;
    on(event: '*', listener: (ev: MaEvent) => void): () => void;
    on(event: string, listener: (...args: any[]) => void): () => void {
        let set = this.eventListeners.get(event);
        if (!set) this.eventListeners.set(event, (set = new Set()));
        set.add(listener);
        return () => set!.delete(listener);
    }

    onStateChange(listener: Listener<ConnectionState>): () => void {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }

    // ---- raw commands ---------------------------------------------------------------------

    /** Send any API command. Resolves with `result`, rejects with {@link MaApiError}. `timeoutMs` overrides the default for slow commands. */
    send<T = unknown>(command: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<T> {
        const ws = this.ws;
        if (!ws || ws.readyState !== 1) return Promise.reject(new Error(`Not connected (${command})`));
        const message_id = String(this.nextMessageId++);
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(message_id);
                reject(new Error(`Timeout waiting for ${command}`));
            }, options.timeoutMs ?? this.opts.requestTimeoutMs);
            this.pending.set(message_id, { command, resolve, reject, timer });
            ws.send(JSON.stringify({ message_id, command, args }));
        });
    }

    /**
     * Typed {@link send} for every command of the API (generated from the server's own docs):
     * arguments and result are checked, e.g. `call("players/get", { player_id })` → `MA.Player`.
     */
    call<C extends MaCommandName>(command: C, ...[args, options]: MaCallParams<C>): Promise<MaCommandResult<C>> {
        return this.send<MaCommandResult<C>>(command, (args ?? {}) as Record<string, unknown>, options);
    }

    // ---- internals ----------------------------------------------------------------------------

    private setState(state: ConnectionState): void {
        if (this._state === state) return;
        this._state = state;
        for (const l of this.stateListeners) this.safeCall(l, state);
    }

    private openSocket(): void {
        this.setState(this._state === 'reconnecting' ? 'reconnecting' : 'connecting');
        const wsUrl = this.opts.url.replace(/\/$/, '').replace(/^http/, 'ws') + '/ws';
        let ws: WebSocketLike;
        try {
            ws = this.wsFactory(wsUrl);
        } catch (e) {
            this.opts.logger?.error('[ma-client] cannot create WebSocket', e);
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;

        ws.addEventListener('open', () => {
            if (this.ws !== ws) return;
            void this.handshake();
        });
        ws.addEventListener('message', (ev) => {
            if (this.ws !== ws) return;
            this.handleMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
        });
        ws.addEventListener('error', (ev) => {
            if (this.ws !== ws) return;
            this.opts.logger?.warn('[ma-client] socket error', ev?.message ?? ev);
        });
        ws.addEventListener('close', () => {
            if (this.ws !== ws) return;
            this.ws = undefined;
            this.rejectAllPending(new Error('Connection closed'));
            if (this._state === 'stopped' || this._state === 'auth_failed') return;
            this.scheduleReconnect();
        });
    }

    private async handshake(): Promise<void> {
        this.setState('authenticating');
        try {
            // The token goes into `args` — the /api-docs example shows it top-level, which the server rejects.
            const auth = await this.send<{ authenticated: boolean; user?: AuthUser }>('auth', { token: this.opts.token });
            if (!auth?.authenticated) throw new MaApiError(ERROR_AUTH_REQUIRED, 'not authenticated', 'auth');
            this.user = auth.user;
            await this.measureClock();
            if (this.isSchemaIncompatible) {
                this.opts.logger?.warn(`[ma-client] server requires schema >= ${this.serverInfo?.min_supported_schema_version}, client has ${CLIENT_SCHEMA_VERSION}`);
            } else if (this.isServerNewer) {
                this.opts.logger?.debug(`[ma-client] server ${this.serverInfo?.server_version} (schema ${this.serverInfo?.schema_version}) is newer than the typed API (${MA_API_VERSION.server}); newer commands work via send()`);
            }
            const [players, queues] = await Promise.all([
                this.send<Player[]>('players/all'),
                this.send<PlayerQueue[]>('player_queues/all'),
            ]);
            this.players.clear();
            for (const p of players) this.players.set(p.player_id, p);
            this.queues.clear();
            for (const q of queues) this.queues.set(q.queue_id, q);
            this.reconnectDelay = this.opts.reconnectInitialDelayMs;
            this.setState('connected');
        } catch (e) {
            // Any rejection of the auth command means the token is bad (20 = required, 23 = invalid/expired).
            if (e instanceof MaApiError && e.command === 'auth') {
                this.opts.logger?.error('[ma-client] authentication failed — check the token');
                this.setState('auth_failed');
                this.ws?.close();
                return;
            }
            this.opts.logger?.warn('[ma-client] handshake failed', e);
            this.ws?.close();
        }
    }

    private scheduleReconnect(): void {
        clearTimeout(this.reconnectTimer);
        this.setState('reconnecting');
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.opts.reconnectMaxDelayMs);
        this.opts.logger?.info(`[ma-client] reconnecting in ${delay} ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this._state === 'reconnecting') this.openSocket();
        }, delay);
    }

    private handleMessage(raw: string): void {
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            this.opts.logger?.warn('[ma-client] invalid JSON from server');
            return;
        }

        if (msg.message_id !== undefined && msg.message_id !== null) {
            const req = this.pending.get(String(msg.message_id));
            if (!req) return;
            if (msg.error_code) {
                this.finishRequest(String(msg.message_id));
                req.reject(new MaApiError(msg.error_code, msg.details ?? '', req.command));
            } else if (msg.partial) {
                // Large list results arrive in chunks flagged `partial: true`.
                req.partial = (req.partial ?? []).concat(msg.result ?? []);
            } else {
                this.finishRequest(String(msg.message_id));
                req.resolve(req.partial ? req.partial.concat(msg.result ?? []) : msg.result);
            }
            return;
        }

        if (msg.event) {
            this.applyEvent(msg as MaEvent);
            return;
        }

        // First message after connecting: server info, pushed without a message_id.
        if (msg.server_id && msg.schema_version !== undefined) {
            this.serverInfo = msg as ServerInfo;
        }
    }

    /**
     * Server timestamps (e.g. `elapsed_time_last_updated`) are on the server's clock; a local clock
     * that is a few seconds off would shift every extrapolated position (the server docs of `time`
     * recommend exactly this comparison). Older servers without `time` keep offset 0.
     */
    private async measureClock(): Promise<void> {
        try {
            const t0 = Date.now();
            const server = await this.send<number>('time');
            const t1 = Date.now();
            if (typeof server === 'number') this.clockOffset = server - (t0 + t1) / 2000;
        } catch {
            this.clockOffset = 0;
        }
    }

    /**
     * Measure the clock offset again and reload a queue's position straight from the server, e.g.
     * when extrapolated positions seem to have drifted (a long session, many seeks).
     */
    async resync(queueId?: string): Promise<void> {
        await this.measureClock();
        if (!queueId) return;
        const fresh = await this.send<PlayerQueue>('player_queues/get', { queue_id: queueId });
        if (fresh?.queue_id) this.queues.set(fresh.queue_id, fresh);
    }

    /** "Now" on the server's clock, in seconds — use it with `currentElapsed(queue, ma.serverNow())`. */
    serverNow(): number {
        return Date.now() / 1000 + this.clockOffset;
    }

    private finishRequest(id: string): void {
        const req = this.pending.get(id);
        if (req) clearTimeout(req.timer);
        this.pending.delete(id);
    }

    private applyEvent(ev: MaEvent): void {
        switch (ev.event) {
            case 'player_added':
            case 'player_updated': {
                const p = ev.data as Player;
                if (p?.player_id) this.players.set(p.player_id, p);
                break;
            }
            case 'player_removed':
                if (ev.object_id) this.players.delete(ev.object_id);
                break;
            case 'queue_added':
            case 'queue_updated':
            case 'queue_items_updated': {
                const q = ev.data as PlayerQueue;
                if (q?.queue_id) this.queues.set(q.queue_id, q);
                break;
            }
            case 'queue_time_updated': {
                const q = ev.object_id ? this.queues.get(ev.object_id) : undefined;
                if (q && typeof ev.data === 'number') {
                    q.elapsed_time = ev.data;
                    // On the server's clock, like the timestamps in queue_updated — mixing both clocks
                    // shifted the extrapolated position by the clock offset depending on the last event
                    q.elapsed_time_last_updated = this.serverNow();
                }
                break;
            }
        }
        for (const l of this.eventListeners.get(ev.event) ?? []) this.safeCall(l, ev.data, ev.object_id);
        for (const l of this.eventListeners.get('*') ?? []) this.safeCall(l, ev);
    }

    private rejectAllPending(error: Error): void {
        for (const [id, req] of this.pending) {
            clearTimeout(req.timer);
            req.reject(error);
            this.pending.delete(id);
        }
    }

    private safeCall(fn: (...args: any[]) => void, ...args: unknown[]): void {
        try {
            fn(...args);
        } catch (e) {
            this.opts.logger?.error('[ma-client] listener threw', e);
        }
    }
}
