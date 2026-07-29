import { getAddress, type Abi, type Address, type Hash, type Hex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type IRevealRequestsReader,
    type OpenRevealRequestsView,
    type OpenRevealRequestView,
    RandomnessKind,
} from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import {
    type ConfirmedTx,
    type GasEstimateRequest,
    type IContractClient,
    type ReadContractParams,
    type TransactionRequest,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../../wallet/types.js';
import { FulfilmentClaims } from '../claims.js';
import { RevealFulfiller } from '../fulfiller.js';
import {
    AdapterRequestState,
    type AdapterRequestView,
    type BeaconRoundClock,
    type BeaconRoundResult,
    BeaconRoundOutcome,
    type FulfillmentInput,
    type FulfillmentResult,
    type IBeaconClient,
    type ISelfServiceRandomnessResolver,
    type OpenRequestMatch,
    type SelfServiceRandomness,
} from '../types.js';

const SOURCE = getAddress('0xabc1230000000000000000000000000000000001');
const RETIRED_SOURCE = getAddress('0x00000000000000000000000000000000000000b2');
const NEXT_SOURCE = getAddress('0x00000000000000000000000000000000000000c3');
const OWNER = getAddress('0x000000000000000000000000000000000000dead');
const FULFILL_HASH = `0x${'f'.repeat(64)}` as Hash;
const SIGNATURE = `0x${'ab'.repeat(64)}` as Hex;
const SERVER_TIME = 1_700_000_100;
const START = 1_700_000_000_000;
const TICK_MS = 60_000;

class FakeBeacon implements IBeaconClient {
    public answer: BeaconRoundResult | null = null;
    public readonly rounds: Array<bigint> = [];

    async signatureOf(round: bigint): Promise<BeaconRoundResult> {
        this.rounds.push(round);
        return this.answer ?? { outcome: BeaconRoundOutcome.SIGNED, round, signature: SIGNATURE };
    }
}

class FakeStrategy implements SelfServiceRandomness {
    public readonly kind: RandomnessKind.DRAND = RandomnessKind.DRAND;
    public readonly clock: BeaconRoundClock = { genesis: 1_700_000_000, period: 3 };
    public readonly beacon = new FakeBeacon();
    public readonly reads: Array<bigint> = [];
    public readonly readAt: Array<number> = [];
    public readonly sent: Array<FulfillmentInput> = [];
    public state = AdapterRequestState.OPEN;
    public round = 91n;
    public settledByAnother = false;
    public fulfilError: unknown = null;

    constructor(public readonly source: Address = SOURCE) {}

    async quoteRequestFee(): Promise<bigint> {
        throw new Error('unused');
    }

    async readRequest(requestId: bigint): Promise<AdapterRequestView> {
        this.reads.push(requestId);
        this.readAt.push(Date.now() - START);
        return { state: this.state, requestId, consumer: OWNER, round: this.round };
    }

    async findOpenRequest(): Promise<OpenRequestMatch | null> {
        throw new Error('unused');
    }

    async findRetiredSourceRequest(): Promise<OpenRequestMatch | null> {
        throw new Error('unused');
    }

    async fulfill(input: FulfillmentInput): Promise<FulfillmentResult> {
        this.sent.push(input);
        if (this.fulfilError !== null) {
            throw this.fulfilError;
        }
        if (this.settledByAnother) {
            return {
                state: AdapterRequestState.CLOSED,
                requestId: input.requestId,
                round: input.round,
                reason: 'already fulfilled',
            };
        }
        return {
            state: AdapterRequestState.OPEN,
            requestId: input.requestId,
            round: input.round,
            txHash: FULFILL_HASH,
        };
    }
}

class FakeResolver implements ISelfServiceRandomnessResolver {
    public resolves = 0;
    public error: unknown = null;

    constructor(public strategy: SelfServiceRandomness | null) {}

    async resolve(): Promise<SelfServiceRandomness | null> {
        this.resolves += 1;
        if (this.error !== null) {
            throw this.error;
        }
        return this.strategy;
    }
}

class FakeRequests implements IRevealRequestsReader {
    public rows: Array<OpenRevealRequestView>;
    public readonly owners: Array<string> = [];
    public failures = 0;

    constructor(rows: Array<OpenRevealRequestView>) {
        this.rows = rows;
    }

    async listOpenRequests(owner: string): Promise<OpenRevealRequestsView> {
        this.owners.push(owner);
        if (this.failures > 0) {
            this.failures -= 1;
            throw new Error('the open request list is unreachable');
        }
        return { serverTime: SERVER_TIME, requests: this.rows };
    }
}

class FakeContracts implements IContractClient {
    public readonly confirmed: Array<Hash> = [];
    public hold = false;
    private gate: (() => void) | null = null;

    async read<T>(_params: ReadContractParams): Promise<T> {
        throw new Error('unused');
    }

    async estimateGas(_tx: GasEstimateRequest): Promise<bigint> {
        throw new Error('unused');
    }

    async send(_tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        throw new Error('unused');
    }

    async confirm(hash: Hash): Promise<ConfirmedTx> {
        this.confirmed.push(hash);
        if (this.hold) {
            await new Promise<void>((resolve) => {
                this.gate = resolve;
            });
        }
        return { txHash: hash, status: TxStatus.Success, blockNumber: '1', logs: [] };
    }

    release(): void {
        this.gate?.();
        this.gate = null;
    }
}

class FakeWallet implements WalletProvider {
    public ready = true;

    get(): WalletManager {
        return { getAddress: () => OWNER } as unknown as WalletManager;
    }

    isReady(): boolean {
        return this.ready;
    }
}

function row(over: Partial<OpenRevealRequestView> = {}): OpenRevealRequestView {
    return { requestId: '7', source: SOURCE.toLowerCase(), tokenId: '42', requestedAt: 1_700_000_050, ...over };
}

interface Harness {
    fulfiller: RevealFulfiller;
    strategy: FakeStrategy;
    resolver: FakeResolver;
    requests: FakeRequests;
    contracts: FakeContracts;
    wallet: FakeWallet;
    claims: FulfilmentClaims;
    logger: NoopLogger;
}

function setup(rows: Array<OpenRevealRequestView> = [row()], source: Address = SOURCE): Harness {
    const strategy = new FakeStrategy(source);
    const resolver = new FakeResolver(strategy);
    const requests = new FakeRequests(rows);
    const contracts = new FakeContracts();
    const wallet = new FakeWallet();
    const claims = new FulfilmentClaims();
    const logger = new NoopLogger();
    const fulfiller = new RevealFulfiller({
        randomness: resolver,
        revealRequests: requests,
        contracts,
        wallet,
        claims,
        logger,
    });
    return { fulfiller, strategy, resolver, requests, contracts, wallet, claims, logger };
}

async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
}

