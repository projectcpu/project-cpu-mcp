import { getAddress, type Address } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
    type IRevealRequestsReader,
    LotState,
    type LotView,
    type OpenRevealRequestsView,
    type OpenRevealRequestView,
    type RandomnessDescriptor,
    RandomnessKind,
} from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { type AttentionItem, AttentionReason, type AttentionReport, AttentionSeverity } from '../../../map/types.js';
import { FulfilmentClaims } from '../../../randomness/claims.js';
import { SelfServiceRandomnessResolver } from '../../../randomness/self-service.resolver.js';
import type { IRandomnessStrategyFactory, RandomnessStrategy } from '../../../randomness/types.js';
import { FakeAppConfig, makeConfig } from '../../../services/__tests__/service-fakes.js';
import { RevealFulfilmentService } from '../../../services/reveal-fulfilment.service.js';
import type { AppConfig, DeliveryView } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import {
    PANEL_CONTINUATION_INDENT,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_STRUCTURAL_SEQUENCES,
} from '../../../utils/panel.constants.js';
import type { IContractClient, WalletProvider } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetAttentionTool } from '../attention/attention.js';
import { WAREHOUSE_PRESSURE_LABELS } from '../attention/constants.js';

const CURRENT_SOURCE = getAddress('0xabc1230000000000000000000000000000000001');
const CURRENT_SOURCE_ON_WIRE = CURRENT_SOURCE.toLowerCase();
const RETIRED_SOURCE_ON_WIRE = '0x00000000000000000000000000000000000000b2';
const REQUESTS_SERVER_TIME = 1_700_000_500;

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

function mapReport(): AttentionReport {
    return {
        ownerKnown: true,
        version: 5,
        serverTime: 1,
        counts: { critical: 1, warning: 0, info: 1 },
        items: [
            {
                tokenId: '1',
                severity: AttentionSeverity.Critical,
                reason: AttentionReason.StalledMining,
                resourceId: 3,
                used: '50',
                cap: '50',
                fillPct: 100,
                breakdown: { liquid: '50', incomingTransport: '0', lots: '0' },
                depositRemaining: null,
                deliveryId: null,
                arrivalAt: null,
                demolishingType: null,
                lotId: null,
                requestId: null,
                requestedAt: null,
                message: null,
            },
            {
                tokenId: '2',
                severity: AttentionSeverity.Info,
                reason: AttentionReason.Unbuilt,
                resourceId: null,
                used: null,
                cap: null,
                fillPct: null,
                breakdown: null,
                depositRemaining: null,
                deliveryId: null,
                arrivalAt: null,
                demolishingType: null,
                lotId: null,
                requestId: null,
                requestedAt: null,
                message: null,
            },
        ],
        note: null,
    };
}

const READY_DELIVERY: DeliveryView = {
    deliveryId: '77',
    payer: '0xMe',
    sourceTokenId: '9',
    targetTokenId: '3',
    resourceId: 101,
    amount: '100',
    arrivalAt: 1,
    delivered: false,
    readyToFinalize: true,
};

function makeLot(overrides: Partial<LotView> = {}): LotView {
    return {
        id: '500',
        hubTokenId: '42',
        sellerAddress: '0xMe',
        resourceId: 3,
        listed: '100',
        remaining: '100',
        pricePerUnit: '1',
        saleFeePercent: 5,
        maxSaleFeePercent: 10,
        frozen: false,
        state: LotState.Open,
        distanceFromAnchor: null,
        createdAt: 1,
        updated: 1,
        ...overrides,
    };
}

class FakeStrategyFactory implements IRandomnessStrategyFactory {
    public readonly descriptors: Array<RandomnessDescriptor> = [];

    constructor(private readonly source: Address) {}

    async create(descriptor: RandomnessDescriptor): Promise<RandomnessStrategy> {
        this.descriptors.push(descriptor);
        return { kind: descriptor.kind, source: this.source } as unknown as RandomnessStrategy;
    }
}

