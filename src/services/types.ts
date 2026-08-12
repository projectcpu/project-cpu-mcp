import type { Address, Hash, Log } from 'viem';

import type { ApiClient } from '../api/client.js';
import type {
    BuildingType,
    BuildingView,
    CraftRecipeId,
    CraftStackView,
    IRevealRequestsReader,
    LotAvailability,
    LotSort,
    OpenRevealRequestView,
    RandomnessDescriptor,
    RecipeView,
    RevealPaymentView,
    StorageConfigView,
    SyndicateSort,
    TransportRoutingView,
} from '../api/types.js';
import type { Network } from '../config/types.js';
import type { CellCoord } from '../geometry/types.js';
import type { ILogger } from '../logger/types.js';
import type { Cell, RevealCellReader } from '../map/types.js';
import type {
    IFulfilmentClaims,
    IRandomnessStrategyFactory,
    ISelfServiceRandomnessResolver,
    PushRandomness,
    SelfServiceRandomness,
} from '../randomness/types.js';
import type { SessionManager } from '../session/manager.js';
import type { ConfirmedTx, IContractClient, TxStatus, WalletManager, WalletProvider } from '../wallet/types.js';

export interface AuthServiceOptions {
    session: SessionManager;
    api: ApiClient;
    wallet: WalletProvider;
    logger: ILogger;
}

export interface DeviceAuthResult {
    verificationUrl: string;
    userCode: string;
}

/** Resolved contract addresses for the configured network. */
export interface AppContracts {
    land: string;
    /** Empty until $CPU is configured for the network; validate with `isAddress` before use. */
    cpuToken: string;
    /** Uniswap v4 hook for the ETH/$CPU pool; empty until configured. Validate before a swap. */
    cpuHook: string;
    cell: string;
    cellLens: string;
    transport: string;
    /** The lot marketplace; empty until configured. Validate with `isAddress` before a trade write. */
    trade: string;
    syndicate: string | null;
}

export enum ModeSwitchKind {
    Possible = 'possible',
    Impossible = 'impossible',
    Unknown = 'unknown',
}

export type ModeSwitchView =
    | { kind: ModeSwitchKind.Possible; costCpu: string }
    | { kind: ModeSwitchKind.Impossible }
    | { kind: ModeSwitchKind.Unknown };

export interface CatalogBuildingView extends BuildingView {
    modeSwitch: ModeSwitchView;
}

export type ModeKey = string | number | bigint;

export enum ModeCostKind {
    Free = 'free',
    Paid = 'paid',
    Unknown = 'unknown',
}

export enum ModeFreeReason {
    FirstPick = 'first_pick',
    SameOutput = 'same_output',
}

export type ModeCostView =
    | { kind: ModeCostKind.Free; why: ModeFreeReason }
    | { kind: ModeCostKind.Paid; costCpu: string }
    | { kind: ModeCostKind.Unknown };

export interface CellOutputView {
    resourceId: number | null;
    resourceName: string | null;
    recipeId: CraftRecipeId | null;
    cost: ModeCostView;
}

export interface BuildingMode {
    resourceId: number | null;
    recipeId: CraftRecipeId | null;
}

/** Chain + contract addresses for the configured network, loaded from the game API. */
export interface AppConfig {
    network: Network;
    chainId: number;
    contracts: AppContracts;
    randomness: RandomnessDescriptor;
    /** Resource id → display name, served alongside the chain config. */
    resources: Record<number, string>;
    recipes: Array<RecipeView>;
    /** Per-building catalog — on-chain id, kind, costs, and mine/craft bindings. */
    buildings: Array<CatalogBuildingView>;
    /**
     * The two gameplay legs every reveal is charged; `null` when the game API serves no reveal payment at
     * all. Never the total to send — a reveal is always funded from `ICellClient.quoteReveal`.
     */
    reveal: RevealPaymentView | null;
    transport: TransportRoutingView;
    /** Trade fee params, normalized to the MCP's percent surface. */
    trade: TradeConfigView;
    storage: StorageConfigView;
}

export interface TradeConfigView {
    saleBurnPercent: number;
    maxSaleFeePercent: number;
}

/** Provider of the chain config — implemented by AppConfigService; injected into RevealService. */
export interface IAppConfig {
    load(): Promise<AppConfig>;
}

export interface AppConfigServiceOptions {
    api: ApiClient;
    network: Network;
    logger: ILogger;
}

/** Ensures the wallet has approved a spender for a token — implemented by AllowanceService. */
export interface IAllowanceService {
    ensureAllowance(token: Address, spender: Address, needed: bigint): Promise<Hash | null>;
}

