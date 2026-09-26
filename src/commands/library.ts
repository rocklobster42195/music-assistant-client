import type { MaCommandResult } from '../generated/commands.js';
import type * as M from '../generated/models.js';
import type { MediaItem } from '../types.js';
import { PlaybackCommands } from './playback.js';

/** Library listing command per media type. */
const LIBRARY = {
    artist: 'music/artists/library_items',
    album: 'music/albums/library_items',
    track: 'music/tracks/library_items',
    playlist: 'music/playlists/library_items',
    radio: 'music/radios/library_items',
    audiobook: 'music/audiobooks/library_items',
    podcast: 'music/podcasts/library_items',
    genre: 'music/genres/library_items',
} as const;

export type LibraryType = keyof typeof LIBRARY;

export type LibraryQuery = {
    search?: string;
    favorite?: boolean;
    limit?: number;
    offset?: number;
    /** e.g. "name", "sort_name", "timestamp_added_desc", "last_played_desc", "random". */
    orderBy?: string;
};

/** What identifies an item on the server: its id and the provider (instance id or domain). Every media item has both. */
export type ItemRef = { item_id: string; provider: string };

/** Anything MA accepts as "a media item" in commands like mark_played. */
export type AnyMediaItem = MaCommandResult<'music/item_by_uri'> | M.ItemMapping;

/** Search, browse, library, playlists and play progress. */
export class LibraryCommands extends PlaybackCommands {
    // ---- finding things ------------------------------------------------------------------------

    /** Search all providers (or only the library). Results are grouped by type (`tracks`, `albums`, …). */
    search(query: string, opts: { mediaTypes?: M.MediaType[]; limit?: number; libraryOnly?: boolean } = {}) {
        return this.call('music/search', {
            search_query: query,
            ...(opts.mediaTypes ? { media_types: opts.mediaTypes } : {}),
            ...(opts.limit ? { limit: opts.limit } : {}),
            ...(opts.libraryOnly ? { library_only: true } : {}),
        });
    }
    /** One level of the provider tree (`undefined` = the root with all providers). */
    browse(path?: string) {
        return this.call('music/browse', path ? { path } : {});
    }
    /** Library items of one type, e.g. `libraryItems("album", { search: "live", limit: 20 })`. */
    libraryItems<T extends LibraryType>(type: T, query: LibraryQuery = {}): Promise<MaCommandResult<(typeof LIBRARY)[T]>> {
        const args = {
            ...(query.search ? { search: query.search } : {}),
            ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
            ...(query.limit ? { limit: query.limit } : {}),
            ...(query.offset ? { offset: query.offset } : {}),
            ...(query.orderBy ? { order_by: query.orderBy } : {}),
        };
        return this.send(LIBRARY[type], args);
    }
    /** Fetch a media item by URI; provider URIs resolve to the library item when it exists. */
    itemByUri(uri: string) {
        return this.call('music/item_by_uri', { uri });
    }
    albumTracks(album: ItemRef) { return this.call('music/albums/album_tracks', ref(album)); }
    playlistTracks(playlist: ItemRef) { return this.call('music/playlists/playlist_tracks', ref(playlist)); }
    artistTopTracks(artist: ItemRef) { return this.call('music/artists/top_tracks', ref(artist)); }
    podcastEpisodes(podcast: ItemRef) { return this.call('music/podcasts/podcast_episodes', ref(podcast)); }
    /** Recommendation folders as shown on MA's home screen. */
    recommendations() { return this.call('music/recommendations'); }

    // ---- listening history ---------------------------------------------------------------------

    recentlyPlayed(opts: { limit?: number; mediaTypes?: M.MediaType[] } = {}) {
        return this.call('music/recently_played_items', { ...(opts.limit ? { limit: opts.limit } : {}), ...(opts.mediaTypes ? { media_types: opts.mediaTypes } : {}) });
    }
    /** Started, unfinished audiobooks and podcast episodes, newest first ("continue listening"). */
    inProgressItems(limit?: number) {
        return this.call('music/in_progress_items', limit ? { limit } : {});
    }
    markPlayed(item: AnyMediaItem, opts: { fullyPlayed?: boolean; secondsPlayed?: number } = {}) {
        return this.call('music/mark_played', {
            media_item: item,
            ...(opts.fullyPlayed !== undefined ? { fully_played: opts.fullyPlayed } : {}),
            ...(opts.secondsPlayed !== undefined ? { seconds_played: Math.round(opts.secondsPlayed) } : {}),
        });
    }
    /** Forget the play progress of an item (it leaves "continue listening"). */
    markUnplayed(item: AnyMediaItem) { return this.call('music/mark_unplayed', { media_item: item }); }

    // ---- library and favorites -----------------------------------------------------------------

    /** Add a provider item (object or URI) to the library; returns the library item. */
    addToLibrary(item: string | AnyMediaItem) { return this.call('music/library/add_item', { item }); }
    removeFromLibrary(mediaType: M.MediaType, libraryItemId: string | number) {
        return this.call('music/library/remove_item', { media_type: mediaType, library_item_id: libraryItemId });
    }
    addFavorite(uri: string) { return this.call('music/favorites/add_item', { item: uri }); }
    removeFavorite(mediaType: M.MediaType, libraryItemId: string | number) {
        return this.call('music/favorites/remove_item', { media_type: mediaType, library_item_id: libraryItemId });
    }

    // ---- playlists -----------------------------------------------------------------------------

    createPlaylist(name: string) { return this.call('music/playlists/create_playlist', { name }); }
    /** Append items (URIs) to a library playlist (runs as a background task on the server). */
    addToPlaylist(playlistId: string | number, uris: string[]) {
        return this.call('music/playlists/add_playlist_tracks', { db_playlist_id: playlistId, uris });
    }
    /** Remove items at the given positions (1-based, as in MA's playlist track lists). */
    removeFromPlaylist(playlistId: string | number, positions: number[]) {
        return this.call('music/playlists/remove_playlist_tracks', { db_playlist_id: playlistId, positions_to_remove: positions });
    }

    // ---- metadata ------------------------------------------------------------------------------

    /**
     * Lyrics of a track from the metadata providers (e.g. lrclib): `[plain, lrc]`, each null when
     * missing. The first lookup of a track can take ~30 s; MA caches the result (also a miss).
     */
    async trackLyrics(track: M.Track | MediaItem): Promise<{ plain: string | null; lrc: string | null }> {
        // A queue item's media_item is a full Track; the lenient MediaItem type just doesn't say so
        const r = await this.call('metadata/get_track_lyrics', { track: track as M.Track }, { timeoutMs: 60_000 });
        return { plain: r?.[0] || null, lrc: r?.[1] || null };
    }
}

function ref(item: ItemRef) {
    return { item_id: item.item_id, provider_instance_id_or_domain: item.provider };
}