class FakeRevealRequests implements IRevealRequestsReader {
    public readonly owners: Array<string> = [];
    public unreachable = false;

    constructor(private readonly rows: Array<OpenRevealRequestView> = []) {}

    async listOpenRequests(owner: string): Promise<OpenRevealRequestsView> {
        this.owners.push(owner);
        if (this.unreachable) {
            throw new Error('the open reveal request list is unreachable');
        }
        return { serverTime: REQUESTS_SERVER_TIME, requests: this.rows };
    }
}

function openRequest(over: Partial<OpenRevealRequestView> = {}): OpenRevealRequestView {
    return {
        requestId: '7',
        source: CURRENT_SOURCE_ON_WIRE,
        tokenId: '42',
        requestedAt: REQUESTS_SERVER_TIME - 300,
        ...over,
    };
}

function chainConfig(selfService: boolean): AppConfig {
    const base = makeConfig();
    return selfService
        ? {
              ...base,
              randomness: {
                  kind: RandomnessKind.DRAND,
                  adapter: CURRENT_SOURCE,
                  genesis: 1_600_000_000,
                  period: 3,
                  beaconApi: 'https://beacon.example/chain',
              },
          }
        : { ...base, randomness: { kind: RandomnessKind.ENTROPY, adapter: CURRENT_SOURCE } };
}

interface HarnessOpts {
    walletReady: boolean | null;
    deliveries: (() => Promise<Array<DeliveryView>>) | null;
    lots: (() => Promise<Array<LotView>>) | null;
    selfService: boolean | null;
    revealRequests: FakeRevealRequests | null;
    report: AttentionReport | null;
}

function harness(opts: Partial<HarnessOpts> = {}): Handler {
    const walletReady = opts.walletReady ?? true;
    const map = {
        attention: (owner: string | null): AttentionReport =>
            owner === null
                ? {
                      ownerKnown: false,
                      version: 5,
                      serverTime: 1,
                      counts: { critical: 0, warning: 0, info: 0 },
                      items: [],
                      note: null,
                  }
                : (opts.report ?? mapReport()),
    };
    const wallet = { isReady: () => walletReady, get: () => ({ getAddress: () => '0xMe' }) };
    const appConfig = {
        load: async () => ({ resources: { 3: 'Silica', 101: 'Power' }, recipes: [], buildings: [] }),
    };
    const transport = {
        listReadyToFinalizeForOwner: opts.deliveries ?? (async () => []),
    };
    const trade = {
        listMyLots: opts.lots ?? (async () => []),
    };
    const logger = new NoopLogger();
    const config = new FakeAppConfig(chainConfig(opts.selfService ?? true));
    const revealFulfilment = new RevealFulfilmentService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: config,
        randomness: new SelfServiceRandomnessResolver({
            appConfig: config,
            randomness: new FakeStrategyFactory(CURRENT_SOURCE),
            logger,
        }),
        revealRequests: opts.revealRequests ?? new FakeRevealRequests(),
        contracts: {} as unknown as IContractClient,
        claims: new FulfilmentClaims(),
        logger,
    });
    const context = {
        mapReader: map,
        wallet,
        appConfig,
        transport,
        trade,
        revealFulfilment,
        logger,
    } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    registerGetAttentionTool(server, context);
    if (captured === null) {
        throw new Error('get_attention was not registered');
    }
    return captured;
}

