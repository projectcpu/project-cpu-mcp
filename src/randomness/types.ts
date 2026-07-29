import type { Address, Hash, Hex } from 'viem';
import { z } from 'zod';

import type { IRevealRequestsReader, RandomnessDescriptor, RandomnessKind } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import type { IAppConfig } from '../services/types.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export interface PushRandomness {
    kind: RandomnessKind.ENTROPY;
    source: Address;
    quoteFee(): Promise<bigint>;
}

export interface SelfServiceRandomness {
    kind: RandomnessKind.DRAND;
    source: Address;
    clock: BeaconRoundClock;
    beacon: IBeaconClient;
    quoteRequestFee(): Promise<bigint>;
    readRequest(requestId: bigint): Promise<AdapterRequestView>;
    findOpenRequest(owner: Address, tokenId: string): Promise<OpenRequestMatch | null>;
    findRetiredSourceRequest(owner: Address, tokenId: string): Promise<OpenRequestMatch | null>;
    fulfill(input: FulfillmentInput): Promise<FulfillmentResult>;
}

export type RandomnessStrategy = PushRandomness | SelfServiceRandomness;

export interface IRandomnessStrategyFactory {
    create(descriptor: RandomnessDescriptor, cell: Address): Promise<RandomnessStrategy>;
}

export interface PushRandomnessOptions {
    source: Address;
    contracts: IContractClient;
    logger: ILogger;
}

export interface SelfServiceRandomnessOptions {
    source: Address;
    clock: BeaconRoundClock;
    beacon: IBeaconClient;
    contracts: IContractClient;
    wallet: WalletProvider;
    revealRequests: IRevealRequestsReader;
    logger: ILogger;
}

export interface RandomnessStrategyFactoryOptions {
    contracts: IContractClient;
    wallet: WalletProvider;
    revealRequests: IRevealRequestsReader;
    logger: ILogger;
}

export enum AdapterRequestState {
    OPEN = 'open',
    CLOSED = 'closed',
}

export interface AdapterRequestView {
    state: AdapterRequestState;
    requestId: bigint;
    consumer: Address;
    round: bigint;
}

export interface OpenRequestRow {
    requestId: bigint;
    source: Address;
    tokenId: string;
    requestedAt: number | null;
}

export interface OpenRequestMatch extends OpenRequestRow {
    serverTime: number;
}

export interface FulfillmentInput {
    requestId: bigint;
    round: bigint;
    signature: Hex;
}

export interface FulfillmentSent {
    state: AdapterRequestState.OPEN;
    requestId: bigint;
    round: bigint;
    txHash: Hash;
}

export interface FulfillmentAlreadyDone {
    state: AdapterRequestState.CLOSED;
    requestId: bigint;
    round: bigint;
    reason: string;
}

export type FulfillmentResult = FulfillmentSent | FulfillmentAlreadyDone;

export enum AdapterErrorName {
    UNKNOWN_REQUEST = 'UnknownRequest',
    ROUND_MISMATCH = 'RoundMismatch',
    MALFORMED_SIGNATURE = 'MalformedSignature',
    SIGNATURE_DOES_NOT_VERIFY = 'SignatureDoesNotVerify',
    INSUFFICIENT_CALLBACK_GAS = 'InsufficientCallbackGas',
    INSUFFICIENT_FEE = 'InsufficientFee',
}

export interface AdapterFailure {
    name: AdapterErrorName;
    message: string;
    alreadyFulfilled: boolean;
}

export enum BeaconRoundOutcome {
    SIGNED = 'signed',
    NOT_RELEASED = 'not_released',
    MALFORMED = 'malformed',
}

export interface BeaconRoundSigned {
    outcome: BeaconRoundOutcome.SIGNED;
    round: bigint;
    signature: Hex;
}

export interface BeaconRoundNotReleased {
    outcome: BeaconRoundOutcome.NOT_RELEASED;
    round: bigint;
    reason: string;
}

export interface BeaconRoundMalformed {
    outcome: BeaconRoundOutcome.MALFORMED;
    round: bigint;
    reason: string;
}

export type BeaconRoundResult = BeaconRoundSigned | BeaconRoundNotReleased | BeaconRoundMalformed;

export interface IBeaconClient {
    signatureOf(round: bigint): Promise<BeaconRoundResult>;
}

export interface BeaconClientOptions {
    baseUrl: string;
    logger: ILogger;
}

export const beaconRoundSchema = z.object({
    round: z.number().int().nonnegative(),
    signature: z.string(),
});

export interface BeaconRoundClock {
    genesis: number;
    period: number;
}

export interface IFulfilmentClaims {
    claim(source: Address, requestId: bigint): boolean;
    release(source: Address, requestId: bigint): void;
    has(source: Address, requestId: bigint): boolean;
}

export interface RequestBackoff {
    failures: number;
    nextAttemptAt: number;
}

export interface ISelfServiceRandomnessResolver {
    resolve(): Promise<SelfServiceRandomness | null>;
}

export interface SelfServiceRandomnessResolverOptions {
    appConfig: IAppConfig;
    randomness: IRandomnessStrategyFactory;
    logger: ILogger;
}

export interface RevealFulfillerOptions {
    randomness: ISelfServiceRandomnessResolver;
    revealRequests: IRevealRequestsReader;
    contracts: IContractClient;
    wallet: WalletProvider;
    claims: IFulfilmentClaims;
    logger: ILogger;
}

export interface RevealFulfilmentHandle {
    stop(): void;
}

export interface RevealFulfillerFactoryOptions {
    appConfig: IAppConfig;
    randomness: IRandomnessStrategyFactory;
    revealRequests: IRevealRequestsReader;
    contracts: IContractClient;
    wallet: WalletProvider;
    claims: IFulfilmentClaims;
    logger: ILogger;
}

export interface BeaconWaitPlan {
    releaseAt: number;
    budgetMs: number;
    retryDelayMs: number;
}
