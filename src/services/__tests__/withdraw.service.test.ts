import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    type Address,
    type Hex,
    type Log,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { CELL_ABI } from '../../contracts/cell.abi.js';
import { makeCell } from '../../map/__tests__/fixtures.js';
import { describeRevert } from '../../wallet/revert.utils.js';
import { TxStatus } from '../../wallet/types.js';
import { WithdrawService } from '../withdraw.service.js';
import { CELL, makeCellHarness, makeConfig, WALLET_ADDRESS } from './service-fakes.js';

const WEI_PER_UNIT = 10n ** 18n;

const LOG_META = {
    blockHash: `0x${'0'.repeat(64)}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: `0x${'0'.repeat(64)}`,
    transactionIndex: 0,
    removed: false,
} as const;

function withdrawnLog(units: bigint): Log {
    const topics = encodeEventTopics({
        abi: CELL_ABI,
        eventName: 'CpuWithdrawn',
        args: { tokenId: 42n, to: WALLET_ADDRESS },
    });
    const data = encodeAbiParameters([{ type: 'uint64' }, { type: 'uint256' }], [units, units * WEI_PER_UNIT]);
    return { address: CELL as Address, topics, data, ...LOG_META } as unknown as Log;
}

function makeService(opts: Parameters<typeof makeCellHarness>[1] = {}) {
    return makeCellHarness((deps) => new WithdrawService(deps), opts);
}

describe('WithdrawService', () => {
    it('sends the wei-denominated amount and reports the executed tranche from the event', async () => {
        const { service, contracts } = makeService({
            cell: makeCell({ tokenId: '42', owner: WALLET_ADDRESS }),
            logs: [[withdrawnLog(100n)]],
        });

        const result = await service.withdraw({ tokenId: '42', amount: '100' });

        expect(contracts.sent).toHaveLength(1);
        const sent = contracts.sent[0];
        if (sent === undefined) {
            throw new Error('expected one tx');
        }
        expect(sent.to).toBe(CELL);
        expect(sent.value).toBeNull(); // a mint spends no ETH

        const decoded = decodeFunctionData({ abi: CELL_ABI, data: sent.data as Hex });
        expect(decoded.functionName).toBe('withdrawCpu');
        expect(decoded.args).toEqual([42n, 100n * WEI_PER_UNIT]);

        expect(result.tokenId).toBe('42');
        expect(result.requested).toBe('100');
        expect(result.executed).toBe('100');
        expect(result.partial).toBe(false);
        expect(result.status).toBe(TxStatus.Success);
        expect(result.blockNumber).toBe('100');
    });

    it('reports a partial tranche when the event debits less than requested', async () => {
        const { service } = makeService({
            cell: makeCell({ tokenId: '42', owner: WALLET_ADDRESS }),
            logs: [[withdrawnLog(40n)]],
        });

        const result = await service.withdraw({ tokenId: '42', amount: '100' });

        expect(result.requested).toBe('100');
        expect(result.executed).toBe('40');
        expect(result.partial).toBe(true);
    });

    it('falls back to the requested amount when no withdraw event is present', async () => {
        const { service } = makeService({ cell: makeCell({ tokenId: '42', owner: WALLET_ADDRESS }) });

        const result = await service.withdraw({ tokenId: '42', amount: '100' });

        expect(result.requested).toBe('100');
        expect(result.executed).toBe('100');
        expect(result.partial).toBe(false);
    });

    it('withdraws when the map has no cached cell (ownership left to the contract)', async () => {
        const { service, contracts } = makeService();
        await service.withdraw({ tokenId: '42', amount: '100' });
        expect(contracts.sent).toHaveLength(1);
    });

    it('rejects a withdraw from a cell owned by someone else', async () => {
        const { service, contracts } = makeService({ cell: makeCell({ tokenId: '42', owner: '0xother' }) });
        await expect(service.withdraw({ tokenId: '42', amount: '100' })).rejects.toThrow(/do not own/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses when the Cell contract is not configured', async () => {
        const config = makeConfig();
        config.contracts.cell = '';
        const { service, contracts } = makeService({ config });
        await expect(service.withdraw({ tokenId: '42', amount: '100' })).rejects.toThrow(/not configured/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('wraps an on-chain revert', async () => {
        const { service } = makeService({ receipts: [TxStatus.Reverted] });
        await expect(service.withdraw({ tokenId: '42', amount: '100' })).rejects.toThrow(
            /withdraw transaction reverted/i,
        );
    });

    it('refuses when the wallet chainId does not match the chain config', async () => {
        const { service, contracts } = makeService({ walletChainId: 8453 });
        await expect(service.withdraw({ tokenId: '42', amount: '100' })).rejects.toThrow(/chain mismatch/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('decodes the new withdraw revert reasons through describeRevert', () => {
        for (const errorName of ['MintClosed', 'AmountNotWholeUnit'] as const) {
            const data = encodeErrorResult({ abi: CELL_ABI, errorName });
            expect(describeRevert({ data }, CELL_ABI)).toBe(`${errorName}()`);
        }
    });
});