describe('get_attention tool', () => {
    it('merges ready deliveries and decorates resource names', async () => {
        const handler = harness({ deliveries: async () => [READY_DELIVERY] });
        const result = await handler({ minSeverity: null });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/Critical: 1 \| Warning: 1 \| Info: 1/);

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        const delivery = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.DeliveryReady);
        expect(delivery.deliveryId).toBe('77');
        expect(delivery.arrivalAt).toBe(1);
        const stalled = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.StalledMining);
        expect(stalled.resourceName).toBe('Silica');
    });

    it('reports no owner-scoped items when the wallet is not ready', async () => {
        const handler = harness({ walletReady: false });
        const result = await handler({ minSeverity: null, owner: null });
        expect(result.content[0]?.text).toMatch(/authenticate/);
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.ownerKnown).toBe(false);
    });

    it('scouts another owner, surfacing their cells and inbound deliveries as intel', async () => {
        const handler = harness({ deliveries: async () => [READY_DELIVERY] });
        const result = await handler({ minSeverity: null, owner: '0xNeighbor' });
        expect(result.content[0]?.text).toMatch(/Scope: scouting/);
        expect(result.content[0]?.text).toMatch(/Owner: 0xNeighbor/);
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.scouting).toBe(true);
        expect(payload.owner).toBe('0xNeighbor');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.DeliveryReady)).toBe(true);
    });

    it('filters by minSeverity', async () => {
        const handler = harness();
        const result = await handler({ minSeverity: AttentionSeverity.Critical });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items).toHaveLength(1);
        expect(payload.items[0].severity).toBe(AttentionSeverity.Critical);
    });

    it('degrades gracefully when the deliveries fetch fails', async () => {
        const handler = harness({
            deliveries: async () => {
                throw new Error('server down');
            },
        });
        const result = await handler({ minSeverity: null });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.note).toMatch(/could not be loaded/i);
        // Map-derived items survive the delivery outage.
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.StalledMining)).toBe(true);
    });

    it('warns about a frozen own lot, naming the live rate, tolerance and fee-free cancel', async () => {
        const handler = harness({
            lots: async () => [
                makeLot({ id: '900', hubTokenId: '77', saleFeePercent: 12, maxSaleFeePercent: 10, frozen: true }),
            ],
        });
        const result = await handler({ minSeverity: null });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        const frozen = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.LotFrozen);
        expect(frozen.severity).toBe(AttentionSeverity.Warning);
        expect(frozen.lotId).toBe('900');
        expect(frozen.tokenId).toBe('77');
        expect(frozen.message).toMatch(/12%/);
        expect(frozen.message).toMatch(/10%/);
        expect(frozen.message).toMatch(/cancel is fee-free/i);
    });

    it('flags an own lot at exactly the tolerance as at-risk info', async () => {
        const handler = harness({
            lots: async () => [makeLot({ id: '901', hubTokenId: '77', saleFeePercent: 10, maxSaleFeePercent: 10 })],
        });
        const result = await handler({ minSeverity: null });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        const atRisk = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.LotAtRisk);
        expect(atRisk.severity).toBe(AttentionSeverity.Info);
        expect(atRisk.lotId).toBe('901');
        expect(atRisk.tokenId).toBe('77');
    });

    it('leaves a healthy own lot (rate below tolerance) off the list', async () => {
        const handler = harness({
            lots: async () => [makeLot({ saleFeePercent: 5, maxSaleFeePercent: 10 })],
        });
        const result = await handler({ minSeverity: null });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.LotFrozen)).toBe(false);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.LotAtRisk)).toBe(false);
    });

    it('never flags lots in delivering, sold or cancelled states', async () => {
        const handler = harness({
            lots: async () => [
                makeLot({
                    id: '1',
                    state: LotState.Delivering,
                    saleFeePercent: 20,
                    maxSaleFeePercent: 10,
                    frozen: true,
                }),
                makeLot({ id: '2', state: LotState.Sold, saleFeePercent: 10, maxSaleFeePercent: 10 }),
                makeLot({
                    id: '3',
                    state: LotState.Cancelled,
                    saleFeePercent: 20,
                    maxSaleFeePercent: 10,
                    frozen: true,
                }),
            ],
        });
        const result = await handler({ minSeverity: null });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.LotFrozen)).toBe(false);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.LotAtRisk)).toBe(false);
    });

    it('does not fold the caller lots into a scouted owner report', async () => {
        const lots = vi.fn(async () => [makeLot({ frozen: true, saleFeePercent: 20, maxSaleFeePercent: 10 })]);
        const handler = harness({ lots });
        const result = await handler({ minSeverity: null, owner: '0xNeighbor' });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.LotFrozen)).toBe(false);
        expect(lots).not.toHaveBeenCalled();
    });

    it('degrades gracefully when the lots fetch fails', async () => {
        const handler = harness({
            lots: async () => {
                throw new Error('server down');
            },
        });
        const result = await handler({ minSeverity: null });
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.note).toMatch(/lots could not be loaded/i);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.StalledMining)).toBe(true);
    });

    it('raises a critical item for a reveal request open past the two-minute mark', async () => {
        const requests = new FakeRevealRequests([openRequest({ requestId: '11', tokenId: '77' })]);
        const handler = harness({ revealRequests: requests });
        const result = await handler({ minSeverity: null });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        const stuck = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.RevealStuck);
        expect(stuck.severity).toBe(AttentionSeverity.Critical);
        expect(stuck.tokenId).toBe('77');
        expect(stuck.requestId).toBe('11');
        expect(stuck.requestedAt).toBe(REQUESTS_SERVER_TIME - 300);
        expect(stuck.message).toContain('open for 300 seconds');
        expect(payload.note).toBeNull();
        expect(requests.owners).toEqual(['0xMe']);
        expect(result.content[0]?.text).toMatch(/Critical: 2/);
    });

    it('leaves a reveal request younger than the two-minute mark off the list', async () => {
        const requests = new FakeRevealRequests([openRequest({ requestedAt: REQUESTS_SERVER_TIME - 30 })]);
        const handler = harness({ revealRequests: requests });
        const result = await handler({ minSeverity: null });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealStuck)).toBe(false);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealSourceRetired)).toBe(
            false,
        );
        expect(payload.note).toBeNull();
    });

    it('flags a cell locked by a retired randomness source and names the admin cleanup', async () => {
        const requests = new FakeRevealRequests([
            openRequest({
                requestId: '13',
                tokenId: '88',
                source: RETIRED_SOURCE_ON_WIRE,
                requestedAt: REQUESTS_SERVER_TIME - 4,
            }),
        ]);
        const handler = harness({ revealRequests: requests });
        const result = await handler({ minSeverity: null });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        const locked = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.RevealSourceRetired);
        expect(locked.severity).toBe(AttentionSeverity.Critical);
        expect(locked.tokenId).toBe('88');
        expect(locked.requestId).toBe('13');
        expect(locked.requestedAt).toBe(REQUESTS_SERVER_TIME - 4);
        expect(locked.message).toContain(RETIRED_SOURCE_ON_WIRE);
        expect(locked.message).toContain(CURRENT_SOURCE);
        expect(locked.message).toMatch(/admin of the contracts clears it on-chain/);
        expect(locked.message).toMatch(/only way out/);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealStuck)).toBe(false);
    });

    it('leaves a cell locked at a retired source with that one item once it is past the mark', async () => {
        const requests = new FakeRevealRequests([
            openRequest({
                requestId: '14',
                tokenId: '89',
                source: RETIRED_SOURCE_ON_WIRE,
                requestedAt: REQUESTS_SERVER_TIME - 300,
            }),
        ]);
        const handler = harness({ revealRequests: requests });
        const result = await handler({ minSeverity: null });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        const locked = payload.items.filter((i: { tokenId: string }) => i.tokenId === '89');
        expect(locked.map((i: { reason: string }) => i.reason)).toEqual([AttentionReason.RevealSourceRetired]);
        expect(locked[0].requestedAt).toBe(REQUESTS_SERVER_TIME - 300);
    });

    it('raises neither reveal item on a stand whose randomness source settles reveals itself', async () => {
        const requests = new FakeRevealRequests([
            openRequest({ requestId: '1', tokenId: '10' }),
            openRequest({ requestId: '2', tokenId: '20', source: RETIRED_SOURCE_ON_WIRE }),
        ]);
        const handler = harness({ selfService: false, revealRequests: requests });
        const result = await handler({ minSeverity: null });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealStuck)).toBe(false);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealSourceRetired)).toBe(
            false,
        );
        expect(payload.note).toBeNull();
        expect(requests.owners).toEqual([]);
        expect(result.content[0]?.text).toMatch(/Critical: 1 \| Warning: 0 \| Info: 1/);
    });

    it('degrades gracefully when the open reveal requests cannot be read', async () => {
        const requests = new FakeRevealRequests([openRequest()]);
        requests.unreachable = true;
        const handler = harness({
            revealRequests: requests,
            deliveries: async () => [READY_DELIVERY],
            lots: async () => [makeLot({ frozen: true, saleFeePercent: 20, maxSaleFeePercent: 10 })],
        });
        const result = await handler({ minSeverity: null });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.note).toMatch(/open reveal requests could not be read/i);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.StalledMining)).toBe(true);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.DeliveryReady)).toBe(true);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.LotFrozen)).toBe(true);
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealStuck)).toBe(false);
    });

    it('does not fold the caller open reveal requests into a scouted owner report', async () => {
        const requests = new FakeRevealRequests([openRequest()]);
        const handler = harness({ revealRequests: requests });
        const result = await handler({ minSeverity: null, owner: '0xNeighbor' });

        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(payload.items.some((i: { reason: string }) => i.reason === AttentionReason.RevealStuck)).toBe(false);
        expect(requests.owners).toEqual([]);
    });

    it('keeps the request reveal counter out of the payload it returns', async () => {
        const requests = new FakeRevealRequests([
            { ...openRequest(), revealEpoch: 4, revealCount: 4 } as OpenRevealRequestView,
        ]);
        const handler = harness({ revealRequests: requests });
        const result = await handler({ minSeverity: null });

        const text = result.content[1]?.text ?? '';
        expect(text).not.toMatch(/revealEpoch/i);
        expect(text).not.toMatch(/revealCount/i);
        const payload = JSON.parse(text);
        const stuck = payload.items.find((i: { reason: string }) => i.reason === AttentionReason.RevealStuck);
        expect(Object.keys(stuck).sort()).toEqual([
            'arrivalAt',
            'breakdown',
            'cap',
            'deliveryId',
            'demolishingType',
            'depositRemaining',
            'fillPct',
            'lotId',
            'message',
            'reason',
            'requestId',
            'requestedAt',
            'resourceId',
            'resourceName',
            'severity',
            'tokenId',
            'used',
        ]);
    });
});

