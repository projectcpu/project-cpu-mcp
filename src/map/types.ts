import { z } from 'zod';

import type { MapStore } from './store.js';
import type { OpenRevealRequestView } from '../api/types.js';
import type { CellCoord } from '../geometry/types.js';
import type { ILogger } from '../logger/types.js';
import type { IAppConfig } from '../services/types.js';
import { saleFeeOverridesToPercent } from '../utils/format.utils.js';
import type { IBackendVersion } from '../version/types.js';

export enum CellProcessKind {
    Mining = 'mining',
    Craft = 'craft',
}

export const rawCellResourceStorageSchema = z.object({
    used: z.string(),
    cellCap: z.string().nullable(),
    hubCap: z.string().nullable(),
    reserved: z.object({
        incomingTransport: z.string(),
        lots: z.string(),
    }),
});

export const rawCellResourceSchema = z.object({
    resourceId: z.number(),
    deposit: z.string(),
    balance: z.string(),
    strength: z.number().nullable().default(null),
    storage: rawCellResourceStorageSchema.nullable().default(null),
});

export const cellBuildingViewSchema = z.object({
    type: z.string(),
    buildFinishAt: z.number().nullable(),
    modeResource: z.number().nullable().default(null),
    modeRecipeId: z.string().nullable().default(null),
});

export const rawCellProcessMiningViewSchema = z.object({
    kind: z.literal(CellProcessKind.Mining),
    resource: z.number(),
    durationSec: z.number(),
    yieldPerCycle: z.number(),
    batches: z.number(),
    claimedBatches: z.number(),
    startAt: z.number(),
});

export const rawCellProcessCraftViewSchema = z.object({
    kind: z.literal(CellProcessKind.Craft),
    recipeId: z.string(),
    batches: z.number(),
    claimedBatches: z.number(),
    durationSec: z.number(),
    startAt: z.number(),
});

export const rawCellProcessViewSchema = z.discriminatedUnion('kind', [
    rawCellProcessMiningViewSchema,
    rawCellProcessCraftViewSchema,
]);

export const rawCellSchema = z.object({
    tokenId: z.string(),
    owner: z.string(),
    revealCount: z.number(),
    revealPending: z.boolean().default(false),
    resources: z.array(rawCellResourceSchema),
    building: cellBuildingViewSchema.nullable().default(null),
    // Set after a demolish and cleared on rebuild. `demolishFinishAt > serverTime` ⇒ the plot is still in its
    // rebuild cooldown; `building` is null meanwhile, so this is the only signal the cell was just demolished.
    demolishFinishAt: z.number().nullable().default(null),
    // Observed, not authoritative: both are legitimately absent on a valid active cooldown, so absence reads as
    // "unknown", never as "no demolition" (see Demolition in CONTEXT.md).
    demolishStartAt: z.number().nullable().default(null),
    // A string, not an enum over the building catalog: an unknown type must not drop the whole cell.
    demolishingType: z.string().nullable().default(null),
    transitFeeOverrides: z.record(z.coerce.number(), z.string()).nullable().default(null),
    saleFeeOverrides: z
        .record(z.coerce.number(), z.number().int())
        .nullable()
        .default(null)
        .transform(saleFeeOverridesToPercent),
    process: rawCellProcessViewSchema.nullable().default(null),
    updated: z.number(),
});

export const mapSnapshotResponseSchema = z.object({
    serverTime: z.number(),
    version: z.number(),
    cells: z.array(rawCellSchema),
});

export type RawCellResource = z.infer<typeof rawCellResourceSchema>;
export type RawCellResourceStorage = z.infer<typeof rawCellResourceStorageSchema>;
export type RawCellProcessMiningView = z.infer<typeof rawCellProcessMiningViewSchema>;
export type RawCellProcessCraftView = z.infer<typeof rawCellProcessCraftViewSchema>;
export type RawCellProcessView = z.infer<typeof rawCellProcessViewSchema>;
export type RawCell = z.infer<typeof rawCellSchema>;

