import { z } from 'zod';

import type { ILogger } from '../../../logger/types.js';
import { type AttentionItem, AttentionSeverity } from '../../../map/types.js';
import type { IAppConfig, ITradeClient } from '../../../services/types.js';
import type { ResourceNames } from '../../../utils/format.utils.js';
import type { WalletProvider } from '../../../wallet/types.js';

export const getAttentionInputSchema = {
    minSeverity: z
        .nativeEnum(AttentionSeverity)
        .nullable()
        .default(null)
        .describe('Only return items at or above this urgency (critical > warning > info). Default: all.'),
    owner: z
        .string()
        .nullable()
        .default(null)
        .describe(
            'Scout another player: their wallet address to inspect their cells (read-only intel — the map is ' +
                'public). Omit to get your own to-do list. Deliveries are only surfaced for yourself.',
        ),
};

/** `count: null` means the chain could not be asked — never that the hub is clear. */
export interface EvictedHubCount {
    hubTokenId: string;
    count: number | null;
}

export interface IEvictedLotCounts {
    forHubs(hubTokenIds: ReadonlyArray<string>): Promise<Array<EvictedHubCount>>;
}

export interface EvictedLotCountServiceOptions {
    appConfig: IAppConfig;
    wallet: WalletProvider;
    tradeClient: ITradeClient;
    logger: ILogger;
}

export interface WarehousePressureInput {
    scouting: boolean;
    owner: string | null;
    ownerKnown: boolean;
    version: number;
    counts: Record<AttentionSeverity, number>;
    items: ReadonlyArray<AttentionItem>;
    note: string | null;
    resources: ResourceNames;
}
