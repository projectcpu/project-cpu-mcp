import { decodeFunctionData, type Address, type Hash, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { ERC20_ABI } from '../../contracts/erc20.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import {
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../../wallet/types.js';
import { MAX_APPROVE_AMOUNT } from '../allowance.constants.js';
import { AllowanceService } from '../allowance.service.js';

const TOKEN = '0x2222222222222222222222222222222222222222';
const SPENDER = '0x1111111111111111111111111111111111111111';

class FakeWallet implements WalletManager, WalletProvider {
    async getTransactionSender(): Promise<Address | null> {
        return this.getAddress();
    }
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<{ functionName: string; args: ReadonlyArray<unknown> }> = [];

    constructor(
        private readonly allowance: bigint,
        private readonly receipt: TxStatus = TxStatus.Success,
    ) {}

    get(): WalletManager {
        return this;
    }
    isReady(): boolean {
        return true;
    }
    getAddress(): Address {
        return '0x000000000000000000000000000000000000dEaD';
    }
    getChainId(): number {
        return 1;
    }
    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sent.push(tx);
        return `0x${'e'.repeat(64)}` as Hash;
    }
    async estimateGas(): Promise<bigint> {
        return 21000n;
    }
    async getGasPrice(): Promise<bigint> {
        return 1_000_000_000n;
    }
    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        return { status: this.receipt, transactionHash: hash, blockNumber: 1n, logs: [] };
    }
    async readContract(params: { functionName: string; args: ReadonlyArray<unknown> }): Promise<unknown> {
        this.reads.push({ functionName: params.functionName, args: params.args });
        return this.allowance;
    }
    async getBalance(): Promise<bigint> {
        return 0n;
    }
    async signMessage(): Promise<Hex> {
        return '0x';
    }
    async signTypedData(): Promise<Hex> {
        return '0x';
    }
}

function makeService(wallet: FakeWallet): AllowanceService {
    return new AllowanceService({ wallet: wallet as unknown as WalletProvider, logger: new NoopLogger() });
}

describe('AllowanceService', () => {
    it('skips the approve when the allowance already covers the amount', async () => {
        const wallet = new FakeWallet(MAX_APPROVE_AMOUNT);

        const hash = await makeService(wallet).ensureAllowance(TOKEN, SPENDER, 1000n);

        expect(hash).toBeNull();
        expect(wallet.sent).toHaveLength(0);
        expect(wallet.reads[0]?.functionName).toBe('allowance');
    });

    it('approves the max amount once when the allowance is short', async () => {
        const wallet = new FakeWallet(0n);

        const hash = await makeService(wallet).ensureAllowance(TOKEN, SPENDER, 1000n);

        expect(hash).not.toBeNull();
        expect(wallet.sent).toHaveLength(1);
        const sent = wallet.sent[0];
        if (sent === undefined) {
            throw new Error('expected one tx');
        }
        expect(sent.to).toBe(TOKEN);
        const decoded = decodeFunctionData({ abi: ERC20_ABI, data: sent.data });
        expect(decoded.functionName).toBe('approve');
        expect(decoded.args).toEqual([SPENDER, MAX_APPROVE_AMOUNT]);
    });

    it('throws when the approve reverts on-chain', async () => {
        const wallet = new FakeWallet(0n, TxStatus.Reverted);
        await expect(makeService(wallet).ensureAllowance(TOKEN, SPENDER, 1000n)).rejects.toThrow(/reverted/i);
    });
});
