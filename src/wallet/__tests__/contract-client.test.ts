import { BaseError, RawContractError, type Abi, type Hash } from 'viem';
import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { ContractClient } from '../contract-client.js';
import {
    type ReadContractParams,
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../types.js';

const HASH = `0x${'a'.repeat(64)}` as Hash;

type FakeWalletParts = Partial<{
    readContract: (params: ReadContractParams) => Promise<unknown>;
    sendTransaction: (tx: TransactionRequest) => Promise<Hash>;
    waitForReceipt: (hash: Hash) => Promise<TxReceipt>;
}>;

function provider(parts: FakeWalletParts): WalletProvider {
    const wallet = parts as unknown as WalletManager;
    return { get: () => wallet, isReady: () => true };
}

function client(parts: FakeWalletParts): ContractClient {
    return new ContractClient({
        wallet: provider(parts),
        logger: new NoopLogger(),
        retry: { baseDelayMs: 0, maxDelayMs: 0 },
    });
}

describe('ContractClient', () => {
    it('reads through the wallet and retries a transient failure', async () => {
        let calls = 0;
        const c = client({
            readContract: async () => {
                calls += 1;
                if (calls < 2) {
                    throw new Error('fetch failed');
                }
                return 42n;
            },
        });
        const value = await c.read<bigint>({ address: HASH, abi: [], functionName: 'x', args: [] });
        expect(value).toBe(42n);
        expect(calls).toBe(2);
    });

    it('does not retry a read that reverts', async () => {
        let calls = 0;
        const c = client({
            readContract: async () => {
                calls += 1;
                const revert = new BaseError('reverted');
                revert.name = 'ContractFunctionExecutionError';
                throw revert;
            },
        });
        await expect(c.read({ address: HASH, abi: [], functionName: 'x', args: [] })).rejects.toThrow();
        expect(calls).toBe(1);
    });

    it('sends a transaction exactly once (no retry)', async () => {
        let calls = 0;
        const c = client({
            sendTransaction: async () => {
                calls += 1;
                return HASH;
            },
        });
        const hash = await c.send({ to: HASH, data: '0x', value: null, gas: null }, null);
        expect(hash).toBe(HASH);
        expect(calls).toBe(1);
    });

    it('decodes a custom-error revert on send via the provided ABI', async () => {
        const abi = [{ type: 'error', name: 'NotYetArrived', inputs: [] }] as const;
        const c = client({
            sendTransaction: async () => {
                throw new BaseError('estimate failed', {
                    cause: new RawContractError({ data: '0xd90f2071' }),
                });
            },
        });
        await expect(c.send({ to: HASH, data: '0x', value: null, gas: null }, abi as unknown as Abi)).rejects.toThrow(
            /Execution reverted: NotYetArrived\(\)/,
        );
    });

    it('decodes a revert whose data sits on a nested rpc error node', async () => {
        const abi = [{ type: 'error', name: 'NotYetArrived', inputs: [] }] as const;
        const rpcShaped = new Error('RPC Request failed.') as Error & { data: string };
        rpcShaped.data = '0xd90f2071';
        const c = client({
            sendTransaction: async () => {
                throw new BaseError('tx failed', { cause: new BaseError('reverted', { cause: rpcShaped }) });
            },
        });
        await expect(c.send({ to: HASH, data: '0x', value: null, gas: null }, abi as unknown as Abi)).rejects.toThrow(
            /Execution reverted: NotYetArrived\(\)/,
        );
    });

    it('rethrows the original error when the revert is not decodable', async () => {
        const abi = [{ type: 'error', name: 'NotYetArrived', inputs: [] }] as const;
        const c = client({
            sendTransaction: async () => {
                throw new BaseError('estimate failed', {
                    cause: new RawContractError({ data: '0xdeadbeef' }),
                });
            },
        });
        await expect(c.send({ to: HASH, data: '0x', value: null, gas: null }, abi as unknown as Abi)).rejects.toThrow(
            'estimate failed',
        );
    });

    it('rethrows unchanged when no error ABI is given', async () => {
        const c = client({
            sendTransaction: async () => {
                throw new BaseError('estimate failed', {
                    cause: new RawContractError({ data: '0xd90f2071' }),
                });
            },
        });
        await expect(c.send({ to: HASH, data: '0x', value: null, gas: null }, null)).rejects.toThrow('estimate failed');
    });

    it('confirms a successful receipt', async () => {
        const c = client({
            waitForReceipt: async (hash) => ({
                status: TxStatus.Success,
                transactionHash: hash,
                blockNumber: 100n,
                logs: [],
            }),
        });
        const confirmed = await c.confirm(HASH, 'Reveal request');
        expect(confirmed).toEqual({ txHash: HASH, status: TxStatus.Success, blockNumber: '100', logs: [] });
    });

    it('throws when the receipt reverted', async () => {
        const c = client({
            waitForReceipt: async (hash) => ({
                status: TxStatus.Reverted,
                transactionHash: hash,
                blockNumber: 7n,
                logs: [],
            }),
        });
        await expect(c.confirm(HASH, 'Reveal request')).rejects.toThrow(/Reveal request reverted/);
    });

    it('retries a transient receipt-wait failure', async () => {
        let calls = 0;
        const c = client({
            waitForReceipt: async (hash) => {
                calls += 1;
                if (calls < 2) {
                    throw new Error('timeout');
                }
                return { status: TxStatus.Success, transactionHash: hash, blockNumber: 5n, logs: [] };
            },
        });
        const confirmed = await c.confirm(HASH, 'Reveal request');
        expect(confirmed.blockNumber).toBe('5');
        expect(calls).toBe(2);
    });
});
