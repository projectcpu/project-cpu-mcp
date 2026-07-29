import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { parseTransaction, type Address, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { EvmWalletManager } from '../evm.manager.js';

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const TARGET = '0x1111111111111111111111111111111111111111' as Address;
const DATA = '0xdeadbeef' as Hex;
const TX_HASH = `0x${'c'.repeat(64)}` as Hex;
const PENDING_COUNT = 4n;

interface RpcCall {
    method: string;
    params: Array<unknown>;
}

class FakeNode {
    public readonly calls: Array<RpcCall> = [];
    public rejectSends = 0;
    private server: Server | null = null;

    async start(): Promise<string> {
        const node = createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += String(chunk);
            });
            req.on('end', () => {
                const request = JSON.parse(body) as RpcCall & { id: number };
                this.calls.push({ method: request.method, params: request.params });
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ id: request.id, jsonrpc: '2.0', ...this.answer(request.method) }));
            });
        });
        this.server = node;
        await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
    }

    async stop(): Promise<void> {
        const node = this.server;
        this.server = null;
        if (node === null) {
            return;
        }
        await new Promise<void>((resolve) => node.close(() => resolve()));
    }

    sentNonces(): Array<number> {
        return this.calls
            .filter((call) => call.method === 'eth_sendRawTransaction')
            .map((call) => parseTransaction(call.params[0] as Hex).nonce ?? -1);
    }

    private answer(method: string): { result: unknown } | { error: { code: number; message: string } } {
        switch (method) {
            case 'eth_estimateGas':
                return { result: '0x7a12' };
            case 'eth_gasPrice':
                return { result: '0x1a13b8600' };
            case 'eth_chainId':
                return { result: `0x${mainnet.id.toString(16)}` };
            case 'eth_getTransactionCount':
                return { result: `0x${PENDING_COUNT.toString(16)}` };
            case 'eth_maxPriorityFeePerGas':
                return { result: '0x3b9aca00' };
            case 'eth_getBlockByNumber':
                return {
                    result: { number: '0x1', baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', timestamp: '0x1' },
                };
            case 'eth_sendRawTransaction':
                if (this.rejectSends > 0) {
                    this.rejectSends -= 1;
                    return { error: { code: -32000, message: 'transaction underpriced' } };
                }
                return { result: TX_HASH };
            default:
                return { error: { code: -32601, message: 'method not found' } };
        }
    }
}

describe('EvmWalletManager transaction nonces', () => {
    let node: FakeNode;

    beforeEach(() => {
        node = new FakeNode();
    });

    afterEach(async () => {
        await node.stop();
    });

    async function createManager(): Promise<EvmWalletManager> {
        const rpcUrl = await node.start();
        return new EvmWalletManager({ privateKey: TEST_KEY, chainId: mainnet.id, rpcUrl, logger: new NoopLogger() });
    }

    it('signs the nonce the node reports for the account', async () => {
        const manager = await createManager();

        await manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: 100_000n });

        expect(node.sentNonces()).toEqual([Number(PENDING_COUNT)]);
    });

    it('hands out distinct nonces to calls that overlap, so they cannot collide', async () => {
        const manager = await createManager();

        await Promise.all([
            manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: 100_000n }),
            manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: 100_000n }),
        ]);

        expect(node.sentNonces().sort()).toEqual([Number(PENDING_COUNT), Number(PENDING_COUNT) + 1]);
    });

    it('leaves no gap behind a send the node refused', async () => {
        const manager = await createManager();
        node.rejectSends = 1;

        await expect(manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: 100_000n })).rejects.toThrow();
        await manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: 100_000n });

        expect(node.sentNonces()).toEqual([Number(PENDING_COUNT), Number(PENDING_COUNT)]);
    });
});
