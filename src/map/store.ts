import { isNewer } from './map.utils.js';
import type { MapSnapshotResponse, RawCell } from './types.js';

/**
 * In-memory map state. The single source of truth for every read; kept current by snapshot loads and
 * realtime updates, which all funnel through `applyCell` so newer-wins holds between them. The one
 * exception is `replaceAll`, which deliberately bypasses newer-wins to swap in a different world.
 */
export class MapStore {
    private readonly cells = new Map<string, RawCell>();
    // Authoritative resync cursor for `?since`. Advanced ONLY by server responses (applySnapshot),
    // never by a single realtime cell — otherwise the cursor races ahead of what we actually hold and
    // a later `?since` skips changes the socket missed, losing them for good.
    private syncVersion = 0;
    // Live high-water mark of cell.updated, advanced by every applied cell. Drives the local
    // get_changes delta only — it never goes to the server, so it can't cause a `?since` skip.
    private latestUpdated = 0;
    // Offset (serverTime − local seconds) captured at the last snapshot. getServerTime() projects it onto the
    // live local clock, so "reference now" keeps advancing between resyncs instead of freezing at the snapshot.
    private serverTimeOffsetSec: number | null = null;
    // Rows the tolerant parser could not read. A row we cannot hold is indistinguishable from ground nobody
    // minted, so readers that must not confuse the two ask for this count before trusting what they see.
    private droppedCells = 0;
    // Live updates the tolerant parser could not read. The row itself may already be held, so this is
    // staleness rather than a hole — tracked apart so readers can say which of the two they are refusing on.
    private droppedUpdates = 0;

    // `nowSec` is injectable so tests get a deterministic clock; production uses wall-clock seconds.
    constructor(private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000)) {}

    applyCell(cell: RawCell): boolean {
        const held = this.cells.get(cell.tokenId) ?? null;
        if (!isNewer(cell, held)) {
            return false;
        }

        this.cells.set(cell.tokenId, cell);
        if (cell.updated > this.latestUpdated) {
            this.latestUpdated = cell.updated;
        }
        return true;
    }

    // Merges (never replaces) so a freshly-arrived realtime cell isn't clobbered by an older snapshot.
    // The server-provided version is the only thing allowed to move the resync cursor.
    applySnapshot(snapshot: MapSnapshotResponse): void {
        for (const cell of snapshot.cells) {
            this.applyCell(cell);
        }
        // Keep the freshest (largest) offset so a late, out-of-order older snapshot can't rewind "now".
        const offset = snapshot.serverTime - this.nowSec();
        if (this.serverTimeOffsetSec === null || offset > this.serverTimeOffsetSec) {
            this.serverTimeOffsetSec = offset;
        }
        if (snapshot.version > this.syncVersion) {
            this.syncVersion = snapshot.version;
        }
    }

    replaceAll(snapshot: MapSnapshotResponse): void {
        this.cells.clear();
        this.latestUpdated = 0;
        this.droppedCells = 0;
        this.droppedUpdates = 0;
        for (const cell of snapshot.cells) {
            this.cells.set(cell.tokenId, cell);
            if (cell.updated > this.latestUpdated) {
                this.latestUpdated = cell.updated;
            }
        }
        this.syncVersion = snapshot.version;
        this.serverTimeOffsetSec = snapshot.serverTime - this.nowSec();
    }

    // Sticky: a delta never re-sends a row that was already dropped, so the count survives every delta and
    // is cleared only by a read of the whole map, which re-delivers the rows a delta would skip.
    noteDroppedCells(count: number): void {
        this.droppedCells += count;
    }

    noteDroppedUpdates(count: number): void {
        this.droppedUpdates += count;
    }

    // Clears only what the caller's whole-map read actually covered, so gaps opened while that read was in
    // flight stay counted instead of being repaired by a response that predates them.
    clearRepairedGaps(cells: number, updates: number): void {
        this.droppedCells = Math.max(0, this.droppedCells - cells);
        this.droppedUpdates = Math.max(0, this.droppedUpdates - updates);
    }

    getDroppedCells(): number {
        return this.droppedCells;
    }

    getDroppedUpdates(): number {
        return this.droppedUpdates;
    }

    get(tokenId: string): RawCell | null {
        return this.cells.get(tokenId) ?? null;
    }

    getByOwner(owner: string): Array<RawCell> {
        const lower = owner.toLowerCase();
        const result: Array<RawCell> = [];
        for (const cell of this.cells.values()) {
            if (cell.owner.toLowerCase() === lower) {
                result.push(cell);
            }
        }
        return result;
    }

    changedSince(version: number): Array<RawCell> {
        const result: Array<RawCell> = [];
        for (const cell of this.cells.values()) {
            if (cell.updated > version) {
                result.push(cell);
            }
        }
        return result;
    }

    values(): IterableIterator<RawCell> {
        return this.cells.values();
    }

    // Cursor to send as `?since` — the last version the server vouched for.
    getSyncVersion(): number {
        return this.syncVersion;
    }

    // Freshness / get_changes cursor — the newest cell.updated we currently hold.
    getLatestUpdated(): number {
        return this.latestUpdated;
    }

    getServerTime(): number {
        return this.serverTimeOffsetSec === null ? 0 : this.nowSec() + this.serverTimeOffsetSec;
    }

    size(): number {
        return this.cells.size;
    }
}
