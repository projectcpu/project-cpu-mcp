#!/usr/bin/env node

import * as os from 'node:os';

import pkg from '../package.json' with { type: 'json' };
import { ApiClient } from './api/client.js';
import { RevealRequestsClient } from './api/reveal-requests.client.js';
import { DEFAULT_API_URL } from './config/constants.js';
import { loadEnvConfig } from './config/env.js';
import { createLogger } from './logger/index.js';
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_RECONNECT_GRACE_MS } from './map/constants.js';
import { MapReader } from './map/reader.js';
import { createMapSocket } from './map/socket.js';
import { MapStore } from './map/store.js';
import { MapSync } from './map/sync.js';
import { FulfilmentClaims } from './randomness/claims.js';
import { RandomnessStrategyFactory } from './randomness/factory.js';
import { startRevealFulfilment } from './randomness/fulfiller.factory.js';
import { SelfServiceRandomnessResolver } from './randomness/self-service.resolver.js';
import { createServer } from './server.js';
import { AllowanceService } from './services/allowance.service.js';
import { AppConfigService } from './services/app-config.service.js';
import { AuthService } from './services/auth.service.js';
import { BalanceService } from './services/balance.service.js';
import { BuildService } from './services/build.service.js';
import { CellClient } from './services/cell.client.js';
import { CraftService } from './services/craft.service.js';
import { MarketApiClient } from './services/market/client.js';
import { MarketService } from './services/market/service.js';
import { MiningService } from './services/mining.service.js';
import { MintService } from './services/mint.service.js';
import { RevealFulfilmentService } from './services/reveal-fulfilment.service.js';
import { RevealService } from './services/reveal.service.js';
import { RouteService } from './services/route.service.js';
import { SwapService } from './services/swap.service.js';
import { SyndicateRegistryClient } from './services/syndicate.client.js';
import { SyndicateService } from './services/syndicate.service.js';
import { TradeRulesService } from './services/trade-rules.service.js';
import { TradeClient } from './services/trade.client.js';
import { TradeService } from './services/trade.service.js';
import { TransportClient } from './services/transport.client.js';
import { TransportService } from './services/transport.service.js';
import { WithdrawService } from './services/withdraw.service.js';
import { SessionManager } from './session/manager.js';
import { SessionStorage } from './session/storage.js';
import type { AppContext } from './types.js';
import { errorMessage } from './utils/error.utils.js';
import { BackendVersion, createBackendVersionProbe } from './version/backend-version.js';
import { BACKEND_VERSION_TTL_MS, PACKAGE_VERSION_TTL_MS } from './version/constants.js';
import { fetchLatestFromRegistry, PackageVersion } from './version/package-version.js';
import { ResetCoordinator } from './version/reset-coordinator.js';
import type { OnBackendVersionChange } from './version/types.js';
import { ContractClient } from './wallet/contract-client.js';
import { createWalletProvider } from './wallet/index.js';

