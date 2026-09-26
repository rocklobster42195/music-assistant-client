import type * as M from '../generated/models.js';
import { LibraryCommands } from './library.js';

/** Announcements, dashboards and the party mode. */
export class ExtraCommands extends LibraryCommands {
    // ---- announcements -------------------------------------------------------------------------

    /** Speak `message` (TTS) or play `url` as an announcement on a player. */
    playAnnouncement(playerId: string, opts: { message?: string; url?: string; ttsEngine?: string; language?: string; volume?: number; preAnnounce?: boolean }) {
        return this.call('players/cmd/play_announcement', {
            player_id: playerId,
            ...(opts.message ? { message: opts.message } : {}),
            ...(opts.url ? { url: opts.url } : {}),
            ...(opts.ttsEngine ? { tts_engine: opts.ttsEngine } : {}),
            ...(opts.language ? { language: opts.language } : {}),
            ...(typeof opts.volume === 'number' ? { volume_level: Math.round(opts.volume) } : {}),
            ...(typeof opts.preAnnounce === 'boolean' ? { pre_announce: opts.preAnnounce } : {}),
        });
    }
    ttsEngines() { return this.call('players/tts_engines'); }

    // ---- dashboards ----------------------------------------------------------------------------

    /** Registered dashboard endpoints (e.g. a Chromecast TV). */
    dashboards() { return this.call('dashboard/dashboards'); }
    dashboardSessions() { return this.call('dashboard/sessions'); }
    /** Casting starts an app on the target (e.g. a Chromecast) — that can take well over 10 s. */
    showDashboard(dashboardId: string, dashboard: M.DashboardType, playerId?: string) {
        return this.call('dashboard/show', { dashboard_id: dashboardId, dashboard, ...(playerId ? { player_id: playerId } : {}) }, { timeoutMs: 60_000 });
    }
    hideDashboard(dashboardId: string) { return this.call('dashboard/hide', { dashboard_id: dashboardId }, { timeoutMs: 30_000 }); }

    // ---- party mode (needs MA's Party plugin) --------------------------------------------------

    /** Guest URL (works from anywhere when MA's remote access is on, otherwise on the local network). */
    partyUrl() { return this.call('party/url'); }
    /** A guest request: add an item to the party queue, `boost` = play it next among guest requests. */
    partyAddToQueue(uri: string, boost = false) { return this.call('party/add_to_queue', { uri, ...(boost ? { boost: true } : {}) }); }
    /** Move a queued item up into the boosted section (right after the current track). */
    partyBoost(queueItemId: string) { return this.call('party/boost_queue_item', { queue_item_id: queueItemId }); }
    partySkip() { return this.call('party/skip'); }
}
