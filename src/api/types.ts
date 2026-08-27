import { z } from 'zod';

import { LAUNCH_CHAIN_ID, LAUNCH_NETWORK } from '../config/constants.js';
import type { ILogger } from '../logger/types.js';
import type { IJwtSession } from '../session/types.js';

/** HTTP status codes the client and services branch on. */
export enum HttpStatus {
    Ok = 200,
    Accepted = 202,
    Unauthorized = 401,
    NotFound = 404,
    Conflict = 409,
}

export interface ApiClientOptions {
    baseUrl: string;
    session: IJwtSession;
    logger: ILogger;
}

export interface IAuthenticator {
    /** Returns a valid bearer token, performing a (re-)login if missing or expired. */
    getAccessToken(): Promise<string>;
}

export enum ApiAuthenticationErrorCode {
    AuthenticationRequired = 'AUTHENTICATION_REQUIRED',
}

export enum AuthenticationNextTool {
    Authenticate = 'cpu_authenticate',
}

export interface AuthenticationRequiredErrorData {
    code: ApiAuthenticationErrorCode.AuthenticationRequired;
    stateCleared: true;
    nextTool: AuthenticationNextTool.Authenticate;
}

export interface SiweNonceResponse {
    nonce: string;
    issuedAt: string;
    expirationTime: string;
}

export interface SiweVerifyResponse {
    accessToken: string;
    user: {
        id: string;
        address: string;
    };
}

export interface DeviceAuthResponse {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
}

export interface DeviceTokenCompleteResponse {
    sessionConfig: {
        accountAddress: string;
        sessionHash: string;
        policies: unknown;
        expiresAt: number;
    };
}

export interface ApiResponse<T> {
    status: number;
    data: T;
}

/** Last-known reachability of the game API, derived from whether the most recent HTTP call to it
 *  produced a usable JSON response. `reachable: false` means the API is down/unreachable right now. */
export interface ServerHealthView {
    reachable: boolean;
    reason: string | null;
}

export const backendVersionResponseSchema = z.object({ versionSha: z.string().min(1) }).passthrough();

/** Must match the game's recipe catalog — never rename or reuse a value. */
export enum CraftRecipeId {
    GenerateEnergyOil = 'generate_energy_oil',
    EnrichFuelRods = 'enrich_fuel_rods',
    GenerateEnergyReactor = 'generate_energy_reactor',
    MakeConcrete = 'make_concrete',
    SmeltSteel = 'smelt_steel',
    RefineWiring = 'refine_wiring',
    MakeHeatsinks = 'make_heatsinks',
    MakeChemicals = 'make_chemicals',
    MakeCompounds = 'make_compounds',
    MakeSilicon = 'make_silicon',
    MakeChips = 'make_chips',
    MakeMemory = 'make_memory',
    MakeCooling = 'make_cooling',
    MakeAccelerators = 'make_accelerators',
    MakeNetwork = 'make_network',
    ForgeWcpu = 'forge_wcpu',
}

export interface CraftStackView {
    resourceId: number;
    amount: number;
}

/** Enabled craft recipes from `GET /api/v1/config`. */
export interface RecipeView {
    id: CraftRecipeId;
    name: string;
    tier: number;
    inputs: Array<CraftStackView>;
    outputs: Array<CraftStackView>;
    durationSec: number;
    /** $CPU per batch, human-readable decimal (`'0'` = free). */
    costCpu: string;
}

/** Building role — an extractor mines resources, a crafter runs recipes, the hub routes transport. */
export enum BuildingKind {
    Extractor = 'extractor',
    Crafter = 'crafter',
    Hub = 'hub',
}

/** The building types a cell can hold — 6 tier-1 extractors, tier-2..5 crafters, and the Hub. */
export enum BuildingType {
    PumpStation = 'pump_station',
    Quarry = 'quarry',
    Derrick = 'derrick',
    Mine = 'mine',
    TungstenDrill = 'tungsten_drill',
    LeachField = 'leach_field',
    OilPowerPlant = 'oil_power_plant',
    EnrichmentPlant = 'enrichment_plant',
    Reactor = 'reactor',
    ConcretePlant = 'concrete_plant',
    SteelMill = 'steel_mill',
    CopperSmelter = 'copper_smelter',
    HeatsinkPlant = 'heatsink_plant',
    ChemicalPlant = 'chemical_plant',
    CompoundsPlant = 'compounds_plant',
    SiliconPlant = 'silicon_plant',
    WaferFab = 'wafer_fab',
    CoolingPlant = 'cooling_plant',
    AcceleratorFab = 'accelerator_fab',
    NetworkAssembly = 'network_assembly',
    Datacenter = 'datacenter',
    Hub = 'hub',
}

