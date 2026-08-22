import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { DeliveryView, FinalizeResult, TransportQuote, TransportResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType } from '../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerFinalizeDeliveryTool } from '../finalize/finalize-delivery.js';
import { registerGetTransportStatusTool } from '../get-status/get-transport-status.js';
import { registerListMyTransportsTool } from '../list-mine/list-my-transports.js';
import { registerQuoteTransportTool } from '../quote/quote-transport.js';
import { registerTransportTool } from '../transport.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Register = (server: ToolRegistrar, context: AppContext) => void;

const RESOURCES = { 3: 'Silica' };

function capture(register: Register, transport: unknown): (args: never) => Promise<ToolResult> {
    const appConfig = { load: async () => ({ resources: RESOURCES }) };
    const context = { transport, appConfig, logger: new NoopLogger() } as unknown as AppContext;
    let captured: ((args: never) => Promise<ToolResult>) | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: (args: never) => Promise<ToolResult>): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    register(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

const freeResult: TransportResult = {
    deliveryId: '123',
    sourceTokenId: '10',
    targetTokenId: '20',
    resourceId: 3,
    amount: '100',
    fee: '0',
    transitPaid: '0',
    transitDiscount: '0',
    arrivalAt: 1704,
    txHash: '0xmove',
    approveTxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

const paidResult: TransportResult = {
    deliveryId: '77',
    sourceTokenId: '10',
    targetTokenId: '20',
    resourceId: 3,
    amount: '100',
    fee: '10',
    transitPaid: '8',
    transitDiscount: '2',
    arrivalAt: 1704,
    txHash: '0xmove',
    approveTxHash: '0xapprove',
    status: TxStatus.Success,
    blockNumber: '100',
};

const deliveryView: DeliveryView = {
    deliveryId: '55',
    payer: '0x000000000000000000000000000000000000dEaD',
    sourceTokenId: '10',
    targetTokenId: '20',
    resourceId: 3,
    amount: '100',
    arrivalAt: 1704,
    delivered: false,
    readyToFinalize: false,
};

describe('transport tool', () => {
    it('reports an own-cell move with no $CPU fee', async () => {
        const handler = capture(registerTransportTool, { transport: async () => freeResult });
        const result = await handler({ path: [], resourceId: 3, amount: '100' } as never);
        expect(result.content[0]?.text).toMatch(/Transport delivery 123/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/no transit fee/);
        expect(result.content[0]?.text).toMatch(/finalize_delivery 123/);
    });

    it('reports a paid move with the approve and move tx', async () => {
        const handler = capture(registerTransportTool, { transport: async () => paidResult });
        const result = await handler({ path: [], resourceId: 3, amount: '100' } as never);
        expect(result.content[0]?.text).toMatch(/Transport delivery 77/);
        expect(result.content[0]?.text).toMatch(/transit fee 8 \$CPU \(saved 2 \$CPU via syndicate\)/);
        expect(result.content[0]?.text).toMatch(/approve tx 0xapprove/);
        expect(result.content[0]?.text).toMatch(/move tx 0xmove/);
    });

    it('propagates service errors', async () => {
        const handler = capture(registerTransportTool, {
            transport: async () => {
                throw new Error('not authenticated');
            },
        });
        await expect(handler({ path: [], resourceId: 3, amount: '100' } as never)).rejects.toThrow(/not authenticated/);
    });

    it('names the event in the machine block', async () => {
        const handler = capture(registerTransportTool, { transport: async () => freeResult });
        const result = await handler({ path: [], resourceId: 3, amount: '100' } as never);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.TransportSent);
    });
});

describe('quote_transport tool', () => {
    it('summarizes a paid quote with the member saving', async () => {
        const quote: TransportQuote = { fee: '10', discount: '2.5', totalDistance: 4, arrivalAt: 1704 };
        const handler = capture(registerQuoteTransportTool, { quote: async () => quote });
        const result = await handler({ path: [], resourceId: 3, amount: '100' } as never);
        expect(result.content[0]?.text).toMatch(/10 \$CPU to pay/);
        expect(result.content[0]?.text).toMatch(/member saving 2\.5 \$CPU already applied/);
        expect(result.content[0]?.text).toMatch(/4 hops/);
        expect(result.content[1]?.text).toContain('"discount":"2.5"');
    });

    it('omits the saving when there is no discount', async () => {
        const quote: TransportQuote = { fee: '10', discount: '0', totalDistance: 4, arrivalAt: 1704 };
        const handler = capture(registerQuoteTransportTool, { quote: async () => quote });
        const result = await handler({ path: [], resourceId: 3, amount: '100' } as never);
        expect(result.content[0]?.text).toMatch(/10 \$CPU to pay/);
        expect(result.content[0]?.text).not.toMatch(/member saving/);
    });

    it('summarizes a free quote', async () => {
        const quote: TransportQuote = { fee: '0', discount: '0', totalDistance: 2, arrivalAt: 1704 };
        const handler = capture(registerQuoteTransportTool, { quote: async () => quote });
        const result = await handler({ path: [], resourceId: 3, amount: '100' } as never);
        expect(result.content[0]?.text).toMatch(/free \(no transit fee\)/);
    });
});

describe('get_transport_status tool', () => {
    it('reports a delivery', async () => {
        const handler = capture(registerGetTransportStatusTool, { getStatus: async () => deliveryView });
        const result = await handler({ deliveryId: '55' } as never);
        expect(result.content[0]?.text).toMatch(/Delivery 55: in transit/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/10→20/);
    });
});

describe('list_my_transports tool', () => {
    it('lists the caller deliveries', async () => {
        const handler = capture(registerListMyTransportsTool, { listMine: async () => [deliveryView] });
        const result = await handler({ filter: 'all' } as never);
        expect(result.content[0]?.text).toMatch(/1 delivery\(ies\) · filter=all/);
        expect(result.content[0]?.text).toMatch(/Delivery 55: in transit/);
    });
});

describe('finalize_delivery tool', () => {
    it('reports the finalized deliveries', async () => {
        const result: FinalizeResult = {
            deliveryIds: ['55'],
            txHash: '0xfin',
            status: TxStatus.Success,
            blockNumber: '100',
        };
        const handler = capture(registerFinalizeDeliveryTool, { finalize: async () => result });
        const out = await handler({ ids: ['55'] } as never);
        expect(out.content[0]?.text).toMatch(/Finalized 1 delivery/);
        expect(out.content[0]?.text).toMatch(/0xfin/);
    });

    it('names the event in the machine block', async () => {
        const result: FinalizeResult = {
            deliveryIds: ['55'],
            txHash: '0xfin',
            status: TxStatus.Success,
            blockNumber: '100',
        };
        const handler = capture(registerFinalizeDeliveryTool, { finalize: async () => result });
        const out = await handler({ ids: ['55'] } as never);
        const parsed = JSON.parse(out.content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.DeliveryFinalized);
    });
});
