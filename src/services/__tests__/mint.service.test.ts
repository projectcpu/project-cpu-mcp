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
import { NO_PUBLIC_DROP_MESSAGE, SEADROP_ADDRESS } from '../mint.constants.js';
import { MintService } from '../mint.service.js';
import { type AppConfig, type AppContracts, type PublicDropView } from '../types.js';

const BASE_CHAIN_ID = 8453;
const FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719' as Address;
const OVER_LIMIT_MESSAGE = /Quantity 6 exceeds the per-wallet mint limit of 5 for this drop\./i;

const ACTIVE_DROP: PublicDropView = {
    mintPrice: parseEther('0.01'),
    startTime: 0,
    endTime: 4_000_000_000,
    maxTotalMintableByWallet: 5,
    feeBps: 250,
    restrictFeeRecipients: false,
};

const ZERO_PRICE_DROP: PublicDropView = { ...ACTIVE_DROP, mintPrice: 0n, feeBps: 0 };

const HIGH_PRICE_DROP: PublicDropView = { ...ACTIVE_DROP, mintPrice: 250_000_000_000_000_000n };

const NOT_STARTED_DROP: PublicDropView = { ...ACTIVE_DROP, startTime: 4_000_000_000, endTime: 4_100_000_000 };

const ENDED_DROP: PublicDropView = { ...ACTIVE_DROP, startTime: 1, endTime: 2 };

const FREE_OPEN_ENDED_DROP: PublicDropView = { ...ACTIVE_DROP, mintPrice: 0n, feeBps: 0, startTime: 0, endTime: 0 };

