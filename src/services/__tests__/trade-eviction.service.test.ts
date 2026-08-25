import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, type Address, type Hash, type Log } from 'viem';
import { describe, expect, it } from 'vitest';

import { FakeAppConfig, FakeContractClient, FakeWallet, makeConfig, TRADE, WALLET_ADDRESS } from './service-fakes.js';
import { LotState } from '../../api/types.js';
import { TRADE_ABI } from '../../contracts/trade.abi.js';
import { OnChainLotState } from '../../contracts/trade.types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { makeCell, projectCell } from '../../map/__tests__/fixtures.js';
import type { Cell, RevealCellReader } from '../../map/types.js';
import { TxStatus, type IContractClient, type WalletProvider } from '../../wallet/types.js';
import { LotEvictionService } from '../trade-eviction.service.js';
import { TradeClient } from '../trade.client.js';
import type { OnChainLot } from '../types.js';

const SELLER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER_OWNER = '0x2222222222222222222222222222222222222222' as Address;
const HUB = 9n;
const RESOURCE = 5;

function makeLot(overrides: Partial<OnChainLot> = {}): OnChainLot {
    return {
        seller: SELLER,
        hub: HUB,
        resource: RESOURCE,
        remaining: 80n,
        pricePerUnit: 500000000000000000n,
        state: OnChainLotState.Open,
        maxSaleFeeBp: 250,
        hubRadius: 3,
        hubMoveFee: 0n,
        ...overrides,
    };
}

// The chain answers checksummed while the projection answers lower-case, so the fixture owner is spelled
// in the case the caller's own address is NOT.
function ownedCell(tokenId: string, owner: string): Cell {
    return projectCell(makeCell({ tokenId, owner }));
}

const CALLER_HUB = ownedCell(HUB.toString(), WALLET_ADDRESS.toLowerCase());
const FOREIGN_HUB = ownedCell(HUB.toString(), OTHER_OWNER);

class FakeHubMap implements RevealCellReader {
    public readonly steps: Array<string> = [];
    public constructor(private readonly cells: Record<string, Cell> = {}) {}
    async readRevealCell(tokenId: string): Promise<Cell | null> {
        this.steps.push(`read ${tokenId}`);
        return this.cells[tokenId] ?? null;
    }
    getServerTime(): number {
        return 0;
    }
    async refresh(): Promise<void> {
        this.steps.push('refresh');
    }
}

class RevertingContractClient extends FakeContractClient {
    public constructor(
        private readonly failure: Error,
        reads: Record<string, unknown>,
    ) {
        super([], [], reads);
    }
    async send(): Promise<Hash> {
        throw this.failure;
    }
}

function lotEvictedLog(args: {
    lotId: bigint;
    evictor: Address;
    seller: Address;
    remaining: bigint;
    address: Address | null;
}): Log {
    const topics = encodeEventTopics({
        abi: TRADE_ABI,
        eventName: 'LotEvicted',
        args: { lotId: args.lotId, evictor: args.evictor, seller: args.seller },
    });
    return {
        address: args.address ?? (TRADE as Address),
        topics,
        data: encodeAbiParameters([{ type: 'uint128' }], [args.remaining]),
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 0,
        transactionIndex: 0,
        transactionHash: `0x${'0'.repeat(64)}`,
        removed: false,
    } as unknown as Log;
}

interface ServiceOptions {
    lot: OnChainLot | null;
    cells: Record<string, Cell> | null;
    logs: Array<Log> | null;
    sendError: Error | null;
}

function makeService(options: Partial<ServiceOptions> = {}) {
    const lot = options.lot ?? makeLot();
    const logs = options.logs ?? [
        lotEvictedLog({
            lotId: 7n,
            evictor: WALLET_ADDRESS,
            seller: lot.seller,
            remaining: lot.remaining,
            address: null,
        }),
    ];
    const reads = { getLot: lot };
    const contracts: IContractClient =
        options.sendError != null
            ? new RevertingContractClient(options.sendError, reads)
            : new FakeContractClient([TxStatus.Success], [logs], reads);
    const mapReader = new FakeHubMap(options.cells ?? { [HUB.toString()]: CALLER_HUB });
    const logger = new NoopLogger();
    const service = new LotEvictionService({
        wallet: new FakeWallet(1) as unknown as WalletProvider,
        appConfig: new FakeAppConfig(makeConfig()),
        tradeClient: new TradeClient({ contracts, logger }),
        contracts,
        mapReader,
        logger,
    });
    return { service, contracts: contracts as FakeContractClient, mapReader };
}

