import type { EvictedHubCount, EvictedLotCountServiceOptions, IEvictedLotCounts } from './types.js';
import type { ILogger } from '../../../logger/types.js';
import { preparePaidAction } from '../../../services/paid-action.js';
import { AppContract } from '../../../services/paid-action.types.js';
import { TradeClient } from '../../../services/trade.client.js';
import type { IAppConfig, ITradeClient } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { errorMessage } from '../../../utils/error.utils.js';
import { ContractClient } from '../../../wallet/contract-client.js';
import type { WalletProvider } from '../../../wallet/types.js';

/**
 * The per-hub count of the seller's outstanding evicted lots, read from the Trade contract. The count is
 * the only authority on whether a hub still blocks new listings: the projection can lag it in either
 * direction, so an unreadable count answers null and never zero — a guessed zero would report a hub clear
 * that is still blocked.
 */
export class EvictedLotCountService implements IEvictedLotCounts {
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly tradeClient: ITradeClient;
    private readonly logger: ILogger;

    constructor(options: EvictedLotCountServiceOptions) {
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.tradeClient = options.tradeClient;
        this.logger = options.logger;
    }

    async forHubs(hubTokenIds: ReadonlyArray<string>): Promise<Array<EvictedHubCount>> {
        if (hubTokenIds.length === 0) {
            return [];
        }
        if (!this.wallet.isReady()) {
            return this.unknown(hubTokenIds);
        }

        try {
            const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
            const trade = action.requireContract(AppContract.Trade, 'cannot read the outstanding evicted lot count');
            const seller = action.wallet.getAddress();
            return await Promise.all(
                hubTokenIds.map(async (hubTokenId) => {
                    try {
                        const count = await this.tradeClient.getSellerEvictedCount({
                            trade,
                            seller,
                            hub: BigInt(hubTokenId),
                        });
                        return { hubTokenId, count: Number(count) };
                    } catch (error) {
                        this.logger.warn('could not read the outstanding evicted lot count of a hub', {
                            hubTokenId,
                            error: errorMessage(error),
                        });
                        return { hubTokenId, count: null };
                    }
                }),
            );
        } catch (error) {
            this.logger.warn('could not reach the Trade contract for the evicted lot counts', {
                error: errorMessage(error),
            });
            return this.unknown(hubTokenIds);
        }
    }

    private unknown(hubTokenIds: ReadonlyArray<string>): Array<EvictedHubCount> {
        return hubTokenIds.map((hubTokenId) => ({ hubTokenId, count: null }));
    }
}

export function createEvictedLotCountService(context: AppContext): IEvictedLotCounts {
    const logger = context.logger.child('attention:evicted');
    const contracts = new ContractClient({ wallet: context.wallet, logger, retry: null });
    return new EvictedLotCountService({
        appConfig: context.appConfig,
        wallet: context.wallet,
        tradeClient: new TradeClient({ contracts, logger }),
        logger,
    });
}
