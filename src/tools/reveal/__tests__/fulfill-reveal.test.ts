import { getAddress, type Abi, type Address, type Hash, type Hex } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type IRevealRequestsReader,
    type OpenRevealRequestsView,
    type OpenRevealRequestView,
    RandomnessKind,
} from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { FulfilmentClaims } from '../../../randomness/claims.js';
import { RevealFulfiller } from '../../../randomness/fulfiller.js';
import {
    AdapterRequestState,
    type AdapterRequestView,
    type BeaconRoundClock,
    BeaconRoundOutcome,
    type BeaconRoundResult,
    type FulfillmentInput,
    type FulfillmentResult,
    type IBeaconClient,
    type ISelfServiceRandomnessResolver,
    type OpenRequestMatch,
    type SelfServiceRandomness,
} from '../../../randomness/types.js';
import { FakeAppConfig, makeConfig } from '../../../services/__tests__/service-fakes.js';
import { RevealFulfilmentService } from '../../../services/reveal-fulfilment.service.js';
import {
    type FulfillRevealInput,
    type RevealFulfilmentReport,
    RevealFulfilmentOutcome,
} from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import {
    type ConfirmedTx,
    type GasEstimateRequest,
    type IContractClient,
    type ReadContractParams,
    type TransactionRequest,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../../../wallet/types.js';
import { ToolEventType } from '../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerFulfillRevealTool } from '../fulfill-reveal.js';

const SOURCE = getAddress('0xabc1230000000000000000000000000000000001');
const RETIRED_SOURCE = getAddress('0x00000000000000000000000000000000000000b2');
const OWNER = getAddress('0x000000000000000000000000000000000000dead');
const FULFILL_HASH = `0x${'f'.repeat(64)}` as Hash;
const SIGNATURE = `0x${'ab'.repeat(64)}` as Hex;
const SERVER_TIME = 1_700_000_100;
const CHAIN_ID = 1;

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: FulfillRevealInput) => Promise<ToolResult>;

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
    public readonly sent: Array<FulfillmentInput> = [];
    public state = AdapterRequestState.OPEN;
    public round = 91n;
    public settledByAnother = false;
    public fulfilError: unknown = null;
    public fulfilErrorOnRequestId: bigint | null = null;

    constructor(public readonly source: Address = SOURCE) {}

    async quoteRequestFee(): Promise<bigint> {
        throw new Error('unused');
    }

    async readRequest(requestId: bigint): Promise<AdapterRequestView> {
        this.reads.push(requestId);
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
        if (
            this.fulfilError !== null &&
            (this.fulfilErrorOnRequestId === null || this.fulfilErrorOnRequestId === input.requestId)
        ) {
            throw this.fulfilError;
        }
        if (this.settledByAnother) {
            return {
                state: AdapterRequestState.CLOSED,
                requestId: input.requestId,
                round: input.round,
                reason: `Reveal request ${input.requestId} is no longer open at the randomness source: it has already been fulfilled.`,
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
    constructor(public strategy: SelfServiceRandomness | null) {}

    async resolve(): Promise<SelfServiceRandomness | null> {
        return this.strategy;
    }
}

class FakeRequests implements IRevealRequestsReader {
    public rows: Array<OpenRevealRequestView>;
    public readonly owners: Array<string> = [];
    public unreachable = false;

    constructor(rows: Array<OpenRevealRequestView>) {
        this.rows = rows;
    }

    async listOpenRequests(owner: string): Promise<OpenRevealRequestsView> {
        this.owners.push(owner);
        if (this.unreachable) {
            throw new Error('the open request list is unreachable');
        }
        return { serverTime: SERVER_TIME, requests: this.rows };
    }
}

class FakeContracts implements IContractClient {
    public readonly confirmed: Array<Hash> = [];
    public readonly labels: Array<string> = [];
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

    async confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx> {
        this.confirmed.push(hash);
        this.labels.push(revertLabel);
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
    public chainId = CHAIN_ID;

    get(): WalletManager {
        return { getAddress: () => OWNER, getChainId: () => this.chainId } as unknown as WalletManager;
    }

    isReady(): boolean {
        return true;
    }
}

function row(over: Partial<OpenRevealRequestView> = {}): OpenRevealRequestView {
    return { requestId: '7', source: SOURCE.toLowerCase(), tokenId: '42', requestedAt: 1_700_000_050, ...over };
}

function noArgs(over: Partial<FulfillRevealInput> = {}): FulfillRevealInput {
    return { tokenIds: null, requestId: null, source: null, ...over };
}

interface Harness {
    handler: Handler;
    service: RevealFulfilmentService;
    strategy: FakeStrategy;
    resolver: FakeResolver;
    requests: FakeRequests;
    contracts: FakeContracts;
    claims: FulfilmentClaims;
    wallet: FakeWallet;
    logger: NoopLogger;
}

function setup(rows: Array<OpenRevealRequestView> = [row()], source: Address = SOURCE): Harness {
    const strategy = new FakeStrategy(source);
    const resolver = new FakeResolver(strategy);
    const requests = new FakeRequests(rows);
    const contracts = new FakeContracts();
    const claims = new FulfilmentClaims();
    const wallet = new FakeWallet();
    const logger = new NoopLogger();
    const service = new RevealFulfilmentService({
        wallet,
        appConfig: new FakeAppConfig(makeConfig()),
        randomness: resolver,
        revealRequests: requests,
        contracts,
        claims,
        logger,
    });

    const context = { revealFulfilment: service, logger } as unknown as AppContext;
    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerFulfillRevealTool(server, context);
    if (captured === null) {
        throw new Error('cpu_fulfill_reveal was not registered');
    }
    return { handler: captured, service, strategy, resolver, requests, contracts, claims, wallet, logger };
}

function reportOf(result: ToolResult): RevealFulfilmentReport {
    return JSON.parse(result.content[1]?.text ?? '{}') as RevealFulfilmentReport;
}

function headerOf(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}

async function drain(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('cpu_fulfill_reveal', () => {
    it('registers under the name the package contract pins', () => {
        const names: Array<string> = [];
        const server = {
            registerTool(name: string): void {
                names.push(name);
            },
        } as unknown as ToolRegistrar;

        registerFulfillRevealTool(server, {} as unknown as AppContext);

        expect(names).toEqual(['cpu_fulfill_reveal']);
    });

    it('settles every open reveal request the owner has when no cell is named', async () => {
        const { handler, strategy, contracts } = setup([
            row(),
            row({ requestId: '8', tokenId: '43' }),
            row({ requestId: '9', tokenId: '44' }),
        ]);

        const report = reportOf(await handler(noArgs()));

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n, 8n, 9n]);
        expect(contracts.confirmed).toEqual([FULFILL_HASH, FULFILL_HASH, FULFILL_HASH]);
        expect(report.requests.map((entry) => entry.outcome)).toEqual([
            RevealFulfilmentOutcome.Settled,
            RevealFulfilmentOutcome.Settled,
            RevealFulfilmentOutcome.Settled,
        ]);
        expect(report.requests.map((entry) => entry.tokenId)).toEqual(['42', '43', '44']);
    });

    it('asks the beacon for the very round the source named, and fulfils with that one', async () => {
        const { handler, strategy } = setup();

        await handler(noArgs());

        expect(strategy.beacon.rounds).toEqual([91n]);
        expect(strategy.sent.map((input) => input.round)).toEqual([91n]);
    });

    it('fulfils with the signature the beacon answered with', async () => {
        const { handler, strategy } = setup();

        await handler(noArgs());

        expect(strategy.sent).toEqual([{ requestId: 7n, round: 91n, signature: SIGNATURE }]);
    });

    it('sends the next fulfilment only after the previous receipt', async () => {
        const { handler, strategy, contracts } = setup([row(), row({ requestId: '8', tokenId: '43' })]);
        contracts.hold = true;

        const pending = handler(noArgs());
        await drain();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        expect(contracts.confirmed).toEqual([FULFILL_HASH]);

        contracts.release();
        await drain();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n, 8n]);
        expect(contracts.confirmed).toEqual([FULFILL_HASH, FULFILL_HASH]);

        contracts.release();
        const report = reportOf(await pending);

        expect(report.requests.map((entry) => entry.outcome)).toEqual([
            RevealFulfilmentOutcome.Settled,
            RevealFulfilmentOutcome.Settled,
        ]);
    });

    it('settles only the cells named and leaves the rest of the open requests alone', async () => {
        const { handler, strategy } = setup([
            row(),
            row({ requestId: '8', tokenId: '43' }),
            row({ requestId: '9', tokenId: '44' }),
        ]);

        const report = reportOf(await handler(noArgs({ tokenIds: ['43'] })));

        expect(strategy.reads).toEqual([8n]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([8n]);
        expect(report.requests.map((entry) => entry.requestId)).toEqual(['8']);
    });

    it('settles each of several named cells and none of the others', async () => {
        const { handler, strategy } = setup([
            row(),
            row({ requestId: '8', tokenId: '43' }),
            row({ requestId: '9', tokenId: '44' }),
        ]);

        const report = reportOf(await handler(noArgs({ tokenIds: ['42', '44'] })));

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n, 9n]);
        expect(report.requests.map((entry) => entry.tokenId)).toEqual(['42', '44']);
    });

    it('says nothing was settled when none of the named cells has an open request', async () => {
        const { handler, strategy } = setup([row()]);

        const result = await handler(noArgs({ tokenIds: ['43'] }));

        expect(strategy.sent).toEqual([]);
        expect(headerOf(result)).toMatch(/None of the cells you named \(43\)/);
        expect(reportOf(result).requests).toEqual([]);
    });

    it('settles a request named by id and source without asking the game API at all', async () => {
        const { handler, strategy, requests, contracts } = setup([]);
        requests.unreachable = true;

        const report = reportOf(await handler(noArgs({ requestId: '7', source: SOURCE.toLowerCase() })));

        expect(requests.owners).toEqual([]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        expect(contracts.confirmed).toEqual([FULFILL_HASH]);
        expect(report.requests.map((entry) => entry.outcome)).toEqual([RevealFulfilmentOutcome.Settled]);
        expect(report.requests[0]?.tokenId).toBeNull();
    });

    it('refuses a request named by id without the source it was opened at', async () => {
        const { handler, strategy } = setup([]);

        await expect(handler(noArgs({ requestId: '7' }))).rejects.toThrow(/both halves of the pair/i);
        expect(strategy.sent).toEqual([]);
    });

    it('refuses a source named without the request id it belongs to', async () => {
        const { handler } = setup([]);

        await expect(handler(noArgs({ source: SOURCE }))).rejects.toThrow(/both halves of the pair/i);
    });

    it('refuses to mix a named request with a list of cells', async () => {
        const { handler, requests } = setup([row()]);

        await expect(handler(noArgs({ tokenIds: ['42'], requestId: '7', source: SOURCE }))).rejects.toThrow(
            /not both/i,
        );
        expect(requests.owners).toEqual([]);
    });

    it('refuses a request id that is not a whole number', async () => {
        const { handler } = setup([]);

        await expect(handler(noArgs({ requestId: '0x7', source: SOURCE }))).rejects.toThrow(/not a whole number/i);
    });

    it('refuses a source that is not an address', async () => {
        const { handler } = setup([]);

        await expect(handler(noArgs({ requestId: '7', source: 'the adapter' }))).rejects.toThrow(/not an address/i);
    });

    it('refuses with an explanation on a network whose source delivers draws itself', async () => {
        const { handler, resolver, requests, strategy } = setup();
        resolver.strategy = null;

        await expect(handler(noArgs())).rejects.toThrow(
            /Reveals on network ethereum are delivered by the randomness source itself/,
        );
        expect(requests.owners).toEqual([]);
        expect(strategy.sent).toEqual([]);
    });

    it('refuses a request named by id on a network whose source delivers draws itself', async () => {
        const { handler, resolver, strategy } = setup();
        resolver.strategy = null;

        await expect(handler(noArgs({ requestId: '7', source: SOURCE }))).rejects.toThrow(
            /nothing here for you to settle by hand/,
        );
        expect(strategy.sent).toEqual([]);
    });

    it('refuses to settle anything while the wallet sits on another chain than the chain config', async () => {
        const { handler, wallet, requests, strategy } = setup();
        wallet.chainId = CHAIN_ID + 1;

        await expect(handler(noArgs())).rejects.toThrow(
            `Chain mismatch: the chain config is chainId ${CHAIN_ID} but the wallet is on ${CHAIN_ID + 1}. Check RPC_URL.`,
        );
        expect(requests.owners).toEqual([]);
        expect(strategy.reads).toEqual([]);
        expect(strategy.sent).toEqual([]);
    });

    it('refuses a request named by id while the wallet sits on another chain than the chain config', async () => {
        const { handler, wallet, strategy } = setup();
        wallet.chainId = CHAIN_ID + 1;

        await expect(handler(noArgs({ requestId: '7', source: SOURCE }))).rejects.toThrow(/Check RPC_URL/);
        expect(strategy.sent).toEqual([]);
    });

    it('reports a request the source no longer holds as done rather than as a failure', async () => {
        const { handler, strategy, contracts } = setup();
        strategy.state = AdapterRequestState.CLOSED;

        const result = await handler(noArgs());
        const report = reportOf(result);

        expect(strategy.sent).toEqual([]);
        expect(contracts.confirmed).toEqual([]);
        expect(report.requests.map((entry) => entry.outcome)).toEqual([RevealFulfilmentOutcome.AlreadyDone]);
        expect(report.requests[0]?.note).toMatch(/get_cell 42/);
        expect(headerOf(result)).toMatch(/already settled/);
        expect(headerOf(result)).toMatch(/1 already carried the draw/);
    });

    it('reports a request the source rejects as unknown as done rather than as a failure', async () => {
        const { handler, strategy } = setup();
        strategy.settledByAnother = true;

        const result = await handler(noArgs());
        const report = reportOf(result);

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        expect(report.requests.map((entry) => entry.outcome)).toEqual([RevealFulfilmentOutcome.AlreadyDone]);
        expect(report.requests[0]?.note).toMatch(/already been fulfilled/i);
        expect(report.requests[0]?.note).toMatch(/get_cell 42/);
    });

    it('names the outcome of every request in one answer, mixing settled, skipped and busy', async () => {
        const { handler, claims, strategy } = setup([
            row(),
            row({ requestId: '8', tokenId: '43' }),
            row({ requestId: '9', source: RETIRED_SOURCE.toLowerCase(), tokenId: '44' }),
        ]);
        claims.claim(SOURCE, 8n);

        const result = await handler(noArgs());
        const report = reportOf(result);

        expect(report.requests.map((entry) => entry.outcome)).toEqual([
            RevealFulfilmentOutcome.Settled,
            RevealFulfilmentOutcome.Busy,
            RevealFulfilmentOutcome.RetiredSource,
        ]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        const header = headerOf(result);
        expect(header).toMatch(/Settled 1 of 3 reveal requests/);
        expect(header).toMatch(/Request 7 \(cell 42\): settled/);
        expect(header).toMatch(/Request 8 \(cell 43\): left to the call already settling it/);
        expect(header).toMatch(/Request 9 \(cell 44\): skipped, retired randomness source/);
        expect(header).toMatch(new RegExp(`Fulfil tx ${FULFILL_HASH}`));
    });

    it('sends nothing for a request opened at a source the chain config has moved off', async () => {
        const { handler, strategy, contracts } = setup([row({ source: RETIRED_SOURCE.toLowerCase() })]);

        const report = reportOf(await handler(noArgs()));

        expect(strategy.reads).toEqual([]);
        expect(strategy.sent).toEqual([]);
        expect(contracts.confirmed).toEqual([]);
        expect(report.requests[0]?.outcome).toBe(RevealFulfilmentOutcome.RetiredSource);
        expect(report.requests[0]?.note).toMatch(/would revert/);
    });

    it('sends nothing for a request named by id at a source the chain config has moved off', async () => {
        const { handler, strategy } = setup();

        const report = reportOf(await handler(noArgs({ requestId: '7', source: RETIRED_SOURCE.toLowerCase() })));

        expect(strategy.sent).toEqual([]);
        expect(report.requests[0]?.outcome).toBe(RevealFulfilmentOutcome.RetiredSource);
    });

    it('settles a listed request whose address the chain config spells in another case', async () => {
        const configured = SOURCE.toLowerCase() as Address;
        const { handler, strategy } = setup([row({ source: SOURCE })], configured);

        const report = reportOf(await handler(noArgs()));

        expect(configured).not.toBe(SOURCE);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        expect(report.requests[0]?.outcome).toBe(RevealFulfilmentOutcome.Settled);
    });

    it('settles a named request whose source is spelled in another case than the chain config', async () => {
        const { handler, strategy } = setup([], SOURCE.toLowerCase() as Address);

        const report = reportOf(await handler(noArgs({ requestId: '7', source: SOURCE })));

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
        expect(report.requests[0]?.outcome).toBe(RevealFulfilmentOutcome.Settled);
    });

    it('leaves a request whose round is still unpublished open, and says so', async () => {
        const { handler, strategy } = setup();
        strategy.beacon.answer = { outcome: BeaconRoundOutcome.NOT_RELEASED, round: 91n, reason: 'not published' };

        const result = await handler(noArgs());
        const report = reportOf(result);

        expect(strategy.sent).toEqual([]);
        expect(report.requests[0]?.outcome).toBe(RevealFulfilmentOutcome.NotReady);
        expect(report.requests[0]?.round).toBe('91');
        expect(report.requests[0]?.note).toMatch(/not published yet/);
        expect(headerOf(result)).toMatch(/1 still open/);
    });

    it('carries the reason a refused fulfilment gives, and frees the request for the next call', async () => {
        const { handler, strategy, claims } = setup();
        strategy.fulfilError = new Error('the randomness source refused the signature');

        const report = reportOf(await handler(noArgs()));

        expect(report.requests[0]?.outcome).toBe(RevealFulfilmentOutcome.Failed);
        expect(report.requests[0]?.note).toMatch(/refused the signature/);
        expect(claims.has(SOURCE, 7n)).toBe(false);
    });

    it('frees a settled request so a later call can look at it again', async () => {
        const { handler, claims } = setup();

        await handler(noArgs());

        expect(claims.has(SOURCE, 7n)).toBe(false);
    });

    it('walks the whole list when the beacon answers no request with a draw it can use', async () => {
        const { handler, strategy } = setup([row(), row({ requestId: '8', tokenId: '43' })]);
        strategy.beacon.answer = { outcome: BeaconRoundOutcome.MALFORMED, round: 91n, reason: 'not hex' };

        const report = reportOf(await handler(noArgs()));

        expect(report.requests.map((entry) => entry.requestId)).toEqual(['7', '8']);
        expect(report.requests.map((entry) => entry.outcome)).toEqual([
            RevealFulfilmentOutcome.NotReady,
            RevealFulfilmentOutcome.NotReady,
        ]);
    });

    it('settles the rest of the list after the first request is refused, and names both outcomes', async () => {
        const { handler, strategy } = setup([row(), row({ requestId: '8', tokenId: '43' })]);
        strategy.fulfilError = new Error('the randomness source refused the signature');
        strategy.fulfilErrorOnRequestId = 7n;

        const result = await handler(noArgs());
        const report = reportOf(result);

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n, 8n]);
        expect(report.requests.map((entry) => entry.requestId)).toEqual(['7', '8']);
        expect(report.requests.map((entry) => entry.outcome)).toEqual([
            RevealFulfilmentOutcome.Failed,
            RevealFulfilmentOutcome.Settled,
        ]);
        expect(headerOf(result)).toMatch(/Request 7 \(cell 42\): failed/);
        expect(headerOf(result)).toMatch(/Request 8 \(cell 43\): settled/);
    });

    it('says plainly when the owner has no open reveal request at all', async () => {
        const { handler, strategy } = setup([]);

        const result = await handler(noArgs());

        expect(strategy.sent).toEqual([]);
        expect(headerOf(result)).toMatch(/no open reveal request/i);
        expect(reportOf(result).requests).toEqual([]);
    });

    it('names the request the fulfilment reverted under, so the receipt reads plainly', async () => {
        const { handler, contracts } = setup();

        await handler(noArgs());

        expect(contracts.labels).toEqual(['Reveal fulfilment']);
    });

    it('names the event in the machine block once a request actually settles', async () => {
        const { handler } = setup();

        const result = await handler(noArgs());

        expect((reportOf(result) as unknown as { eventType: string }).eventType).toBe(ToolEventType.RevealFulfilled);
    });

    it('leaves the event out of the machine block when nothing settled on this call', async () => {
        const { handler, strategy } = setup();
        strategy.state = AdapterRequestState.CLOSED;

        const result = await handler(noArgs());

        expect(reportOf(result)).not.toHaveProperty('eventType');
    });

    it('leaves the event out when there was nothing open to settle at all', async () => {
        const { handler } = setup([]);

        const result = await handler(noArgs());

        expect(reportOf(result)).not.toHaveProperty('eventType');
    });
});

