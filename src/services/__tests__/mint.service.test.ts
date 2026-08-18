import { decodeFunctionData, parseEther, zeroAddress, type Address, type Hash, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { FakeAppConfig, LAND, WALLET_ADDRESS } from './service-fakes.js';
import { RandomnessKind } from '../../api/types.js';
import { Network } from '../../config/types.js';
import { SEADROP_ABI } from '../../contracts/seadrop.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import {
    type ReadContractParams,
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../../wallet/types.js';
import { SEADROP_ADDRESS } from '../mint.constants.js';
import { MintService } from '../mint.service.js';
import { type AppConfig, type AppContracts, type PublicDropView } from '../types.js';

const BASE_CHAIN_ID = 8453;
const FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719' as Address;

const ACTIVE_DROP: PublicDropView = {
    mintPrice: parseEther('0.01'),
    startTime: 0,
    endTime: 4_000_000_000,
    maxTotalMintableByWallet: 5,
    feeBps: 250,
    restrictFeeRecipients: false,
};

class MintWallet implements WalletManager, WalletProvider {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<ReadContractParams> = [];
    private receiptIndex = 0;

    constructor(
        private readonly drop: PublicDropView | (() => never) = ACTIVE_DROP,
        private readonly feeRecipients: ReadonlyArray<Address> = [FEE_RECIPIENT],
        private readonly receipts: Array<TxStatus> = [],
        private readonly chainId: number = BASE_CHAIN_ID,
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
        return this.chainId;
    }
    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sent.push(tx);
        return `0x${String(this.sent.length).padStart(64, '0')}` as Hash;
    }
    async estimateGas(): Promise<bigint> {
        return 21000n;
    }
    async getGasPrice(): Promise<bigint> {
        return 1_000_000_000n;
    }
    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const status = this.receipts[this.receiptIndex] ?? TxStatus.Success;
        this.receiptIndex += 1;
        return { status, transactionHash: hash, blockNumber: 100n, logs: [] };
    }
    async readContract(params: ReadContractParams): Promise<unknown> {
        this.reads.push(params);
        if (params.functionName === 'getPublicDrop') {
            return typeof this.drop === 'function' ? this.drop() : this.drop;
        }
        if (params.functionName === 'getAllowedFeeRecipients') {
            return this.feeRecipients;
        }
        throw new Error(`unexpected read: ${params.functionName}`);
    }
    async getBalance(): Promise<bigint> {
        return 0n;
    }
    async signMessage(): Promise<Hex> {
        return '0x';
    }
}

function makeConfig(contracts: Partial<AppContracts> = {}): AppConfig {
    return {
        network: Network.BASE,
        chainId: BASE_CHAIN_ID,
        contracts: {
            land: LAND,
            cpuToken: '',
            cpuHook: '',
            cell: '',
            cellLens: '',
            transport: '',
            trade: '',
            syndicate: null,
            ...contracts,
        },
        randomness: { kind: RandomnessKind.ENTROPY, adapter: '' },
        resources: {},
        recipes: [],
        buildings: [],
        reveal: { ethContribution: '0', cpuBurn: '0' },
        transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: {} },
        trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
        storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
    };
}

function makeService(wallet: MintWallet, config: AppConfig = makeConfig()): MintService {
    return new MintService({ wallet, appConfig: new FakeAppConfig(config), logger: new NoopLogger() });
}

describe('MintService', () => {
    describe('quote', () => {
        it('returns total = quantity × mintPrice and echoes the drop terms', async () => {
            const quote = await makeService(new MintWallet()).quote({ quantity: '3' });

            expect(quote.quantity).toBe(3);
            expect(quote.mintPrice).toBe('0.01');
            expect(quote.total).toBe('0.03');
            expect(quote.feeBps).toBe(250);
            expect(quote.maxTotalMintableByWallet).toBe(5);
        });
    });

    describe('mint', () => {
        it('sends one SeaDrop mintPublic tx with the ETH value and mints to the wallet', async () => {
            const wallet = new MintWallet();
            const result = await makeService(wallet).mint({ quantity: '2' });

            expect(wallet.sent).toHaveLength(1);
            expect(wallet.sent[0]?.to).toBe(SEADROP_ADDRESS);
            expect(wallet.sent[0]?.value).toBe(parseEther('0.02'));

            const decoded = decodeFunctionData({ abi: SEADROP_ABI, data: wallet.sent[0]?.data as Hex });
            expect(decoded.functionName).toBe('mintPublic');
            expect(decoded.args).toEqual([LAND, FEE_RECIPIENT, zeroAddress, 2n]);

            expect(result.status).toBe(TxStatus.Success);
            expect(result.total).toBe('0.02');
            expect(result.blockNumber).toBe('100');
        });

        it('throws when the on-chain mint reverts', async () => {
            const wallet = new MintWallet(ACTIVE_DROP, [FEE_RECIPIENT], [TxStatus.Reverted]);
            await expect(makeService(wallet).mint({ quantity: '1' })).rejects.toThrow(/reverted/i);
        });
    });

    describe('error cases', () => {
        it('throws when the land contract is not configured', async () => {
            const service = makeService(new MintWallet(), makeConfig({ land: '' }));
            await expect(service.quote({ quantity: '1' })).rejects.toThrow(/land contract is not configured/i);
        });

        it('throws when quantity exceeds the per-wallet limit', async () => {
            await expect(makeService(new MintWallet()).quote({ quantity: '6' })).rejects.toThrow(
                /per-wallet mint limit/i,
            );
        });

        it('throws a clear error when the public drop read reverts', async () => {
            const wallet = new MintWallet(() => {
                throw new Error('not initialized');
            });
            await expect(makeService(wallet).quote({ quantity: '1' })).rejects.toThrow(
                /could not read the land public drop/i,
            );
        });

        it('throws when the drop has no allowed fee recipient', async () => {
            const wallet = new MintWallet(ACTIVE_DROP, []);
            await expect(makeService(wallet).mint({ quantity: '1' })).rejects.toThrow(/no allowed fee recipient/i);
        });

        it('throws when the wallet chain does not match the configured network', async () => {
            const wallet = new MintWallet(ACTIVE_DROP, [FEE_RECIPIENT], [], 1);
            await expect(makeService(wallet).quote({ quantity: '1' })).rejects.toThrow(/does not match/i);
        });
    });
});
