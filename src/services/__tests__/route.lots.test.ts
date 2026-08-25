import { describe, expect, it } from 'vitest';

import { FakeAppConfig, FakeWallet, TRADE, WALLET_ADDRESS, makeConfig } from './service-fakes.js';
import { OnChainLotState } from '../../contracts/trade.types.js';
import { TradeLotSnapshots } from '../route.lots.js';
import type { GetLotParams, OnChainLot } from '../types.js';

const LOT: OnChainLot = {
    seller: WALLET_ADDRESS,
    hub: 4242n,
    resource: 3,
    remaining: 120n,
    pricePerUnit: 1n,
    state: OnChainLotState.Evicted,
    maxSaleFeeBp: 500,
    hubRadius: 8,
    hubMoveFee: 400_000_000_000_000_000n,
};

class FakeLotReader {
    readonly reads: Array<GetLotParams> = [];

    getLot(params: GetLotParams): Promise<OnChainLot> {
        this.reads.push(params);
        return Promise.resolve(LOT);
    }
}

function harness(): { snapshots: TradeLotSnapshots; client: FakeLotReader } {
    const client = new FakeLotReader();
    const config = makeConfig();
    const snapshots = new TradeLotSnapshots({
        appConfig: new FakeAppConfig(config),
        wallet: new FakeWallet(config.chainId),
        tradeClient: client as unknown as ConstructorParameters<typeof TradeLotSnapshots>[0]['tradeClient'],
    });
    return { snapshots, client };
}

describe('TradeLotSnapshots', () => {
    it('reads the lot from the Trade contract of the configured network, by its numeric id', async () => {
        const { snapshots, client } = harness();

        const lot = await snapshots.readLot('77');

        expect(client.reads).toEqual([{ trade: TRADE, lotId: 77n }]);
        expect(lot).toEqual(LOT);
    });

    it('carries the reach and the rate the lot recorded, which no map projection serves', async () => {
        const { snapshots } = harness();

        const lot = await snapshots.readLot('77');

        expect(lot.hubRadius).toBe(8);
        expect(lot.hubMoveFee).toBe(400_000_000_000_000_000n);
    });
});
