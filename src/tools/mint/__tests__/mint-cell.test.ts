import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { MintResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType } from '../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerMintCellTool } from '../mint-cell.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: { quantity: string }) => Promise<ToolResult>;

function harness(outcome: MintResult | Error): Handler {
    const mint = {
        mint: async (): Promise<MintResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const context = { mint, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerMintCellTool(server, context);
    if (captured === null) {
        throw new Error('mint_cell was not registered');
    }
    return captured;
}

const result: MintResult = {
    land: '0x00000000000000000000000000000000000001',
    quantity: 1,
    total: '0.01',
    txHash: '0xmint',
    status: TxStatus.Success,
    blockNumber: '100',
};

describe('mint_cell tool', () => {
    it('reports the mint with the tx and total paid', async () => {
        const out = await harness(result)({ quantity: '1' });
        expect(out.content[0]?.text).toMatch(/Minted 1 land cell/);
        expect(out.content[0]?.text).toMatch(/0xmint/);
    });

    it('names the event in the machine block', async () => {
        const out = await harness(result)({ quantity: '1' });
        const parsed = JSON.parse(out.content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.CellMinted);
    });

    it('propagates service errors', async () => {
        await expect(harness(new Error('mint sold out'))({ quantity: '1' })).rejects.toThrow(/mint sold out/);
    });
});
