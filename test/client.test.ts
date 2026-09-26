import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { MA_API_VERSION, MaApiError, MusicAssistantClient, currentElapsed, snapImageSize, type MA, type WebSocketLike } from '../src/index.js';

// Minimal fixtures shaped like real server 2.10.4 payloads (see api-docs/).
const SERVER_INFO = {
    server_id: 'abc', server_version: '2.10.4', schema_version: 65, min_supported_schema_version: 28,
    base_url: 'http://ma.local:8095', homeassistant_addon: true, onboard_done: true,
};
const PLAYER = {
    player_id: 'RINCON_BATH', provider: 'sonos', type: 'player', name: 'Bathroom', available: true,
    playback_state: 'idle', volume_level: 10, volume_muted: false, group_members: [],
};
const QUEUE = {
    queue_id: 'RINCON_BATH', active: true, display_name: 'Bathroom', available: true, items: 0,
    shuffle_enabled: false, repeat_mode: 'off', crossfade_enabled: false, autoplay_enabled: false,
    elapsed_time: 0, state: 'idle',
};

/** Scriptable fake server socket. `respond` decides what the "server" answers per command. */
class FakeSocket implements WebSocketLike {
    readyState = 0;
    sent: any[] = [];
    private listeners: Record<string, ((ev: any) => void)[]> = {};
    constructor(public respond: (msg: any, sock: FakeSocket) => void) {}
    addEventListener(type: string, l: (ev: any) => void) { (this.listeners[type] ??= []).push(l); }
    emit(type: string, ev: any = {}) { for (const l of this.listeners[type] ?? []) l(ev); }
    serverSend(obj: unknown) { this.emit('message', { data: JSON.stringify(obj) }); }
    open() { this.readyState = 1; this.emit('open'); this.serverSend(SERVER_INFO); }
    send(data: string) {
        const msg = JSON.parse(data);
        this.sent.push(msg);
        queueMicrotask(() => this.respond(msg, this));
    }
    close() { this.readyState = 3; this.emit('close'); }
}

