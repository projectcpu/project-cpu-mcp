import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Hash, Hex } from 'viem';
import { mainnet } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { EvmWalletManager } from '../evm.manager.js';

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const TX_HASH = `0x${'c'.repeat(64)}` as Hash;
const SENDER = '0x2222222222222222222222222222222222222222';

interface RpcCall {
    method: string;
    params: Array<unknown>;
}

class FakeNode {
    readonly calls: Array<RpcCall> = [];
    transaction: Record<string, unknown> | null = {
        hash: TX_HASH,
        from: SENDER,
        to: '0x1111111111111111111111111111111111111111',
        value: '0x0',
        input: '0x',
        nonce: '0x1',
        gas: '0x5208',
        blockHash: `0x${'d'.repeat(64)}`,
        blockNumber: '0x1',
        transactionIndex: '0x0',
        type: '0x2',
        chainId: `0x${mainnet.id.toString(16)}`,
        maxFeePerGas: '0x3b9aca00',
        maxPriorityFeePerGas: '0x3b9aca00',
        r: `0x${'1'.repeat(64)}`,
        s: `0x${'2'.repeat(64)}`,
        v: '0x1b',
    };
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

    private answer(method: string): { result: unknown } | { error: { code: number; message: string } } {
        if (method === 'eth_getTransactionByHash') {
            return { result: this.transaction };
        }
        if (method === 'eth_chainId') {
            return { result: `0x${mainnet.id.toString(16)}` };
        }
        return { error: { code: -32601, message: 'method not found' } };
    }
}

describe('the wallet reading back who sent a mined transaction', () => {
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

    it('fetches the transaction by hash and answers with its sender', async () => {
        const manager = await createManager();

        const sender = await manager.getTransactionSender(TX_HASH);

        expect(sender?.toLowerCase()).toBe(SENDER);
        expect(node.calls.map((call) => call.method)).toContain('eth_getTransactionByHash');
        expect(node.calls.find((call) => call.method === 'eth_getTransactionByHash')?.params).toEqual([TX_HASH]);
    });

    it('surfaces a node that cannot find the transaction rather than inventing a sender', async () => {
        const manager = await createManager();
        node.transaction = null;

        await expect(manager.getTransactionSender(TX_HASH)).rejects.toThrow();
    });
});
