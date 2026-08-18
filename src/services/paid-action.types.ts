import type { Address } from 'viem';

import type { AppConfig, IAppConfig } from './types.js';
import type { WalletManager, WalletProvider } from '../wallet/types.js';

export enum AppContract {
    Land = 'land',
    CpuToken = 'cpuToken',
    CpuHook = 'cpuHook',
    Cell = 'cell',
    Transport = 'transport',
    Trade = 'trade',
    Syndicate = 'syndicate',
}

export interface PaidActionPreparationOptions {
    appConfig: IAppConfig;
    wallet: WalletProvider;
}

export interface PaidActionContext {
    config: AppConfig;
    wallet: WalletManager;
    requireContract(contract: AppContract, purpose: string): Address;
}
