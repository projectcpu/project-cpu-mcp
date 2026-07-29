import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createPublicClient, http, parseTransaction, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { abstractTestnet, mainnet } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { AgwWalletManager } from '../agw.manager.js';
import { EvmWalletManager } from '../evm.manager.js';

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const SIGNER_ADDRESS = privateKeyToAccount(TEST_KEY).address;
const AGW_ACCOUNT = '0x000000000000000000000000000000000000dEaD' as Address;
const TARGET = '0x1111111111111111111111111111111111111111' as Address;
const DATA = '0xdeadbeef' as Hex;
const ESTIMATE = 31337n;
const GAS_PRICE = 7_000_000_000n;
const TX_HASH = `0x${'c'.repeat(64)}` as Hex;
const UNSUPPORTED = Symbol('unsupported rpc method');

interface RpcCall {
    method: string;
    params: Array<unknown>;
}

class FakeNode {
    public readonly calls: Array<RpcCall> = [];
    private server: Server | null = null;

    async start(chainId: number): Promise<string> {
        const node = createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += String(chunk);
            });
            req.on('end', () => {
                const request = JSON.parse(body) as RpcCall & { id: number };
                this.calls.push({ method: request.method, params: request.params });
                const result = this.result(request.method, chainId);
                const body_ =
                    result === UNSUPPORTED
                        ? { id: request.id, jsonrpc: '2.0', error: { code: -32601, message: 'method not found' } }
                        : { id: request.id, jsonrpc: '2.0', result };
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body_));
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

    methods(): Array<string> {
        return this.calls.map((call) => call.method);
    }

    rawTransaction(): Hex {
        const sent = this.calls.find((call) => call.method === 'eth_sendRawTransaction');
        return sent?.params[0] as Hex;
    }

    private result(method: string, chainId: number): unknown {
        switch (method) {
            case 'eth_estimateGas':
                return `0x${ESTIMATE.toString(16)}`;
            case 'eth_gasPrice':
                return `0x${GAS_PRICE.toString(16)}`;
            case 'eth_chainId':
                return `0x${chainId.toString(16)}`;
            case 'eth_getTransactionCount':
                return '0x1';
            case 'eth_maxPriorityFeePerGas':
                return '0x3b9aca00';
            case 'eth_getBlockByNumber':
                return { number: '0x1', baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', timestamp: '0x1' };
            case 'eth_sendRawTransaction':
                return TX_HASH;
            default:
                return UNSUPPORTED;
        }
    }
}

