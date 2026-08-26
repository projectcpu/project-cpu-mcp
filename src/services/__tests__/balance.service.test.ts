import type { Address, Hash, Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { CPU_TOKEN, FakeAppConfig, makeConfig, WALLET_ADDRESS } from './service-fakes.js';
import { Network } from '../../config/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type {
    ReadContractParams,
    TransactionRequest,
    TxReceipt,
    WalletManager,
    WalletProvider,
} from '../../wallet/types.js';
import { BalanceService } from '../balance.service.js';

class BalanceWallet implements WalletManager, WalletProvider {
    async getTransactionSender(): Promise<Address | null> {
        return this.getAddress();
    }
    public readonly reads: Array<ReadContractParams> = [];

    constructor(
        private readonly cpuWei: bigint,
        private readonly nativeWei: bigint,
    ) {}

    get(): WalletManager {
        return this;
    }
    isReady(): boolean {
        return true;
    }
    getAddress(): Address {
        return WALLET_ADDRESS;
    }
    getChainId(): number {
        return 1;
    }
    async sendTransaction(_tx: TransactionRequest): Promise<Hash> {
        throw new Error('not used');
    }
    async estimateGas(): Promise<bigint> {
        throw new Error('not used');
    }
    async getGasPrice(): Promise<bigint> {
        throw new Error('not used');
    }
    async waitForReceipt(_hash: Hash): Promise<TxReceipt> {
        throw new Error('not used');
    }
    async readContract(params: ReadContractParams): Promise<unknown> {
        this.reads.push(params);
        return this.cpuWei;
    }
    async getBalance(): Promise<bigint> {
        return this.nativeWei;
    }
    async signMessage(): Promise<Hex> {
        return '0x';
    }
    async signTypedData(): Promise<Hex> {
        return '0x';
    }
}

function makeService(wallet: BalanceWallet, cpuToken: string = CPU_TOKEN): BalanceService {
    return new BalanceService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(makeConfig(cpuToken)),
        logger: new NoopLogger(),
    });
}

describe('BalanceService', () => {
    it('reads $CPU via balanceOf and native gas, formatting both', async () => {
        const wallet = new BalanceWallet(1_500_000_000_000_000_000n, 2_000_000_000_000_000_000n);

        const result = await makeService(wallet).getBalances();

        expect(result.address).toBe(WALLET_ADDRESS);
        expect(result.network).toBe(Network.ETHEREUM);
        expect(result.chainId).toBe(1);
        expect(result.cpu).toBe('1.5');
        expect(result.native).toBe('2');

        const read = wallet.reads[0];
        expect(read?.functionName).toBe('balanceOf');
        expect(read?.address).toBe(CPU_TOKEN);
        expect(read?.args).toEqual([WALLET_ADDRESS]);
    });

    it('throws when the $CPU token is not configured', async () => {
        const wallet = new BalanceWallet(0n, 0n);
        await expect(makeService(wallet, '').getBalances()).rejects.toThrow(/not configured/i);
    });
});
