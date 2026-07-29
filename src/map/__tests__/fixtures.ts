import { BuildingType } from '../../api/types.js';
import { toCell } from '../cell-view.utils.js';
import {
    type Cell,
    type CellProjectionConfig,
    CellProcessKind,
    type MapSnapshotResponse,
    type RawCell,
    type RawCellProcessCraftView,
    type RawCellProcessMiningView,
    type RawCellResource,
    type RawCellResourceStorage,
} from '../types.js';

export const TEST_HUB_STORAGE_MULTIPLIER = 10;

export function makeStorage(overrides: Partial<RawCellResourceStorage> = {}): RawCellResourceStorage {
    return {
        used: '0',
        cap: '100',
        reserved: { incomingTransport: '0', lots: '0' },
        ...overrides,
    };
}

export function makeResource(overrides: Partial<RawCellResource> = {}): RawCellResource {
    return {
        resourceId: 1,
        deposit: '0',
        balance: '0',
        strength: null,
        storage: null,
        ...overrides,
    };
}

export function makeMiningProcess(overrides: Partial<RawCellProcessMiningView> = {}): RawCellProcessMiningView {
    return {
        kind: CellProcessKind.Mining,
        resource: 1,
        durationSec: 180,
        yieldPerCycle: 77,
        batches: 10,
        claimedBatches: 0,
        startAt: 0,
        ...overrides,
    };
}

export function makeCraftProcess(overrides: Partial<RawCellProcessCraftView> = {}): RawCellProcessCraftView {
    return {
        kind: CellProcessKind.Craft,
        recipeId: 'recipe',
        batches: 1,
        claimedBatches: 0,
        durationSec: 60,
        startAt: 0,
        ...overrides,
    };
}

export function makeCell(overrides: Partial<RawCell> = {}): RawCell {
    return {
        tokenId: '1',
        owner: '0xowner',
        revealCount: 0,
        revealPending: false,
        resources: [],
        building: null,
        demolishFinishAt: null,
        transitFeeOverrides: null,
        saleFeeOverrides: null,
        process: null,
        updated: 1,
        ...overrides,
    };
}

export function makeSnapshot(overrides: Partial<MapSnapshotResponse> = {}): MapSnapshotResponse {
    return {
        serverTime: 1000,
        version: 50,
        cells: [],
        ...overrides,
    };
}

export function makeProjectionConfig(overrides: Partial<CellProjectionConfig> = {}): CellProjectionConfig {
    return {
        hubStorageMultiplier: TEST_HUB_STORAGE_MULTIPLIER,
        hubBuildingTypes: new Set<string>([BuildingType.Hub]),
        craftOutputsByRecipe: {},
        ...overrides,
    };
}

export function projectCell(raw: RawCell, serverTime = 0, config: CellProjectionConfig = makeProjectionConfig()): Cell {
    return toCell(raw, serverTime, config);
}
