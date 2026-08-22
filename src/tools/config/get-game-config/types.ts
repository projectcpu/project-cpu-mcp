import type {
    RandomnessDescriptor,
    RevealPaymentView,
    StorageConfigView,
    TransportRoutingView,
} from '../../../api/types.js';
import type { Network } from '../../../config/types.js';
import type { AppContracts, TradeConfigView } from '../../../services/types.js';

export interface CatalogSizeView {
    buildingCount: number;
    recipeCount: number;
}

export interface EntryPointLookupView {
    building: string;
    buildingSearch: string;
    resource: string;
    recipes: string;
}

export interface GameConfigReferenceView {
    network: Network;
    chainId: number;
    contracts: AppContracts;
    randomness: RandomnessDescriptor;
    resources: Record<number, string>;
    reveal: RevealPaymentView | null;
    transport: TransportRoutingView;
    trade: TradeConfigView;
    storage: StorageConfigView;
    catalog: CatalogSizeView;
    lookup: EntryPointLookupView;
}
