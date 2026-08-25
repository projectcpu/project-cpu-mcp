import type { Address, Hash } from 'viem';

import { decodeDeliveryScheduled, settleTransitFees } from './delivery.helpers.js';
import type { ILotReturnService, LotReturnServiceOptions } from './lot-return.types.js';
import {
    assertFeeWithinCeiling,
    assertReturnRoute,
    assertReturnableLot,
    assertRouteStartsAtHub,
    assertWholeRemainder,
    decodeReturnedUnits,
    describeCapacityRefusal,
    describeLotReturnRevert,
    parseFeeCeilingWei,
    returnBranchOf,
} from './lot-return.utils.js';
import { preparePaidAction } from './paid-action.js';
import { AppContract, type PaidActionContext } from './paid-action.types.js';
import {
    LotReturnBranch,
    type DestinationCapacityView,
    type IAllowanceService,
    type IAppConfig,
    type ITradeClient,
    type LotReturnInput,
    type LotReturnQuote,
    type LotReturnQuoteInput,
    type LotReturnResult,
    type OnChainLot,
    type ReturnQuoteResult,
} from './types.js';
import { assessDestinationCapacity } from './warehouse.utils.js';
import type { LotState } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import type { RevealCellReader } from '../map/types.js';
import { cpuFromWei } from '../utils/format.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

interface PreparedReturn {
    action: PaidActionContext;
    trade: Address;
    lot: OnChainLot;
    state: LotState;
    seller: Address;
    lotId: bigint;
    returnTokenIds: Array<bigint>;
    destinationTokenId: string;
}

/**
 * One seller intent — send a lot's whole unsold remainder home — over the two contract branches that can
 * carry it: `cancel` for an Open lot, `reclaim` for an Evicted one. Both are priced by `Trade.quoteReturn`
 * and both carry the ceiling the seller passes in, never a figure this service picked for them: the route is
 * re-priced on-chain to decide, and a fee that outgrew the seller's ceiling refuses before anything is spent.
 */
export class LotReturnService implements ILotReturnService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly allowance: IAllowanceService;
    private readonly contracts: IContractClient;
    private readonly tradeClient: ITradeClient;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;

    constructor(options: LotReturnServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.allowance = options.allowance;
        this.contracts = options.contracts;
        this.tradeClient = options.tradeClient;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
    }

    async quoteReturn(input: LotReturnQuoteInput): Promise<LotReturnQuote> {
        const prepared = await this.prepare(input);
        const quote = await this.quoteOnChain(prepared);
        const capacity = await this.assessDestination(prepared, quote.amount);
        return this.toQuoteView(prepared, quote, capacity);
    }

    async returnLot(input: LotReturnInput): Promise<LotReturnResult> {
        const maxFee = parseFeeCeilingWei(input.maxTransitFeeWei, input.lotId);
        const prepared = await this.prepare(input);
        const { action, trade, lot, state, lotId, returnTokenIds } = prepared;
        const transport = action.requireContract(AppContract.Transport, 'cannot route goods');

        const quote = await this.quoteOnChain(prepared);
        assertWholeRemainder(quote.amount, lot.remaining, input.lotId);
        assertFeeWithinCeiling(quote.transitFee, maxFee, input.lotId);

        const capacity = await this.assessDestination(prepared, quote.amount);
        if (!capacity.fits) {
            throw new Error(describeCapacityRefusal(capacity, prepared.destinationTokenId, input.lotId));
        }

        const branch = returnBranchOf(state);
        const approveTxHash =
            maxFee === 0n
                ? null
                : await this.allowance.ensureAllowance(
                      action.requireContract(AppContract.CpuToken, 'cannot pay for transit'),
                      transport,
                      maxFee,
                  );

        this.logger.info('returning lot', {
            lotId: input.lotId,
            branch,
            maxFeeWei: maxFee.toString(),
            quotedFeeWei: quote.transitFee.toString(),
            amount: quote.amount.toString(),
        });

        let confirmed;
        try {
            const txHash: Hash =
                branch === LotReturnBranch.Reclaimed
                    ? await this.tradeClient.reclaim({ trade, lotId, returnTokenIds, maxFee })
                    : await this.tradeClient.cancel({ trade, lotId, returnTokenIds, maxFee });
            confirmed = await this.contracts.confirm(txHash, `Return lot ${input.lotId}`);
        } catch (error) {
            throw describeLotReturnRevert(error, branch);
        }

        const scheduled = decodeDeliveryScheduled(confirmed.logs, transport);
        const transit = settleTransitFees(confirmed.logs, transport, quote.transitFee);
        const returned = decodeReturnedUnits(confirmed.logs, trade, quote.amount, this.logger);

        return {
            lotId: input.lotId,
            originalState: state,
            branch,
            hubTokenId: lot.hub.toString(),
            resourceId: lot.resource,
            returned: returned.toString(),
            transitPaid: cpuFromWei(transit.transitPaid.toString()),
            transitDiscount: cpuFromWei(transit.transitDiscount.toString()),
            destinationTokenId: scheduled.targetId.toString(),
            deliveryId: scheduled.deliveryId.toString(),
            arrivalAt: Number(scheduled.arrivalAt),
            approveTxHash,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private async prepare(input: LotReturnQuoteInput): Promise<PreparedReturn> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const trade = action.requireContract(AppContract.Trade, 'cannot return a lot');
        assertReturnRoute(input.chain);

        const seller = action.wallet.getAddress();
        const lotId = BigInt(input.lotId);
        const lot = await this.tradeClient.getLot({ trade, lotId });
        const state = assertReturnableLot(lot, seller, input.lotId);
        assertRouteStartsAtHub(input.chain, lot.hub, input.lotId);

        return {
            action,
            trade,
            lot,
            state,
            seller,
            lotId,
            returnTokenIds: input.chain.map((tokenId) => BigInt(tokenId)),
            destinationTokenId: String(input.chain[input.chain.length - 1]),
        };
    }

    private async quoteOnChain(prepared: PreparedReturn): Promise<ReturnQuoteResult> {
        return this.tradeClient.quoteReturn({
            trade: prepared.trade,
            lotId: prepared.lotId,
            returnTokenIds: prepared.returnTokenIds,
            seller: prepared.seller,
        });
    }

    private async assessDestination(prepared: PreparedReturn, required: bigint): Promise<DestinationCapacityView> {
        await this.mapReader.refresh();
        const cell = await this.mapReader.readRevealCell(prepared.destinationTokenId);
        if (cell === null) {
            throw new Error(
                `Cell ${prepared.destinationTokenId} is not in the world map, so the room it has for the ` +
                    `remainder cannot be checked. Nothing was sent — retry shortly, or route the return to a ` +
                    `revealed cell of your own.`,
            );
        }
        return assessDestinationCapacity(cell, prepared.lot.resource, required);
    }

    private toQuoteView(
        prepared: PreparedReturn,
        quote: ReturnQuoteResult,
        capacity: DestinationCapacityView,
    ): LotReturnQuote {
        return {
            lotId: prepared.lotId.toString(),
            hubTokenId: prepared.lot.hub.toString(),
            resourceId: prepared.lot.resource,
            amount: quote.amount.toString(),
            destinationTokenId: prepared.destinationTokenId,
            maxTransitFee: cpuFromWei(quote.transitFee.toString()),
            maxTransitFeeWei: quote.transitFee.toString(),
            transitDiscount: cpuFromWei(quote.transitDiscount.toString()),
            totalDistance: Number(quote.totalDistance),
            arrivalAt: Number(quote.arrivalAt),
            capacity,
        };
    }
}
