import { ExtraCommands } from './commands/extras.js';
import { snapImageSize } from './images.js';

/**
 * Client for the Music Assistant WebSocket API: the connection (connection.ts) with live player and
 * queue state, typed convenience commands (commands/*.ts), and `call()` for every other command.
 *
 * UI-agnostic: no Stream Deck imports, so it can be reused elsewhere (e.g. JSA) and published to npm.
 */
export class MusicAssistantClient extends ExtraCommands {
    // ---- helpers ----------------------------------------------------------------------------

    /**
     * URL that fetches an image through the MA image proxy (`/imageproxy/<proxy_id>?size=`).
     * `proxyId` is `MediaItemImage.proxy_id`; `size` is snapped up to a size the server accepts.
     */
    imageProxyUrl(proxyId: string, size = 0): string {
        return `${this.url.replace(/\/$/, '')}/imageproxy/${proxyId}?size=${snapImageSize(size)}`;
    }

    /**
     * Normalize an image URL as found in `current_media.image_url`: MA proxy URLs get the requested
     * size, relative URLs are made absolute, and external URLs are returned unchanged.
     */
    resolveImageUrl(imageUrl: string, size = 0): string {
        const base = this.url.replace(/\/$/, '');
        const url = new URL(imageUrl, base + '/');
        if (url.pathname.startsWith('/imageproxy/')) url.searchParams.set('size', String(snapImageSize(size)));
        return url.toString();
    }
}
