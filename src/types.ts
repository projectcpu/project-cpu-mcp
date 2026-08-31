import type { ApiClient } from './api/client.js';
import type { EnvConfig } from './config/types.js';
import type { ILogger } from './logger/types.js';
import type { MapReader } from './map/reader.js';
import type { MapSync } from './map/sync.js';
import type { AppConfigService } from './services/app-config.service.js';
import type { AuthService } from './services/auth.service.js';
import type { BalanceService } from './services/balance.service.js';
import type { BuildService } from './services/build.service.js';
import type { CraftService } from './services/craft.service.js';
import type { IMarketAcceptanceService } from './services/market/acceptance.types.js';
import type { IMarketCancelService } from './services/market/cancel.types.js';
import type { IMarketListingService } from './services/market/listing.types.js';
import type { IMarketOfferService } from './services/market/offer.types.js';
import type { IMarketProfileReader } from './services/market/profile.schemas.js';
import type { IMarketPurchaseService } from './services/market/purchase.types.js';
import type { IMarketService } from './services/market/types.js';
import type { MiningService } from './services/mining.service.js';
import type { MintService } from './services/mint.service.js';
import type { RevealFulfilmentService } from './services/reveal-fulfilment.service.js';
import type { RevealService } from './services/reveal.service.js';
import type { RouteService } from './services/route.service.js';
import type { SwapService } from './services/swap.service.js';
import type { SyndicateService } from './services/syndicate.service.js';
import type { TradeRulesService } from './services/trade-rules.service.js';
import type { TradeService } from './services/trade.service.js';
import type { TransportService } from './services/transport.service.js';
import type { WithdrawService } from './services/withdraw.service.js';
import type { SessionManager } from './session/manager.js';
import type { IBackendVersionSignal, IPackageVersionSignal } from './version/types.js';
import type { WalletProvider } from './wallet/types.js';

export enum WalletMode {
    EVM = 'evm',
    PAYBOX = 'paybox',
}

export interface AppContext {
    config: EnvConfig;
    session: SessionManager;
    wallet: WalletProvider;
    api: ApiClient;
    auth: AuthService;
    appConfig: AppConfigService;
    reveal: RevealService;
    revealFulfilment: RevealFulfilmentService;
    build: BuildService;
    craft: CraftService;
    mining: MiningService;
    transport: TransportService;
    route: RouteService;
    trade: TradeService;
    tradeRules: TradeRulesService;
    market: IMarketService;
    marketProfile: IMarketProfileReader;
    marketListing: IMarketListingService;
    marketOffer: IMarketOfferService;
    marketPurchase: IMarketPurchaseService;
    marketAcceptance: IMarketAcceptanceService;
    marketCancel: IMarketCancelService;
    syndicate: SyndicateService;
    swap: SwapService;
    mint: MintService;
    balance: BalanceService;
    withdraw: WithdrawService;
    mapSync: MapSync;
    mapReader: MapReader;
    backendVersion: IBackendVersionSignal;
    packageVersion: IPackageVersionSignal;
    logger: ILogger;
}
