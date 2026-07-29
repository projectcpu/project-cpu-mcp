import { isAddress, type Address, type Hash } from 'viem';

import { decodeDeliveryScheduled, settleTransitFees } from './delivery.helpers.js';
import { TRANSPORT_MAX_FEE_BUFFER_PERCENT } from './transport.constants.js';
import {
    DeliveryFilter,
    type AppConfig,
    type DeliveryView,
    type FinalizeResult,
    type IAllowanceService,
    type IAppConfig,
    type ITransportClient,
    type TransportInput,
    type TransportQuote,
    type TransportResult,
    type TransportServiceOptions,
} from './types.js';
import type { ApiClient } from '../api/client.js';
import { describeApiError } from '../api/response.utils.js';
import { HttpStatus, type DeliveriesResponse, type DeliveryResponse } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { cpuFromWei } from '../utils/format.utils.js';
import type { IContractClient, WalletManager, WalletProvider } from '../wallet/types.js';

interface Route {
    transport: Address;
    from: Address;
    tokenIds: Array<bigint>;
    res: number;
    amount: bigint;
}

export class TransportService {
    private readonly api: ApiClient;
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly allowance: IAllowanceService;
    private readonly contracts: IContractClient;
    private readonly transportClient: ITransportClient;
    private readonly logger: ILogger;

    constructor(options: TransportServiceOptions) {
        this.api = options.api;
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.allowance = options.allowance;
        this.contracts = options.contracts;
        this.transportClient = options.transportClient;
        this.logger = options.logger;
    }

