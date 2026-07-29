import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { WithdrawResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerWithdrawTool } from '../withdraw.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: { tokenId: string; amount: string }) => Promise<ToolResult>;

function harness(outcome: WithdrawResult | Error): Handler {
    const withdraw = {
        withdraw: async (): Promise<WithdrawResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const context = { withdraw, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerWithdrawTool(server, context);
    if (captured === null) {
        throw new Error('withdraw was not registered');
    }
    return captured;
}

const result: WithdrawResult = {
    tokenId: '42',
    requested: '100',
    executed: '100',
    partial: false,
    txHash: '0xwithdraw',
    status: TxStatus.Success,
    blockNumber: '100',
};

describe('withdraw tool', () => {
    it('reports the withdraw with the minted $CPU amount', async () => {
        const out = await harness(result)({ tokenId: '42', amount: '100' });
        expect(out.content[0]?.text).toMatch(/Withdrew from cell 42/);
        expect(out.content[0]?.text).toMatch(/minted 100 \$CPU/);
        expect(out.content[0]?.text).toMatch(/0xwithdraw/);
        const parsed = JSON.parse(out.content[1]?.text ?? '{}') as WithdrawResult;
        expect(parsed.executed).toBe('100');
        expect(parsed.partial).toBe(false);
    });

    it('reports a partial tranche and names the emission budget', async () => {
        const partial: WithdrawResult = { ...result, requested: '100', executed: '40', partial: true };
        const out = await harness(partial)({ tokenId: '42', amount: '100' });
        expect(out.content[0]?.text).toMatch(/requested 100/);
        expect(out.content[0]?.text).toMatch(/emission budget/i);
        expect(out.content[0]?.text).toMatch(/minted 40 \$CPU/);
        expect(out.content[0]?.text).toMatch(/60 wCPU stays/);
    });

    it('propagates service errors', async () => {
        await expect(harness(new Error('not authenticated'))({ tokenId: '42', amount: '100' })).rejects.toThrow(
            /not authenticated/,
        );
    });
});
