import { describe, expect, it } from 'vitest';

import { newestCompleteJsonLines, serializeFileLogEntry } from '../file-log.utils.js';
import { LogLevel } from '../types.js';

describe('file log utilities', () => {
    it('keeps the newest complete JSON lines within the byte limit', () => {
        const first = '{"message":"first"}\n';
        const second = '{"message":"second"}\n';
        const third = '{"message":"third-🚀"}\n';
        const contents = Buffer.from(first + second + third);
        const limit = Buffer.byteLength(second + third);

        expect(newestCompleteJsonLines(contents, limit).toString('utf8')).toBe(second + third);
        expect(newestCompleteJsonLines(contents, limit - 1).toString('utf8')).toBe(third);
    });

    it('replaces a single oversized entry with a valid bounded JSON record', () => {
        const limit = 300;
        const line = serializeFileLogEntry(
            {
                timestamp: '2026-08-28T00:00:00.000Z',
                level: LogLevel.Warn,
                context: 'test',
                message: 'x'.repeat(1_000),
                meta: null,
            },
            limit,
        );

        expect(Buffer.byteLength(line)).toBeLessThanOrEqual(limit);
        expect(() => JSON.parse(line)).not.toThrow();
        expect(JSON.parse(line)).toMatchObject({
            level: 'WARN',
            context: 'test',
            meta: { truncated: true },
        });
    });
});
