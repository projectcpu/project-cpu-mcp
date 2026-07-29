import { GET_MARKETS_DESCRIPTION } from './constants.js';
import type { MarketResourceSummary } from '../../../api/types.js';
import type { Cell } from '../../../map/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeMarkets } from '../format.utils.js';
import { marketsInputSchema, type EnrichedMarketSummary } from '../types.js';

interface SaleFeeReader {
    readRevealCell(tokenId: string): Promise<Cell | null>;
}

async function enrichLiveSaleFee(mapReader: SaleFeeReader, row: MarketResourceSummary): Promise<EnrichedMarketSummary> {
    const cell = await mapReader.readRevealCell(row.hubTokenId);
    const liveSaleFeePercent = cell !== null && cell.activeHub ? (cell.saleFeeOverrides?.[row.resourceId] ?? 0) : null;
    return { ...row, liveSaleFeePercent };
}

export function registerGetMarketsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_markets',
        { description: GET_MARKETS_DESCRIPTION, inputSchema: marketsInputSchema },
        async (args) => {
            const markets = await context.trade.getMarkets(args);
            const enriched = await Promise.all(markets.map((row) => enrichLiveSaleFee(context.mapReader, row)));
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: `${enriched.length} market(s)\n${summarizeMarkets(enriched, resources)}` },
                    { type: 'text', text: JSON.stringify(enriched) },
                ],
            };
        },
    );
}
