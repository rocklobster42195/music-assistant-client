// LRC lyrics ("[mm:ss.xx] text" per line) as returned by metadata/get_track_lyrics.

export interface LyricLine {
    /** Start time in seconds. */
    time: number;
    /** Line text ('' for an instrumental gap). */
    text: string;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/**
 * Parse LRC text into lines sorted by time. A line with several time tags (repeated chorus) yields
 * one entry per tag; metadata tags like [ar:…] and untimed lines are skipped.
 */
export function parseLrc(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];
    for (const raw of lrc.split(/\r?\n/)) {
        const times: number[] = [];
        let rest = raw;
        for (const m of raw.matchAll(TIME_TAG)) {
            times.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
            rest = rest.replace(m[0], '');
        }
        const text = rest.replace(/<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g, '').trim(); // enhanced LRC word tags
        for (const time of times) lines.push({ time, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

/** Index of the line being sung at `seconds` (-1 before the first line). */
export function lyricIndexAt(lines: readonly LyricLine[], seconds: number): number {
    let lo = 0;
    let hi = lines.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].time <= seconds) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return found;
}
