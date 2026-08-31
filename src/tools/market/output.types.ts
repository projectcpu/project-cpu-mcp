import { z } from 'zod';

import {
    baseUnitAmountSchema,
    cellMarketSnapshotSchema,
    cellTokenIdSchema,
    evmAddressSchema,
    marketCurrencySchema,
    marketListingSchema,
    marketOfferSchema,
    marketPageSchema,
    MarketActionStage,
    MarketActionStatus,
    MarketOrderKind,
    orderHashSchema,
    transactionHashSchema,
} from '../../services/market/types.js';
import { ToolEventType } from '../types.js';

const actionEnvelopeSchema = z.object({
    status: z.nativeEnum(MarketActionStatus),
    stage: z.nativeEnum(MarketActionStage),
    wallet: evmAddressSchema,
});

const approvalHashesSchema = z.array(transactionHashSchema);

export const getCellMarketOutputSchema = cellMarketSnapshotSchema.strict();

export const getMyListingsOutputSchema = marketPageSchema(marketListingSchema).strict();

export const getMyOffersOutputSchema = marketPageSchema(marketOfferSchema).strict();

export const listCellOutputSchema = actionEnvelopeSchema
    .extend({
        tokenId: cellTokenIdSchema,
        listing: marketListingSchema,
        grossPrice: baseUnitAmountSchema,
        currency: marketCurrencySchema,
        platformFee: baseUnitAmountSchema,
        creatorFee: baseUnitAmountSchema,
        estimatedProceeds: baseUnitAmountSchema,
        approvalTxHashes: approvalHashesSchema,
        eventType: z.literal(ToolEventType.CellListed),
    })
    .strict();

export const makeCellOfferOutputSchema = actionEnvelopeSchema
    .extend({
        tokenId: cellTokenIdSchema,
        offer: marketOfferSchema,
        amount: baseUnitAmountSchema,
        currency: marketCurrencySchema,
        approvalTxHashes: approvalHashesSchema,
        eventType: z.literal(ToolEventType.CellOfferMade),
    })
    .strict();

export const buyCellOutputSchema = actionEnvelopeSchema
    .extend({
        tokenId: cellTokenIdSchema,
        orderHash: orderHashSchema,
        seller: evmAddressSchema,
        price: baseUnitAmountSchema,
        currency: marketCurrencySchema,
        maxAmount: baseUnitAmountSchema,
        approvalTxHashes: approvalHashesSchema,
        fulfilmentTxHash: transactionHashSchema,
        txHashes: z.array(transactionHashSchema),
        eventType: z.literal(ToolEventType.CellBought),
    })
    .strict();

export const acceptCellOfferOutputSchema = actionEnvelopeSchema
    .extend({
        tokenId: cellTokenIdSchema,
        orderHash: orderHashSchema,
        offer: marketOfferSchema,
        buyer: evmAddressSchema,
        amount: baseUnitAmountSchema,
        currency: marketCurrencySchema,
        approvalTxHashes: approvalHashesSchema,
        fulfilmentTxHash: transactionHashSchema,
        txHashes: z.array(transactionHashSchema),
        eventType: z.literal(ToolEventType.CellOfferAccepted),
    })
    .strict();

export const cancelOrderOutputSchema = actionEnvelopeSchema
    .extend({
        orderHash: orderHashSchema,
        orderKind: z.nativeEnum(MarketOrderKind),
        tokenId: cellTokenIdSchema.nullable(),
        cancellationTxHash: transactionHashSchema,
        txHashes: z.array(transactionHashSchema),
        eventType: z.literal(ToolEventType.MarketOrderCancelled),
    })
    .strict();
