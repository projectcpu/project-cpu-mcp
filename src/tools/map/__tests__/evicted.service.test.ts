import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import { FakeAppConfig, makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { AppConfig, IAppConfig, ITradeClient } from '../../../services/types.js';
import type { WalletProvider } from '../../../wallet/types.js';
import { EvictedLotCountService } from '../attention/evicted.service.js';

const HUBS = ['42', '55'];

function neverAsked(): ITradeClient {
    return {
        async getSellerEvictedCount(): Promise<bigint> {
            throw new Error('the count must not be read when the chain cannot answer');
        },
    } as unknown as ITradeClient;
}

class UnreachableAppConfig implements IAppConfig {
    async load(): Promise<AppConfig> {
        throw new Error('the game config is unreachable');
    }
}

function service(
    walletReady: boolean,
    appConfig: IAppConfig = new FakeAppConfig(makeConfig()),
): EvictedLotCountService {
    const wallet = {
        isReady: () => walletReady,
        get: () => ({
            getAddress: () => '0xSeller',
            getChainId: () => makeConfig().chainId,
        }),
    } as unknown as WalletProvider;

    return new EvictedLotCountService({
        appConfig,
        wallet,
        tradeClient: neverAsked(),
        logger: new NoopLogger(),
    });
}

describe('outstanding evicted lot counts', () => {
    it('answers unknown, never clear, when there is no session to ask the chain with', async () => {
        const counts = await service(false).forHubs(HUBS);

        expect(counts).toEqual([
            { hubTokenId: '42', count: null },
            { hubTokenId: '55', count: null },
        ]);
        for (const entry of counts) {
            expect(entry.count).toBeNull();
            expect(entry.count).not.toBe(0);
        }
    });

    it('answers unknown, never clear, when the Trade contract cannot be reached at all', async () => {
        const counts = await service(true, new UnreachableAppConfig()).forHubs(['42']);

        expect(counts).toEqual([{ hubTokenId: '42', count: null }]);
        expect(counts[0]?.count).not.toBe(0);
    });

    it('asks nothing at all when no hub is in play', async () => {
        expect(await service(true).forHubs([])).toEqual([]);
    });
});
