import type {
    RandomnessDescriptor,
    RevealPaymentView,
    StorageConfigView,
    TransportRoutingView,
} from '../../../api/types.js';
import type { Network } from '../../../config/types.js';
import type { AppContracts, TradeConfigView } from '../../../services/types.js';

/** One Hub tier's routing reach, so a structured reader never has to treat `hubRadius` as universal. */
export interface HubTierRadiusView {
    type: string;
    tier: number;
    radius: number;
}

export interface TransportReferenceView extends TransportRoutingView {
    hubRadii: Array<HubTierRadiusView>;
}

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
    transport: TransportReferenceView;
    trade: TradeConfigView;
    storage: StorageConfigView;
    catalog: CatalogSizeView;
    lookup: EntryPointLookupView;
}
