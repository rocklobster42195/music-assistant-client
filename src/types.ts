// Subset of the Music Assistant API models that the convenience layer relies on.
// Field names follow the server's JSON (snake_case). Verified against server 2.10.4 / schema 65;
// the full reference lives in api-docs/ and src/generated/.

export interface ServerInfo {
    server_id: string;
    server_version: string;
    schema_version: number;
    min_supported_schema_version: number;
    base_url: string;
    homeassistant_addon: boolean;
    onboard_done: boolean;
    name?: string;
    status?: string;
}

export interface AuthUser {
    user_id: string;
    username: string;
    role: string;
    display_name?: string;
    avatar_url?: string;
}

// Enums come from the generated models (the server's own docs), so both layers agree
import type { DashboardType, MediaType, PlaybackState, RepeatMode } from './generated/models.js';
export type { DashboardType, MediaType, PlaybackState, RepeatMode };

/** RGB triplets computed by MA from the current artwork. */
export interface MediaPalette {
    background_dark?: [number, number, number];
    background_light?: [number, number, number];
    primary?: [number, number, number];
    accent?: [number, number, number];
    on_dark?: [number, number, number];
    on_light?: [number, number, number];
}

export interface PlayerMedia {
    uri: string;
    media_type: MediaType;
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    album_artist?: string | null;
    image_url?: string | null;
    palette?: MediaPalette | null;
    duration?: number | null;
    elapsed_time?: number | null;
    elapsed_time_last_updated?: number | null;
    queue_item_id?: string | null;
    source_id?: string | null;
}

export interface Player {
    player_id: string;
    provider: string;
    type: string;
    name: string;
    display_name?: string;
    available: boolean;
    enabled?: boolean;
    playback_state: PlaybackState;
    elapsed_time?: number | null;
    elapsed_time_last_updated?: number | null;
    powered?: boolean | null;
    volume_level?: number | null;
    volume_muted?: boolean | null;
    group_members: string[];
    synced_to?: string | null;
    active_group?: string | null;
    active_source?: string | null;
    current_media?: PlayerMedia | null;
    group_volume?: number | null;
    group_volume_muted?: boolean | null;
    /** Epoch seconds when the sleep timer stops playback. */
    sleep_timer_expires_at?: number | null;
    source_list?: PlayerSource[];
    hide_in_ui?: boolean;
    [key: string]: unknown;
}

export interface PlayerSource {
    id: string;
    name: string;
    /** Passive sources (e.g. AirPlay) become active on their own and can't be selected. */
    passive?: boolean;
    [key: string]: unknown;
}


export interface DashboardEndpoint {
    dashboard_id: string;
    name: string;
    supported_types: DashboardType[];
    provider_domain_hint?: string;
}

export interface DashboardSession {
    dashboard_id: string;
    dashboard?: DashboardType;
    player_id?: string | null;
    [key: string]: unknown;
}

export interface PlayerQueue {
    queue_id: string;
    active: boolean;
    display_name: string;
    available: boolean;
    items: number;
    shuffle_enabled: boolean;
    repeat_mode: RepeatMode;
    crossfade_enabled: boolean;
    /** "Don't stop the music" in the MA UI. */
    autoplay_enabled: boolean;
    current_index?: number | null;
    elapsed_time: number;
    elapsed_time_last_updated?: number;
    state: PlaybackState;
    current_item?: QueueItem | null;
    next_item?: QueueItem | null;
    [key: string]: unknown;
}

export interface QueueItem {
    queue_item_id: string;
    /** Position in the queue (0-based). */
    index?: number;
    name: string;
    duration?: number | null;
    media_item?: MediaItem | null;
    image?: MediaItemImage | null;
    [key: string]: unknown;
}

export interface MediaItemImage {
    type: string;
    path: string;
    provider: string;
    remotely_accessible: boolean;
    /** Opaque id for `/imageproxy/<proxy_id>`. */
    proxy_id?: string;
}

export interface MediaItem {
    item_id: string;
    provider: string;
    name: string;
    uri: string;
    media_type: MediaType;
    favorite?: boolean;
    metadata?: { images?: MediaItemImage[] | null; [key: string]: unknown };
    [key: string]: unknown;
}

/** Events pushed by the server over the WebSocket. */
export interface EventMap {
    player_added: Player;
    player_updated: Player;
    player_removed: string;
    player_config_updated: unknown;
    queue_added: PlayerQueue;
    queue_updated: PlayerQueue;
    queue_items_updated: PlayerQueue;
    /** Elapsed seconds of the queue's current item. */
    queue_time_updated: number;
    media_item_added: MediaItem;
    media_item_updated: MediaItem;
    media_item_deleted: MediaItem;
    media_item_played: unknown;
    music_sync_completed: unknown;
    providers_updated: unknown;
    tasks_updated: unknown;
    application_shutdown: unknown;
}

export type EventName = keyof EventMap;

export interface MaEvent<E extends EventName = EventName> {
    event: E;
    object_id?: string | null;
    data: EventMap[E];
}
