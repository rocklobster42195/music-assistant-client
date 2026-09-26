# Changelog

All notable changes to `music-assistant-client`.

## [Unreleased]

First public version.

- Connection: token auth, auto-reconnect with backoff, live players and queues from server events, typed events, `onStateChange`, `connect()` (start and wait until loaded, for scripts), schema compatibility checks (`isSchemaIncompatible`, `isServerNewer`).
- `call(command, args)`: every command of the Music Assistant API with checked arguments and typed results; all data models as `MA.*`. Generated from Music Assistant 2.10.4 (schema 65).
- Convenience methods for playback, queue editing, players and groups, sleep timer, search, browse, library, playlists, listening history, lyrics, announcements, dashboards and party mode.
- Server clock: `clockOffset` (measured on connect with `time`) and `serverNow()`, to extrapolate positions with `currentElapsed(queue, ma.serverNow())`. `queue_time_updated` positions are stamped on the server clock too. `resync(queueId?)` measures the offset again and reloads a queue's position.
- Helpers: `currentElapsed`, `imageProxyUrl`, `resolveImageUrl`, `parseLrc`, `lyricIndexAt`.
