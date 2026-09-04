import { MarketAcceptanceService } from './acceptance.service.js';
import { MarketCancelService } from './cancel.service.js';
import { MarketApiClient } from './client.js';
import type { MarketCoordinator, MarketServices, MarketServicesOptions } from './factory.types.js';
import { MarketFulfilmentProof } from './fulfilment-proof.js';
import { WalletTransactionReader } from './fulfilment-proof.reader.js';
import { MarketListingService } from './listing.service.js';
import { MarketOfferService } from './offer.service.js';
import { MarketProfileClient } from './profile.client.js';
import { MarketPurchaseService } from './purchase.service.js';
import { MarketRecoveryStore } from './recovery.store.js';
import { MarketService } from './service.js';
import { MarketSingleFlight } from './single-flight.js';
import { chainIdForNetwork } from '../../config/network.utils.js';

// One recovery store and one single-flight map for the whole marketplace surface: the bound on
// unresolved creations is a promise about this process, not about one tool, and two tools that
// happened to hold 100 records each would break it.
export function createMarketCoordinator(): MarketCoordinator {
    return { singleFlight: new MarketSingleFlight(), recovery: new MarketRecoveryStore() };
}

export function createMarketServices(options: MarketServicesOptions): MarketServices {
    const { appConfig, wallet, network, logger } = options;
    const client = new MarketApiClient({ api: options.api, logger: logger.child('market:api') });
    const { singleFlight, recovery } = options.coordinator ?? createMarketCoordinator();
    const proof = new MarketFulfilmentProof({
        transactions: new WalletTransactionReader({ wallet, logger: logger.child('market:chain') }),
        logger: logger.child('market:proof'),
    });
    const profile = new MarketProfileClient({
        client,
        chainId: chainIdForNetwork(network),
        logger: logger.child('market:profile'),
    });

    return {
        market: new MarketService({ client, logger: logger.child('market') }),
        marketProfile: profile,
        marketListing: new MarketListingService({
            client,
            profile,
            appConfig,
            wallet,
            network,
            singleFlight,
            recovery,
            logger: logger.child('market:listing'),
        }),
        marketOffer: new MarketOfferService({
            client,
            profile,
            appConfig,
            wallet,
            network,
            singleFlight,
            recovery,
            logger: logger.child('market:offer'),
        }),
        marketPurchase: new MarketPurchaseService({
            client,
            proof,
            appConfig,
            wallet,
            network,
            singleFlight,
            recovery,
            logger: logger.child('market:purchase'),
        }),
        marketAcceptance: new MarketAcceptanceService({
            client,
            proof,
            appConfig,
            wallet,
            network,
            singleFlight,
            recovery,
            logger: logger.child('market:acceptance'),
        }),
        marketCancel: new MarketCancelService({
            client,
            proof,
            wallet,
            network,
            singleFlight,
            recovery,
            logger: logger.child('market:cancel'),
        }),
    };
}
