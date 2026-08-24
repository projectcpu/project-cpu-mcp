import { beforeEach, describe, expect, it } from 'vitest';

import { MapStore } from '../store.js';
import { makeCell, makeSnapshot } from './fixtures.js';

const NOW = 1_000_000;

describe('MapStore', () => {
    let store: MapStore;

    beforeEach(() => {
        store = new MapStore(() => NOW);
    });

    describe('applyCell', () => {
        it('applies a new cell and advances only the latest-updated mark, not the sync cursor', () => {
            expect(store.applyCell(makeCell({ tokenId: '1', updated: 42 }))).toBe(true);
            expect(store.size()).toBe(1);
            expect(store.getLatestUpdated()).toBe(42);
            // A realtime cell must never move the `?since` cursor — only server responses may.
            expect(store.getSyncVersion()).toBe(0);
        });

        it('keeps newer-wins and drops equal/older updates', () => {
            store.applyCell(makeCell({ tokenId: '1', updated: 100, owner: '0xnew' }));

            expect(store.applyCell(makeCell({ tokenId: '1', updated: 100, owner: '0xstale' }))).toBe(false);
            expect(store.applyCell(makeCell({ tokenId: '1', updated: 99, owner: '0xstale' }))).toBe(false);
            expect(store.get('1')?.owner).toBe('0xnew');
        });
    });

    describe('applySnapshot', () => {
        it('does not let an older snapshot cell clobber a newer live cell', () => {
            store.applyCell(makeCell({ tokenId: '1', updated: 100, owner: '0xlive' }));

            store.applySnapshot(
                makeSnapshot({ cells: [makeCell({ tokenId: '1', updated: 50, owner: '0xsnapshot' })] }),
            );

            expect(store.get('1')?.owner).toBe('0xlive');
        });

        it('records serverTime and the sync version from the response', () => {
            store.applySnapshot(makeSnapshot({ serverTime: 1234, version: 77, cells: [makeCell({ updated: 77 })] }));
            expect(store.getServerTime()).toBe(1234);
            expect(store.getSyncVersion()).toBe(77);
        });

        it('reports 0 server time until the first snapshot anchors the clock', () => {
            expect(store.getServerTime()).toBe(0);
        });

        it('advances server time with the local clock between snapshots (no freeze)', () => {
            let now = 2_000_000;
            const live = new MapStore(() => now);
            live.applySnapshot(makeSnapshot({ serverTime: 5000, version: 1, cells: [] }));
            expect(live.getServerTime()).toBe(5000);
            now += 30;
            expect(live.getServerTime()).toBe(5030);
        });

        it('does not let a late, older snapshot rewind server time', () => {
            let now = 2_000_000;
            const live = new MapStore(() => now);
            live.applySnapshot(makeSnapshot({ serverTime: 5000, version: 2, cells: [] }));
            now += 100;
            // A stale snapshot delivered late: server advanced only 50s over 100s of local time.
            live.applySnapshot(makeSnapshot({ serverTime: 5050, version: 1, cells: [] }));
            expect(live.getServerTime()).toBe(5100);
        });

        it('keeps the sync cursor at the server version even when a newer cell already arrived', () => {
            // A live cell pushed latestUpdated to 100, but the snapshot is only complete up to 50:
            // the cursor must stay at 50 so a later `?since=50` still backfills the (50, 100] gap.
            store.applyCell(makeCell({ tokenId: '1', updated: 100, owner: '0xlive' }));

            store.applySnapshot(makeSnapshot({ version: 50, cells: [makeCell({ tokenId: '2', updated: 40 })] }));

            expect(store.getSyncVersion()).toBe(50);
            expect(store.getLatestUpdated()).toBe(100);
        });
    });

    describe('replaceAll', () => {
        it('drops the cells it held instead of merging them', () => {
            store.applySnapshot(makeSnapshot({ version: 900, cells: [makeCell({ tokenId: '1', updated: 900 })] }));

            store.replaceAll(makeSnapshot({ version: 3, serverTime: 1234, cells: [makeCell({ tokenId: '2' })] }));

            expect(store.get('1')).toBeNull();
            expect(store.get('2')).not.toBeNull();
            expect(store.size()).toBe(1);
        });

        it('rewinds all three cursors onto the new snapshot', () => {
            store.applySnapshot(makeSnapshot({ version: 900, serverTime: 9000, cells: [] }));
            store.applyCell(makeCell({ tokenId: '1', updated: 950 }));
            expect(store.getSyncVersion()).toBe(900);
            expect(store.getLatestUpdated()).toBe(950);
            expect(store.getServerTime()).toBe(9000);

            store.replaceAll(
                makeSnapshot({ version: 3, serverTime: 20, cells: [makeCell({ tokenId: '7', updated: 2 })] }),
            );

            expect(store.getSyncVersion()).toBe(3);
            expect(store.getLatestUpdated()).toBe(2);
            expect(store.getServerTime()).toBe(20);
        });

        it('leaves no cursor behind when the new world is empty', () => {
            store.applySnapshot(makeSnapshot({ version: 900, serverTime: 9000, cells: [makeCell({ updated: 900 })] }));

            store.replaceAll(makeSnapshot({ version: 0, serverTime: 5, cells: [] }));

            expect(store.size()).toBe(0);
            expect(store.getSyncVersion()).toBe(0);
            expect(store.getLatestUpdated()).toBe(0);
            expect(store.getServerTime()).toBe(5);
        });
    });

    describe('unreadable rows', () => {
        it('keeps the count once a row has been missed, so a later clean sync cannot hide it', () => {
            store.noteDroppedCells(1);
            store.noteDroppedCells(0);

            expect(store.getDroppedCells()).toBe(1);
        });

        it('clears the count when the whole map is replaced, so a new world starts unblemished', () => {
            store.noteDroppedCells(2);
            store.noteDroppedUpdates(1);

            store.replaceAll(makeSnapshot({ version: 10, serverTime: 5, cells: [makeCell({ updated: 10 })] }));

            expect(store.getDroppedCells()).toBe(0);
            expect(store.getDroppedUpdates()).toBe(0);
        });

        it('counts an unreadable live update apart from an unreadable row', () => {
            store.noteDroppedUpdates(1);

            expect(store.getDroppedUpdates()).toBe(1);
            expect(store.getDroppedCells()).toBe(0);
        });

        it('clears only the gaps a repairing whole-map read covered', () => {
            store.noteDroppedCells(1);
            store.noteDroppedUpdates(2);

            store.clearRepairedGaps(1, 1);

            expect(store.getDroppedCells()).toBe(0);
            expect(store.getDroppedUpdates()).toBe(1);
        });

        it('leaves the unread rows a partial repair did not cover still counted', () => {
            store.noteDroppedCells(2);

            store.clearRepairedGaps(1, 0);

            expect(store.getDroppedCells()).toBe(1);
        });

        it('never lets a repair drive a count below zero', () => {
            store.noteDroppedCells(1);

            store.clearRepairedGaps(5, 5);

            expect(store.getDroppedCells()).toBe(0);
            expect(store.getDroppedUpdates()).toBe(0);
        });
    });

    it('looks cells up by owner case-insensitively', () => {
        store.applyCell(makeCell({ tokenId: '1', owner: '0xME' }));
        store.applyCell(makeCell({ tokenId: '2', owner: '0xrival' }));

        expect(store.getByOwner('0xme').map((c) => c.tokenId)).toEqual(['1']);
    });

    it('returns null for an unknown token', () => {
        expect(store.get('nope')).toBeNull();
    });

    it('changedSince returns only cells updated after the version', () => {
        store.applyCell(makeCell({ tokenId: '1', updated: 10 }));
        store.applyCell(makeCell({ tokenId: '2', updated: 30 }));

        expect(store.changedSince(20).map((c) => c.tokenId)).toEqual(['2']);
        expect(store.changedSince(0)).toHaveLength(2);
    });
});
