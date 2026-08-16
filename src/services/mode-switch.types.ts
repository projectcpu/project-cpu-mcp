import type { Address, Hash, Log } from 'viem';

import type { PaidActionContext } from './paid-action.types.js';
import type { CatalogBuildingView, IAllowanceService, ICellClient, ModeCostView, ModeSwitchCharge } from './types.js';
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

interface PrepareModeSwitchBase<T> {
    action: PaidActionContext;
    cell: Address;
    tokenId: bigint;
    mapBuilding: CatalogBuildingView | null;
    paymentPurpose: string;
    quote(building: CatalogBuildingView | null): ModeBaseQuote<T>;
}

interface PrepareMiningModeSwitch {
    operation: ModeOperation.Mining;
    target: number;
    mapMode: number | null;
}

interface PrepareCraftModeSwitch {
    operation: ModeOperation.Craft;
    target: bigint;
    mapMode: bigint | null;
}

export type PrepareModeSwitchInput<T> = PrepareModeSwitchBase<T> & (PrepareMiningModeSwitch | PrepareCraftModeSwitch);

export interface ModePriceContext {
    mode: number | bigint | null;
    building: CatalogBuildingView | null;
    exact: boolean;
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
