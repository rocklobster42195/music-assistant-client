# music-assistant-client

A typed TypeScript client for the [Music Assistant](https://www.music-assistant.io/) WebSocket API.

- **Token authentication** and **auto-reconnect** with backoff
- **Live state**: all players and queues kept up to date from server events
- **Convenience methods** for playback, queues, players, groups, search, library, playlists, listening history and party mode
- **The whole API, typed**: every command (310 in Music Assistant 2.10) and every data model, generated from the server's own API docs
- **No dependencies**, ESM, runs in Node.js ≥ 20 and in browsers

> Unofficial community package, not affiliated with the Music Assistant project. It was built for MAC, a Stream Deck plugin for Music Assistant.

## Install

```bash
npm install music-assistant-client
```

On **Node.js 20**, which has no stable global `WebSocket`, also install [`ws`](https://www.npmjs.com/package/ws) and pass it in (see below). Node.js 22+, Deno, Bun and browsers work without it.

## Quick start

You need the server address and a **long-lived token**: in Music Assistant, open **Settings → Profile** and create one.

```ts
import { MusicAssistantClient } from "music-assistant-client";

const ma = new MusicAssistantClient({ url: "http://192.168.1.10:8095", token: "…" });
ma.start();

ma.onStateChange((state) => console.log("connection:", state)); // connecting → authenticating → connected

ma.on("player_updated", (player) => {
    console.log(`${player.display_name ?? player.name}: ${player.playback_state}, volume ${player.volume_level}`);
});
```

For a **script** that does one thing and exits, `connect()` starts the client and waits until players and queues are loaded. It rejects when the token is rejected or the server doesn't answer within 15 s (`connect({ timeoutMs })`, 0 = wait forever), and stops the client then:

```ts
// announce.mjs — node announce.mjs "Kitchen" "Dinner is ready"
const [room, message] = process.argv.slice(2);
const ma = new MusicAssistantClient({ url: process.env.MA_URL, token: process.env.MA_TOKEN });
await ma.connect();

const player = ma.playerByName(room);
if (!player) throw new Error(`No player "${room}"`);
await ma.playAnnouncement(player.player_id, { message, volume: 30 });
ma.stop();
```

Node.js 20:

```ts
import WebSocket from "ws";

const ma = new MusicAssistantClient({ url, token, webSocketFactory: (u) => new WebSocket(u) });
```

## Controlling things

Commands take a **queue id** (playback) or a **player id** (volume, power, grouping). For a player's own queue, the two are the same.

```ts
const kitchen = ma.playerByName("Kitchen");          // from the live cache, case-insensitive
if (!kitchen) throw new Error("no such player");

const { albums = [] } = await ma.search("Dark Side of the Moon", { mediaTypes: ["album"] });
if (albums[0]?.uri) await ma.playMedia(kitchen.player_id, albums[0].uri, "replace");
await ma.setVolume(kitchen.player_id, 25);
await ma.skipSeconds(kitchen.player_id, 30);
```

| Area | Methods |
|---|---|
| Playback | `playPause` `play` `pause` `stopPlayback` `next` `previous` `seek` `skipSeconds` `setShuffle` `setRepeat` `setCrossfade` `setAutoplay` `setPlaybackSpeed` `playMedia` `transferQueue` |
| Queue | `queueItems` `playIndex` `clearQueue` `removeQueueItem` `moveQueueItem` `saveQueueAsPlaylist` |
| Players and groups | `playerByName` `setPower` `setVolume` `volumeUp` `volumeDown` `setMute` `selectSource` `groupPlayers` `ungroup` `ungroupMany` `setGroupVolume` `setGroupMute` `setSleepTimer` `sleepTimer` `clearSleepTimer` `stopPlayer` |
| Library | `search` `browse` `libraryItems` `itemByUri` `albumTracks` `playlistTracks` `artistTopTracks` `podcastEpisodes` `recommendations` `addToLibrary` `removeFromLibrary` `addFavorite` `removeFavorite` `addCurrentlyPlayingToFavorites` |
| Listening history | `recentlyPlayed` `inProgressItems` `markPlayed` `markUnplayed` |
| Playlists | `createPlaylist` `addToPlaylist` `removeFromPlaylist` |
| Extras | `trackLyrics` `playAnnouncement` `ttsEngines` `dashboards` `showDashboard` `hideDashboard` `partyUrl` `partyAddToQueue` `partyBoost` `partySkip` |

`playMedia` accepts any Music Assistant URI (`library://playlist/12`, `spotify://track/…`, …). Audiobooks and podcast episodes resume where they were left off.

## Every other command: `call()`

Anything the convenience methods don't cover is one `call()` away, with checked arguments and a typed result:

```ts
import type { MA } from "music-assistant-client";

const player: MA.Player = await ma.call("players/get", { player_id: "RINCON_…" });
const episodes = await ma.call("music/podcasts/podcast_episodes", { item_id: "12", provider_instance_id_or_domain: "library" });

ma.call("players/get", {});                  // ✗ compile error: player_id is missing
ma.call("player_queues/seek", { queue_id: "q", position: "soon" }); // ✗ compile error: position is a number
```

Your editor completes command names and shows each command's and argument's description from the server docs. All data models are available as `MA.*` (`MA.Track`, `MA.Album`, `MA.PlayerQueue`, `MA.SearchResults`, `MA.MediaType`, …).

`send(command, args)` is the untyped escape hatch, for example for commands of a newer server.

## Live state and events

```ts
ma.players          // Map<player_id, Player>, always current
ma.queues           // Map<queue_id, PlayerQueue>
ma.serverInfo       // server version, schema, base URL
ma.user             // the token's user

ma.on("queue_updated", (queue) => { … });
ma.on("queue_time_updated", (seconds, queueId) => { … });
ma.on("*", (event) => { … });   // every event: { event, object_id, data }
```

Events: `player_added` `player_updated` `player_removed` `player_config_updated` `queue_added` `queue_updated` `queue_items_updated` `queue_time_updated` `media_item_added` `media_item_updated` `media_item_deleted` `media_item_played` `music_sync_completed` `providers_updated` `tasks_updated` `application_shutdown`. `on()` returns an unsubscribe function.

**Control commands return nothing**: Music Assistant reports the new state through events. Fast sequences (like several volume steps) are coalesced by the server, so a UI should update optimistically and reconcile when the event arrives.

The playback position is only sent every few seconds. `currentElapsed(queue)` extrapolates it while playing:

```ts
import { currentElapsed } from "music-assistant-client";
const seconds = currentElapsed(ma.queues.get(queueId)!);
```

## Helpers

- `imageProxyUrl(proxyId, size)` / `resolveImageUrl(url, size)`: artwork through Music Assistant's image proxy, at a size the server accepts
- `trackLyrics(track)` → `{ plain, lrc }`, with `parseLrc(lrc)` and `lyricIndexAt(lines, seconds)` for synced lyrics
- `snapImageSize(size)`: the next image size the proxy supports

## Connection, errors and options

| Option | Default | |
|---|---|---|
| `url` | | Server base URL, e.g. `http://192.168.1.10:8095` |
| `token` | | Long-lived access token |
| `webSocketFactory` | global `WebSocket` | Needed on Node.js 20 |
| `requestTimeoutMs` | 10000 | Per command (slow commands override it) |
| `reconnectInitialDelayMs` / `reconnectMaxDelayMs` | 1000 / 30000 | Exponential backoff |
| `logger` | none | `{ debug, info, warn, error }`, e.g. `console` |

- `state`: `stopped` · `connecting` · `authenticating` · `connected` · `reconnecting` · `auth_failed`. A rejected token ends in `auth_failed` without reconnecting.
- Failed commands reject with `MaApiError` (`code`, `details`, `command`), timeouts and lost connections with a plain `Error`.
- `stop()` closes the connection and rejects pending commands.

## Compatibility

The types are generated from Music Assistant **2.10.4 (schema 65)**, exported as `MA_API_VERSION`. The client works with newer servers too:
- `isServerNewer` tells you when the server's schema is ahead of the types. Commands added since then work through `send()`.
- `isSchemaIncompatible` tells you when the server no longer supports this client's schema.

The server also sends a few undocumented compatibility fields, for example `Player.display_name`. The client's own state types (`Player`, `PlayerQueue`, …) include the common ones.

## Development

```bash
npm install
npm run check        # build, typecheck, tests, lint
```

**Updating the API types.** Fetch `/api-docs/openapi.json`, `/api-docs/commands.json` and `/info` from a Music Assistant server into `api-docs/` as `openapi-<version>.json`, `commands-<version>.json` and `info-<version>.json` (remove personal values such as the server id and URLs from `info`), then run `npm run gen:api`. CI fails when `src/generated/` does not match `api-docs/`.

**Releasing.** Write the notes under `[Unreleased]` in `CHANGELOG.md`, then `npm run release:patch|minor|major`. It bumps the version, dates the changelog, commits, tags `v<version>` and pushes; the **Publish** workflow publishes the tag to npm with provenance.

## License

MIT
