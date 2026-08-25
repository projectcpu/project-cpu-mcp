import type { RouteNode } from './route.utils.js';
import type {
    IAppConfig,
    ITradeClient,
    NextHopsResult,
    OnChainLot,
    QuoteTransportCallView,
    RouteGraphArtifact,
    RouteNetworkResult,
    RouteRequestView,
} from './types.js';
import type { LotState } from '../api/types.js';
import type { WalletProvider } from '../wallet/types.js';

/** Names the lot whose way home is being planned. Absent, the planner runs ordinary rules end to end. */
export interface LotReturnRouteContext {
    lotId: string;
}

export enum RouteSourcePolicy {
    /** Ordinary rules: the source is judged on today's map, exactly like the target. */
    Live = 'live',
    /** An Evicted lot: the hub it was listed on is admitted from the lot snapshot, whatever stands there now. */
    HistoricalHub = 'historical_hub',
}

/**
 * The two routing facts the lot itself carries, which the game API does not project: the reach the hub
 * served when the lot was listed, and the rate it charged then. Eviction, demolition, a rebuild or a sale
 * cannot move either, which is why the way home is measured against them.
 */
export interface HistoricalSourceView {
    tokenId: string;
    /** Reach recorded on the lot at listing; the first hop is measured against this, not today's building. */
    radius: number;
    listedTransitFeePerUnit: string;
    /** Per-unit rate whatever stands there now charges; null when nothing on that cell charges today. */
    liveTransitFeePerUnit: string | null;
    /** The nominal per-unit rate this source contributes: the listed rate, or a cheaper live one. */
    transitFeePerUnit: string;
}

/** The Lot return the graph was cut for, and how its source was admitted. */
export interface LotReturnPlanView {
    lotId: string;
    lotState: LotState;
    sourcePolicy: RouteSourcePolicy;
    /** The snapshot facts, present only where the historical policy admitted the source. */
    historicalSource: HistoricalSourceView | null;
}

/** What a Lot return contributes to one plan: how the source was admitted, and the source itself. */
export interface LotReturnPlan {
    view: LotReturnPlanView;
    /** The synthetic source node, present only where the historical policy admitted one. */
    sourceNode: RouteNode | null;
}

export interface PlannedRouteRequestView extends RouteRequestView {
    lotReturn: LotReturnPlanView | null;
}

export interface PlannedRouteGraphArtifact extends RouteGraphArtifact {
    request: PlannedRouteRequestView;
}

/** `chain` stays empty: the waypoints are the seller's to compute from the graph, exactly like `path`. */
export interface LotReturnQuoteArgumentsView {
    lotId: string;
    chain: Array<string>;
}

export interface LotReturnQuoteCallView {
    tool: string;
    arguments: LotReturnQuoteArgumentsView;
}

export type PlannedQuoteCallView = QuoteTransportCallView | LotReturnQuoteCallView;

export interface PlannedRouteNetworkResult extends Omit<RouteNetworkResult, 'request' | 'quoteTemplate'> {
    request: PlannedRouteRequestView;
    quoteTemplate: PlannedQuoteCallView;
}

export interface PlannedNextHopsResult extends NextHopsResult {
    lotReturn: LotReturnPlanView | null;
}

/** The authoritative lot read the planner needs. Kept behind an interface so tests substitute a fake. */
export interface ILotSnapshots {
    readLot(lotId: string): Promise<OnChainLot>;
}

export interface LotSnapshotsOptions {
    appConfig: IAppConfig;
    wallet: WalletProvider;
    tradeClient: ITradeClient;
}
