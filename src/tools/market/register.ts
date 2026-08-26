import { z } from 'zod';

import { createAcceptCellOfferTool } from './accept-offer/accept-offer.js';
import { createBuyCellTool } from './buy-cell/buy-cell.js';
import { createCancelOrderTool } from './cancel-order/cancel-order.js';
import { createGetCellMarketTool } from './cell-market/cell-market.js';
import { createListCellTool } from './list-cell/list-cell.js';
import { createMakeCellOfferTool } from './make-offer/make-offer.js';
import { createGetMyListingsTool } from './my-listings/my-listings.js';
import { createGetMyOffersTool } from './my-offers/my-offers.js';
import { createGetMyOffersReceivedTool } from './my-offers-received/my-offers-received.js';
import type { MarketToolDefinition } from './types.js';
import { runWithMarketWaitBudget } from '../../services/market/budget.scope.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

// The declared shape is applied to the arguments here rather than trusted to have been applied
// upstream: a nullable-with-default input that arrives absent must reach the service as null, and a
// marketplace service that receives `undefined` for it refuses a call that should have worked.
function bindMarketTool(server: ToolRegistrar, definition: MarketToolDefinition): void {
    const shape = z.object(definition.inputSchema);

    server.registerTool(
        definition.name,
        { description: definition.description, inputSchema: definition.inputSchema },
        async (args: unknown) => runWithMarketWaitBudget(async () => definition.handler(shape.parse(args ?? {}))),
    );
}

export function registerGetCellMarketTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createGetCellMarketTool(context));
}

export function registerGetMyListingsTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createGetMyListingsTool(context));
}

export function registerGetMyOffersTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createGetMyOffersTool(context));
}

export function registerGetMyOffersReceivedTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createGetMyOffersReceivedTool(context));
}

export function registerListCellTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createListCellTool(context));
}

export function registerMakeCellOfferTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createMakeCellOfferTool(context));
}

export function registerBuyCellTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createBuyCellTool(context));
}

export function registerAcceptCellOfferTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createAcceptCellOfferTool(context));
}

export function registerCancelOrderTool(server: ToolRegistrar, context: AppContext): void {
    bindMarketTool(server, createCancelOrderTool(context));
}
