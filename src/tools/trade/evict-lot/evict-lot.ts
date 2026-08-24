import { EVICT_LOT_DESCRIPTION } from './constants.js';
import { summarizeEvictLot } from './format.utils.js';
import { evictLotInputSchema } from './types.js';
import { LotEvictionService } from '../../../services/trade-eviction.service.js';
import type { ILotEviction } from '../../../services/trade-eviction.types.js';
import { TradeClient } from '../../../services/trade.client.js';
import type { AppContext } from '../../../types.js';
import { ContractClient } from '../../../wallet/contract-client.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';

export function createLotEvictionService(context: AppContext): ILotEviction {
    const logger = context.logger.child('trade:eviction');
    const contracts = new ContractClient({ wallet: context.wallet, logger, retry: null });
    return new LotEvictionService({
        wallet: context.wallet,
        appConfig: context.appConfig,
        tradeClient: new TradeClient({ contracts, logger }),
        contracts,
        mapReader: context.mapReader,
        logger,
    });
}

export function registerEvictLotTool(
    server: ToolRegistrar,
    context: AppContext,
    eviction: ILotEviction = createLotEvictionService(context),
): void {
    server.registerTool(
        'cpu_evict_lot',
        { description: EVICT_LOT_DESCRIPTION, inputSchema: evictLotInputSchema },
        async (args) => {
            const result = await eviction.evictLot({ lotId: args.lotId });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeEvictLot(result, resources) },
                    { type: 'text', text: JSON.stringify({ ...result, eventType: ToolEventType.LotEvicted }) },
                ],
            };
        },
    );
}