    async transport(input: TransportInput): Promise<TransportResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config.chainId, wallet.getChainId());
        const route = this.buildRoute(config, wallet, input);

        this.logger.info('quoting transport route', {
            resourceId: input.resourceId,
            amount: input.amount,
            network: config.network,
        });
        const quote = await this.transportClient.quoteRoute(route);
        const maxFee = quote.totalFee + (quote.totalFee * BigInt(TRANSPORT_MAX_FEE_BUFFER_PERCENT)) / 100n;

        const approveTxHash = await this.approveFee(config, route.transport, maxFee);

        const txHash = await this.transportClient.move({ ...route, maxFee });
        const confirmed = await this.contracts.confirm(txHash, 'Transport move');
        const scheduled = decodeDeliveryScheduled(confirmed.logs, route.transport);
        const transit = settleTransitFees(confirmed.logs, route.transport, quote.totalFee);

        this.logger.info('transport move confirmed', {
            deliveryId: scheduled.deliveryId.toString(),
            txHash: confirmed.txHash,
            block: confirmed.blockNumber,
        });

        return {
            deliveryId: scheduled.deliveryId.toString(),
            sourceTokenId: scheduled.sourceId.toString(),
            targetTokenId: scheduled.targetId.toString(),
            resourceId: input.resourceId,
            amount: input.amount,
            fee: cpuFromWei(quote.totalFee.toString()),
            transitPaid: cpuFromWei(transit.transitPaid.toString()),
            transitDiscount: cpuFromWei(transit.transitDiscount.toString()),
            arrivalAt: Number(scheduled.arrivalAt),
            txHash: confirmed.txHash,
            approveTxHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    async quote(input: TransportInput): Promise<TransportQuote> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config.chainId, wallet.getChainId());
        const route = this.buildRoute(config, wallet, input);

        this.logger.info('quoting transport', {
            resourceId: input.resourceId,
            amount: input.amount,
            network: config.network,
        });
        const quote = await this.transportClient.quoteRoute(route);
        return {
            fee: cpuFromWei(quote.totalFee.toString()),
            discount: cpuFromWei(quote.discount.toString()),
            totalDistance: Number(quote.totalDistance),
            arrivalAt: Number(quote.arrivalAt),
        };
    }

    async listMine(filter: DeliveryFilter): Promise<Array<DeliveryView>> {
        const address = this.wallet.get().getAddress();
        const deliveries = await this.fetchDeliveries(`?payer=${address}`);
        const nowMs = Date.now();
        const views = deliveries.map((d) => this.toView(d, nowMs));
        return views.filter((v) => this.matchesFilter(v, filter));
    }

    // Arrived-and-ready deliveries landing on the given owner's cells. Scopes by target-cell owner
    // server-side (public endpoint), so it never pulls the global delivery set.
    async listReadyToFinalizeForOwner(owner: string): Promise<Array<DeliveryView>> {
        const deliveries = await this.fetchDeliveries(`?owner=${owner}`);
        const nowMs = Date.now();
        return deliveries.map((d) => this.toView(d, nowMs)).filter((v) => v.readyToFinalize);
    }

    async getStatus(deliveryId: string): Promise<DeliveryView> {
        const deliveries = await this.fetchDeliveries('');
        const found = deliveries.find((d) => d.deliveryId === deliveryId);
        if (found === undefined) {
            throw new Error(`No delivery ${deliveryId} found.`);
        }
        return this.toView(found, Date.now());
    }

    async finalize(ids: Array<string>): Promise<FinalizeResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config.chainId, wallet.getChainId());
        const transport = this.resolveTransport(config);

        this.logger.info('finalizing deliveries', { ids, network: config.network });
        const txHash = await this.transportClient.finalize({ transport, ids: ids.map((id) => BigInt(id)) });
        const confirmed = await this.contracts.confirm(txHash, 'Finalize deliveries');
        return {
            deliveryIds: ids,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private buildRoute(config: AppConfig, wallet: WalletManager, input: TransportInput): Route {
        return {
            transport: this.resolveTransport(config),
            from: wallet.getAddress(),
            tokenIds: input.path.map((tokenId) => BigInt(tokenId)),
            res: input.resourceId,
            amount: BigInt(input.amount),
        };
    }

    private resolveTransport(config: AppConfig): Address {
        const transport = config.contracts.transport;
        if (!isAddress(transport, { strict: false })) {
            throw new Error(`Transport contract is not configured for network ${config.network}; cannot move.`);
        }
        return transport;
    }

    private async approveFee(config: AppConfig, transport: Address, maxFee: bigint): Promise<Hash | null> {
        if (maxFee === 0n) {
            return null;
        }
        const cpuToken = config.contracts.cpuToken;
        if (!isAddress(cpuToken, { strict: false })) {
            throw new Error(`$CPU token is not configured for network ${config.network}; cannot pay the transit fee.`);
        }
        return this.allowance.ensureAllowance(cpuToken, transport, maxFee);
    }

    private async fetchDeliveries(query: string): Promise<Array<DeliveryResponse>> {
        const response = await this.api.request<DeliveriesResponse>(`/api/v1/deliveries${query}`);
        if (response.status !== HttpStatus.Ok) {
            throw new Error(`Failed to list deliveries (HTTP ${response.status}): ${describeApiError(response.data)}`);
        }
        return response.data.deliveries;
    }

    private toView(d: DeliveryResponse, nowMs: number): DeliveryView {
        const readyToFinalize = !d.delivered && d.arrivalAt !== null && d.arrivalAt * 1000 <= nowMs;
        return {
            deliveryId: d.deliveryId,
            payer: d.payer,
            sourceTokenId: d.sourceTokenId,
            targetTokenId: d.targetTokenId,
            resourceId: d.resourceId,
            amount: d.amount,
            arrivalAt: d.arrivalAt,
            delivered: d.delivered,
            readyToFinalize,
        };
    }

    private matchesFilter(v: DeliveryView, filter: DeliveryFilter): boolean {
        switch (filter) {
            case DeliveryFilter.All:
                return true;
            case DeliveryFilter.Delivered:
                return v.delivered;
            case DeliveryFilter.ReadyToFinalize:
                return v.readyToFinalize;
            case DeliveryFilter.InTransit:
                return !v.delivered && !v.readyToFinalize;
        }
    }

    private assertChain(configChainId: number, walletChainId: number): void {
        if (configChainId !== walletChainId) {
            throw new Error(
                `Chain mismatch: the chain config is chainId ${configChainId} but the wallet is on ${walletChainId}. Check NETWORK.`,
            );
        }
    }
}