/** Cost to demolish a building: `cpu` $CPU burned + `inputs` consumed from the cell's warehouse (no refund). */
export interface DemolishCostView {
    /** $CPU burned to tear it down, human-readable decimal. */
    cpu: string;
    /** Resources debited from the cell's warehouse (integer units). Ids → `resources`. */
    inputs: Array<CraftStackView>;
}

export interface BuildingEffectsView {
    cycleTimeBp: number;
    extractionShareBp: number;
    inputEfficiency: Array<{ resourceId: number; percent: number }>;
}

/** Per-building catalog entry from `GET /api/v1/config`. */
export interface BuildingView {
    type: string;
    /** `uint8` id the on-chain `place(tokenId, type)` consumes — stable and append-only. */
    onChainId: number;
    name: string;
    kind: BuildingKind;
    tier: number;
    /**
     * Routing reach in grid steps this exact building grants the cell it stands on, once it is Ready. Each
     * hub tier serves its own value; anything that does not route serves `0`.
     */
    radius: number;
    /** $CPU per build, human-readable decimal (`'0'` = free). */
    buildCost: string;
    buildTimeSec: number;
    /** Resources burned to construct it (integer units); empty for tier-1 extractors. Ids → `resources`. */
    buildInputs: Array<CraftStackView>;
    /** Cost to tear it down — burned $CPU + warehouse resources consumed. */
    demolishCost: DemolishCostView;
    modeSwitchCost: string | null;
    /** Resource ids an extractor produces; empty for crafters/hub. Ids → `resources`. */
    minableResources: Array<number>;
    /** Recipe ids a crafter runs; empty for extractors/hub. */
    recipes: Array<CraftRecipeId>;
    effects: BuildingEffectsView;
    recipeOpexCpu: Record<string, string> | null;
    upgradeFrom: string | null;
    upgradeTo: Array<string>;
    family: string | null;
    level: number | null;
    branch: string | null;
}

/**
 * The two gameplay legs charged on every reveal, both whole-unit decimals as `GET /api/v1/config` serves
 * them — never wei. The view omits the live randomness fee and the metadata publication charge, so the pair
 * is never the total a reveal transaction must carry — only the Cell's own quote is (see
 * `ICellClient.quoteReveal`).
 */
export interface RevealPaymentView {
    /** ETH contributed to the $CPU liquidity pool, decimal ETH. */
    ethContribution: string;
    /** $CPU burned from the caller, decimal $CPU. */
    cpuBurn: string;
}

export interface TransportRoutingView {
    moveRadius: number;
    hubRadius: number;
    moveTimePerCellSec: number;
    moveFeeFloors: Record<number, string>;
}

export interface ResourceStorageCapsView {
    resourceId: number;
    cellCap: number;
    hubCap: number;
}

export interface StorageConfigView {
    caps: Array<ResourceStorageCapsView>;
}

export enum RandomnessKind {
    ENTROPY = 'entropy',
    DRAND = 'drand',
}

export const entropyRandomnessSchema = z.object({
    kind: z.literal(RandomnessKind.ENTROPY),
    adapter: z.string(),
});

export const drandRandomnessSchema = z.object({
    kind: z.literal(RandomnessKind.DRAND),
    adapter: z.string(),
    genesis: z.number().int().positive(),
    period: z.number().int().positive(),
    beaconApi: z.string().url(),
});

export const randomnessDescriptorSchema = z.discriminatedUnion('kind', [
    entropyRandomnessSchema,
    drandRandomnessSchema,
]);

export type EntropyRandomnessDescriptor = z.infer<typeof entropyRandomnessSchema>;

export type DrandRandomnessDescriptor = z.infer<typeof drandRandomnessSchema>;

export type RandomnessDescriptor = z.infer<typeof randomnessDescriptorSchema>;

const craftStackSchema = z.object({ resourceId: z.number(), amount: z.number() }).strict();

const recipeConfigSchema = z
    .object({
        id: z.nativeEnum(CraftRecipeId),
        name: z.string(),
        tier: z.number(),
        inputs: z.array(craftStackSchema),
        outputs: z.array(craftStackSchema),
        durationSec: z.number(),
        costCpu: z.string(),
    })
    .passthrough();