export interface AllowanceServiceOptions {
    wallet: WalletProvider;
    logger: ILogger;
}

export interface CellClientOptions {
    contracts: IContractClient;
    logger: ILogger;
}

export interface RequestRevealParams {
    cell: Address;
    tokenId: bigint;
    value: bigint;
}

/**
 * What one reveal costs right now, read from the Cell itself and the only source a reveal is funded from:
 * `totalRequiredWei` is the whole ETH the reveal is charged and `cpuBurnWei` the exact burn to approve. The
 * transaction carries headroom over the total (see `bufferedRevealValue`); the burn is approved as quoted.
 * Any leg may be zero.
 */
export interface RevealQuote {
    ethContributionWei: bigint;
    randomnessFeeWei: bigint;
    totalRequiredWei: bigint;
    cpuBurnWei: bigint;
}

export interface PlaceParams {
    cell: Address;
    tokenId: bigint;
    buildingType: number;
}

export interface DemolishParams {
    cell: Address;
    tokenId: bigint;
}

export interface StartMiningParams {
    cell: Address;
    tokenId: bigint;
    target: number;
    batches: number;
}

export interface StartCraftParams {
    cell: Address;
    tokenId: bigint;
    recipeId: bigint;
    batches: number;
}

export interface ClaimParams {
    cell: Address;
    tokenId: bigint;
}

export interface WithdrawCpuParams {
    cell: Address;
    tokenId: bigint;
    amount: bigint;
}

export interface CellViewResult {
    buildingType: number;
    modeResource: number;
    modeRecipeId: bigint;
}

export interface ICellClient {
    readCellView(cell: Address, tokenId: bigint): Promise<CellViewResult>;
    quoteReveal(cell: Address): Promise<RevealQuote>;
    requestReveal(params: RequestRevealParams): Promise<Hash>;
    place(params: PlaceParams): Promise<Hash>;
    demolish(params: DemolishParams): Promise<Hash>;
    startMining(params: StartMiningParams): Promise<Hash>;
    startCraft(params: StartCraftParams): Promise<Hash>;
    claim(params: ClaimParams): Promise<Hash>;
    withdrawCpu(params: WithdrawCpuParams): Promise<Hash>;
}

export interface RevealServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    cellClient: ICellClient;
    contracts: IContractClient;
    randomness: IRandomnessStrategyFactory;
    claims: IFulfilmentClaims;
    mapReader: RevealCellReader;
    logger: ILogger;
}

export enum CellRevertName {
    INSUFFICIENT_REVEAL_PAYMENT = 'InsufficientRevealPayment',
    REVEAL_PAYMENT_NOT_CONFIGURED = 'RevealPaymentNotConfigured',
    REVEAL_HOOK_NOT_CONFIGURED = 'RevealHookNotConfigured',
    HOOK_DELIVERY_FAILED = 'HookDeliveryFailed',
    REFUND_FAILED = 'RefundFailed',
    REVEAL_NOT_CONFIGURED = 'RevealNotConfigured',
    REVEAL_CELL_OCCUPIED = 'RevealCellOccupied',
    REVEAL_PROCESS_ACTIVE = 'RevealProcessActive',
    REVEAL_ALREADY_PENDING = 'RevealAlreadyPending',
    REVEAL_IN_FLIGHT = 'RevealInFlight',
    DEPOSITS_NOT_EXHAUSTED = 'DepositsNotExhausted',
    REVEAL_REQUEST_ID_IN_USE = 'RevealRequestIdInUse',
}

export enum UpgradeRevertName {
    NOT_REVEALED = 'NotRevealed',
    PROCESS_ACTIVE = 'ProcessActive',
    DEMOLISH_IN_PROGRESS = 'DemolishInProgress',
    BUILDING_NOT_ENABLED = 'BuildingNotEnabled',
    NOT_A_BASE_BUILDING = 'NotABaseBuilding',
    INVALID_UPGRADE = 'InvalidUpgrade',
    BUILDING_NOT_READY = 'BuildingNotReady',
    STORAGE_EXCEEDS_CAP = 'StorageExceedsCap',
    INSUFFICIENT_LIQUID = 'InsufficientLiquid',
    NOT_CELL_OWNER = 'NotCellOwner',
}

export interface PushRevealInput {
    randomness: PushRandomness;
    config: AppConfig;
    cell: Address;
    tokenId: string;
    genesis: boolean;
    previousRevealCount: number;
}