const UNCONFIGURED_DROP: PublicDropView = {
    mintPrice: 0n,
    startTime: 0,
    endTime: 0,
    maxTotalMintableByWallet: 0,
    feeBps: 0,
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
        reveal: { ethBudget: '0', cpuBurn: '0' },
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

        it('quotes a zero total when the live drop price is zero', async () => {
            const quote = await makeService(new MintWallet(ZERO_PRICE_DROP)).quote({ quantity: '3' });

            expect(quote.mintPrice).toBe('0');
            expect(quote.total).toBe('0');
        });

        it('quotes the live nonzero drop price through the same flow', async () => {
            const quote = await makeService(new MintWallet(HIGH_PRICE_DROP)).quote({ quantity: '3' });

            expect(quote.mintPrice).toBe('0.25');
            expect(quote.total).toBe('0.75');
        });

        it('quotes a configured free drop that never closes', async () => {
            const quote = await makeService(new MintWallet(FREE_OPEN_ENDED_DROP)).quote({ quantity: '2' });

            expect(quote.mintPrice).toBe('0');
            expect(quote.total).toBe('0');
            expect(quote.maxTotalMintableByWallet).toBe(5);
        });

        it('reads the drop terms from SeaDrop on every quote', async () => {
            const wallet = new MintWallet();
            await makeService(wallet).quote({ quantity: '1' });

            const read = wallet.reads.find((r) => r.functionName === 'getPublicDrop');
            expect(read?.address).toBe(SEADROP_ADDRESS);
            expect(read?.args).toEqual([LAND]);
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

        it('sends a zero-value mint tx when the live drop price is zero', async () => {
            const wallet = new MintWallet(ZERO_PRICE_DROP);
            const result = await makeService(wallet).mint({ quantity: '2' });

            expect(wallet.sent[0]?.value).toBe(0n);
            expect(result.total).toBe('0');

            const decoded = decodeFunctionData({ abi: SEADROP_ABI, data: wallet.sent[0]?.data as Hex });
            expect(decoded.functionName).toBe('mintPublic');
            expect(decoded.args).toEqual([LAND, FEE_RECIPIENT, zeroAddress, 2n]);
        });

        it('sends the live nonzero drop price as the tx value through the same flow', async () => {
            const wallet = new MintWallet(HIGH_PRICE_DROP);
            const result = await makeService(wallet).mint({ quantity: '2' });

            expect(wallet.sent[0]?.value).toBe(500_000_000_000_000_000n);
            expect(result.total).toBe('0.5');

            const decoded = decodeFunctionData({ abi: SEADROP_ABI, data: wallet.sent[0]?.data as Hex });
            expect(decoded.functionName).toBe('mintPublic');
            expect(decoded.args).toEqual([LAND, FEE_RECIPIENT, zeroAddress, 2n]);
        });

        it('mints a configured free drop that never closes', async () => {
            const wallet = new MintWallet(FREE_OPEN_ENDED_DROP);
            const result = await makeService(wallet).mint({ quantity: '2' });

            expect(wallet.sent).toHaveLength(1);
            expect(wallet.sent[0]?.value).toBe(0n);
            expect(result.total).toBe('0');

            const decoded = decodeFunctionData({ abi: SEADROP_ABI, data: wallet.sent[0]?.data as Hex });
            expect(decoded.functionName).toBe('mintPublic');
            expect(decoded.args).toEqual([LAND, FEE_RECIPIENT, zeroAddress, 2n]);
        });

        it('quotes and mints a quantity equal to the per-wallet limit', async () => {
            const quote = await makeService(new MintWallet()).quote({ quantity: '5' });

            expect(quote.quantity).toBe(5);
            expect(quote.total).toBe('0.05');

            const wallet = new MintWallet();
            const result = await makeService(wallet).mint({ quantity: '5' });

            expect(wallet.sent).toHaveLength(1);
            const decoded = decodeFunctionData({ abi: SEADROP_ABI, data: wallet.sent[0]?.data as Hex });
            expect(decoded.args).toEqual([LAND, FEE_RECIPIENT, zeroAddress, 5n]);
            expect(result.status).toBe(TxStatus.Success);
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
            const quoteWallet = new MintWallet();
            await expect(makeService(quoteWallet).quote({ quantity: '6' })).rejects.toThrow(OVER_LIMIT_MESSAGE);
            const mintWallet = new MintWallet();
            await expect(makeService(mintWallet).mint({ quantity: '6' })).rejects.toThrow(OVER_LIMIT_MESSAGE);
            expect(quoteWallet.sent).toHaveLength(0);
            expect(mintWallet.sent).toHaveLength(0);
        });

        it('throws a clear error when the public drop read reverts', async () => {
            const wallet = new MintWallet(() => {
                throw new Error('not initialized');
            });
            await expect(makeService(wallet).quote({ quantity: '1' })).rejects.toThrow(
                /could not read the land public drop/i,
            );
        });

        it('throws when the drop has not started yet', async () => {
            const wallet = new MintWallet(NOT_STARTED_DROP);
            await expect(makeService(wallet).quote({ quantity: '1' })).rejects.toThrow(/has not started/i);
            expect(wallet.sent).toHaveLength(0);
        });

        it('throws when the drop has ended', async () => {
            const wallet = new MintWallet(ENDED_DROP);
            await expect(makeService(wallet).mint({ quantity: '1' })).rejects.toThrow(/has ended/i);
            expect(wallet.sent).toHaveLength(0);
        });

        it('refuses a drop the land contract never configured', async () => {
            const wallet = new MintWallet(UNCONFIGURED_DROP);
            const quoteError = await makeService(wallet)
                .quote({ quantity: '1' })
                .then(
                    () => null,
                    (error: Error) => error,
                );
            const mintError = await makeService(wallet)
                .mint({ quantity: '1' })
                .then(
                    () => null,
                    (error: Error) => error,
                );
            expect(quoteError?.message).toBe(NO_PUBLIC_DROP_MESSAGE);
            expect(mintError?.message).toBe(NO_PUBLIC_DROP_MESSAGE);
            expect(quoteError?.message).not.toMatch(/exceeds/i);
            expect(mintError?.message).not.toMatch(/exceeds/i);
            expect(wallet.sent).toHaveLength(0);
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
