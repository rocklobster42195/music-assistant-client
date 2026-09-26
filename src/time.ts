import type { PlayerQueue } from './types.js';

/** Current position of a queue in seconds, extrapolated while playing. */
export function currentElapsed(queue: Pick<PlayerQueue, 'elapsed_time' | 'elapsed_time_last_updated' | 'state'>, nowSeconds = Date.now() / 1000): number {
    const base = queue.elapsed_time ?? 0;
    if (queue.state !== 'playing' || !queue.elapsed_time_last_updated) return base;
    return base + Math.max(0, nowSeconds - queue.elapsed_time_last_updated);
}
