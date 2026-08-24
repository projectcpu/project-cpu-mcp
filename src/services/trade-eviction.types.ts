import type { Hash } from 'viem';

import type { EvictLotInput, EvictLotResult, EvictLotParams, GetLotParams, IAppConfig, OnChainLot } from './types.js';
import type { ILogger } from '../logger/types.js';
import type { RevealCellReader } from '../map/types.js';
import type { ConfirmedTx, WalletProvider } from '../wallet/types.js';

/**
 * Deliberately narrower than `ITradeClient`: eviction must never be able to reach `buy`, `cancel`,
 * `reclaim` or `createLot`, and a service that cannot name them cannot move a unit of anyone's goods.
 */
export interface ILotEvictionClient {
    getLot(params: GetLotParams): Promise<OnChainLot>;
    evict(params: EvictLotParams): Promise<Hash>;
}

/** The receipt half of the contract client; eviction sends only through `ILotEvictionClient`. */
export interface ILotEvictionConfirmer {
    confirm(txHash: Hash, revertLabel: string): Promise<ConfirmedTx>;
}

export interface LotEvictionServiceOptions {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    tradeClient: ILotEvictionClient;
    contracts: ILotEvictionConfirmer;
    mapReader: RevealCellReader;
    logger: ILogger;
}

/** One hub owner ending one foreign Open lot — implemented by LotEvictionService. */
export interface ILotEviction {
    evictLot(input: EvictLotInput): Promise<EvictLotResult>;
}
