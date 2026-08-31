import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { MarketScanOutcome } from './listing.types.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    chainIdSchema,
    evmAddressSchema,
    marketCurrencySchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    MarketOfferKind,
    orderHashSchema,
    positiveBaseUnitAmountSchema,
    seaportOrderParametersSchema,
    unixSecondsSchema,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
    type MarketOffer,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';
import { USDG_CENT_BASE_UNITS } from './constants.js';

export const usdgOfferAmountSchema = positiveBaseUnitAmountSchema.refine(
    (amount) => /^[1-9][0-9]*$/.test(amount) && BigInt(amount) % USDG_CENT_BASE_UNITS === 0n,
    'USDG offers must use whole-cent increments (10000 base units).',
);

export interface MarketOfferScan {
    outcome: MarketScanOutcome;
    offer: MarketOffer | null;
}

export interface MarketOfferContracts {
    collection: string;
    usdg: string;
}

export const preparedOfferTermsSchema = z.object({
    maker: evmAddressSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema,
    amount: baseUnitAmountSchema,
    currency: marketCurrencySchema,
    counter: baseUnitAmountSchema,
    startTime: unixSecondsSchema,
    expirationTime: unixSecondsSchema,
});

const marketPriceWireSchema = z.object({
    currencyAddress: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    amountBaseUnits: baseUnitAmountSchema,
});

const prepareOfferWireResponseSchema = marketPreparedIntentSchema.extend({
    order: seaportOrderParametersSchema,
    approvals: z.array(marketTransactionSchema),
    currency: marketCurrencySchema,
});

const submittedOfferWireSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    maker: evmAddressSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema.nullable(),
    price: marketPriceWireSchema,
    startsAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema,
});

const currencyFrom = (price: z.infer<typeof marketPriceWireSchema>) => ({
    address: price.currencyAddress,
    symbol: price.symbol,
    decimals: price.decimals,
});

export const prepareOfferResponseSchemaFor = (request: MakeCellOfferRequest, counter: string) =>
    prepareOfferWireResponseSchema.transform((data) => ({
        prepareId: data.prepareId,
        expiresAt: data.expiresAt,
        chainId: data.chainId,
        protocolAddress: data.protocolAddress,
        offer: {
            maker: data.order.offerer,
            kind: MarketOfferKind.Item,
            tokenId: request.tokenId,
            amount: request.amount,
            currency: data.currency,
            counter,
            startTime: Number(data.order.startTime),
            expirationTime: Number(data.order.endTime),
        },
        transactions: data.approvals,
        order: data.order,
    }));

export const submitOfferResponseSchemaFor = (chainId: number) =>
    z.object({ offer: submittedOfferWireSchema }).transform(({ offer }) => ({
        offer: {
            orderHash: offer.orderHash,
            protocolAddress: offer.protocolAddress,
            chainId: chainIdSchema.parse(chainId),
            maker: offer.maker,
            kind: offer.kind,
            tokenId: offer.tokenId,
            amount: offer.price.amountBaseUnits,
            currency: currencyFrom(offer.price),
            startTime: offer.startsAt,
            expirationTime: offer.expiresAt,
        },
    }));

export type PreparedOfferTerms = z.infer<typeof preparedOfferTermsSchema>;

export type PrepareOfferResponse = z.infer<ReturnType<typeof prepareOfferResponseSchemaFor>>;

export type SubmitOfferResponse = z.infer<ReturnType<typeof submitOfferResponseSchemaFor>>;

export interface MakeCellOfferRequest {
    tokenId: string;
    amount: string;
    expirationTime: number;
}

export interface MakeCellOfferResult {
    status: MarketActionStatus;
    stage: MarketActionStage;
    wallet: string;
    tokenId: string;
    offer: MarketOffer;
    amount: string;
    currency: MarketCurrency;
    approvalTxHashes: Array<string>;
}

export interface OfferRecoveryPayload {
    prepared: PrepareOfferResponse | null;
    signature: string | null;
    approvalTxHashes: Array<string>;
}

export interface MarketOfferServiceOptions {
    client: IMarketSingleShotClient;
    profile: IMarketProfileReader;
    appConfig: IAppConfig;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketOfferService {
    makeCellOffer(request: MakeCellOfferRequest): Promise<MakeCellOfferResult>;
}
