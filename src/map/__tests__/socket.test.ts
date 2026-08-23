import { describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { CELL_UPDATE_EVENT } from '../constants.js';
import { createMapSocket } from '../socket.js';
import type { RawCell, SocketLifecycleHandlers } from '../types.js';
import { makeCell } from './fixtures.js';

const listeners = new Map<string, (payload: never) => void>();

vi.mock('socket.io-client', () => ({
    io: () => ({
        on(event: string, listener: (payload: never) => void) {
            listeners.set(event, listener);
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
        connected: true,
    }),
}));

function connected(): { applied: Array<RawCell>; dropped: number; emit: (raw: unknown) => void } {
    listeners.clear();
    const applied: Array<RawCell> = [];
    let dropped = 0;
    const handlers: SocketLifecycleHandlers = {
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        onError: vi.fn(),
        onCellUpdate: (cell) => applied.push(cell),
        onCellUpdateDropped: () => {
            dropped += 1;
        },
    };
    createMapSocket({ baseUrl: 'http://test', logger: new NoopLogger() }).connect(handlers);
    return {
        applied,
        get dropped() {
            return dropped;
        },
        emit: (raw: unknown) => listeners.get(CELL_UPDATE_EVENT)?.(raw as never),
    };
}

describe('MapSocketClient', () => {
    it('applies a cell update it can read', () => {
        const socket = connected();

        socket.emit(makeCell({ tokenId: '1', updated: 10 }));

        expect(socket.applied.map((c) => c.tokenId)).toEqual(['1']);
        expect(socket.dropped).toBe(0);
    });

    it('reports a cell update it cannot read instead of letting the row vanish', () => {
        const socket = connected();

        socket.emit({ tokenId: '1' });

        expect(socket.applied).toEqual([]);
        expect(socket.dropped).toBe(1);
    });
});