export interface SelfServiceRevealInput {
    randomness: SelfServiceRandomness;
    config: AppConfig;
    cell: Address;
    tokenId: string;
    genesis: boolean;
    previousRevealCount: number;
    pending: boolean;
    owner: Address;
}

export interface FundedRevealRequest {
    approveTxHash: Hash | null;
    quote: RevealQuote;
    value: bigint;
}

export interface RevealRequestContext {
    requestId: bigint | null;
    source: Address;
    requestTxHash: Hash | null;
    approveTxHash: Hash | null;
    /** The whole ETH the reveal cost, as the Cell quoted it; the transaction carries headroom above it. */
    paidWei: bigint;
    cpuBurnWei: bigint;
    status: TxStatus | null;
    blockNumber: string | null;
}

export enum RevealSettlementKind {
    Settled = 'settled',
    Unfinished = 'unfinished',
}

export interface RevealSettlement {
    kind: RevealSettlementKind.Settled;
    round: bigint | null;
    fulfillTxHash: Hash | null;
    logs: Array<Log>;
}

export interface RevealNonSettlement {
    kind: RevealSettlementKind.Unfinished;
    round: bigint | null;
    reason: string;
}

export type RevealSettlementOutcome = RevealSettlement | RevealNonSettlement;

export interface RevealDepositView {
    resourceId: number;
    resourceName: string | null;
    amount: string;
    strength: number;
}

export interface RevealResult {
    tokenId: string;
    genesis: boolean;
    requestTxHash: Hash | null;
    fulfillTxHash: Hash | null;
    requestId: string | null;
    source: Address | null;
    round: string | null;
    deposits: Array<RevealDepositView> | null;
    status: TxStatus | null;
    blockNumber: string | null;
    /**
     * The whole ETH this reveal cost (decimal), as the cell quoted it — the liquidity contribution and the
     * randomness fee together, not the fee alone; "0" when the call sent no request of its own. The
     * transaction carries headroom above it and the excess comes back in the same transaction, so this is
     * what the wallet is left down by.
     */
    ethPaid: string;
    /** $CPU burned by this reveal (decimal); "0" when the call sent no request of its own. */
    cpuBurn: string;
    approveTxHash: Hash | null;
    fulfilled: boolean;
    note: string | null;
}

export interface SelfServiceRevealRequests {
    currentSource: Address;
    serverTime: number;
    requests: Array<OpenRevealRequestView>;
}

export interface RevealFulfilmentServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    randomness: ISelfServiceRandomnessResolver;
    revealRequests: IRevealRequestsReader;
    contracts: IContractClient;
    claims: IFulfilmentClaims;
    logger: ILogger;
}

export interface FulfillRevealInput {
    tokenIds: Array<string> | null;
    requestId: string | null;
    source: string | null;
}

export interface RevealFulfilmentTarget {
    requestId: bigint;
    source: Address;
    tokenId: string | null;
}

export enum RevealFulfilmentOutcome {
    Settled = 'settled',
    AlreadyDone = 'already_done',
    Busy = 'busy',
    RetiredSource = 'retired_source',
    NotReady = 'not_ready',
    Failed = 'failed',
}

export interface RevealFulfilmentEntry {
    requestId: string;
    source: Address;
    tokenId: string | null;
    outcome: RevealFulfilmentOutcome;
    round: string | null;
    fulfillTxHash: Hash | null;
    note: string;
}

export interface RevealFulfilmentReport {
    owner: Address;
    source: Address;
    requests: Array<RevealFulfilmentEntry>;
}

export interface BuildServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    cellClient: ICellClient;
    contracts: IContractClient;
    mapReader: RevealCellReader;
    logger: ILogger;
}

export interface BuildInput {
    tokenId: string;
    buildingType: BuildingType;
}

export interface BuildResult {
    tokenId: string;
    buildingType: BuildingType;
    /** Build cost in $CPU (decimal). */
    buildCost: string;
    approveTxHash: Hash | null;
    buildTxHash: Hash | null;
    alreadyBuilt: boolean;
}

export interface BuildPlacement {
    buildTxHash: Hash | null;
    approveTxHash: Hash | null;
    /** Build cost in $CPU (decimal). */
    buildCost: string;
}

export interface UpgradeInput {
    tokenId: string;
    targetBuildingType: string;
}

export interface UpgradeResult {
    tokenId: string;
    fromBuildingType: string;
    toBuildingType: string;
    buildCost: string;
    buildInputs: Array<CraftStackView>;
    noop: boolean;
    upgrading: boolean;
    finishAt: number | null;
    approveTxHash: Hash | null;
    txHash: Hash | null;
    status: TxStatus | null;
    blockNumber: string | null;
}

