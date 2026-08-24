import { formatEther } from 'viem';

import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import type { IAppConfig, ITradeClient, ITradeRules, LotListingRulesView, TradeRulesServiceOptions } from './types.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';
import { bpToPercent } from '../utils/format.utils.js';
import type { WalletProvider } from '../wallet/types.js';

/**
 * The listing rules live only on the deployed Trade contract — the game API's config projects the fee
 * parameters, not the lot window. Reading them is therefore a chain call, and the rulebook read that
 * carries them must survive a chain it cannot reach: an unavailable answer is null, never a guess.
 */
export class TradeRulesService implements ITradeRules {
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly tradeClient: ITradeClient;
    private readonly logger: ILogger;

    constructor(options: TradeRulesServiceOptions) {
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.tradeClient = options.tradeClient;
        this.logger = options.logger;
    }

    async loadLotListingRules(): Promise<LotListingRulesView | null> {
        if (!this.wallet.isReady()) {
            return null;
        }
        try {
            const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
            const trade = action.requireContract(AppContract.Trade, 'cannot read the lot listing rules');
            const config = await this.tradeClient.getConfig({ trade });
            return {
                minLotSharePercent: bpToPercent(config.minLotShareBp),
                maxLotSharePercent: bpToPercent(config.maxLotShareBp),
                minUncappedLotValue: config.minUncappedLotValue.toString(),
                maxUncappedLotValue: config.maxUncappedLotValue.toString(),
                maxLotsPerSellerHubResource: config.maxLotsPerSellerResource,
                minPricePerUnit: formatEther(config.minPricePerUnit),
            };
        } catch (error) {
            this.logger.warn('could not read the lot listing rules', { error: errorMessage(error) });
            return null;
        }
    }
}
