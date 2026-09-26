import { MusicAssistantConnection } from '../connection.js';
import type * as M from '../generated/models.js';
import type { Player } from '../types.js';

const clampVolume = (level: number) => Math.round(Math.min(100, Math.max(0, level)));

/** Playback, queue and player commands. */
export class PlaybackCommands extends MusicAssistantConnection {
    // ---- playback (queue) --------------------------------------------------------------------

    playPause(queueId: string) { return this.call('player_queues/play_pause', { queue_id: queueId }); }
    play(queueId: string) { return this.call('player_queues/play', { queue_id: queueId }); }
    pause(queueId: string) { return this.call('player_queues/pause', { queue_id: queueId }); }
    stopPlayback(queueId: string) { return this.call('player_queues/stop', { queue_id: queueId }); }
    next(queueId: string) { return this.call('player_queues/next', { queue_id: queueId }); }
    previous(queueId: string) { return this.call('player_queues/previous', { queue_id: queueId }); }
    /** Jump to `position` seconds in the current item. */
    seek(queueId: string, position: number) { return this.call('player_queues/seek', { queue_id: queueId, position }); }
    /** Skip `seconds` forward (negative: back) — e.g. ±30 s in a podcast. */
    skipSeconds(queueId: string, seconds: number) { return this.call('player_queues/skip', { queue_id: queueId, seconds }); }
    setShuffle(queueId: string, enabled: boolean) { return this.call('player_queues/shuffle', { queue_id: queueId, shuffle_enabled: enabled }); }
    setRepeat(queueId: string, mode: M.RepeatMode) { return this.call('player_queues/repeat', { queue_id: queueId, repeat_mode: mode }); }
    setCrossfade(queueId: string, enabled: boolean) { return this.call('player_queues/crossfade', { queue_id: queueId, crossfade_enabled: enabled }); }
    /** "Don't stop the music". */
    setAutoplay(queueId: string, enabled: boolean) { return this.call('player_queues/autoplay', { queue_id: queueId, autoplay_enabled: enabled }); }
    /** Playback speed 0.5–3.0 (audiobooks and podcast episodes only); the current item unless `queueItemId` is given. */
    setPlaybackSpeed(queueId: string, speed: number, queueItemId?: string) {
        return this.call('player_queues/set_playback_speed', { queue_id: queueId, speed, ...(queueItemId ? { queue_item_id: queueItemId } : {}) });
    }
    /** Move the queue (and playback) to another player — "music follows me". */
    transferQueue(sourceQueueId: string, targetQueueId: string, autoPlay?: boolean) {
        return this.call('player_queues/transfer', {
            source_queue_id: sourceQueueId,
            target_queue_id: targetQueueId,
            ...(autoPlay === undefined ? {} : { auto_play: autoPlay }),
        });
    }
    /**
     * Play one or more media items / URIs. `option`: play | replace | next | replace_next | add.
     * Audiobooks and podcast episodes resume where they were left off.
     */
    playMedia(queueId: string, media: string | string[], option?: M.QueueOption) {
        return this.call('player_queues/play_media', { queue_id: queueId, media, ...(option ? { option } : {}) });
    }

    // ---- queue contents ------------------------------------------------------------------------

    /** Queue items, paged. */
    queueItems(queueId: string, limit = 50, offset = 0) {
        return this.call('player_queues/items', { queue_id: queueId, limit, offset });
    }
    /** Jump to (and play) the item at `index` — or with that queue_item_id — in the queue. */
    playIndex(queueId: string, index: number | string) {
        return this.call('player_queues/play_index', { queue_id: queueId, index });
    }
    /** Remove all items (stops playback unless `keepPlaying`). */
    clearQueue(queueId: string, keepPlaying = false) {
        return this.call('player_queues/clear', { queue_id: queueId, ...(keepPlaying ? { skip_stop: true } : {}) });
    }
    /** Remove one item, by queue_item_id or index. */
    removeQueueItem(queueId: string, itemIdOrIndex: string | number) {
        return this.call('player_queues/delete_item', { queue_id: queueId, item_id_or_index: itemIdOrIndex });
    }
    /** Move an item `shift` places (negative: up); 0 moves it to the front of the upcoming items. */
    moveQueueItem(queueId: string, queueItemId: string, shift: number) {
        return this.call('player_queues/move_item', { queue_id: queueId, queue_item_id: queueItemId, pos_shift: shift });
    }
    /** Save the queue as a new playlist (runs as a background task on the server). */
    saveQueueAsPlaylist(queueId: string, name: string) {
        return this.call('player_queues/save_as_playlist', { queue_id: queueId, name });
    }

    // ---- players -------------------------------------------------------------------------------

    /** A player from the live cache by its name (case-insensitive), e.g. `playerByName("Kitchen")`. */
    playerByName(name: string): Player | undefined {
        const wanted = name.trim().toLocaleLowerCase();
        for (const p of this.players.values()) {
            if ((p.display_name ?? p.name).toLocaleLowerCase() === wanted || p.name.toLocaleLowerCase() === wanted) return p;
        }
        return undefined;
    }
    /** Stop the player itself (also sources outside MA's queue) — what MA's sleep timer does. */
    stopPlayer(playerId: string) { return this.call('players/cmd/stop', { player_id: playerId }); }
    setPower(playerId: string, powered: boolean) { return this.call('players/cmd/power', { player_id: playerId, powered }); }
    setVolume(playerId: string, level: number) { return this.call('players/cmd/volume_set', { player_id: playerId, volume_level: clampVolume(level) }); }
    volumeUp(playerId: string) { return this.call('players/cmd/volume_up', { player_id: playerId }); }
    volumeDown(playerId: string) { return this.call('players/cmd/volume_down', { player_id: playerId }); }
    setMute(playerId: string, muted: boolean) { return this.call('players/cmd/volume_mute', { player_id: playerId, muted }); }
    /** "Like": add the currently playing item to the MA favorites. */
    addCurrentlyPlayingToFavorites(playerId: string) { return this.call('players/add_currently_playing_to_favorites', { player_id: playerId }); }
    selectSource(playerId: string, source: string) { return this.call('players/cmd/select_source', { player_id: playerId, source }); }

    // ---- groups --------------------------------------------------------------------------------

    /** Group `playerIds` with `targetPlayerId` as leader. */
    groupPlayers(targetPlayerId: string, playerIds: string[]) {
        return this.call('players/cmd/set_members', { target_player: targetPlayerId, player_ids_to_add: playerIds });
    }
    ungroup(playerId: string) { return this.call('players/cmd/ungroup', { player_id: playerId }); }
    /** Take several players out of their groups at once. */
    ungroupMany(playerIds: string[]) { return this.call('players/cmd/ungroup_many', { player_ids: playerIds }); }
    setGroupVolume(playerId: string, level: number) { return this.call('players/cmd/group_volume', { player_id: playerId, volume_level: clampVolume(level) }); }
    setGroupMute(playerId: string, muted: boolean) { return this.call('players/cmd/group_volume_mute', { player_id: playerId, muted }); }

    // ---- sleep timer ---------------------------------------------------------------------------

    /** Stop playback after `seconds`. Returns the expiry time (epoch seconds). */
    setSleepTimer(playerId: string, seconds: number) { return this.call('players/sleep_timer/set', { player_id: playerId, seconds: Math.round(seconds) }); }
    /** Expiry time (epoch seconds) of the running sleep timer. */
    sleepTimer(playerId: string) { return this.call('players/sleep_timer/get', { player_id: playerId }); }
    clearSleepTimer(playerId: string) { return this.call('players/sleep_timer/clear', { player_id: playerId }); }
}
