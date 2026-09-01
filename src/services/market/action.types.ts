import type { MarketActionStage } from './types.js';

export enum MarketActionTool {
    ListCell = 'cpu_list_cell',
    MakeCellOffer = 'cpu_make_cell_offer',
    BuyCell = 'cpu_buy_cell',
    AcceptCellOffer = 'cpu_accept_cell_offer',
    CancelOrder = 'cpu_cancel_order',
}

export interface MarketActionIdentity {
    wallet: string;
    network: string;
    tool: MarketActionTool;
    inputs: ReadonlyArray<string | null>;
}

export interface MarketRecoveryRecord<TPayload = unknown> {
    tool: MarketActionTool;
    stage: MarketActionStage;
    payload: TPayload;
}

export interface IMarketSingleFlight {
    run<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export interface IMarketRecoveryStore {
    read<TPayload>(key: string): MarketRecoveryRecord<TPayload> | null;
    write(key: string, record: MarketRecoveryRecord): void;
    forget(key: string): void;
    size(): number;
}
