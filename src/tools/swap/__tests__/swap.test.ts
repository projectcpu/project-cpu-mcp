import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import { SwapDirection, SwapToken, type SwapResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType } from '../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerSwapTool } from '../swap.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: { sell: SwapToken; amount: string; slippage: number | null }) => Promise<ToolResult>;

function harness(outcome: SwapResult | Error): Handler {
    const swap = {
        swap: async (): Promise<SwapResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const context = { swap, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerSwapTool(server, context);
    if (captured === null) {
        throw new Error('swap was not registered');
    }
    return captured;
}

const result: SwapResult = {
    direction: SwapDirection.EthToCpu,
    sell: SwapToken.ETH,
    tokenIn: '0x0000000000000000000000000000000000000e',
    tokenOut: '0x0000000000000000000000000000000000000c',
    amountIn: '1',
    amountOutQuoted: '100',
    amountOutMinimum: '99',
    txHash: '0xswap',
    approveTxHash: null,
    permit2TxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

describe('swap tool', () => {
    it('reports the swap with the tx', async () => {
        const out = await harness(result)({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 });
        expect(out.content[0]?.text).toMatch(/Swapped 1 ETH/);
        expect(out.content[0]?.text).toMatch(/0xswap/);
    });

    it('names the event in the machine block', async () => {
        const out = await harness(result)({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 });
        const parsed = JSON.parse(out.content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.Swapped);
    });

    it('propagates service errors', async () => {
        await expect(
            harness(new Error('slippage exceeded'))({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 }),
        ).rejects.toThrow(/slippage exceeded/);
    });
});
