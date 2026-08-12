import { getAddress, type Abi, type Address, type Hash } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    type IRevealRequestsReader,
    type OpenRevealRequestsView,
    type RandomnessDescriptor,
    RandomnessKind,
} from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { CELL, FakeAppConfig, makeConfig } from '../../services/__tests__/service-fakes.js';
import type { AppConfig, IAppConfig } from '../../services/types.js';
import type {
    ConfirmedTx,
    GasEstimateRequest,
    IContractClient,
    ReadContractParams,
    TransactionRequest,
    WalletManager,
    WalletProvider,
} from '../../wallet/types.js';
import { FulfilmentClaims } from '../claims.js';
import { RandomnessStrategyFactory } from '../factory.js';
import { createRevealFulfiller, startRevealFulfilment } from '../fulfiller.factory.js';
import { RevealFulfiller } from '../fulfiller.js';

const SOURCE = getAddress('0xabc1230000000000000000000000000000000001');

const PUSH: RandomnessDescriptor = { kind: RandomnessKind.ENTROPY, adapter: SOURCE };

const SELF_SERVICE: RandomnessDescriptor = {
    kind: RandomnessKind.DRAND,
    adapter: SOURCE,
    genesis: 1_700_000_000,
    period: 3,
    beaconApi: 'https://beacon.test/v2/chains/abc',
};

class FakeContracts implements IContractClient {
    async read<T>(_params: ReadContractParams): Promise<T> {
        throw new Error('unused');
    }
    async estimateGas(_tx: GasEstimateRequest): Promise<bigint> {
        throw new Error('unused');
    }
    async send(_tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        throw new Error('unused');
    }
    async confirm(): Promise<ConfirmedTx> {
        throw new Error('unused');
    }
}

class FakeRequests implements IRevealRequestsReader {
    public calls = 0;

    async listOpenRequests(): Promise<OpenRevealRequestsView> {
        this.calls += 1;
        return { serverTime: 0, requests: [] };
    }
}

class FlakyAppConfig implements IAppConfig {
    public reads = 0;

    constructor(
        private readonly config: AppConfig,
        private failures: number,
    ) {}

    async load(): Promise<AppConfig> {
        this.reads += 1;
        if (this.failures > 0) {
            this.failures -= 1;
            throw new Error('the chain config is unreachable');
        }
        return this.config;
    }
}

class FakeWallet implements WalletProvider {
    get(): WalletManager {
        return { getAddress: () => CELL as Address } as unknown as WalletManager;
    }
    isReady(): boolean {
        return true;
    }
}

function configWith(randomness: RandomnessDescriptor, over: Partial<AppConfig> = {}): AppConfig {
    return { ...makeConfig(), randomness, ...over };
}

async function build(config: AppConfig): Promise<RevealFulfiller | null> {
    const contracts = new FakeContracts();
    const wallet = new FakeWallet();
    const revealRequests = new FakeRequests();
    const logger = new NoopLogger();
    return createRevealFulfiller({
        appConfig: new FakeAppConfig(config),
        randomness: new RandomnessStrategyFactory({ contracts, revealRequests, logger }),
        revealRequests,
        contracts,
        wallet,
        claims: new FulfilmentClaims(),
        logger,
    });
}

describe('createRevealFulfiller', () => {
    it('builds nothing where the randomness source settles reveals itself', async () => {
        expect(await build(configWith(PUSH))).toBeNull();
    });

    it('builds the sweep where reveals are settled by this client', async () => {
        expect(await build(configWith(SELF_SERVICE))).toBeInstanceOf(RevealFulfiller);
    });

    it('says so instead of sweeping blind when the cell contract is not configured', async () => {
        const config = configWith(SELF_SERVICE, { contracts: { ...makeConfig().contracts, cell: '' } });

        await expect(build(config)).rejects.toThrow(/cell contract is not configured/i);
    });
});

describe('startRevealFulfilment', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    function start(appConfig: IAppConfig): { requests: FakeRequests; handle: { stop(): void } } {
        const contracts = new FakeContracts();
        const wallet = new FakeWallet();
        const requests = new FakeRequests();
        const logger = new NoopLogger();
        const handle = startRevealFulfilment({
            appConfig,
            randomness: new RandomnessStrategyFactory({ contracts, revealRequests: requests, logger }),
            revealRequests: requests,
            contracts,
            wallet,
            claims: new FulfilmentClaims(),
            logger,
        });
        return { requests, handle };
    }

    it('comes up on a later try when the chain config was not readable at startup', async () => {
        vi.useFakeTimers();
        const appConfig = new FlakyAppConfig(configWith(SELF_SERVICE), 1);

        const { requests, handle } = start(appConfig);
        await vi.advanceTimersByTimeAsync(0);
        expect(requests.calls).toBe(0);

        await vi.advanceTimersByTimeAsync(60_000);
        handle.stop();

        expect(appConfig.reads).toBe(2);
        expect(requests.calls).toBe(1);
    });

    it('gives up retrying when stopped while it is still trying', async () => {
        vi.useFakeTimers();
        const appConfig = new FlakyAppConfig(configWith(SELF_SERVICE), 5);

        const { handle } = start(appConfig);
        handle.stop();
        await vi.advanceTimersByTimeAsync(600_000);

        expect(appConfig.reads).toBe(1);
    });

    it('sweeps nothing when stopped before the build it started came back', async () => {
        vi.useFakeTimers();
        const { requests, handle } = start(new FakeAppConfig(configWith(SELF_SERVICE)));

        handle.stop();
        await vi.advanceTimersByTimeAsync(600_000);

        expect(requests.calls).toBe(0);
    });

    it('stops the sweep it started', async () => {
        vi.useFakeTimers();
        const { requests, handle } = start(new FakeAppConfig(configWith(SELF_SERVICE)));

        await vi.advanceTimersByTimeAsync(0);
        handle.stop();
        await vi.advanceTimersByTimeAsync(600_000);

        expect(requests.calls).toBe(1);
    });
});
