import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import type { ILotSnapshots, LotSnapshotsOptions } from './route.types.js';
import { TradeClient } from './trade.client.js';
import type { IAppConfig, ITradeClient, OnChainLot } from './types.js';
import type { ILogger } from '../logger/types.js';
import { ContractClient } from '../wallet/contract-client.js';
import type { WalletProvider } from '../wallet/types.js';

/**
 * Reads one lot straight from the Trade contract. Return-aware routing cannot take these facts from the
 * game API: it projects neither the reach nor the rate the hub carried when the lot was listed, and those
 * two are exactly what a hub that has since been demolished, rebuilt or sold can no longer tell anyone.
 */
export class TradeLotSnapshots implements ILotSnapshots {
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly tradeClient: ITradeClient;

    constructor(options: LotSnapshotsOptions) {
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.tradeClient = options.tradeClient;
    }

    async readLot(lotId: string): Promise<OnChainLot> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const trade = action.requireContract(AppContract.Trade, 'cannot read the lot this route plans a way home for');
        return this.tradeClient.getLot({ trade, lotId: BigInt(lotId) });
    }
}

export function createLotSnapshots(appConfig: IAppConfig, wallet: WalletProvider, logger: ILogger): ILotSnapshots {
    const contracts = new ContractClient({ wallet, logger: logger.child('contract'), retry: null });
    return new TradeLotSnapshots({
        appConfig,
        wallet,
        tradeClient: new TradeClient({ contracts, logger: logger.child('trade:client') }),
    });
}