function happyServer(msg: any, sock: FakeSocket) {
    const reply = (result: unknown) => sock.serverSend({ message_id: msg.message_id, result });
    switch (msg.command) {
        case 'auth': return msg.args?.token === 'good'
            ? reply({ authenticated: true, user: { user_id: 'u1', username: 'boris', role: 'admin' } })
            // Real server answer for an invalid token (2.10.4)
            : sock.serverSend({ message_id: msg.message_id, error_code: 23, details: 'The access token is invalid or has expired.' });
        case 'players/all': return reply([PLAYER]);
        case 'player_queues/all': return reply([QUEUE]);
        case 'broken': return sock.serverSend({ message_id: msg.message_id, error_code: 12, details: 'Invalid or unsupported command.' });
        case 'chunked':
            sock.serverSend({ message_id: msg.message_id, result: [1, 2], partial: true });
            return reply([3]);
        default: return reply(null);
    }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MusicAssistantClient', () => {
    let sockets: FakeSocket[];
    const makeClient = (token = 'good', respond = happyServer) =>
        new MusicAssistantClient({
            url: 'http://ma.local:8095',
            token,
            reconnectInitialDelayMs: 100,
            webSocketFactory: (url) => {
                expect(url).toBe('ws://ma.local:8095/ws');
                const s = new FakeSocket(respond);
                sockets.push(s);
                return s;
            },
        });

    beforeEach(() => { sockets = []; });
    afterEach(() => { vi.useRealTimers(); });

    it('authenticates with the token inside args and loads players and queues', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();

        expect(sockets[0].sent[0]).toMatchObject({ command: 'auth', args: { token: 'good' } });
        expect(client.state).toBe('connected');
        expect(client.serverInfo?.server_version).toBe('2.10.4');
        expect(client.user?.username).toBe('boris');
        expect(client.players.get('RINCON_BATH')?.name).toBe('Bathroom');
        expect(client.queues.get('RINCON_BATH')?.state).toBe('idle');
        expect(client.isSchemaIncompatible).toBe(false);
    });

    it('stops at auth_failed and does not reconnect on a bad token', async () => {
        vi.useFakeTimers();
        const client = makeClient('bad');
        client.start();
        sockets[0].open();
        await vi.runAllTimersAsync();
        expect(client.state).toBe('auth_failed');
        expect(sockets).toHaveLength(1);
    });

    it('connect() resolves once players and queues are loaded', async () => {
        const client = makeClient();
        const connected = client.connect();
        sockets[0].open();
        await connected;
        expect(client.players.get('RINCON_BATH')?.name).toBe('Bathroom');
        await client.connect(); // already connected: resolves right away
        expect(sockets).toHaveLength(1);
    });

    it('connect() rejects on a bad token and on timeout, and stops the client', async () => {
        const bad = makeClient('bad');
        const rejected = bad.connect();
        sockets[0].open();
        await expect(rejected).rejects.toBeInstanceOf(MaApiError);
        expect(bad.state).toBe('stopped');

        vi.useFakeTimers();
        const silent = makeClient();
        const timedOut = silent.connect({ timeoutMs: 1000 });
        const check = expect(timedOut).rejects.toThrow(/within 1000 ms/);
        await vi.advanceTimersByTimeAsync(1000);
        await check;
        expect(silent.state).toBe('stopped');
    });

    it('call() sends any API command with typed args and result', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();

        const result = client.call('players/get', { player_id: 'RINCON_BATH' });
        await flush();
        expect(sockets[0].sent.at(-1)).toMatchObject({ command: 'players/get', args: { player_id: 'RINCON_BATH' } });
        await expect(result).resolves.toBeNull(); // the fake server answers null to unknown commands
        await expect(client.call('player_queues/all')).resolves.toEqual([QUEUE]); // no required args → args optional

        // Types (checked by `npm run typecheck -w music-assistant-client`)
        expectTypeOf(result).resolves.toEqualTypeOf<MA.Player>();
        expectTypeOf(client.call('music/search', { search_query: 'x' })).resolves.toEqualTypeOf<MA.SearchResults>();
        expectTypeOf<MA.Track['media_type']>().toEqualTypeOf<MA.MediaType | undefined>();
        // @ts-expect-error missing required argument
        void client.call('players/get', {}).catch(() => {});
        // @ts-expect-error unknown command
        void client.call('players/nope').catch(() => {});
        // @ts-expect-error wrong argument type
        void client.call('player_queues/seek', { queue_id: 'q', position: 'soon' }).catch(() => {});
        expect(MA_API_VERSION.schema).toBe(65);
    });

    it('convenience commands send the right command and arguments', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();

        const ref = { item_id: '42', provider: 'library' };
        const cases: [() => Promise<unknown>, string, Record<string, unknown>][] = [
            [() => client.skipSeconds('q', -30), 'player_queues/skip', { queue_id: 'q', seconds: -30 }],
            [() => client.setPlaybackSpeed('q', 1.5), 'player_queues/set_playback_speed', { queue_id: 'q', speed: 1.5 }],
            [() => client.clearQueue('q'), 'player_queues/clear', { queue_id: 'q' }],
            [() => client.removeQueueItem('q', 3), 'player_queues/delete_item', { queue_id: 'q', item_id_or_index: 3 }],
            [() => client.moveQueueItem('q', 'qi', -1), 'player_queues/move_item', { queue_id: 'q', queue_item_id: 'qi', pos_shift: -1 }],
            [() => client.saveQueueAsPlaylist('q', 'Party'), 'player_queues/save_as_playlist', { queue_id: 'q', name: 'Party' }],
            [() => client.setPower('p', false), 'players/cmd/power', { player_id: 'p', powered: false }],
            [() => client.ungroupMany(['a', 'b']), 'players/cmd/ungroup_many', { player_ids: ['a', 'b'] }],
            [() => client.sleepTimer('p'), 'players/sleep_timer/get', { player_id: 'p' }],
            [() => client.search('holmes', { mediaTypes: ['audiobook'], limit: 5 }), 'music/search', { search_query: 'holmes', media_types: ['audiobook'], limit: 5 }],
            [() => client.browse(), 'music/browse', {}],
            [() => client.libraryItems('album', { search: 'live', favorite: true, orderBy: 'random' }), 'music/albums/library_items', { search: 'live', favorite: true, order_by: 'random' }],
            [() => client.albumTracks(ref), 'music/albums/album_tracks', { item_id: '42', provider_instance_id_or_domain: 'library' }],
            [() => client.podcastEpisodes(ref), 'music/podcasts/podcast_episodes', { item_id: '42', provider_instance_id_or_domain: 'library' }],
            [() => client.inProgressItems(10), 'music/in_progress_items', { limit: 10 }],
            [() => client.recentlyPlayed({ mediaTypes: ['track'] }), 'music/recently_played_items', { media_types: ['track'] }],
            [() => client.addToPlaylist(7, ['library://track/1']), 'music/playlists/add_playlist_tracks', { db_playlist_id: 7, uris: ['library://track/1'] }],
            [() => client.partyAddToQueue('library://track/1', true), 'party/add_to_queue', { uri: 'library://track/1', boost: true }],
            [() => client.partyUrl(), 'party/url', {}],
        ];
        for (const [run, command, args] of cases) {
            await run();
            expect(sockets[0].sent.at(-1), command).toEqual(expect.objectContaining({ command, args }));
        }
    });

    it('finds players by name in the live cache', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();
        expect(client.playerByName('bathroom')?.player_id).toBe('RINCON_BATH');
        expect(client.playerByName(' Bathroom ')?.player_id).toBe('RINCON_BATH');
        expect(client.playerByName('Kitchen')).toBeUndefined();
        // library listings take any extra filter the server knows (Python **kwargs)
        expectTypeOf(client.call('music/tracks/library_items', { limit: 1, provider: 'library', explicit: true })).resolves.toEqualTypeOf<MA.Track[]>();
        expectTypeOf(client.libraryItems('podcast')).resolves.toEqualTypeOf<MA.Podcast[]>();
    });

    it('measures the server clock and extrapolates positions on it, whatever event came last', async () => {
        const skew = 5; // server clock 5 s ahead of ours
        const client = makeClient('good', (msg, sock) =>
            msg.command === 'time' ? sock.serverSend({ message_id: msg.message_id, result: Date.now() / 1000 + skew }) : happyServer(msg, sock),
        );
        client.start();
        sockets[0].open();
        await flush(); await flush(); await flush();
        expect(client.clockOffset).toBeCloseTo(skew, 0);

        // queue_updated carries a server timestamp …
        sockets[0].serverSend({ event: 'queue_updated', object_id: 'RINCON_BATH', data: { ...QUEUE, state: 'playing', elapsed_time: 10, elapsed_time_last_updated: client.serverNow() } });
        expect(currentElapsed(client.queues.get('RINCON_BATH')!, client.serverNow())).toBeCloseTo(10, 1);
        // … queue_time_updated only the position: it must be stamped on the same clock
        sockets[0].serverSend({ event: 'queue_time_updated', object_id: 'RINCON_BATH', data: 20 });
        expect(currentElapsed(client.queues.get('RINCON_BATH')!, client.serverNow())).toBeCloseTo(20, 1);
    });

    it('keeps the cache in sync from events and notifies listeners', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();

        const seen: string[] = [];
        client.on('player_updated', (p) => seen.push(`${p.name}:${p.playback_state}`));
        sockets[0].serverSend({ event: 'player_updated', object_id: 'RINCON_BATH', data: { ...PLAYER, playback_state: 'playing', volume_level: 5 } });
        sockets[0].serverSend({ event: 'queue_updated', object_id: 'RINCON_BATH', data: { ...QUEUE, state: 'playing', crossfade_enabled: true } });
        sockets[0].serverSend({ event: 'queue_time_updated', object_id: 'RINCON_BATH', data: 42 });

        expect(seen).toEqual(['Bathroom:playing']);
        expect(client.players.get('RINCON_BATH')?.volume_level).toBe(5);
        expect(client.queues.get('RINCON_BATH')?.crossfade_enabled).toBe(true);
        expect(client.queues.get('RINCON_BATH')?.elapsed_time).toBe(42);
    });

    it('rejects with MaApiError and merges partial results', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();

        await expect(client.send('broken')).rejects.toBeInstanceOf(MaApiError);
        await expect(client.send('chunked')).resolves.toEqual([1, 2, 3]);
    });

    it('sends the documented argument names for toggles', async () => {
        const client = makeClient();
        client.start();
        sockets[0].open();
        await flush(); await flush();

        await client.setAutoplay('Q', true);
        await client.setCrossfade('Q', false);
        await client.setMute('P', true);
        const tail = sockets[0].sent.slice(-3);
        expect(tail[0]).toMatchObject({ command: 'player_queues/autoplay', args: { queue_id: 'Q', autoplay_enabled: true } });
        expect(tail[1]).toMatchObject({ command: 'player_queues/crossfade', args: { queue_id: 'Q', crossfade_enabled: false } });
        expect(tail[2]).toMatchObject({ command: 'players/cmd/volume_mute', args: { player_id: 'P', muted: true } });
    });

    it('reconnects with backoff after the connection drops', async () => {
        vi.useFakeTimers();
        const client = makeClient();
        client.start();
        sockets[0].open();
        await vi.advanceTimersByTimeAsync(0);
        expect(client.state).toBe('connected');

        sockets[0].close();
        expect(client.state).toBe('reconnecting');
        await vi.advanceTimersByTimeAsync(100);
        expect(sockets).toHaveLength(2);
        sockets[1].open();
        await vi.advanceTimersByTimeAsync(0);
        expect(client.state).toBe('connected');
    });

    it('builds image URLs with sizes the proxy accepts', () => {
        const client = makeClient();
        expect(client.imageProxyUrl('ab'.repeat(32), 144)).toBe(`http://ma.local:8095/imageproxy/${'ab'.repeat(32)}?size=160`);
        expect(client.resolveImageUrl('http://ma.local:8095/imageproxy/xyz?size=0&fmt=png', 144)).toBe('http://ma.local:8095/imageproxy/xyz?size=160&fmt=png');
        expect(client.resolveImageUrl('https://somafm.com/logo.jpg', 144)).toBe('https://somafm.com/logo.jpg');
    });
});

describe('helpers', () => {
    it('snaps to accepted proxy sizes', () => {
        expect(snapImageSize(0)).toBe(0);
        expect(snapImageSize(72)).toBe(80);
        expect(snapImageSize(144)).toBe(160);
        expect(snapImageSize(5000)).toBe(0);
    });

    it('extrapolates elapsed time only while playing', () => {
        expect(currentElapsed({ elapsed_time: 10, elapsed_time_last_updated: 100, state: 'playing' }, 105)).toBe(15);
        expect(currentElapsed({ elapsed_time: 10, elapsed_time_last_updated: 100, state: 'paused' }, 105)).toBe(10);
    });
});