describe('LotEvictionService', () => {
    it('ends a foreign open lot on a hub the caller owns and reports it as evicted', async () => {
        const { service } = makeService();

        const result = await service.evictLot({ lotId: '7' });

        expect(result).toEqual({
            lotId: '7',
            hubTokenId: '9',
            sellerAddress: SELLER,
            resourceId: RESOURCE,
            remaining: '80',
            state: LotState.Evicted,
            txHash: `0x${'0'.repeat(63)}1`,
            status: TxStatus.Success,
            blockNumber: '100',
        });
    });

    it('sends exactly one transaction, and it is the eviction of the lot the caller named', async () => {
        const { service, contracts } = makeService();

        await service.evictLot({ lotId: '7' });

        expect(contracts.sent).toHaveLength(1);
        expect(contracts.sent[0]?.to).toBe(TRADE);
        expect(contracts.sent[0]?.value).toBeNull();
        expect(decodeFunctionData({ abi: TRADE_ABI, data: contracts.sent[0]?.data ?? '0x' })).toEqual({
            functionName: 'evict',
            args: [7n],
        });
    });

    it('reads the authoritative lot off the Trade contract before it sends anything', async () => {
        const { service, contracts } = makeService();

        await service.evictLot({ lotId: '7' });

        expect(contracts.reads).toEqual([{ address: TRADE, abi: TRADE_ABI, functionName: 'getLot', args: [7n] }]);
    });

    it('schedules no delivery and reports no route, because eviction moves nothing', async () => {
        const { service } = makeService();

        const result = await service.evictLot({ lotId: '7' });

        expect(Object.keys(result).sort()).toEqual(
            [
                'blockNumber',
                'hubTokenId',
                'lotId',
                'remaining',
                'resourceId',
                'sellerAddress',
                'state',
                'status',
                'txHash',
            ].sort(),
        );
    });

    it('reports the whole remainder the chain settled, not the amount read before the call', async () => {
        const { service } = makeService({
            logs: [
                lotEvictedLog({ lotId: 7n, evictor: WALLET_ADDRESS, seller: SELLER, remaining: 64n, address: null }),
            ],
        });

        const result = await service.evictLot({ lotId: '7' });

        expect(result.remaining).toBe('64');
    });

    it('refreshes the map before it judges who owns the hub, so a stale snapshot cannot admit the call', async () => {
        const { service, mapReader } = makeService();

        await service.evictLot({ lotId: '7' });

        expect(mapReader.steps).toEqual(['refresh', `read ${HUB.toString()}`]);
    });

    it('judges ownership of the hub the lot actually sits on, not of any cell the caller happens to own', async () => {
        const { service, contracts } = makeService({
            cells: { '5': ownedCell('5', WALLET_ADDRESS), [HUB.toString()]: FOREIGN_HUB },
        });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/hub 9/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('admits a hub whose recorded owner differs from the caller only in letter case', async () => {
        const { service, contracts } = makeService();

        await service.evictLot({ lotId: '7' });

        expect(contracts.sent).toHaveLength(1);
    });

    it('refuses a hub the caller does not own, before any transaction', async () => {
        const { service, contracts } = makeService({ cells: { [HUB.toString()]: FOREIGN_HUB } });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(
            /only the hub owner can evict a lot from hub 9/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses when the hub is not in the map at all rather than guessing that it is the caller’s', async () => {
        const { service, contracts } = makeService({ cells: {} });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/not in the current map/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses to evict the caller’s own lot and names the lot return instead', async () => {
        const { service, contracts } = makeService({ lot: makeLot({ seller: WALLET_ADDRESS }) });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/cpu_return_lot/);
        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/your own lot/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses the caller’s own lot even on a hub the caller owns, where the eviction would otherwise pass', async () => {
        const { service, contracts } = makeService({
            lot: makeLot({ seller: WALLET_ADDRESS.toLowerCase() as Address }),
        });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/your own lot/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses a delivering lot and never finalizes its delivery for the caller', async () => {
        const { service, contracts } = makeService({ lot: makeLot({ state: OnChainLotState.Delivering }) });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/still delivering/i);
        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/finalize/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses a lot that is already evicted rather than evicting it twice', async () => {
        const { service, contracts } = makeService({ lot: makeLot({ state: OnChainLotState.Evicted }) });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/already evicted/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses a lot the contract no longer holds', async () => {
        const { service, contracts } = makeService({ lot: makeLot({ state: OnChainLotState.None }) });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/no live lot 7/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('turns the contract’s own hub-owner refusal into an actionable message', async () => {
        const { service } = makeService({ sendError: new Error('Execution reverted: NotHubOwner()') });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/hub changed hands/i);
    });

    it('turns the contract’s own self-eviction refusal into the lot-return instruction', async () => {
        const { service } = makeService({ sendError: new Error('Execution reverted: SelfEviction()') });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/cpu_return_lot/);
    });

    it('turns the contract’s own state refusal into a race the agent can re-read', async () => {
        const { service } = makeService({ sendError: new Error('Execution reverted: LotNotOpen()') });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/no longer open/i);
    });

    it('keeps an undecoded revert intact instead of inventing a reason for it', async () => {
        const { service } = makeService({ sendError: new Error('nonce too low') });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/nonce too low/);
    });

    it('refuses to report an eviction the Trade contract did not emit', async () => {
        const { service } = makeService({ logs: [] });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/emitted no LotEvicted/i);
    });

    it('ignores a LotEvicted emitted by some other contract in the same transaction', async () => {
        const { service } = makeService({
            logs: [
                lotEvictedLog({
                    lotId: 7n,
                    evictor: WALLET_ADDRESS,
                    seller: SELLER,
                    remaining: 999n,
                    address: OTHER_OWNER,
                }),
            ],
        });

        await expect(service.evictLot({ lotId: '7' })).rejects.toThrow(/emitted no LotEvicted/i);
    });
});