export interface DemolishInput {
    tokenId: string;
}

export interface DemolishResult {
    tokenId: string;
    buildingType: string;
    /** $CPU burned to tear it down (decimal). */
    cpuBurned: string;
    /** Warehouse resources consumed by the demolish (integer units); empty when none. */
    inputsConsumed: Array<CraftStackView>;
    rebuildUnlockAt: number | null;
    rebuildCooldownSec: number | null;
    approveTxHash: Hash | null;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

export interface WithdrawServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    cellClient: ICellClient;
    contracts: IContractClient;
    mapReader: RevealCellReader;
    logger: ILogger;
}

export interface WithdrawInput {
    tokenId: string;
    /** Whole wCPU units to cash out (e.g. `"100"`). */
    amount: string;
}

/** A confirmed withdraw — the on-chain mint of $CPU against a cell's debited wCPU (1:1). */
export interface WithdrawResult {
    tokenId: string;
    requested: string;
    executed: string;
    partial: boolean;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

export interface MiningServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    cellClient: ICellClient;
    contracts: IContractClient;
    mapReader: RevealCellReader;
    logger: ILogger;
}

export interface ProcessStatusView {
    tokenId: string;
    active: boolean;
    serverTime: number;
    batches: number;
    claimedBatches: number;
    completedBatches: number;
    claimableBatches: number;
    isFinished: boolean;
    startAt: number | null;
    durationSec: number | null;
    endsAtSec: number | null;
    nextBatchAtSec: number | null;
    stalled: boolean;
}

export interface MiningStatusResult extends ProcessStatusView {
    targetResourceId: number | null;
    yieldPerCycle: number | null;
    claimable: string;
    depositRemaining: string;
    warehouseUsed: string | null;
    warehouseCap: string | null;
}