const PANEL_MAX_WIDTH = 72;
const PANEL_TITLE = 'WAREHOUSE PRESSURE';
const PANEL_LABELS = [
    'Scope',
    'Owner',
    'Map',
    'Shown',
    'Critical',
    'Warning',
    'Info',
    'Near full',
    'Peak fill',
    'Stalled',
    'Note',
];
const SCOUTED = '0x00000000000000000000000000000000000000c3';

function panelOf(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}

function labelSeparators(panel: string): number {
    return panel.split(PANEL_LABEL_SEPARATOR).length - 1;
}

function unwrapped(panel: string): string {
    return panel
        .split('\n')
        .reduce((text, line) =>
            line.startsWith(PANEL_CONTINUATION_INDENT) ? `${text} ${line.trim()}` : `${text}\n${line}`,
        );
}

function flattened(panel: string): string {
    return panel
        .split('\n')
        .map((line) => line.trim())
        .join('');
}

function panelLabels(panel: string): Array<string> {
    return panel
        .split('\n')
        .slice(1)
        .flatMap((line) => line.trim().split(' | '))
        .map((field) => field.split(': ')[0] ?? '')
        .filter((label) => PANEL_LABELS.includes(label));
}

function pressureReport(over: Partial<AttentionReport> = {}): AttentionReport {
    return {
        ownerKnown: true,
        version: 12,
        serverTime: 1,
        counts: { critical: 0, warning: 2, info: 0 },
        items: [
            {
                tokenId: '4',
                severity: AttentionSeverity.Warning,
                reason: AttentionReason.WarehouseNearFull,
                resourceId: 3,
                used: '92',
                cap: '100',
                fillPct: 92,
                breakdown: { liquid: '92', incomingTransport: '0', lots: '0' },
                depositRemaining: null,
                deliveryId: null,
                arrivalAt: null,
                demolishingType: null,
                lotId: null,
                requestId: null,
                requestedAt: null,
                message: null,
            },
            {
                tokenId: '5',
                severity: AttentionSeverity.Warning,
                reason: AttentionReason.WarehouseNearFull,
                resourceId: 101,
                used: '99',
                cap: '100',
                fillPct: 99,
                breakdown: { liquid: '99', incomingTransport: '0', lots: '0' },
                depositRemaining: null,
                deliveryId: null,
                arrivalAt: null,
                demolishingType: null,
                lotId: null,
                requestId: null,
                requestedAt: null,
                message: null,
            },
        ],
        note: null,
        ...over,
    };
}