const modeSwitchCostConfigSchema = z.preprocess(
    (value) => ({ known: value !== undefined, value: value ?? null }),
    z.object({ known: z.boolean(), value: z.string().nullable() }).strict(),
);

export type ModeSwitchCostConfig = z.infer<typeof modeSwitchCostConfigSchema>;

export const buildingEffectsSchema = z
    .object({
        cycleTimeBp: z.number(),
        extractionShareBp: z.number(),
        inputEfficiency: z.array(z.object({ resourceId: z.number(), percent: z.number() })),
    })
    .passthrough();

export const buildingConfigSchema = z
    .object({
        type: z.string().min(1),
        onChainId: z.number(),
        name: z.string(),
        kind: z.nativeEnum(BuildingKind),
        tier: z.number(),
        radius: z
            .number({
                required_error:
                    'buildings[].radius is missing: every building row must serve its routing radius in grid ' +
                    'steps, because routing reach is read per building and never defaulted.',
                invalid_type_error:
                    'buildings[].radius must be a number of grid steps: routing reach is read per building ' +
                    'and never defaulted.',
            })
            .int('buildings[].radius must be a whole number of grid steps.')
            .nonnegative('buildings[].radius must not be negative.'),
        buildCost: z.string(),
        buildTimeSec: z.number(),
        buildInputs: z.array(craftStackSchema),
        demolishCost: z
            .object({ cpu: z.string(), inputs: z.array(craftStackSchema) })
            .strict()
            .nullable()
            .default(null),
        modeSwitchCost: modeSwitchCostConfigSchema,
        minableResources: z.array(z.number()),
        recipes: z.array(z.nativeEnum(CraftRecipeId)),
        effects: buildingEffectsSchema,
        recipeOpexCpu: z.record(z.string(), z.string()).nullable().default(null),
        upgradeFrom: z.string().nullable().default(null),
        upgradeTo: z.array(z.string()).default([]),
        family: z.string().nullable().default(null),
        level: z.number().nullable().default(null),
        branch: z.string().nullable().default(null),
    })
    .passthrough();

export type ParsedBuildingConfig = z.output<typeof buildingConfigSchema>;

export const transportRoutingSchema = z
    .object({
        moveRadius: z.number(),
        hubRadius: z.number(),
        moveTimePerCellSec: z.number(),
        moveFeeFloors: z.record(z.string(), z.string()).refine((floors) => Object.keys(floors).length > 0, {
            message:
                'transport.moveFeeFloors must carry a per-resource transit-fee floor for every resource; the ' +
                'removed scalar default is no longer accepted.',
        }),
    })
    .passthrough();

const resourceStorageCapsSchema = z
    .object({
        resourceId: z.number().int().nonnegative(),
        cellCap: z.number().int().nonnegative(),
        hubCap: z.number().int().nonnegative(),
    })
    .strict();

export const storageConfigSchema = z
    .object({ caps: z.array(resourceStorageCapsSchema) })
    .strict()
    .superRefine((storage, context) => {
        for (let index = 1; index < storage.caps.length; index += 1) {
            const previous = storage.caps[index - 1];
            const current = storage.caps[index];
            if (previous !== undefined && current !== undefined && current.resourceId <= previous.resourceId) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['caps', index, 'resourceId'],
                    message: 'storage caps must be strictly ascending by resourceId',
                });
            }
        }
    });

/**
 * Both parameters are surfaced as live rules, so neither may be defaulted: a zero burn and a zero
 * ceiling are quotable numbers an agent would plan against, and a response without them is a stale
 * shape, not a network that charges nothing.
 */
export const tradeParametersSchema = z.object({
    saleBurnPercent: z.number(),
    maxSaleFeeBp: z.number(),
});

export type TradeParameters = z.infer<typeof tradeParametersSchema>;

export const appConfigResponseSchema = z
    .object({
        network: z.literal(LAUNCH_NETWORK),
        chainId: z.literal(LAUNCH_CHAIN_ID),
        contracts: z
            .object({
                land: z.string().default(''),
                cpuToken: z.string().default(''),
                cpuHook: z.string().default(''),
                cell: z.string().default(''),
                cellLens: z.string().default(''),
                transport: z.string().default(''),
                trade: z.string().default(''),
                syndicate: z.string().nullable().default(null),
            })
            .passthrough(),
        randomness: z.unknown().nullable().default(null),
        storage: storageConfigSchema,
        resources: z.record(z.string(), z.string()).default({}),
        recipes: z.array(recipeConfigSchema).default([]),
        buildings: z.array(buildingConfigSchema).default([]),
        reveal: z.unknown().nullable().default(null),
        transport: transportRoutingSchema,
        trade: z.unknown(),
    })
    .passthrough();

