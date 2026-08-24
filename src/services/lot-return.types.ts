import type {
    IAllowanceService,
    IAppConfig,
    ITradeClient,
    LotReturnInput,
    LotReturnQuote,
    LotReturnResult,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import type { RevealCellReader } from '../map/types.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export interface LotReturnServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    contracts: IContractClient;
    tradeClient: ITradeClient;
    mapReader: RevealCellReader;
    logger: ILogger;
}

/** One player intent — send a lot's whole remainder home — quoted and then settled. */
export interface ILotReturnService {
    quoteReturn(input: LotReturnInput): Promise<LotReturnQuote>;
    returnLot(input: LotReturnInput): Promise<LotReturnResult>;
}
