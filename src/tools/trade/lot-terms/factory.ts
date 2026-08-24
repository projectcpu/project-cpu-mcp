import { LotTermsService } from '../../../services/lot-terms.service.js';
import type { ILotTerms } from '../../../services/lot-terms.types.js';
import { TradeClient } from '../../../services/trade.client.js';
import type { AppContext } from '../../../types.js';
import { ContractClient } from '../../../wallet/contract-client.js';

export function createLotTermsService(context: AppContext): ILotTerms {
    const logger = context.logger.child('trade:lot-terms');
    const contracts = new ContractClient({ wallet: context.wallet, logger: logger.child('contract'), retry: null });
    return new LotTermsService({
        appConfig: context.appConfig,
        wallet: context.wallet,
        tradeClient: new TradeClient({ contracts, logger: logger.child('client') }),
        logger,
    });
}