describe('get_attention panel', () => {
    it('opens with the same title and the same fields in the same order on every call', async () => {
        const results = [
            await harness()({ minSeverity: null }),
            await harness({ report: pressureReport() })({ minSeverity: null }),
            await harness({ walletReady: false })({ minSeverity: null, owner: null }),
            await harness()({ minSeverity: null, owner: SCOUTED }),
            await harness({ report: pressureReport({ items: [], counts: { critical: 0, warning: 0, info: 0 } }) })({
                minSeverity: null,
            }),
        ];

        for (const result of results) {
            const panel = panelOf(result);
            expect(panel.split('\n')[0]).toBe(PANEL_TITLE);
            expect(panelLabels(panel)).toEqual(PANEL_LABELS);
        }
    });

    it('keeps every line inside the panel width, whatever the values are', async () => {
        const results = [
            await harness({ report: pressureReport() })({ minSeverity: null }),
            await harness()({ minSeverity: null, owner: SCOUTED }),
            await harness({ walletReady: false })({ minSeverity: null, owner: null }),
            await harness({
                deliveries: async () => {
                    throw new Error('server down');
                },
                lots: async () => {
                    throw new Error('server down');
                },
            })({ minSeverity: null }),
        ];

        for (const result of results) {
            for (const line of panelOf(result).split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('separates fields the same way everywhere: one space after a colon, one space around a bar', async () => {
        const panel = panelOf(await harness({ report: pressureReport() })({ minSeverity: null }));

        for (const line of panel.split('\n')) {
            expect(line).not.toMatch(/:(?! )/);
            expect(line).not.toMatch(/: {2}/);
            expect(line).not.toMatch(/\|\S|\S\|/);
            expect(line).not.toMatch(/ {2}\||\| {2}/);
            expect(line).not.toMatch(/\|\s*$/);
            expect(line).toBe(line.trimEnd());
        }
    });

    it('prints a missing value instead of dropping its field', async () => {
        const panel = panelOf(await harness({ walletReady: false })({ minSeverity: null, owner: null }));

        expect(panel).toMatch(/Owner: n\/a/);
        expect(panel).toMatch(/Peak fill: n\/a/);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('reports warehouse pressure: how many boxes are near full, the worst one, and what stalled', async () => {
        const panel = panelOf(await harness({ report: pressureReport() })({ minSeverity: null }));

        expect(panel).toMatch(/Near full: 2/);
        expect(panel).toMatch(/Peak fill: 99% Power \(#101\)/);
        expect(panel).toMatch(/Stalled: 0/);
        expect(panel).toMatch(/Map: v12/);
        expect(panel).toMatch(/Shown: 2/);
    });

    it('counts the stalled cells of the default report and names its fullest box', async () => {
        const panel = panelOf(await harness()({ minSeverity: null }));

        expect(panel).toMatch(/Stalled: 1/);
        expect(panel).toMatch(/Peak fill: 100% Silica \(#3\)/);
        expect(panel).toMatch(/Near full: 0/);
    });

    it('carries a degradation note in the panel instead of hiding it in the payload', async () => {
        const result = await harness({
            deliveries: async () => {
                throw new Error('server down');
            },
        })({ minSeverity: null });

        expect(panelOf(result)).toMatch(/Note: Deliveries could not be loaded/);
        expect(JSON.parse(result.content[1]?.text ?? '{}').note).toMatch(/could not be loaded/i);
    });

    it('leaves the machine block untouched next to the panel', async () => {
        const result = await harness({ report: pressureReport() })({ minSeverity: null });

        expect(result.content).toHaveLength(2);
        expect(result.content[1]?.type).toBe('text');
        const payload = JSON.parse(result.content[1]?.text ?? '{}');
        expect(Object.keys(payload).sort()).toEqual([
            'counts',
            'items',
            'note',
            'owner',
            'ownerKnown',
            'resourceNames',
            'scouting',
            'serverTime',
            'version',
        ]);
        expect(payload.version).toBe(12);
        expect(payload.items).toHaveLength(2);
    });
});

function panelItem(reason: AttentionReason, over: Partial<AttentionItem> = {}): AttentionItem {
    return {
        tokenId: '4',
        severity: AttentionSeverity.Warning,
        reason,
        resourceId: 3,
        used: null,
        cap: null,
        fillPct: null,
        breakdown: null,
        depositRemaining: null,
        deliveryId: null,
        arrivalAt: null,
        demolishingType: null,
        lotId: null,
        requestId: null,
        requestedAt: null,
        message: null,
        ...over,
    };
}

describe('get_attention panel, hostile and partial inputs', () => {
    it('keeps the label with its value when an owner address is too long to fit a line', async () => {
        const handler = harness();
        const panel = panelOf(await handler({ minSeverity: null, owner: `0x${'b'.repeat(70)}` }));

        for (const line of panel.split('\n')) {
            expect(line).not.toMatch(/:(?! )/);
            expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
        }
        expect(panel).toMatch(/Owner: 0xbb/);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('does not let a newline inside an owner address forge a panel line', async () => {
        const handler = harness();
        const clean = panelOf(await handler({ minSeverity: null, owner: '0xabc forged line' }));
        const injected = panelOf(await handler({ minSeverity: null, owner: '0xabc\nforged line' }));

        expect(injected.split('\n')).toHaveLength(clean.split('\n').length);
        expect(injected).not.toMatch(/^forged line/mu);
        expect(injected).toMatch(/Owner: 0xabc forged line/);
    });

    it('counts a stalled craft next to a stalled extractor', async () => {
        const handler = harness({
            report: pressureReport({
                counts: { critical: 2, warning: 0, info: 0 },
                items: [
                    panelItem(AttentionReason.StalledMining, { severity: AttentionSeverity.Critical }),
                    panelItem(AttentionReason.StalledCraft, { tokenId: '5', severity: AttentionSeverity.Critical }),
                ],
            }),
        });
        const panel = panelOf(await handler({ minSeverity: null }));

        expect(panel).toMatch(/Stalled: 2/);
        expect(panel).toMatch(/Near full: 0/);
    });

    it('counts only near-full boxes as pressure, not every other flag on the list', async () => {
        const handler = harness({
            report: pressureReport({
                counts: { critical: 0, warning: 3, info: 0 },
                items: [
                    panelItem(AttentionReason.WarehouseNearFull, { fillPct: 88 }),
                    panelItem(AttentionReason.ProcessFinished, { tokenId: '5' }),
                    panelItem(AttentionReason.DepositDepleted, { tokenId: '6' }),
                ],
            }),
        });
        const panel = panelOf(await handler({ minSeverity: null }));

        expect(panel).toMatch(/Near full: 1/);
        expect(panel).toMatch(/Shown: 3/);
        expect(panel).toMatch(/Peak fill: 88% Silica \(#3\)/);
    });
    it('does not let a bar inside an owner address forge a field boundary', async () => {
        const panel = panelOf(await harness()({ minSeverity: null, owner: 'a|b' }));

        for (const line of panel.split('\n')) {
            expect(line.replace(/ \| /gu, '')).not.toContain('|');
        }
        expect(panel).toMatch(/Owner: a\/b/);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('does not let an owner address write a field of its own into the panel', async () => {
        const owners = [
            `0x${'a'.repeat(53)} Stalled: 999`,
            '0xcccccccccccccccccccc Iron Syndicate Stalled: 0 Near full: 0 Note: all clear',
        ];

        for (const owner of owners) {
            const result = await harness()({ minSeverity: null, owner });
            const panel = panelOf(result);

            expect(labelSeparators(panel)).toBe(PANEL_LABELS.length);
            expect(panelLabels(panel)).toEqual(PANEL_LABELS);
            expect(JSON.parse(result.content[1]?.text ?? '{}').owner).toBe(owner);
        }
    });

    it('lets an owner address forge no line, no column and no field, whichever separator it carries', async () => {
        const handler = harness();
        const clean = panelOf(await handler({ minSeverity: null, owner: '0xabc forged' }));

        for (const probe of PANEL_STRUCTURAL_SEQUENCES) {
            const panel = panelOf(await handler({ minSeverity: null, owner: `0xabc${probe}forged` }));

            expect(panel.split('\n')).toHaveLength(clean.split('\n').length);
            expect(labelSeparators(panel)).toBe(labelSeparators(clean));
            expect(panel.split('|')).toHaveLength(clean.split('|').length);
        }
    });

    it('loses not one character of a value it had to wrap', async () => {
        const owner = `0x${'ab'.repeat(35)}`;
        const handler = harness({
            deliveries: async () => {
                throw new Error('server down');
            },
        });
        const result = await handler({ minSeverity: null, owner });
        const panel = panelOf(result);
        const flattened = panel
            .split('\n')
            .map((line) => line.trim())
            .join('');
        const note = JSON.parse(result.content[1]?.text ?? '{}').note;

        expect(panel.split('\n').length).toBeGreaterThan(5);
        expect(flattened).toContain(`Owner: ${owner}`);
        expect(flattened.replace(/ /gu, '')).toContain(note.replace(/ /gu, ''));
    });

    it('keeps a clock reading inside an owner address exactly as it arrived', async () => {
        const panel = panelOf(await harness()({ minSeverity: null, owner: '0xabc 14:32' }));

        expect(panel).toMatch(/Owner: 0xabc 14:32/);
        expect(labelSeparators(panel)).toBe(PANEL_LABELS.length);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('lets an owner address forge no field even when the panel is read unwrapped', async () => {
        const handler = harness();

        for (let offset = 40; offset < 72; offset += 1) {
            const owner = `${'b'.repeat(offset)}:${'c'.repeat(30)}`;
            const result = await handler({ minSeverity: null, owner });
            const panel = panelOf(result);

            expect(labelSeparators(unwrapped(panel))).toBe(PANEL_LABELS.length);
            expect(flattened(panel)).toContain(`Owner: ${owner}`);
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('wraps an owner address without splitting one of its characters in two', async () => {
        const owner = '\u{1f600}'.repeat(60);
        const panel = panelOf(await harness()({ minSeverity: null, owner }));

        for (const line of panel.split('\n')) {
            expect(line.isWellFormed()).toBe(true);
            expect(line.trimStart()).not.toMatch(/^\p{M}/u);
            expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
        }
        expect(flattened(panel)).toContain(`Owner: ${owner}`);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('keeps its own labels inside the label ceiling the builder documents', () => {
        for (const label of Object.values(WAREHOUSE_PRESSURE_LABELS)) {
            expect(label.length).toBeLessThanOrEqual(PANEL_MAX_LABEL_LENGTH);
        }
    });
});