export type CellBuildingView = z.infer<typeof cellBuildingViewSchema>;
export type MapSnapshotResponse = z.infer<typeof mapSnapshotResponseSchema>;

export interface CellResourceStorage extends Omit<RawCellResourceStorage, 'cellCap' | 'hubCap'> {
    cap: string | null;
    full: boolean;
}

export interface CellResource extends Omit<RawCellResource, 'storage'> {
    storage: CellResourceStorage | null;
}

export type CellProcessMiningView = RawCellProcessMiningView & { stalled: boolean };

export type CellProcessCraftView = RawCellProcessCraftView & { stalled: boolean };

export type CellProcessView = CellProcessMiningView | CellProcessCraftView;

export interface Cell extends Omit<RawCell, 'resources' | 'process'> {
    resources: Array<CellResource>;
    process: CellProcessView | null;
    ready: boolean | null;
    activeHub: boolean;
}

// eslint-disable-next-line no-restricted-syntax
export type UnderivedCell = RawCell & { ready?: never; activeHub?: never };

export interface ActiveDemolition {
    finishAt: number;
    startAt: number | null;
    buildingType: string | null;
}

export interface ProcessOutput {
    resourceId: number;
    amount: number;
}

export interface CellProjectionConfig {
    hubBuildingTypes: Set<string>;
    upgradeFromByBuildingType: Record<string, string | null>;
    craftOutputsByRecipe: Record<string, Array<ProcessOutput>>;
}

export interface ParsedSnapshot {
    snapshot: MapSnapshotResponse;
    // Cells the tolerant parser skipped (schema-invalid — e.g. an unknown building/recipe id from a newer
    // server); the rest of the snapshot still applies so one bad cell can't brick the whole map.
    dropped: number;
}

export enum MapScope {
    Summary = 'summary',
    Mine = 'mine',
    Around = 'around',
    Cells = 'cells',
    All = 'all',
}

export enum MapReadiness {
    Loading = 'loading',
    Ready = 'ready',
    Degraded = 'degraded',
    Stopped = 'stopped',
}

export enum NeighborRelation {
    Owned = 'owned',
    Other = 'other',
    Empty = 'empty',
}

export interface SocketLifecycleHandlers {
    onConnect: () => void;
    onDisconnect: (reason: string) => void;
    onError: (error: Error) => void;
    onCellUpdate: (cell: RawCell) => void;
}

// Abstraction over the realtime socket so tests can drive lifecycle events with a fake.
export interface ISocketClient {
    connect(handlers: SocketLifecycleHandlers): void;
    isConnected(): boolean;
    // Re-establish the connection after a server-initiated disconnect, which socket.io does not
    // auto-recover from (it detaches the socket from its manager). Idempotent / safe to call when
    // already connected or reconnecting.
    reconnect(): void;
    disconnect(): void;
}

export interface CreateMapSocketInput {
    baseUrl: string;
    logger: ILogger;
}

export type MapSocketFactory = (input: CreateMapSocketInput) => ISocketClient;

// Narrow view of the HTTP client the manager needs, so tests can inject a fake without a real one.
export interface IMapApi {
    request<T>(path: string): Promise<{ status: number; data: T }>;
    getBaseUrl(): string;
}

// Read-only lifecycle view the reader needs for its summary — implemented by MapSync.
export interface MapStatus {
    getReadiness(): MapReadiness;
    isSocketConnected(): boolean;
    resyncNow(): Promise<void>;
}

export interface RevealCellReader {
    readRevealCell(tokenId: string): Promise<Cell | null>;
    // The map snapshot's server clock — the reference "now" for maturation, same domain as a process `startAt`.
    getServerTime(): number;
    refresh(): Promise<void>;
}

