import type { IAppConfig, ITradeClient, LotTermsInput, LotTermsResult } from './types.js';
import type { ILogger } from '../logger/types.js';
import type { WalletProvider } from '../wallet/types.js';

export interface LotTermsServiceOptions {
    appConfig: IAppConfig;
    wallet: WalletProvider;
    tradeClient: ITradeClient;
    logger: ILogger;
}

/** One proposed listing, in the units the seller asked in. */
export interface ListingPreflightInput {
    hubTokenId: string;
    resourceId: number;
    value: string;
    pricePerUnit: string;
    /** Null means "lock in whatever the hub charges right now", so there is no tolerance to check. */
    maxSaleFeePercent: number | null;
}

/** Reads the live listing terms and refuses a listing the contract already refuses. */
export interface ILotTerms {
    getLotTerms(input: LotTermsInput): Promise<LotTermsResult>;
    /** Throws a domain error on the first violated rule, in the contract's own order. */
    assertListingAllowed(input: ListingPreflightInput): Promise<LotTermsResult>;
}