async function main(): Promise<void> {
    const config = loadEnvConfig();
    const logger = createLogger();
    logger.info('starting MCP server', { network: config.NETWORK });

    const storage = new SessionStorage(os.homedir(), logger.child('session:storage'));
    const session = new SessionManager({
        storage,
        logger: logger.child('session'),
    });
    session.initialize();
    logger.info('session initialized', { status: session.getStatus() });

    const wallet = createWalletProvider({ config, logger });
    logger.info('wallet provider created', { ready: wallet.isReady() });

    const api = new ApiClient({
        baseUrl: config.API_URL ?? DEFAULT_API_URL,
        session,
        logger: logger.child('api'),
    });

    const auth = new AuthService({ session, api, wallet, logger: logger.child('auth') });
    api.setAuthenticator(auth);

    const appConfig = new AppConfigService({ api, network: config.NETWORK, logger: logger.child('config') });
    const allowance = new AllowanceService({ wallet, logger: logger.child('allowance') });
    const contracts = new ContractClient({ wallet, logger: logger.child('contract'), retry: null });
    const cellClient = new CellClient({ contracts, logger: logger.child('cell') });
    const revealRequests = new RevealRequestsClient({ api, logger: logger.child('reveal:requests') });
    const claims = new FulfilmentClaims();
    const randomness = new RandomnessStrategyFactory({
        contracts,
        revealRequests,
        logger: logger.child('randomness'),
    });
    const transportClient = new TransportClient({ contracts, logger: logger.child('transport:client') });
    const tradeClient = new TradeClient({ contracts, logger: logger.child('trade:client') });
    const transport = new TransportService({
        api,
        wallet,
        appConfig,
        allowance,
        contracts,
        transportClient,
        logger: logger.child('transport'),
    });
    const trade = new TradeService({
        api,
        wallet,
        appConfig,
        allowance,
        contracts,
        tradeClient,
        transportClient,
        logger: logger.child('trade'),
    });
    const tradeRules = new TradeRulesService({
        appConfig,
        wallet,
        tradeClient,
        logger: logger.child('trade:rules'),
    });
    const market = new MarketService({
        client: new MarketApiClient({ api, logger: logger.child('market:api') }),
        logger: logger.child('market'),
    });
    const syndicateRegistry = new SyndicateRegistryClient({ contracts, logger: logger.child('syndicate:client') });
    const syndicate = new SyndicateService({
        api,
        wallet,
        appConfig,
        registry: syndicateRegistry,
        logger: logger.child('syndicate'),
    });
    const swap = new SwapService({ wallet, appConfig, allowance, logger: logger.child('swap') });
    const mint = new MintService({ wallet, appConfig, logger: logger.child('mint') });
    const balance = new BalanceService({ wallet, appConfig, logger: logger.child('balance') });

    const packageVersion = new PackageVersion({
        currentVersion: pkg.version,
        fetchLatest: fetchLatestFromRegistry,
        nowMs: () => Date.now(),
        ttlMs: PACKAGE_VERSION_TTL_MS,
        logger: logger.child('version:package'),
    });

    const resetRequest: { run: OnBackendVersionChange } = {
        run: () => Promise.reject(new Error('state reset requested before startup wiring finished')),
    };
    const backendVersion = new BackendVersion({
        probe: createBackendVersionProbe(api),
        nowMs: () => Date.now(),
        ttlMs: BACKEND_VERSION_TTL_MS,
        onChange: () => resetRequest.run(),
        logger: logger.child('version:backend'),
    });

    const store = new MapStore();
    const mapSync = new MapSync({
        store,
        api,
        backendVersion,
        socketFactory: createMapSocket,
        logger: logger.child('map:sync'),
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        reconnectGraceMs: DEFAULT_RECONNECT_GRACE_MS,
    });
    const mapReader = new MapReader({ store, status: mapSync, appConfig });

    const resetCoordinator = new ResetCoordinator({
        appConfig,
        mapSync,
        swap,
        syndicate,
        logger: logger.child('version:reset'),
    });
    resetRequest.run = () => resetCoordinator.reset();

    const route = new RouteService({
        wallet,
        appConfig,
        mapReader,
        logger: logger.child('route'),
        artifactDirectory: null,
    });

    const withdraw = new WithdrawService({
        wallet,
        appConfig,
        cellClient,
        contracts,
        mapReader,
        logger: logger.child('withdraw'),
    });

    const build = new BuildService({
        wallet,
        appConfig,
        allowance,
        cellClient,
        contracts,
        mapReader,
        logger: logger.child('build'),
    });

    const mining = new MiningService({
        wallet,
        appConfig,
        allowance,
        cellClient,
        contracts,
        mapReader,
        logger: logger.child('mining'),
    });

    const craft = new CraftService({
        wallet,
        appConfig,
        allowance,
        cellClient,
        contracts,
        mapReader,
        logger: logger.child('craft'),
    });

    const reveal = new RevealService({
        wallet,
        appConfig,
        allowance,
        cellClient,
        contracts,
        randomness,
        claims,
        mapReader,
        logger: logger.child('reveal'),
    });

    const revealFulfilment = new RevealFulfilmentService({
        wallet,
        appConfig,
        randomness: new SelfServiceRandomnessResolver({
            appConfig,
            randomness,
            logger: logger.child('reveal:fulfilment'),
        }),
        revealRequests,
        contracts,
        claims,
        logger: logger.child('reveal:fulfilment'),
    });

    const context: AppContext = {
        config,
        session,
        wallet,
        api,
        auth,
        appConfig,
        reveal,
        revealFulfilment,
        build,
        craft,
        mining,
        transport,
        route,
        trade,
        tradeRules,
        market,
        syndicate,
        swap,
        mint,
        balance,
        withdraw,
        mapSync,
        mapReader,
        backendVersion,
        packageVersion,
        logger,
    };

    // Connect the transport first so the handshake isn't blocked, then load the map in the
    // background — a slow or unreachable map source must not delay or break startup.
    await createServer(context);
    logger.info('MCP server listening on stdio');

    mapSync.start();

    const fulfilment = startRevealFulfilment({
        appConfig,
        randomness,
        revealRequests,
        contracts,
        wallet,
        claims,
        logger: logger.child('reveal:fulfiller'),
    });

    const shutdown = (): void => {
        fulfilment.stop();
        mapSync.stop();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
    createLogger().error(`fatal: ${errorMessage(error)}`);
    process.exit(1);
});