export interface MapSyncOptions {
    store: MapStore;
    api: IMapApi;
    backendVersion: IBackendVersion;
    socketFactory: MapSocketFactory;
    logger: ILogger;
    pollIntervalMs: number;
    reconnectGraceMs: number;
}

export interface MapReaderOptions {
    store: MapStore;
    status: MapStatus;
    appConfig: IAppConfig;
}

export interface AroundQuery {
    tokenId: string;
    radius: number;
}

export interface MapQuery {
    scope: MapScope;
    tokenIds: Array<string> | null;
    around: AroundQuery | null;
    ownerAddress: string | null;
}

export interface NeighborRef {
    tokenId: string;
    relation: NeighborRelation;
}

export interface EnrichedCell extends Cell {
    pos: CellCoord;
    neighbors: Array<NeighborRef>;
}

export interface ResourceLocation {
    tokenId: string;
    deposit: string;
    balance: string;
}

export type ResourceIndex = Record<string, Array<ResourceLocation>>;

export interface MapCellStatusCounts {
    idle: number;
    mining: number;
    crafting: number;
}

export interface MapSummary {
    version: number;
    serverTime: number;
    readiness: MapReadiness;
    socketConnected: boolean;
    totalCells: number;
    // null when the wallet address is unknown — the "mine"-scoped figures can't be computed.
    myCells: number | null;
    myCellsByStatus: MapCellStatusCounts | null;
    depletedDeposits: number | null;
    stalledCells: number | null;
}

export interface MapQueryResult {
    summary: MapSummary;
    scope: MapScope;
    resourceIndex: ResourceIndex | null;
    cells: Array<EnrichedCell>;
    returnedCells: number;
    note: string | null;
}

export interface CellInspection {
    cell: EnrichedCell;
    neighbors: Array<Cell>;
    distanceFromMine: number | null;
}

export interface MapChanges {
    version: number;
    serverTime: number;
    changed: Array<EnrichedCell>;
    changedCount: number;
}

export enum AttentionSeverity {
    Critical = 'critical',
    Warning = 'warning',
    Info = 'info',
}

export enum AttentionReason {
    StalledMining = 'stalled_mining',
    StalledCraft = 'stalled_craft',
    WarehouseNearFull = 'warehouse_near_full',
    DepositDepleted = 'deposit_depleted',
    ProcessFinished = 'process_finished',
    DeliveryReady = 'delivery_ready',
    Unbuilt = 'unbuilt',
    DemolishCooldown = 'demolish_cooldown',
    LotFrozen = 'lot_frozen',
    LotAtRisk = 'lot_at_risk',
    RevealStuck = 'reveal_stuck',
    RevealSourceRetired = 'reveal_source_retired',
}

export interface AttentionStorageBreakdown {
    liquid: string;
    incomingTransport: string;
    lots: string;
}

export interface AttentionItem {
    tokenId: string;
    severity: AttentionSeverity;
    reason: AttentionReason;
    // Decorated with resourceName at the tool layer. null for cell-level reasons (unbuilt).
    resourceId: number | null;
    used: string | null;
    cap: string | null;
    fillPct: number | null;
    breakdown: AttentionStorageBreakdown | null;
    depositRemaining: string | null;
    deliveryId: string | null;
    arrivalAt: number | null;
    demolishingType: string | null;
    lotId: string | null;
    requestId: string | null;
    requestedAt: number | null;
    message: string | null;
}

export interface RevealAttentionInput {
    currentSource: string;
    serverTime: number;
    requests: ReadonlyArray<OpenRevealRequestView>;
}

export interface AttentionReport {
    // false when the wallet is unknown — attention is owner-scoped, so there is nothing to report.
    ownerKnown: boolean;
    version: number;
    serverTime: number;
    counts: Record<AttentionSeverity, number>;
    items: Array<AttentionItem>;
    // Set when the deliveries endpoint could not be reached; the map-derived items are still present.
    note: string | null;
}