/** Untrusted `GET /api/v1/config?network=` input accepted by the parser. */
export type AppConfigResponse = z.input<typeof appConfigResponseSchema>;

export enum DeliveryTargetKind {
    Cell = 'cell',
    Lot = 'lot',
}

export interface DeliveryResponse {
    deliveryId: string;
    payer: string | null;
    receiver: string;
    sourceTokenId: string | null;
    targetTokenId: string;
    targetKind: DeliveryTargetKind;
    resourceId: number;
    amount: string;
    arrivalAt: number | null;
    delivered: boolean;
    updated: number;
}

export interface DeliveriesResponse {
    serverTime: number;
    version: number;
    deliveries: Array<DeliveryResponse>;
}

// ---- Trade (lot marketplace) ----

/**
 * Lifecycle of a lot as the game API names it. The contract stores the same lifecycle as an ordinal
 * (`OnChainLotState`); the two representations are converted only through the explicit mapping in
 * `src/services/trade.helpers.ts`.
 */
export enum LotState {
    Delivering = 'delivering',
    Open = 'open',
    /** Thrown out of its hub: still the seller's goods, unbuyable, and owing a Lot return. */
    Evicted = 'evicted',
    Sold = 'sold',
    Cancelled = 'cancelled',
}

/** Discovery availability filter — `incoming` = paid & en route (DELIVERING). */
export enum LotAvailability {
    Open = 'open',
    Incoming = 'incoming',
    Frozen = 'frozen',
    All = 'all',
}

export enum LotSort {
    PriceAsc = 'price_asc',
    Recent = 'recent',
    Nearest = 'nearest',
}

export interface ApiLotView {
    id: string;
    hubTokenId: string;
    sellerAddress: string;
    resourceId: number;
    listed: string;
    remaining: string;
    pricePerUnit: string;
    saleFeeBp: number;
    maxSaleFeeBp: number;
    state: LotState;
    distanceFromAnchor: number | null;
    createdAt: number;
    updated: number;
}

export interface LotView {
    id: string;
    hubTokenId: string;
    sellerAddress: string;
    resourceId: number;
    listed: string;
    remaining: string;
    pricePerUnit: string;
    saleFeePercent: number;
    maxSaleFeePercent: number;
    frozen: boolean;
    state: LotState;
    distanceFromAnchor: number | null;
    createdAt: number;
    updated: number;
}

export interface ApiFillView {
    lotId: string;
    blockNumber: number;
    logIndex: number;
    transactionHash: string;
    hubTokenId: string;
    resourceId: number;
    seller: string;
    buyer: string;
    value: string;
    remaining: string;
    sale: string;
    hubFee: string;
    burn: string;
    pricePerUnit: string;
    settledAt: number;
}

export interface FillView extends ApiFillView {
    soldOut: boolean;
}

export interface ApiMarketResourceSummary {
    hubTokenId: string;
    resourceId: number;
    openLots: number;
    openRemaining: string;
    minPricePerUnit: string | null;
    incomingLots: number;
    incomingRemaining: string;
    frozenLots: number;
    frozenRemaining: string;
    distanceFromAnchor: number | null;
}

export interface MarketResourceSummary {
    hubTokenId: string;
    resourceId: number;
    openLots: number;
    openRemaining: string;
    minPricePerUnit: string | null;
    incomingLots: number;
    incomingRemaining: string;
    frozenLots: number;
    frozenRemaining: string;
    distanceFromAnchor: number | null;
}

/**
 * Every Trade schema below is strict about what the deployed projection owes: a required field stays
 * required, a nullable field stays explicitly nullable, and nothing is passed through untouched. An
 * optional fallback here would let a stale deployment answer a read the MCP then reports as fact.
 */
export const apiLotViewSchema = z.object({
    id: z.string(),
    hubTokenId: z.string(),
    sellerAddress: z.string(),
    resourceId: z.number(),
    listed: z.string(),
    remaining: z.string(),
    pricePerUnit: z.string(),
    saleFeeBp: z.number(),
    maxSaleFeeBp: z.number(),
    state: z.nativeEnum(LotState),
    distanceFromAnchor: z.number().nullable(),
    createdAt: z.number(),
    updated: z.number(),
});

