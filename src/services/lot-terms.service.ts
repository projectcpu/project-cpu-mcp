import { formatEther, parseEther, type Address } from 'viem';

import {
    aboveMaximumMessage,
    belowMinimumMessage,
    emptyWindowMessage,
    evictedPendingMessage,
    invalidPriceMessage,
    invalidValueMessage,
    parseListedValue,
    priceBelowFloorMessage,
    saleFeeToleranceMessage,
    sellerLotLimitMessage,
} from './lot-terms.helpers.js';
import type { ILotTerms, ListingPreflightInput, LotTermsServiceOptions } from './lot-terms.types.js';
import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import {
    LotListingBlocker,
    type IAppConfig,
    type ITradeClient,
    type LotTermsInput,
    type LotTermsResult,
    type OnChainTradeConfig,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import { bpToPercent } from '../utils/format.utils.js';
import type { WalletProvider } from '../wallet/types.js';

interface LiveTerms {
    terms: LotTermsResult;
    config: OnChainTradeConfig;
    trade: Address;
    hub: bigint;
}

/**
 * The listing terms of one hub and resource, and the gate `cpu_create_lot` passes through. The window is
 * read from the contract's own bound views and never worked out from the configured shares, and every
 * deterministic refusal happens here — before the allowance and before the transaction — so a listing the
 * contract already refuses never costs the seller an approval or gas.
 */
export class LotTermsService implements ILotTerms {
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly tradeClient: ITradeClient;
    private readonly logger: ILogger;

    constructor(options: LotTermsServiceOptions) {
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.tradeClient = options.tradeClient;
        this.logger = options.logger;
    }

    async getLotTerms(input: LotTermsInput): Promise<LotTermsResult> {
        return (await this.readLiveTerms(input.hubTokenId, input.resourceId)).terms;
    }

    async assertListingAllowed(input: ListingPreflightInput): Promise<LotTermsResult> {
        const { terms, config, trade, hub } = await this.readLiveTerms(input.hubTokenId, input.resourceId);
        const { hubTokenId, resourceId } = input;

        if (terms.outstandingEvictedCount > 0) {
            throw new Error(evictedPendingMessage(terms.outstandingEvictedCount, hubTokenId));
        }

        const value = parseListedValue(input.value);
        if (value === null) {
            throw new Error(invalidValueMessage(input.value));
        }
        const price = this.parsePrice(input.pricePerUnit);
        if (price === null) {
            throw new Error(invalidPriceMessage(input.pricePerUnit));
        }
        if (price < config.minPricePerUnit) {
            throw new Error(priceBelowFloorMessage(input.pricePerUnit, formatEther(config.minPricePerUnit)));
        }

        if (terms.blockers.includes(LotListingBlocker.EmptyWindow)) {
            throw new Error(emptyWindowMessage(hubTokenId, resourceId, terms.effectiveMin, terms.effectiveMax));
        }
        if (value < BigInt(terms.effectiveMin)) {
            throw new Error(belowMinimumMessage(input.value, terms.effectiveMin, hubTokenId, resourceId));
        }
        if (value > BigInt(terms.effectiveMax)) {
            throw new Error(aboveMaximumMessage(input.value, terms.effectiveMax, hubTokenId, resourceId));
        }
        if (terms.blockers.includes(LotListingBlocker.SellerLotLimit)) {
            throw new Error(sellerLotLimitMessage(terms.sellerLotCount, terms.sellerLotLimit, hubTokenId, resourceId));
        }

        if (input.maxSaleFeePercent !== null) {
            const livePercent = bpToPercent(await this.tradeClient.getSaleFee({ trade, hub, res: resourceId }));
            if (livePercent > input.maxSaleFeePercent) {
                throw new Error(saleFeeToleranceMessage(livePercent, input.maxSaleFeePercent, hubTokenId));
            }
        }

        return terms;
    }

    private async readLiveTerms(hubTokenId: string, resourceId: number): Promise<LiveTerms> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const trade = action.requireContract(AppContract.Trade, 'cannot read the lot listing terms');
        const seller = action.wallet.getAddress();
        const hub = BigInt(hubTokenId);

        const evicted = await this.tradeClient.getSellerEvictedCount({ trade, seller, hub });
        const config = await this.tradeClient.getConfig({ trade });
        const min = await this.tradeClient.getMinLotValue({ trade, hub, res: resourceId });
        const max = await this.tradeClient.getMaxLotValue({ trade, hub, res: resourceId });
        const lotCount = await this.tradeClient.getSellerLotCount({ trade, seller, hub, res: resourceId });

        const blockers: Array<LotListingBlocker> = [];
        if (evicted > 0n) {
            blockers.push(LotListingBlocker.EvictedPending);
        }
        if (max === 0n || min > max) {
            blockers.push(LotListingBlocker.EmptyWindow);
        }
        if (lotCount >= BigInt(config.maxLotsPerSellerResource)) {
            blockers.push(LotListingBlocker.SellerLotLimit);
        }

        this.logger.info('read lot terms', {
            hubTokenId,
            resourceId,
            effectiveMin: min.toString(),
            effectiveMax: max.toString(),
            blockers,
        });

        return {
            trade,
            hub,
            config,
            terms: {
                hubTokenId,
                resourceId,
                sellerAddress: seller,
                effectiveMin: min.toString(),
                effectiveMax: max.toString(),
                sellerLotCount: Number(lotCount),
                sellerLotLimit: config.maxLotsPerSellerResource,
                outstandingEvictedCount: Number(evicted),
                canList: blockers.length === 0,
                blockers,
            },
        };
    }

    private parsePrice(pricePerUnit: string): bigint | null {
        try {
            const wei = parseEther(pricePerUnit);
            return wei > 0n ? wei : null;
        } catch {
            return null;
        }
    }
}
