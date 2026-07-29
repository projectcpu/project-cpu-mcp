import { type Abi, type Address, type Hash } from 'viem';
import { describe, expect, it } from 'vitest';

import { RandomnessKind } from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ConfirmedTx, IContractClient, ReadContractParams, TransactionRequest } from '../../wallet/types.js';
import { PushRandomnessStrategy } from '../push.strategy.js';

const SOURCE = '0x00000000000000000000000000000000000000a1' as Address;

class FakeContracts implements IContractClient {
    public readonly reads: Array<ReadContractParams> = [];
    constructor(private readonly fee: bigint) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        return this.fee as T;
    }
    async estimateGas(): Promise<bigint> {
        return 21_000n;
    }
    async send(_tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        throw new Error('unused');
    }
    async confirm(): Promise<ConfirmedTx> {
        throw new Error('unused');
    }
}

function makeStrategy(fee: bigint): { strategy: PushRandomnessStrategy; contracts: FakeContracts } {
    const contracts = new FakeContracts(fee);
    return {
        strategy: new PushRandomnessStrategy({ source: SOURCE, contracts, logger: new NoopLogger() }),
        contracts,
    };
}

describe('PushRandomnessStrategy', () => {
    it('carries the push kind and the source it quotes at', () => {
        const { strategy } = makeStrategy(0n);

        expect(strategy.kind).toBe(RandomnessKind.ENTROPY);
        expect(strategy.source).toBe(SOURCE);
    });

    it('quotes the fee at the adapter with a no-argument view', async () => {
        const { strategy, contracts } = makeStrategy(4_200n);

        expect(await strategy.quoteFee()).toBe(4_200n);
        expect(contracts.reads).toHaveLength(1);
        expect(contracts.reads[0]?.address).toBe(SOURCE);
        expect(contracts.reads[0]?.functionName).toBe('quoteFee');
        expect(contracts.reads[0]?.args).toEqual([]);
    });

    it('returns the quote untouched, leaving any buffer to the caller', async () => {
        const { strategy } = makeStrategy(1_000n);

        expect(await strategy.quoteFee()).toBe(1_000n);
    });

    it('exposes fee quoting as its only capability', () => {
        const { strategy } = makeStrategy(0n);

        expect(typeof strategy.quoteFee).toBe('function');
        expect(Object.getOwnPropertyNames(Object.getPrototypeOf(strategy))).toEqual(['constructor', 'quoteFee']);
    });
});
