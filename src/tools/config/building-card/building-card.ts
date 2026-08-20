import {
    buildBuildingCard,
    findBuilding,
    renderBuildingCard,
    unknownBuildingTypeError,
} from './building-card.utils.js';
import { GET_BUILDING_DESCRIPTION } from './constants.js';
import { getBuildingInputSchema } from './types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';

export function registerGetBuildingTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_building',
        { description: GET_BUILDING_DESCRIPTION, inputSchema: getBuildingInputSchema },
        async (args) => {
            const { buildings, recipes, resources } = await context.appConfig.load();
            const building = findBuilding(buildings, args.buildingType);
            if (building === null) {
                throw unknownBuildingTypeError(buildings, args.buildingType);
            }

            const card = buildBuildingCard(building, recipes, resources);

            return {
                content: [
                    { type: 'text', text: renderBuildingCard(card, resources) },
                    { type: 'text', text: JSON.stringify(card) },
                ],
            };
        },
    );
}
