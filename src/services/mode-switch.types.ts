import type { Address, Hash, Log } from 'viem';

import type { PaidActionContext } from './paid-action.types.js';
import type {
    CatalogBuildingView,
    IAllowanceService,
    ICellClient,
    ModeCostView,
    ModeKey,
    ModeSwitchCharge,
} from './types.js';
import type { ILogger } from '../logger/types.js';

export enum ModeOperation {
    Mining = 'mining',
    Craft = 'craft',
}

export interface ModeSwitchCoordinatorOptions {
    allowance: IAllowanceService;
    cellClient: ICellClient;
    logger: ILogger;
}

export interface ModeBaseQuote<T> {
    baseCostWei: bigint;
    data: T;
}

export interface PrepareModeSwitchInput<T> {
    action: PaidActionContext;
    cell: Address;
    tokenId: bigint;
    operation: ModeOperation;
    target: ModeKey;
    mapBuilding: CatalogBuildingView | null;
    mapMode: ModeKey | null;
    paymentPurpose: string;
    quote(building: CatalogBuildingView | null): ModeBaseQuote<T>;
}

export interface PreparedModeSwitch {
    cost: ModeCostView;
    exact: boolean;
    approveTxHash: Hash | null;
    cpuToken: Address | null;
    payer: Address;
    baseCostWei: bigint;
}

export interface ReconcileModeSwitchInput {
    prepared: PreparedModeSwitch;
    logs: Array<Log>;
}

export interface PreparedModeSwitchResult<T> {
    data: T;
    charge: PreparedModeSwitch;
}

export type ModeSwitchReconciliation = ModeSwitchCharge;
