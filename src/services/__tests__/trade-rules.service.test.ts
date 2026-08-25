import { describe, expect, it } from 'vitest';

import type { ILogger, LogMeta } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import { TradeRulesService } from '../trade-rules.service.js';
import type { GetTradeConfigParams, ITradeClient, OnChainTradeConfig } from '../types.js';
import { FakeAppConfig, FakeWallet, TRADE, makeConfig } from './service-fakes.js';

const CHAIN_CONFIG: OnChainTradeConfig = {
    minPricePerUnit: 1_500_000_000_000_000_000n,
    saleBurnPercent: 1,
    minLotShareBp: 10,
    maxLotShareBp: 200,
    maxLotsPerSellerResource: 7,
    minUncappedLotValue: 10_000n,
    maxUncappedLotValue: 100_000n,
};

/* eslint-disable @typescript-eslint/no-empty-function */
class RecordingLogger implements ILogger {
    public readonly warnings: Array<{ message: string; meta: LogMeta | null }> = [];

    warn(message: string, meta?: LogMeta): void {
        this.warnings.push({ message, meta: meta ?? null });
    }
    info(): void {}
    error(): void {}
    debug(): void {}
    child(): ILogger {
        return this;
    }
}
/* eslint-enable @typescript-eslint/no-empty-function */

class FakeTradeConfigReader {
    public readonly reads: Array<GetTradeConfigParams> = [];

    constructor(private readonly answer: OnChainTradeConfig | Error) {}

    async getConfig(params: GetTradeConfigParams): Promise<OnChainTradeConfig> {
        this.reads.push(params);
        if (this.answer instanceof Error) {
            throw this.answer;
        }
        return this.answer;
    }
}

class UnavailableWallet implements Pick<WalletProvider, 'isReady' | 'get'> {
    isReady(): boolean {
        return false;
    }
    get(): never {
        throw new Error('no wallet');
    }
}

interface Harness {
    service: TradeRulesService;
    client: FakeTradeConfigReader;
    logger: RecordingLogger;
}

function makeService(answer: OnChainTradeConfig | Error = CHAIN_CONFIG, walletReady: boolean = true): Harness {
    const client = new FakeTradeConfigReader(answer);
    const logger = new RecordingLogger();
    const wallet = walletReady ? new FakeWallet(1) : new UnavailableWallet();
    const service = new TradeRulesService({
        appConfig: new FakeAppConfig(makeConfig()),
        wallet: wallet as unknown as WalletProvider,
        tradeClient: client as unknown as ITradeClient,
        logger,
    });
    return { service, client, logger };
}

describe('TradeRulesService', () => {
    it('carries every listing rule the contract serves into agent-facing units', async () => {
        const { service } = makeService();

        expect(await service.loadLotListingRules()).toEqual({
            minLotSharePercent: 0.1,
            maxLotSharePercent: 2,
            minUncappedLotValue: '10000',
            maxUncappedLotValue: '100000',
            maxLotsPerSellerHubResource: 7,
            minPricePerUnit: '1.5',
        });
    });

    it('keeps the minimum below the maximum on both the share window and the uncapped window', async () => {
        const rules = await makeService().service.loadLotListingRules();

        expect(rules?.minLotSharePercent).toBeLessThan(rules?.maxLotSharePercent ?? 0);
        expect(Number(rules?.minUncappedLotValue)).toBeLessThan(Number(rules?.maxUncappedLotValue));
        expect(rules?.minLotSharePercent).toBe(0.1);
        expect(rules?.minUncappedLotValue).toBe('10000');
    });

    it('states the shares in percent, so a basis-point figure never reaches the agent', async () => {
        const rules = await makeService().service.loadLotListingRules();

        expect(rules?.minLotSharePercent).not.toBe(CHAIN_CONFIG.minLotShareBp);
        expect(rules?.maxLotSharePercent).not.toBe(CHAIN_CONFIG.maxLotShareBp);
    });

    it('states the price floor in $CPU per unit, never as the wei the contract stores', async () => {
        const rules = await makeService().service.loadLotListingRules();

        expect(rules?.minPricePerUnit).toBe('1.5');
        expect(rules?.minPricePerUnit).not.toBe(CHAIN_CONFIG.minPricePerUnit.toString());
    });

    it('tracks the per-seller limit the contract serves rather than a fixed number', async () => {
        const { service } = makeService({ ...CHAIN_CONFIG, maxLotsPerSellerResource: 2 });

        expect((await service.loadLotListingRules())?.maxLotsPerSellerHubResource).toBe(2);
    });

    it('reads the Trade contract configured for the network', async () => {
        const { service, client } = makeService();

        await service.loadLotListingRules();

        expect(client.reads).toEqual([{ trade: TRADE }]);
    });

    it('answers null without touching the chain when no wallet is configured', async () => {
        const { service, client } = makeService(CHAIN_CONFIG, false);

        expect(await service.loadLotListingRules()).toBeNull();
        expect(client.reads).toEqual([]);
    });

    it('answers null and warns when the chain read fails, never a guessed window', async () => {
        const { service, logger } = makeService(new Error('rpc down'));

        expect(await service.loadLotListingRules()).toBeNull();
        expect(logger.warnings).toHaveLength(1);
        expect(logger.warnings[0]?.meta).toEqual({ error: 'rpc down' });
    });
});
