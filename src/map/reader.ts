import { buildAttentionReport } from './attention.utils.js';
import { toCell } from './cell-view.utils.js';
import { WAREHOUSE_NEAR_FULL_PCT } from './constants.js';
import { buildResourceIndex, classifyNeighbors, filterCells, summarizeMap } from './map.utils.js';
import { buildingTypesOfKind, toProjectionConfig, toSettleConfig } from './reader.utils.js';
import type { MapStore } from './store.js';
import {
    type AttentionReport,
    type CellInspection,
    type Cell,
    type CellProjectionConfig,
    type EnrichedCell,
    type MapChanges,
    type MapQuery,
    type MapQueryResult,
    MapReadiness,
    type MapReaderOptions,
    MapScope,
    type MapStatus,
    type RawCell,
    type ResourceIndex,
} from './types.js';
import { BuildingKind } from '../api/types.js';
import { MAX_ROUTE_RADIUS } from '../geometry/constants.js';
import { nearestDistanceWithin, tokenIdToPos } from '../geometry/token.utils.js';
import type { IAppConfig } from '../services/types.js';

const LOADING_NOTE = 'Map is still loading; data may be incomplete. Retry shortly.';

export class MapReader {
    private readonly store: MapStore;
    private readonly status: MapStatus;
    private readonly appConfig: IAppConfig;

    constructor(options: MapReaderOptions) {
        this.store = options.store;
        this.status = options.status;
        this.appConfig = options.appConfig;
    }

    async query(query: MapQuery): Promise<MapQueryResult> {
        const project = await this.projector();
        const rawOwned = query.ownerAddress === null ? null : this.store.getByOwner(query.ownerAddress);
        const summary = summarizeMap({
            readiness: this.status.getReadiness(),
            socketConnected: this.status.isSocketConnected(),
            version: this.store.getLatestUpdated(),
            serverTime: this.store.getServerTime(),
            totalCells: this.store.size(),
            ownedCells: rawOwned === null ? null : rawOwned.map(project),
        });
        const resourceIndex: ResourceIndex | null = rawOwned === null ? null : buildResourceIndex(rawOwned);
        const note = this.status.getReadiness() === MapReadiness.Loading ? LOADING_NOTE : null;

        if (query.scope === MapScope.Summary) {
            return { summary, scope: query.scope, resourceIndex, cells: [], returnedCells: 0, note };
        }

        const cells = filterCells(this.store.values(), query).map((cell) =>
            this.enrich(project(cell), query.ownerAddress),
        );
        return { summary, scope: query.scope, resourceIndex, cells, returnedCells: cells.length, note };
    }

    async inspectCell(tokenId: string, ownerAddress: string | null): Promise<CellInspection | null> {
        const raw = this.store.get(tokenId);
        if (raw === null) {
            return null;
        }

        const project = await this.projector();
        const enriched = this.enrich(project(raw), ownerAddress);
        const neighbors: Array<Cell> = [];
        for (const ref of enriched.neighbors) {
            const neighbor = this.store.get(ref.tokenId);
            if (neighbor !== null) {
                neighbors.push(project(neighbor));
            }
        }

        return { cell: enriched, neighbors, distanceFromMine: this.nearestOwnedDistance(raw, ownerAddress) };
    }

    async readRevealCell(tokenId: string): Promise<Cell | null> {
        const raw = this.store.get(tokenId);
        if (raw === null) {
            return null;
        }
        const project = await this.projector();
        return project(raw);
    }

    getServerTime(): number {
        return this.store.getServerTime();
    }

    async attention(ownerAddress: string | null): Promise<AttentionReport> {
        const config = await this.appConfig.load();
        const project = this.projectorFor(toProjectionConfig(config));
        const rawOwned = ownerAddress === null ? null : this.store.getByOwner(ownerAddress);
        return buildAttentionReport({
            ownedCells: rawOwned === null ? null : rawOwned.map(project),
            version: this.store.getLatestUpdated(),
            serverTime: this.store.getServerTime(),
            nearFullPct: WAREHOUSE_NEAR_FULL_PCT,
            ...toSettleConfig(config),
            extractorBuildingTypes: buildingTypesOfKind(config, BuildingKind.Extractor),
        });
    }

    refresh(): Promise<void> {
        return this.status.resyncNow();
    }

    async getChanges(sinceVersion: number, ownerAddress: string | null): Promise<MapChanges> {
        const project = await this.projector();
        const changed = this.store.changedSince(sinceVersion).map((cell) => this.enrich(project(cell), ownerAddress));
        return {
            version: this.store.getLatestUpdated(),
            serverTime: this.store.getServerTime(),
            changed,
            changedCount: changed.length,
        };
    }

    async allCells(): Promise<Array<Cell>> {
        const project = await this.projector();
        return [...this.store.values()].map(project);
    }

    private async projector(): Promise<(raw: RawCell) => Cell> {
        return this.projectorFor(toProjectionConfig(await this.appConfig.load()));
    }

    private projectorFor(config: CellProjectionConfig): (raw: RawCell) => Cell {
        const serverTime = this.store.getServerTime();
        return (raw: RawCell) => toCell(raw, serverTime, config);
    }

    private enrich(cell: Cell, ownerAddress: string | null): EnrichedCell {
        return {
            ...cell,
            pos: tokenIdToPos(cell.tokenId),
            neighbors: classifyNeighbors(cell, (tokenId) => this.store.get(tokenId), ownerAddress),
        };
    }

    private nearestOwnedDistance(cell: RawCell, ownerAddress: string | null): number | null {
        if (ownerAddress === null) {
            return null;
        }
        const owned = new Set<string>();
        for (const ownedCell of this.store.getByOwner(ownerAddress)) {
            if (ownedCell.tokenId !== cell.tokenId) {
                owned.add(ownedCell.tokenId);
            }
        }
        if (owned.size === 0) {
            return null;
        }
        return nearestDistanceWithin(cell.tokenId, owned, MAX_ROUTE_RADIUS);
    }
}
