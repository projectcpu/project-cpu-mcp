import { OVERSIZED_LOG_MESSAGE } from './constants.js';
import type { FileLogEntry } from './types.js';

export function serializeFileLogEntry(entry: FileLogEntry, maxBytes: number): string {
    const line = `${JSON.stringify(entry)}\n`;
    const originalBytes = Buffer.byteLength(line);
    if (originalBytes <= maxBytes) return line;

    return `${JSON.stringify({
        ...entry,
        message: OVERSIZED_LOG_MESSAGE,
        meta: { truncated: true, originalBytes },
    })}\n`;
}

export function newestCompleteJsonLines(contents: Buffer, maxBytes: number): Buffer {
    if (contents.byteLength <= maxBytes) return contents;

    const candidate = contents.byteLength - maxBytes;
    if (candidate === 0 || contents[candidate - 1] === 0x0a) {
        return contents.subarray(candidate);
    }

    const lineEnd = contents.indexOf(0x0a, candidate);
    return lineEnd === -1 ? Buffer.alloc(0) : contents.subarray(lineEnd + 1);
}
