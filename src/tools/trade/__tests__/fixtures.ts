import type { ZodRawShape } from 'zod';

import {
    type FillView,
    type LotView,
    type MarketIndex,
    type MarketResourceSummary,
    BuildingType,
    LotState,
} from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeCell, projectCell } from '../../../map/__tests__/fixtures.js';
import type { Cell } from '../../../map/types.js';
import type { BuyLotResult, CreateLotResult, SetSaleFeeResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';

export interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

export type Register = (server: ToolRegistrar, context: AppContext) => void;

export const RESOURCES = { 3: 'Silica' };

export interface CapturedTool {
    name: string;
    handler: (args: never) => Promise<ToolResult>;
    description: string;
    inputSchema: ZodRawShape;
}

export function captureTool(register: Register, contextPartial: Record<string, unknown>): CapturedTool {
    const appConfig = { load: async () => ({ resources: RESOURCES }) };
    const context = { appConfig, logger: new NoopLogger(), ...contextPartial } as unknown as AppContext;
    let captured: CapturedTool | null = null;
    const server = {
        registerTool(
            name: string,
            def: { description: string; inputSchema: ZodRawShape },
            handler: (args: never) => Promise<ToolResult>,
        ): void {
            captured = { name, handler, description: def.description, inputSchema: def.inputSchema };
        },
    } as unknown as ToolRegistrar;
    register(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

export function capture(
    register: Register,
    contextPartial: Record<string, unknown>,
): (args: never) => Promise<ToolResult> {
    return captureTool(register, contextPartial).handler;
}

export const createResult: CreateLotResult = {
    lotId: '7',
    hubTokenId: '20',
    resourceId: 3,
    value: '100',
    pricePerUnit: '0.5',
    maxSaleFeePercent: 2.5,
    deliveryId: '123',
    arrivalAt: 1704,
    fee: '0',
    transitPaid: '0',
    transitDiscount: '0',
    txHash: '0xcreate',
    approveTxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

export const buyResult: BuyLotResult = {
    lotId: '7',
    resourceId: 3,
    value: '10',
    sale: '5',
    discount: '0.2',
    paid: '4.8',
    hubFee: '0.125',
    tax: '0.03',
    ownerNet: '0.095',
    burn: '0.05',
    remaining: '90',
    fee: '0',
    transitPaid: '0.5',
    transitDiscount: '0.1',
    deliveryId: '123',
    arrivalAt: 1704,
    txHash: '0xbuy',
    approveSaleTxHash: '0xapprove',
    approveTransitTxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

export const setFeeResult: SetSaleFeeResult = {
    hubTokenId: '20',
    resourceId: 3,
    feePercent: 2.5,
    txHash: '0xsetfee',
    status: TxStatus.Success,
    blockNumber: '100',
};

export const lot: LotView = {
    id: 'lot-1',
    hubTokenId: '5',
    sellerAddress: '0xseller',
    resourceId: 3,
    listed: '100',
    remaining: '80',
    pricePerUnit: '0.5',
    saleFeePercent: 1.5,
    maxSaleFeePercent: 50,
    frozen: false,
    state: LotState.Open,
    distanceFromAnchor: 3,
    createdAt: 1700,
    updated: 1700,
};

export const frozenLot: LotView = { ...lot, id: 'lot-frozen', saleFeePercent: 6, maxSaleFeePercent: 5, frozen: true };

export const evictedLot: LotView = { ...lot, id: 'lot-evicted', state: LotState.Evicted, frozen: false };

export const market: MarketResourceSummary = {
    hubTokenId: '5',
    resourceId: 3,
    openLots: 2,
    openRemaining: '150',
    minPricePerUnit: '0.4',
    incomingLots: 1,
    incomingRemaining: '50',
    frozenLots: 0,
    frozenRemaining: '0',
    distanceFromAnchor: 3,
};

export const fill: FillView = {
    lotId: '7',
    blockNumber: 1200,
    logIndex: 4,
    transactionHash: '0xfill',
    hubTokenId: '20',
    resourceId: 3,
    seller: '0xseller',
    buyer: '0xbuyer',
    value: '10',
    remaining: '90',
    sale: '0.4',
    hubFee: '0.01',
    burn: '0.002',
    pricePerUnit: '0.04',
    settledAt: 1700000000,
    soldOut: false,
};

export const marketIndex: MarketIndex = {
    computedAt: 1700000000,
    resources: [
        { resourceId: 3, priceCpu: '0.5', changePct: 3.2, volume: '120', spark: ['0.77', '0.88'] },
        { resourceId: 6, priceCpu: null, changePct: null, volume: null, spark: [null, null] },
    ],
};

export function hubCell(
    saleFeeOverrides: Record<number, number> | null,
    building: Cell['building'] | null = {
        type: BuildingType.Hub,
        buildFinishAt: 0,
        modeResource: null,
        modeRecipeId: null,
    },
): Cell {
    return projectCell(makeCell({ tokenId: '5', building, saleFeeOverrides }));
}
