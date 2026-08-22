import { FIND_BUILDINGS_DESCRIPTION } from './constants.js';
import {
    buildIndexRow,
    renderIndex,
    renderNoMatch,
    renderSingleMatchHeadline,
    resultLimit,
    selectBuildings,
} from './find-buildings.utils.js';
import { findBuildingsInputSchema, type FindBuildingsArgs, type FindBuildingsResultView } from './types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { buildBuildingCard, renderBuildingCard } from '../building-card/building-card.utils.js';

export function registerFindBuildingsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_find_buildings',
        { description: FIND_BUILDINGS_DESCRIPTION, inputSchema: findBuildingsInputSchema },
        async (args: FindBuildingsArgs) => {
            const { buildings, recipes, resources } = await context.appConfig.load();
            const matched = selectBuildings(buildings, args, recipes);
            const shown = matched.slice(0, resultLimit(args.limit));
            const only = matched.length === 1 ? matched[0] : null;
            const card = only === undefined || only === null ? null : buildBuildingCard(only, recipes, resources);

            const result: FindBuildingsResultView = {
                filters: args,
                matchCount: matched.length,
                buildings: shown.map((building) => buildIndexRow(building, recipes, resources)),
                card,
            };

            const text =
                card !== null
                    ? `${renderSingleMatchHeadline(args, resources)}\n\n${renderBuildingCard(card, resources)}`
                    : matched.length === 0
                      ? renderNoMatch(args, resources)
                      : renderIndex(result.buildings, matched.length, args, resources);

            return {
                content: [
                    { type: 'text', text },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