describe('RevealFulfiller', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(START);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('settles an open request on the first sweep, without waiting out the tick', async () => {
        const { fulfiller, strategy, contracts } = setup();

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.sent).toEqual([{ requestId: 7n, round: 91n, signature: SIGNATURE }]);
        expect(contracts.confirmed).toEqual([FULFILL_HASH]);
    });

    it('reads the very request the list named, and settles that one', async () => {
        const { fulfiller, strategy } = setup();

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.reads).toEqual([7n]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('asks the beacon for the very round the source named, and fulfils with that one', async () => {
        const { fulfiller, strategy } = setup();

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.beacon.rounds).toEqual([91n]);
        expect(strategy.sent.map((input) => input.round)).toEqual([91n]);
    });

    it('sweeps again once a minute and not a tick sooner', async () => {
        const { fulfiller, requests } = setup();

        fulfiller.start();
        await flush();
        expect(requests.owners).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(TICK_MS - 1);
        expect(requests.owners).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1);
        fulfiller.stop();
        expect(requests.owners).toEqual([OWNER, OWNER]);
    });

    it('sweeps nothing until the wallet is there, then sweeps on the next tick', async () => {
        const { fulfiller, requests, wallet } = setup();
        wallet.ready = false;

        fulfiller.start();
        await flush();
        expect(requests.owners).toHaveLength(0);

        wallet.ready = true;
        await vi.advanceTimersByTimeAsync(TICK_MS);
        fulfiller.stop();
        expect(requests.owners).toEqual([OWNER]);
    });

    it('sends the next fulfilment only after the previous receipt', async () => {
        const { fulfiller, strategy, contracts } = setup([row(), row({ requestId: '8', tokenId: '43' })]);
        contracts.hold = true;

        fulfiller.start();
        await flush();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        expect(contracts.confirmed).toHaveLength(1);

        contracts.release();
        await flush();
        fulfiller.stop();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n, 8n]);
        expect(contracts.confirmed).toEqual([FULFILL_HASH, FULFILL_HASH]);
    });

    it('lets a sweep that outlives its tick finish before the next one starts', async () => {
        const { fulfiller, requests, contracts } = setup();
        contracts.hold = true;

        fulfiller.start();
        await flush();
        await vi.advanceTimersByTimeAsync(TICK_MS * 3);

        expect(requests.owners).toHaveLength(1);

        contracts.release();
        await flush();
        await vi.advanceTimersByTimeAsync(TICK_MS);
        fulfiller.stop();

        expect(requests.owners).toHaveLength(2);
    });

    it('leaves a request opened at a retired source alone, without reading or sending anything', async () => {
        const { fulfiller, strategy, contracts } = setup([row({ source: RETIRED_SOURCE.toLowerCase() })]);

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.reads).toEqual([]);
        expect(strategy.sent).toEqual([]);
        expect(contracts.confirmed).toEqual([]);
    });

    it('follows the randomness source the chain config moves to, without a restart', async () => {
        const { fulfiller, strategy, resolver, requests } = setup();
        const moved = new FakeStrategy(NEXT_SOURCE);

        fulfiller.start();
        await flush();
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);

        resolver.strategy = moved;
        requests.rows = [
            row({ requestId: '8' }),
            row({ requestId: '9', source: NEXT_SOURCE.toLowerCase(), tokenId: '43' }),
        ];
        await vi.advanceTimersByTimeAsync(TICK_MS);
        fulfiller.stop();

        expect(moved.sent.map((input) => input.requestId)).toEqual([9n]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('sends nothing once the chain has moved reveals to a source that settles them itself', async () => {
        const { fulfiller, strategy, resolver, logger } = setup();
        const warned = vi.spyOn(logger, 'warn');
        resolver.strategy = null;

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.reads).toEqual([]);
        expect(strategy.sent).toEqual([]);
        expect(warned).not.toHaveBeenCalled();
    });

    it('keeps sweeping after a tick that could not tell which source is current', async () => {
        const { fulfiller, strategy, resolver, logger } = setup();
        const warned = vi.spyOn(logger, 'warn');
        resolver.error = new Error('the chain config is unreachable');

        fulfiller.start();
        await flush();
        expect(strategy.sent).toEqual([]);
        expect(warned).toHaveBeenCalledTimes(1);

        resolver.error = null;
        await vi.advanceTimersByTimeAsync(TICK_MS);
        fulfiller.stop();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('settles a request whose address the chain config spells in another case', async () => {
        const configured = SOURCE.toLowerCase() as Address;
        const { fulfiller, strategy } = setup([row({ source: SOURCE })], configured);

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(configured).not.toBe(SOURCE);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('settles the live request in the same sweep that skips the retired one', async () => {
        const { fulfiller, strategy } = setup([
            row({ requestId: '5', source: RETIRED_SOURCE.toLowerCase(), tokenId: '41' }),
            row(),
        ]);

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('sends nothing for a request the adapter has already closed, and does not call that a failure', async () => {
        const { fulfiller, strategy, contracts } = setup();
        strategy.state = AdapterRequestState.CLOSED;

        fulfiller.start();
        await flush();
        await vi.advanceTimersByTimeAsync(TICK_MS * 3);
        fulfiller.stop();

        expect(strategy.sent).toEqual([]);
        expect(contracts.confirmed).toEqual([]);
        expect(strategy.readAt).toEqual([0, 60_000, 120_000, 180_000]);
    });

    it('treats a request the adapter no longer knows as done rather than as a failure to back off from', async () => {
        const { fulfiller, strategy } = setup();
        strategy.settledByAnother = true;

        fulfiller.start();
        await flush();
        await vi.advanceTimersByTimeAsync(TICK_MS * 3);
        fulfiller.stop();

        expect(strategy.readAt).toEqual([0, 60_000, 120_000, 180_000]);
    });

    it('backs off per request, doubling the wait and stopping at a quarter of an hour', async () => {
        const { fulfiller, strategy } = setup();
        strategy.beacon.answer = { outcome: BeaconRoundOutcome.NOT_RELEASED, round: 91n, reason: 'not published' };

        fulfiller.start();
        await vi.advanceTimersByTimeAsync(2_700_000);
        fulfiller.stop();

        expect(strategy.readAt).toEqual([0, 60_000, 180_000, 420_000, 900_000, 1_800_000, 2_700_000]);
    });

    it('counts a request that settled once from scratch again, instead of carrying its old failures', async () => {
        const silent = { outcome: BeaconRoundOutcome.NOT_RELEASED, round: 91n, reason: 'not published' } as const;
        const { fulfiller, strategy } = setup();
        strategy.beacon.answer = silent;

        fulfiller.start();
        await flush();
        strategy.beacon.answer = null;
        await vi.advanceTimersByTimeAsync(TICK_MS);
        strategy.beacon.answer = silent;
        await vi.advanceTimersByTimeAsync(TICK_MS * 2);
        fulfiller.stop();

        expect(strategy.readAt).toEqual([0, 60_000, 120_000, 180_000]);
    });

    it('backs off a request whose fulfilment reverted for a reason of its own', async () => {
        const { fulfiller, strategy } = setup();
        strategy.fulfilError = new Error('the randomness source refused the signature');

        fulfiller.start();
        await vi.advanceTimersByTimeAsync(TICK_MS * 2);
        fulfiller.stop();

        expect(strategy.readAt).toEqual([0, 60_000]);
    });

    it('leaves a request another caller is already settling to that caller', async () => {
        const { fulfiller, strategy, claims } = setup();
        claims.claim(SOURCE, 7n);

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.reads).toEqual([]);
    });

    it('releases its own claim so the next sweep can pick the request up again', async () => {
        const { fulfiller, strategy, claims } = setup();
        strategy.fulfilError = new Error('the randomness source refused the signature');

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(claims.has(SOURCE, 7n)).toBe(false);
    });

    it('keeps sweeping after a list read it could not make', async () => {
        const { fulfiller, requests, strategy } = setup();
        requests.failures = 1;

        fulfiller.start();
        await flush();
        expect(strategy.sent).toEqual([]);

        await vi.advanceTimersByTimeAsync(TICK_MS);
        fulfiller.stop();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('stops sweeping once told to', async () => {
        const { fulfiller, requests } = setup();

        fulfiller.start();
        await flush();
        fulfiller.stop();
        await vi.advanceTimersByTimeAsync(TICK_MS * 3);

        expect(requests.owners).toHaveLength(1);
    });
});