const AGW_SESSION = {
    accountAddress: AGW_ACCOUNT,
    sessionHash: `0x${'b'.repeat(64)}`,
    policies: {
        signer: SIGNER_ADDRESS,
        expiresAt: 0n,
        feeLimit: { limitType: 0, limit: 0n, period: 0n },
        callPolicies: [],
        transferPolicies: [],
    },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

describe('wallet gas limit and estimation', () => {
    let node: FakeNode;

    beforeEach(() => {
        node = new FakeNode();
    });

    afterEach(async () => {
        await node.stop();
    });

    it('EvmWalletManager estimates with a single unsigned node call carrying only public fields', async () => {
        const rpcUrl = await node.start(mainnet.id);
        const manager = new EvmWalletManager({
            privateKey: TEST_KEY,
            chainId: mainnet.id,
            rpcUrl,
            logger: new NoopLogger(),
        });

        const estimate = await manager.estimateGas({ to: TARGET, data: DATA, value: 5n });

        expect(estimate).toBe(ESTIMATE);
        expect(node.calls).toEqual([
            { method: 'eth_estimateGas', params: [{ from: SIGNER_ADDRESS, to: TARGET, data: DATA, value: '0x5' }] },
        ]);
    });

    it('EvmWalletManager estimates with the exact traffic a keyless public client produces', async () => {
        const rpcUrl = await node.start(mainnet.id);
        const manager = new EvmWalletManager({
            privateKey: TEST_KEY,
            chainId: mainnet.id,
            rpcUrl,
            logger: new NoopLogger(),
        });

        await manager.estimateGas({ to: TARGET, data: DATA, value: null });
        const managerCalls = [...node.calls];
        node.calls.length = 0;

        const keyless = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
        await keyless.estimateGas({ account: SIGNER_ADDRESS, to: TARGET, data: DATA });

        expect(node.calls).toEqual(managerCalls);
    });

    it('EvmWalletManager signs the explicit gas limit into the transaction and skips the node estimate', async () => {
        const rpcUrl = await node.start(mainnet.id);
        const manager = new EvmWalletManager({
            privateKey: TEST_KEY,
            chainId: mainnet.id,
            rpcUrl,
            logger: new NoopLogger(),
        });

        const hash = await manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: 123456n });

        expect(hash).toBe(TX_HASH);
        expect(parseTransaction(node.rawTransaction()).gas).toBe(123456n);
        expect(node.methods()).not.toContain('eth_estimateGas');
    });

    it('EvmWalletManager leaves the gas limit to the node when the request carries none', async () => {
        const rpcUrl = await node.start(mainnet.id);
        const manager = new EvmWalletManager({
            privateKey: TEST_KEY,
            chainId: mainnet.id,
            rpcUrl,
            logger: new NoopLogger(),
        });

        await manager.sendTransaction({ to: TARGET, data: DATA, value: null, gas: null });

        expect(node.methods()).toContain('eth_estimateGas');
        expect(parseTransaction(node.rawTransaction()).gas).toBe(ESTIMATE);
    });

    it('EvmWalletManager reads the gas price with a single unsigned node call', async () => {
        const rpcUrl = await node.start(mainnet.id);
        const manager = new EvmWalletManager({
            privateKey: TEST_KEY,
            chainId: mainnet.id,
            rpcUrl,
            logger: new NoopLogger(),
        });

        const gasPrice = await manager.getGasPrice();

        expect(gasPrice).toBe(GAS_PRICE);
        expect(node.methods()).toEqual(['eth_gasPrice']);
    });

    it('EvmWalletManager reads the gas price with the exact traffic a keyless public client produces', async () => {
        const rpcUrl = await node.start(mainnet.id);
        const manager = new EvmWalletManager({
            privateKey: TEST_KEY,
            chainId: mainnet.id,
            rpcUrl,
            logger: new NoopLogger(),
        });

        await manager.getGasPrice();
        const managerCalls = [...node.calls];
        node.calls.length = 0;

        const keyless = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
        await keyless.getGasPrice();

        expect(node.calls).toEqual(managerCalls);
    });

    it('AgwWalletManager reads the gas price without the session signer key', async () => {
        const rpcUrl = await node.start(abstractTestnet.id);
        const manager = new AgwWalletManager({
            sessionPrivateKey: TEST_KEY,
            sessionConfig: AGW_SESSION,
            rpcUrl,
            logger: new NoopLogger(),
        });

        const gasPrice = await manager.getGasPrice();

        expect(gasPrice).toBe(GAS_PRICE);
        expect(node.methods()).toEqual(['eth_gasPrice']);
    });

    it('AgwWalletManager estimates for the account address without the session signer key', async () => {
        const rpcUrl = await node.start(abstractTestnet.id);
        const manager = new AgwWalletManager({
            sessionPrivateKey: TEST_KEY,
            sessionConfig: AGW_SESSION,
            rpcUrl,
            logger: new NoopLogger(),
        });

        const estimate = await manager.estimateGas({ to: TARGET, data: DATA, value: null });

        expect(estimate).toBe(ESTIMATE);
        expect(node.calls).toEqual([
            { method: 'eth_estimateGas', params: [{ from: AGW_ACCOUNT, to: TARGET, data: DATA }] },
        ]);
    });
});
