import { parseEventLogs, type Address } from 'viem';

import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import { EVICTION_TX_LABEL } from './trade-eviction.constants.js';
import type {
    ILotEviction,
    ILotEvictionClient,
    ILotEvictionConfirmer,
    LotEvictionServiceOptions,
} from './trade-eviction.types.js';
import {
    enrichEvictionRevert,
    hubNotInMapMessage,
    lotAlreadyEvictedMessage,
    lotDeliveringMessage,
    lotNotLiveMessage,
    notHubOwnerMessage,
    selfEvictionMessage,
} from './trade-eviction.utils.js';
import { lotStateFromChain } from './trade.helpers.js';
import type { EvictLotInput, EvictLotResult, IAppConfig, OnChainLot } from './types.js';
import { LotState } from '../api/types.js';
import { TRADE_ABI } from '../contracts/trade.abi.js';
import type { ILogger } from '../logger/types.js';
import type { RevealCellReader } from '../map/types.js';
import { sameAddress } from '../randomness/request.utils.js';
import type { ConfirmedTx, WalletProvider } from '../wallet/types.js';

/**
 * A hub owner ending one foreign Open lot on their own hub. Eviction is the narrowest write in Trade: it
 * takes the shelf back and nothing else — no route, no escrow, no transfer — so this service holds no
 * transport, allowance or delivery dependency at all, and the lot's units stay the seller's and stay
 * escrowed until the seller ships them home themselves.
 */
export class LotEvictionService implements ILotEviction {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly tradeClient: ILotEvictionClient;
    private readonly contracts: ILotEvictionConfirmer;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;

    constructor(options: LotEvictionServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.tradeClient = options.tradeClient;
        this.contracts = options.contracts;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
    }

    async evictLot(input: EvictLotInput): Promise<EvictLotResult> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const trade = action.requireContract(AppContract.Trade, 'cannot evict a lot');
        const caller = action.wallet.getAddress();
        const lotId = BigInt(input.lotId);

        const lot = await this.tradeClient.getLot({ trade, lotId });
        this.assertForeignOpenLot(input.lotId, lot, caller);
        await this.assertHubOwner(input.lotId, lot, caller);

        this.logger.info('evicting lot', {
            lotId: input.lotId,
            hub: lot.hub.toString(),
            network: action.config.network,
        });

        const confirmed = await this.submit(trade, lotId, input.lotId);
        const evicted = parseEventLogs({ abi: TRADE_ABI, eventName: 'LotEvicted', logs: confirmed.logs }).find(
            (event) => sameAddress(event.address, trade),
        );
        if (evicted === undefined) {
            throw new Error(
                `The eviction of lot ${input.lotId} confirmed but Trade emitted no LotEvicted event; the lot's ` +
                    `state is unproven. Re-read it with cpu_get_lot before acting on it.`,
            );
        }

        return {
            lotId: evicted.args.lotId.toString(),
            hubTokenId: lot.hub.toString(),
            sellerAddress: evicted.args.seller,
            resourceId: lot.resource,
            remaining: evicted.args.remaining.toString(),
            state: LotState.Evicted,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private assertForeignOpenLot(lotId: string, lot: OnChainLot, caller: Address): void {
        const state = lotStateFromChain(lot.state);
        const hubTokenId = lot.hub.toString();
        if (state === null) {
            throw new Error(lotNotLiveMessage(lotId));
        }
        if (state === LotState.Delivering) {
            throw new Error(lotDeliveringMessage(lotId, hubTokenId));
        }
        if (state === LotState.Evicted) {
            throw new Error(lotAlreadyEvictedMessage(lotId, hubTokenId));
        }
        if (sameAddress(lot.seller, caller)) {
            throw new Error(selfEvictionMessage(lotId));
        }
    }

    // The local snapshot is refreshed first: eviction is admitted on ownership, and a cached hub that has
    // since changed hands would let the call through to a guaranteed on-chain refusal.
    private async assertHubOwner(lotId: string, lot: OnChainLot, caller: Address): Promise<void> {
        await this.mapReader.refresh();
        const hubTokenId = lot.hub.toString();
        const hub = await this.mapReader.readRevealCell(hubTokenId);
        if (hub === null) {
            throw new Error(hubNotInMapMessage(lotId, hubTokenId));
        }
        if (!sameAddress(hub.owner, caller)) {
            throw new Error(notHubOwnerMessage(lotId, hubTokenId, hub.owner));
        }
    }

    private async submit(trade: Address, lotId: bigint, label: string): Promise<ConfirmedTx> {
        try {
            const txHash = await this.tradeClient.evict({ trade, lotId });
            return await this.contracts.confirm(txHash, `${EVICTION_TX_LABEL} ${label}`);
        } catch (error) {
            throw enrichEvictionRevert(error, label);
        }
    }
}