describe('cpu_fulfill_reveal alongside the background sweep', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function shared(): Harness & { fulfiller: RevealFulfiller } {
        const harness = setup();
        const fulfiller = new RevealFulfiller({
            randomness: harness.resolver,
            revealRequests: harness.requests,
            contracts: harness.contracts,
            wallet: harness.wallet,
            claims: harness.claims,
            logger: harness.logger,
        });
        return { ...harness, fulfiller };
    }

    async function flush(): Promise<void> {
        await vi.advanceTimersByTimeAsync(0);
    }

    it('leaves a request the background sweep is already settling to that sweep', async () => {
        const { handler, fulfiller, strategy, contracts } = shared();
        contracts.hold = true;

        fulfiller.start();
        await flush();
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);

        const report = reportOf(await handler(noArgs()));

        expect(report.requests.map((entry) => entry.outcome)).toEqual([RevealFulfilmentOutcome.Busy]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);

        contracts.release();
        await flush();
        fulfiller.stop();

        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });

    it('keeps the background sweep off a request the tool is settling', async () => {
        const { handler, fulfiller, strategy, contracts } = shared();
        contracts.hold = true;

        const pending = handler(noArgs());
        await flush();
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);

        fulfiller.start();
        await flush();
        fulfiller.stop();

        expect(strategy.reads).toEqual([7n]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);

        contracts.release();
        const report = reportOf(await pending);

        expect(report.requests.map((entry) => entry.outcome)).toEqual([RevealFulfilmentOutcome.Settled]);
        expect(strategy.sent.map((input) => input.requestId)).toEqual([7n]);
    });
});
