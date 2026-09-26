import { describe, expect, it } from 'vitest';
import { lyricIndexAt, parseLrc } from '../src/lyrics.js';

describe('parseLrc', () => {
    it('parses timed lines and skips metadata tags', () => {
        // Invented text: no real song lyrics in the repo
        const lines = parseLrc('[ar:Test Artist]\n[00:18.29] Paper boats on a quiet river\n[00:22.08] Carry the lantern light, I know\n');
        expect(lines).toEqual([
            { time: 18.29, text: 'Paper boats on a quiet river' },
            { time: 22.08, text: 'Carry the lantern light, I know' },
        ]);
    });

    it('expands repeated time tags and sorts by time', () => {
        const lines = parseLrc('[00:30.00][01:10.50]Chorus\n[00:40.00]Verse');
        expect(lines.map((l) => [l.time, l.text])).toEqual([
            [30, 'Chorus'],
            [40, 'Verse'],
            [70.5, 'Chorus'],
        ]);
    });

    it('keeps empty lines as instrumental gaps and strips word tags', () => {
        const lines = parseLrc('[00:01.00]\n[00:02.00]<00:02.10>Hello <00:02.50>world\r\n[1:03]x');
        expect(lines).toEqual([
            { time: 1, text: '' },
            { time: 2, text: 'Hello world' },
            { time: 63, text: 'x' },
        ]);
    });
});

describe('lyricIndexAt', () => {
    const lines = parseLrc('[00:10.00]a\n[00:20.00]b\n[00:30.00]c');
    it('finds the current line', () => {
        expect(lyricIndexAt(lines, 5)).toBe(-1);
        expect(lyricIndexAt(lines, 10)).toBe(0);
        expect(lyricIndexAt(lines, 25)).toBe(1);
        expect(lyricIndexAt(lines, 999)).toBe(2);
        expect(lyricIndexAt([], 5)).toBe(-1);
    });
});
