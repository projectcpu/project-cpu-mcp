import { type Abi, type Address, type Hash, zeroAddress } from 'viem';
import { describe, expect, it } from 'vitest';

import {
    type IRevealRequestsReader,
    type OpenRevealRequestsView,
    type RandomnessDescriptor,
    RandomnessKind,
} from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ConfirmedTx, IContractClient, ReadContractParams, TransactionRequest } from '../../wallet/types.js';
import { RandomnessStrategyFactory } from '../factory.js';
import type { PushRandomness, RandomnessStrategy, SelfServiceRandomness } from '../types.js';

const CELL = '0x1111111111111111111111111111111111111111' as Address;
const CONFIGURED_SOURCE = '0x00000000000000000000000000000000000000a1' as Address;
const ON_CHAIN_SOURCE = '0x00000000000000000000000000000000000000a2' as Address;

class FakeContracts implements IContractClient {
    public readonly reads: Array<ReadContractParams> = [];
    constructor(private readonly results: Record<string, unknown>) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        return this.results[params.functionName] as T;
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

class FakeRevealRequests implements IRevealRequestsReader {
    async listOpenRequests(): Promise<OpenRevealRequestsView> {
        return { serverTime: 0, requests: [] };
    }
}

function asPush(strategy: RandomnessStrategy): PushRandomness {
    if (strategy.kind !== RandomnessKind.ENTROPY) {
        throw new Error(`expected the push strategy, got "${strategy.kind}"`);
    }
    return strategy;
}

function asSelfService(strategy: RandomnessStrategy): SelfServiceRandomness {
    if (strategy.kind !== RandomnessKind.DRAND) {
        throw new Error(`expected the self-service strategy, got "${strategy.kind}"`);
    }
    return strategy;
}

function pushDescriptor(adapter: string): RandomnessDescriptor {
    return { kind: RandomnessKind.ENTROPY, adapter };
}

function selfServiceDescriptor(adapter: string): RandomnessDescriptor {
    return {
        kind: RandomnessKind.DRAND,
        adapter,
        genesis: 1_700_000_000,
        period: 3,
        beaconApi: 'https://beacon.example/v2',
    };
}

function makeFactory(results: Record<string, unknown> = {}): {
    factory: RandomnessStrategyFactory;
    contracts: FakeContracts;
} {
    const contracts = new FakeContracts(results);
    const factory = new RandomnessStrategyFactory({
        contracts,
        revealRequests: new FakeRevealRequests(),
        logger: new NoopLogger(),
    });
    return { factory, contracts };
}

describe('RandomnessStrategyFactory', () => {
    it('picks the push strategy for a push descriptor', async () => {
        const { factory } = makeFactory();

        const strategy = await factory.create(pushDescriptor(CONFIGURED_SOURCE), CELL);

        expect(strategy.kind).toBe(RandomnessKind.ENTROPY);
        expect(strategy.source).toBe(CONFIGURED_SOURCE);
    });

    it('takes the source from the descriptor without reading the cell', async () => {
        const { factory, contracts } = makeFactory({ randomnessSource: ON_CHAIN_SOURCE });

        const strategy = await factory.create(pushDescriptor(CONFIGURED_SOURCE), CELL);

        expect(strategy.source).toBe(CONFIGURED_SOURCE);
        expect(contracts.reads).toHaveLength(0);
    });

    it('falls back to the source the cell reports when the config carries none', async () => {
        const { factory, contracts } = makeFactory({ randomnessSource: ON_CHAIN_SOURCE });

        const strategy = await factory.create(pushDescriptor(''), CELL);

        expect(strategy.source).toBe(ON_CHAIN_SOURCE);
        expect(contracts.reads[0]?.address).toBe(CELL);
        expect(contracts.reads[0]?.functionName).toBe('randomnessSource');
    });

    it('names the source read off the cell and reads nothing else there', async () => {
        const { factory, contracts } = makeFactory({ randomnessSource: ON_CHAIN_SOURCE });

        const strategy = await factory.create(pushDescriptor('   '), CELL);

        expect(asPush(strategy).source).toBe(ON_CHAIN_SOURCE);
        expect(contracts.reads.map((read) => read.functionName)).toEqual(['randomnessSource']);
    });

    it('refuses when neither the config nor the cell knows a source', async () => {
        const { factory } = makeFactory({ randomnessSource: zeroAddress });

        await expect(factory.create(pushDescriptor(''), CELL)).rejects.toThrow(
            /no randomness adapter address.*no randomness source set/is,
        );
    });

    it('refuses a configured adapter that is not an address', async () => {
        const { factory, contracts } = makeFactory({ randomnessSource: ON_CHAIN_SOURCE });

        await expect(factory.create(pushDescriptor('0xnope'), CELL)).rejects.toThrow(/not an address/i);
        expect(contracts.reads).toHaveLength(0);
    });

    it('picks the self-service strategy for a self-service descriptor', async () => {
        const { factory } = makeFactory();

        const strategy = await factory.create(selfServiceDescriptor(CONFIGURED_SOURCE), CELL);

        expect(strategy.kind).toBe(RandomnessKind.DRAND);
        expect(strategy.source).toBe(CONFIGURED_SOURCE);
    });

    it('carries the beacon clock of the descriptor into the self-service strategy', async () => {
        const { factory } = makeFactory();

        const strategy = asSelfService(await factory.create(selfServiceDescriptor(CONFIGURED_SOURCE), CELL));

        expect(strategy.clock).toEqual({ genesis: 1_700_000_000, period: 3 });
    });

    it('gives neither strategy a fee quote of its own — the Cell prices a reveal', async () => {
        const { factory } = makeFactory();

        const push = await factory.create(pushDescriptor(CONFIGURED_SOURCE), CELL);
        const selfService = await factory.create(selfServiceDescriptor(CONFIGURED_SOURCE), CELL);

        expect('quoteFee' in push).toBe(false);
        expect('quoteRequestFee' in selfService).toBe(false);
        expect(typeof asSelfService(selfService).fulfill).toBe('function');
    });

    it('falls back to the cell source for a self-service descriptor too', async () => {
        const { factory, contracts } = makeFactory({ randomnessSource: ON_CHAIN_SOURCE });

        const strategy = await factory.create(selfServiceDescriptor(''), CELL);

        expect(strategy.source).toBe(ON_CHAIN_SOURCE);
        expect(contracts.reads[0]?.functionName).toBe('randomnessSource');
    });
});
