import { AllowanceService } from '../../../services/allowance.service.js';
import { LotReturnService } from '../../../services/lot-return.service.js';
import type { ILotReturnService } from '../../../services/lot-return.types.js';
import { TradeClient } from '../../../services/trade.client.js';
import type { AppContext } from '../../../types.js';
import { ContractClient } from '../../../wallet/contract-client.js';

export function createLotReturnService(context: AppContext): ILotReturnService {
    const logger = context.logger.child('trade:return');
    const contracts = new ContractClient({ wallet: context.wallet, logger: logger.child('contract'), retry: null });
    return new LotReturnService({
        wallet: context.wallet,
        appConfig: context.appConfig,
        allowance: new AllowanceService({ wallet: context.wallet, logger: logger.child('allowance') }),
        contracts,
        tradeClient: new TradeClient({ contracts, logger: logger.child('client') }),
        mapReader: context.mapReader,
        logger,
    });
}
