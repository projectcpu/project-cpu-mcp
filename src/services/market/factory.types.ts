import type { IMarketAcceptanceService } from './acceptance.types.js';
import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketCancelService } from './cancel.types.js';
import type { IMarketListingService } from './listing.types.js';
import type { IMarketOfferService } from './offer.types.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import type { IMarketPurchaseService } from './purchase.types.js';
import type { IMarketService, IMarketTransport } from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export interface MarketCoordinator {
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
}

export interface MarketServicesOptions {
    api: IMarketTransport;
    appConfig: IAppConfig;
    wallet: WalletProvider;
    network: string;
    /** Null builds a fresh one; the whole marketplace surface then shares that single coordinator. */
    coordinator: MarketCoordinator | null;
    logger: ILogger;
}

export interface MarketServices {
    market: IMarketService;
    marketProfile: IMarketProfileReader;
    marketListing: IMarketListingService;
    marketOffer: IMarketOfferService;
    marketPurchase: IMarketPurchaseService;
    marketAcceptance: IMarketAcceptanceService;
    marketCancel: IMarketCancelService;
}