export interface MiningClaimResult {
    tokenId: string;
    claimedBatches: number | null;
    resourceId: number | null;
    claimedAmount: string;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

export interface StartMiningInput {
    tokenId: string;
    /** Resource id to mine; null defaults to the extractor's sole minable resource. */
    targetResourceId: number | null;
    batches: number;
}

export interface ModeSwitchCharge {
    cost: ModeCostView;
    exact: boolean;
    burnedCpu: string | null;
}

export interface StartMiningResult {
    tokenId: string;
    targetResourceId: number;
    yieldPerCycle: number | null;
    batches: number | null;
    durationSec: number | null;
    modeSwitch: ModeSwitchCharge;
    approveTxHash: Hash | null;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

export interface TransportClientOptions {
    contracts: IContractClient;
    logger: ILogger;
}

export interface QuoteRouteParams {
    transport: Address;
    from: Address;
    tokenIds: Array<bigint>;
    res: number;
    amount: bigint;
}

export interface RouteQuote {
    totalFee: bigint;
    discount: bigint;
    totalDistance: bigint;
    arrivalAt: bigint;
}

export interface MoveParams {
    transport: Address;
    tokenIds: Array<bigint>;
    res: number;
    amount: bigint;
    maxFee: bigint;
}

export interface FinalizeParams {
    transport: Address;
    ids: Array<bigint>;
}

export interface ITransportClient {
    quoteRoute(params: QuoteRouteParams): Promise<RouteQuote>;
    move(params: MoveParams): Promise<Hash>;
    finalize(params: FinalizeParams): Promise<Hash>;
}

export interface TransportServiceOptions {
    api: ApiClient;
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    contracts: IContractClient;
    transportClient: ITransportClient;
    logger: ILogger;
}

export interface TransportInput {
    path: Array<number>;
    resourceId: number;
    amount: string;
}

export interface TransportQuote {
    /** Transit fee in $CPU (decimal); "0" for an own-cells-only route. */
    fee: string;
    discount: string;
    totalDistance: number;
    arrivalAt: number;
}

export interface TransportResult {
    deliveryId: string;
    sourceTokenId: string;
    targetTokenId: string;
    resourceId: number;
    amount: string;
    /** Transit fee paid, in $CPU (decimal). */
    fee: string;
    transitPaid: string;
    transitDiscount: string;
    arrivalAt: number;
    txHash: Hash;
    approveTxHash: Hash | null;
    status: TxStatus;
    blockNumber: string;
}

export enum DeliveryFilter {
    All = 'all',
    InTransit = 'in_transit',
    Delivered = 'delivered',
    ReadyToFinalize = 'ready_to_finalize',
}

export interface DeliveryView {
    deliveryId: string;
    payer: string | null;
    sourceTokenId: string | null;
    targetTokenId: string;
    resourceId: number;
    amount: string;
    arrivalAt: number | null;
    delivered: boolean;
    readyToFinalize: boolean;
}

export interface FinalizeResult {
    deliveryIds: Array<string>;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

// ---- Route survey ----

export interface RouteCellReader {
    allCells(): Promise<Array<Cell>>;
}

export interface RouteServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    mapReader: RouteCellReader;
    logger: ILogger;
}

export interface NextHopsInput {
    from: number;
    towards: number | null;
    resourceId: number;
}

export interface NextHopView {
    tokenId: string;
    pos: CellCoord;
    hopDistance: number;
    isOwn: boolean;
    isHub: boolean;
    ready: boolean | null;
    owner: string;
    transitFeePerUnit: string | null;
    distanceToTarget: number | null;
}

export interface NextHopsResult {
    from: string;
    fromIsHub: boolean;
    fromReady: boolean | null;
    towards: string | null;
    targetDistance: number | null;
    reach: { moveRadius: number; hubRadius: number };
    hops: Array<NextHopView>;
    note: string;
}

export interface RouteNetworkInput {
    from: number | null;
    towards: number | null;
    resourceId: number;
}

export interface NetworkNodeView {
    tokenId: string;
    pos: CellCoord;
    isOwn: boolean;
    isHub: boolean;
    ready: boolean | null;
    owner: string;
    transitFeePerUnit: string | null;
    distFromSource: number | null;
    distToTarget: number | null;
    component: number;
}

export interface NetworkEdgeView {
    a: string;
    b: string;
    distance: number;
}

export interface RouteNetworkResult {
    from: string | null;
    towards: string | null;
    fromToTarget: number | null;
    reach: { moveRadius: number; hubRadius: number };
    components: number;
    nodes: Array<NetworkNodeView>;
    edges: Array<NetworkEdgeView>;
    note: string;
}

export interface CraftServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    cellClient: ICellClient;
    contracts: IContractClient;
    mapReader: RevealCellReader;
    logger: ILogger;
}

export interface CraftInput {
    tokenId: string;
    recipeId: CraftRecipeId;
    batches: number;
}

export interface CraftOpexCharge {
    served: boolean;
    costCpu: string;
}

export interface CraftStartResult {
    tokenId: string;
    recipeId: CraftRecipeId;
    batches: number;
    /** Total $CPU cost for all batches (decimal); "0" for a free recipe. */
    costCpu: string;
    opex: CraftOpexCharge;
    totalCpu: string;
    modeSwitch: ModeSwitchCharge;
    approveTxHash: Hash | null;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

export interface CraftOutput {
    resourceId: number;
    amount: string;
}

export interface CraftClaimResult {
    tokenId: string;
    recipeId: CraftRecipeId | null;
    batches: number;
    claimedBatches: number | null;
    outputs: Array<CraftOutput>;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

export interface CraftStatusResult extends ProcessStatusView {
    recipeId: string | null;
    blockedResourceIds: Array<number>;
}

// ---- Trade (lot marketplace) ----

export interface TradeServiceOptions {
    api: ApiClient;
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    contracts: IContractClient;
    tradeClient: ITradeClient;
    /** Reused for the transit-fee quote — every trade write routes goods through Transport. */
    transportClient: ITransportClient;
    logger: ILogger;
}

export interface CreateLotInput {
    /** Waypoint tokenIds, `[source, …waypoints, hub]`. */
    chain: Array<number>;
    resourceId: number;
    value: string;
    pricePerUnit: string;
    maxSaleFeePercent: number | null;
}

export interface SetSaleFeeInput {
    hubTokenId: string;
    resourceId: number;
    feePercent: number;
}

export interface BuyLotInput {
    lotId: string;
    /** Waypoint tokenIds, `[hub, …waypoints, buyerDest]`. */
    chain: Array<number>;
    value: string;
}

export interface CancelLotInput {
    lotId: string;
    /** Waypoint tokenIds, `[hub, …waypoints, sellerDest]` — routes the unsold remainder home. */
    chain: Array<number>;
}

export interface QuoteBuyInput {
    lotId: string;
    value: string;
    /** Waypoint tokenIds, `[hub, …waypoints, buyerDest]`; null for a seller-only estimate. */
    chain: Array<number> | null;
}

/** Filters for `GET /api/v1/trade/lots`. All fields nullable — omit to leave unset. */
export interface ListLotsQuery {
    hub: number | null;
    resourceId: number | null;
    seller: string | null;
    minPrice: string | null;
    maxPrice: string | null;
    availability: LotAvailability | null;
    sort: LotSort | null;
    limit: number | null;
    offset: number | null;
    aroundTokenId: number | null;
    radius: number | null;
}

export interface ListFillsQuery {
    resourceId: number | null;
    hubTokenId: number | null;
    before: string | null;
    limit: number | null;
}

/** Filters for `GET /api/v1/trade/markets`. */
export interface MarketsQuery {
    hub: number | null;
    resourceId: number | null;
    aroundTokenId: number | null;
    radius: number | null;
}

export interface TradeClientOptions {
    contracts: IContractClient;
    logger: ILogger;
}

export interface CreateLotParams {
    trade: Address;
    tokenIds: Array<bigint>;
    res: number;
    /** Units to list. */
    value: bigint;
    /** Asking price per unit, in $CPU wei. */
    price: bigint;
    maxSaleFeeBp: number;
    maxFee: bigint;
}

export interface SetSaleFeeParams {
    trade: Address;
    hub: bigint;
    res: number;
    feeBp: number;
}

export interface GetSaleFeeParams {
    trade: Address;
    hub: bigint;
    res: number;
}

export interface BuyLotParams {
    trade: Address;
    lotId: bigint;
    value: bigint;
    destTokenIds: Array<bigint>;
    maxFee: bigint;
}

export interface QuoteSaleParams {
    trade: Address;
    lotId: bigint;
    value: bigint;
    buyer: Address;
}

export interface QuoteBuyParams {
    trade: Address;
    lotId: bigint;
    value: bigint;
    destTokenIds: Array<bigint>;
    buyer: Address;
}

export interface SaleQuoteResult {
    buyerTotal: bigint;
    sellerNet: bigint;
    sale: bigint;
    feeBp: number;
    hubFee: bigint;
    burn: bigint;
    discount: bigint;
    tax: bigint;
    ownerNet: bigint;
}

export interface BuyQuoteResult {
    sale: SaleQuoteResult;
    transitFee: bigint;
    transitDiscount: bigint;
    arrivalAt: bigint;
    totalCost: bigint;
}

export interface CancelLotParams {
    trade: Address;
    lotId: bigint;
    returnTokenIds: Array<bigint>;
    maxFee: bigint;
}

/** Sends the Trade writes — implemented by TradeClient. Lot state comes from the game API. */
export interface ITradeClient {
    createLot(params: CreateLotParams): Promise<Hash>;
    buy(params: BuyLotParams): Promise<Hash>;
    cancel(params: CancelLotParams): Promise<Hash>;
    setSaleFee(params: SetSaleFeeParams): Promise<Hash>;
    getSaleFee(params: GetSaleFeeParams): Promise<number>;
    quoteSale(params: QuoteSaleParams): Promise<SaleQuoteResult>;
    quoteBuy(params: QuoteBuyParams): Promise<BuyQuoteResult>;
}

export interface SetSaleFeeResult {
    hubTokenId: string;
    resourceId: number;
    feePercent: number;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

/**
 * A confirmed `create_lot`: the lot is `DELIVERING` until its escrow arrives at the hub and a
 * `finalize_delivery` on `deliveryId` opens it.
 */
export interface CreateLotResult {
    lotId: string;
    hubTokenId: string;
    resourceId: number;
    value: string;
    pricePerUnit: string;
    maxSaleFeePercent: number;
    deliveryId: string;
    arrivalAt: number;
    /** Transit fee quoted for the routing, in $CPU (decimal). */
    fee: string;
    transitPaid: string;
    transitDiscount: string;
    txHash: Hash;
    /** Transport-fee approve, when the route crossed a foreign hub. */
    approveTxHash: Hash | null;
    status: TxStatus;
    blockNumber: string;
}

/** A confirmed `buy_lot`: goods ship to the buyer's cell and land after `finalize_delivery`. */
export interface BuyLotResult {
    lotId: string;
    resourceId: number;
    value: string;
    /** value × pricePerUnit, in $CPU (decimal). */
    sale: string;
    discount: string;
    paid: string;
    hubFee: string;
    tax: string;
    ownerNet: string;
    burn: string;
    /** Units left on the lot after this buy (0 = sold out). */
    remaining: string;
    /** Transit fee paid, in $CPU (decimal). */
    fee: string;
    transitPaid: string;
    transitDiscount: string;
    deliveryId: string;
    arrivalAt: number;
    txHash: Hash;
    /** $CPU approve for the sale (spender: Trade). */
    approveSaleTxHash: Hash | null;
    /** $CPU approve for the transit fee (spender: Transport), when the route crossed a foreign hub. */
    approveTransitTxHash: Hash | null;
    status: TxStatus;
    blockNumber: string;
}

/** A confirmed `cancel_lot`: the unsold remainder ships home and lands after `finalize_delivery`. */
export interface CancelLotResult {
    lotId: string;
    resourceId: number;
    /** Units returned to the seller. */
    returned: string;
    /** Transit fee paid, in $CPU (decimal). */
    fee: string;
    transitPaid: string;
    transitDiscount: string;
    deliveryId: string;
    arrivalAt: number;
    txHash: Hash;
    approveTxHash: Hash | null;
    status: TxStatus;
    blockNumber: string;
}

/** A non-destructive buy preview. `routed` = a route was supplied, so the transit fee is included. */
export interface TradeQuote {
    lotId: string;
    resourceId: number;
    pricePerUnit: string;
    value: string;
    remaining: string;
    routed: boolean;
    sale: string;
    saleFeePercent: number;
    discount: string;
    salePaid: string;
    tax: string;
    ownerNet: string;
    transitFee: string | null;
    transitDiscount: string | null;
    arrivalAt: number | null;
    total: string;
}

// ---- Swap (Uniswap v4 ETH/$CPU pool) ----

export interface SwapServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    logger: ILogger;
}

export enum SwapToken {
    ETH = 'ETH',
    CPU = 'CPU',
}

export enum SwapDirection {
    EthToCpu = 'eth_to_cpu',
    CpuToEth = 'cpu_to_eth',
}

export interface PoolKeyView {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
}

export interface SwapRoute {
    direction: SwapDirection;
    tokenIn: Address;
    tokenOut: Address;
    zeroForOne: boolean;
}

export interface PreparedSwap {
    config: AppConfig;
    wallet: WalletManager;
    pool: PoolKeyView;
    route: SwapRoute;
    amountInWei: bigint;
    amountOutWei: bigint;
    amountOutMinimumWei: bigint;
}

export interface V4SwapPlan {
    poolKey: PoolKeyView;
    zeroForOne: boolean;
    inputCurrency: Address;
    outputCurrency: Address;
    amountInWei: bigint;
    amountOutMinimumWei: bigint;
    deadline: bigint;
}

export interface SwapInput {
    sell: SwapToken;
    amount: string;
    slippage: number;
}

export interface SwapQuote {
    direction: SwapDirection;
    sell: SwapToken;
    tokenIn: Address;
    tokenOut: Address;
    fee: number;
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    slippage: number;
}

export interface SwapResult {
    direction: SwapDirection;
    sell: SwapToken;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: string;
    amountOutQuoted: string;
    amountOutMinimum: string;
    txHash: Hash;
    approveTxHash: Hash | null;
    permit2TxHash: Hash | null;
    status: TxStatus;
    blockNumber: string;
}

// ---- Mint (OpenSea SeaDrop land public drop) ----

export interface MintServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    logger: ILogger;
}

export interface MintInput {
    /** Number of land cells to mint, as a positive integer string. */
    quantity: string;
}

/** The active SeaDrop public-drop terms for the land collection, read on-chain. */
export interface PublicDropView {
    /** ETH price per cell, in wei. */
    mintPrice: bigint;
    startTime: number;
    endTime: number;
    maxTotalMintableByWallet: number;
    /** OpenSea fee, in basis points of the (inclusive) mint price. */
    feeBps: number;
    restrictFeeRecipients: boolean;
}

export interface PreparedMint {
    config: AppConfig;
    wallet: WalletManager;
    land: Address;
    drop: PublicDropView;
    quantity: number;
    /** quantity × mintPrice, in wei — the exact ETH the mint must pay. */
    totalWei: bigint;
}

export interface MintQuote {
    land: Address;
    quantity: number;
    /** Per-cell price in native ETH (decimal). */
    mintPrice: string;
    /** quantity × mintPrice in native ETH (decimal). */
    total: string;
    feeBps: number;
    startTime: number;
    endTime: number;
    maxTotalMintableByWallet: number;
}

/** A confirmed mint — the on-chain SeaDrop public-drop purchase of `quantity` cells, paid in ETH. */
export interface MintResult {
    land: Address;
    quantity: number;
    /** quantity × mintPrice in native ETH (decimal). */
    total: string;
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
}

/** Mints land cells via the SeaDrop public drop — implemented by MintService. */
export interface IMintService {
    quote(input: MintInput): Promise<MintQuote>;
    mint(input: MintInput): Promise<MintResult>;
}

// ---- Account balance ----

export interface BalanceServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    logger: ILogger;
}

/** The wallet's spendable funds — $CPU (the game currency) plus native gas. */
export interface BalanceResult {
    address: string;
    network: Network;
    chainId: number;
    /** $CPU balance in $CPU (decimal). */
    cpu: string;
    /** Native gas balance in ETH (decimal). */
    native: string;
}

// ---- Syndicate registry ----

export interface SyndicateServiceOptions {
    api: ApiClient;
    wallet: WalletProvider;
    appConfig: IAppConfig;
    registry: ISyndicateRegistryClient;
    logger: ILogger;
}

export interface SyndicateRegistryClientOptions {
    contracts: IContractClient;
    logger: ILogger;
}

export interface JoinRegistryParams {
    registry: Address;
    id: bigint;
}

export interface LeaveRegistryParams {
    registry: Address;
}

export interface RegistryRates {
    tradeDiscountBp: number;
    transportDiscountBp: number;
    tradeTaxBp: number;
    transportTaxBp: number;
}

export interface CreateRegistryParams {
    registry: Address;
    name: string;
    link: string;
    manager: Address;
    rates: RegistryRates;
}

export interface SetParamsRegistryParams {
    registry: Address;
    id: bigint;
    name: string;
    link: string;
    rates: RegistryRates;
}

export interface TransferManagerRegistryParams {
    registry: Address;
    id: bigint;
    next: Address;
}

export interface SyndicateRegistryConfig {
    exitCooldownSec: number;
}

export interface ISyndicateRegistryClient {
    join(params: JoinRegistryParams): Promise<ConfirmedTx>;
    leave(params: LeaveRegistryParams): Promise<ConfirmedTx>;
    create(params: CreateRegistryParams): Promise<ConfirmedTx>;
    setParams(params: SetParamsRegistryParams): Promise<ConfirmedTx>;
    transferManager(params: TransferManagerRegistryParams): Promise<ConfirmedTx>;
    getConfig(registry: Address): Promise<SyndicateRegistryConfig>;
}

export interface JoinSyndicateInput {
    id: string;
}

export interface JoinSyndicateResult {
    syndicateId: string;
    joinedAt: number;
    leaveAvailableAt: number;
    name: string | null;
    rates: SyndicateRatesView | null;
}

export interface LeaveSyndicateResult {
    syndicateId: string;
    rejoinAvailableImmediately: boolean;
}

export interface SyndicateRatesView {
    tradeDiscountPercent: number;
    transportDiscountPercent: number;
    tradeTaxPercent: number;
    transportTaxPercent: number;
}

export interface CreateSyndicateInput {
    name: string;
    link: string;
    manager: string | null;
    rates: SyndicateRatesView;
}

export interface CreateSyndicateResult {
    syndicateId: string;
    manager: string;
    name: string;
    link: string;
    rates: SyndicateRatesView;
    joinedAt: number;
    leaveAvailableAt: number;
}

export interface SetSyndicateParamsInput {
    id: string;
    name: string;
    link: string;
    rates: SyndicateRatesView;
}

export interface SetSyndicateParamsResult {
    syndicateId: string;
    name: string;
    link: string;
    rates: SyndicateRatesView;
}

export interface TransferSyndicateManagerInput {
    id: string;
    next: string;
}

export interface TransferSyndicateManagerResult {
    syndicateId: string;
    previousManager: string;
    newManager: string;
}

export interface SyndicateCardView {
    id: string;
    manager: string;
    name: string;
    link: string;
    rates: SyndicateRatesView;
    memberCount: number;
    createdAt: number;
}

export interface SyndicateMemberView {
    address: string;
    joinedAt: number;
}

export interface ListSyndicatesQuery {
    name: string | null;
    minMembers: number | null;
    maxMembers: number | null;
    sort: SyndicateSort | null;
    limit: number | null;
    offset: number | null;
}

export interface GetSyndicateInput {
    id: string;
    membersLimit: number | null;
    membersOffset: number | null;
}

export interface SyndicateDetailView {
    card: SyndicateCardView;
    members: Array<SyndicateMemberView>;
}

export interface GetMembershipInput {
    address: string | null;
}

export interface SyndicateMembershipView {
    address: string;
    member: boolean;
    syndicateId: string | null;
    joinedAt: number | null;
    leaveAvailableAt: number | null;
    syndicate: SyndicateCardView | null;
}