export const apiMarketResourceSummarySchema = z.object({
    hubTokenId: z.string(),
    resourceId: z.number(),
    openLots: z.number(),
    openRemaining: z.string(),
    minPricePerUnit: z.string().nullable(),
    incomingLots: z.number(),
    incomingRemaining: z.string(),
    frozenLots: z.number(),
    frozenRemaining: z.string(),
    distanceFromAnchor: z.number().nullable(),
});

export const apiFillViewSchema = z.object({
    lotId: z.string(),
    blockNumber: z.number().int(),
    logIndex: z.number().int(),
    transactionHash: z.string(),
    hubTokenId: z.string(),
    resourceId: z.number().int(),
    seller: z.string(),
    buyer: z.string(),
    value: z.string(),
    remaining: z.string(),
    sale: z.string(),
    hubFee: z.string(),
    burn: z.string(),
    pricePerUnit: z.string(),
    settledAt: z.number().int(),
});

export interface ApiMarketIndexRow {
    resourceId: number;
    priceCpu: string | null;
    changePct: number | null;
    volume: string | null;
    spark: Array<string | null>;
}

export interface ApiMarketIndex {
    computedAt: number;
    resources: Array<ApiMarketIndexRow>;
}

export interface MarketIndexRow {
    resourceId: number;
    priceCpu: string | null;
    changePct: number | null;
    volume: string | null;
    spark: Array<string | null>;
}

export interface MarketIndex {
    computedAt: number;
    resources: Array<MarketIndexRow>;
}

export const apiMarketIndexRowSchema = z.object({
    resourceId: z.number().int(),
    priceCpu: z.string().nullable(),
    changePct: z.number().nullable(),
    volume: z.string().nullable(),
    spark: z.array(z.string().nullable()),
});

export const apiMarketIndexSchema = z.object({
    computedAt: z.number().int(),
    resources: z.array(apiMarketIndexRowSchema),
});

// ---- Syndicate registry ----

export enum SyndicateSort {
    MembersDesc = 'members_desc',
    Recent = 'recent',
    Name = 'name',
}

export const apiSyndicateRatesSchema = z
    .object({
        tradeDiscountBp: z.number().int(),
        transportDiscountBp: z.number().int(),
        tradeTaxBp: z.number().int(),
        transportTaxBp: z.number().int(),
    })
    .passthrough();
export type ApiSyndicateRates = z.infer<typeof apiSyndicateRatesSchema>;

export const apiSyndicateCardSchema = z
    .object({
        id: z.string(),
        manager: z.string(),
        name: z.string(),
        link: z.string(),
        rates: apiSyndicateRatesSchema,
        memberCount: z.number().int(),
        createdAt: z.number().int(),
    })
    .passthrough();
export type ApiSyndicateCard = z.infer<typeof apiSyndicateCardSchema>;

export const apiSyndicateMemberViewSchema = z
    .object({
        address: z.string(),
        joinedAt: z.number().int(),
    })
    .passthrough();
export type ApiSyndicateMemberView = z.infer<typeof apiSyndicateMemberViewSchema>;

export const apiSyndicateMembershipSchema = z
    .object({
        syndicateId: z.string(),
        joinedAt: z.number().int(),
        leaveAvailableAt: z.number().int(),
    })
    .passthrough();
export type ApiSyndicateMembership = z.infer<typeof apiSyndicateMembershipSchema>;

export const apiRevealRequestSchema = z
    .object({
        requestId: z.string(),
        source: z.string(),
        tokenId: z.string(),
        revealCount: z.number().int().nullable(),
        requestedAt: z.number().int().nullable(),
    })
    .passthrough()
    .transform(({ revealCount, ...request }) => ({ ...request, revealEpoch: revealCount }));
export type ApiRevealRequest = z.infer<typeof apiRevealRequestSchema>;

export const apiOpenRevealRequestsSchema = z
    .object({
        serverTime: z.number().int(),
        requests: z.array(apiRevealRequestSchema),
    })
    .passthrough();
export type ApiOpenRevealRequests = z.infer<typeof apiOpenRevealRequestsSchema>;

export interface OpenRevealRequestView {
    requestId: string;
    source: string;
    tokenId: string;
    requestedAt: number | null;
}

export interface OpenRevealRequestsView {
    serverTime: number;
    requests: Array<OpenRevealRequestView>;
}

export interface IApiReader {
    request<T>(path: string): Promise<ApiResponse<T>>;
}

export interface RevealRequestsClientOptions {
    api: IApiReader;
    logger: ILogger;
}

export interface IRevealRequestsReader {
    listOpenRequests(owner: string): Promise<OpenRevealRequestsView>;
}
