import type { WalletProvider } from '../wallet/types.js';

export enum SeaportItemType {
    Native = 0,
    Erc20 = 1,
    Erc721 = 2,
    Erc1155 = 3,
    Erc721WithCriteria = 4,
    Erc1155WithCriteria = 5,
}

export enum SeaportOrderType {
    FullOpen = 0,
    PartialOpen = 1,
    FullRestricted = 2,
    PartialRestricted = 3,
    Contract = 4,
}

export enum SeaportSpenderOutcome {
    Resolved = 'resolved',
    Unregistered = 'unregistered',
    Unreachable = 'unreachable',
}

export interface SeaportSpenderAnswer {
    outcome: SeaportSpenderOutcome;
    address: string | null;
    detail: string | null;
}

export interface SeaportSpenderReaderOptions {
    wallet: WalletProvider;
}

export interface ISeaportSpenderReader {
    spenderForConduitKey(conduitKey: string): Promise<SeaportSpenderAnswer>;
    registeredSpender(spender: string): Promise<SeaportSpenderAnswer>;
}
