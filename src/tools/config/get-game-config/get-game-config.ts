import { GET_GAME_CONFIG_DESCRIPTION } from './constants.js';
import { buildGameConfigReference, renderEntryPoint } from './get-game-config.utils.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';

export function registerGetGameConfigTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_game_config',
        { description: GET_GAME_CONFIG_DESCRIPTION, inputSchema: {} },
        async () => {
            const [config, lotListing] = await Promise.all([
                context.appConfig.load(),
                context.tradeRules.loadLotListingRules(),
            ]);

            return {
                content: [
                    { type: 'text', text: renderEntryPoint(config, lotListing) },
                    { type: 'text', text: JSON.stringify(buildGameConfigReference(config, lotListing)) },
                ],
            };
        },
    );
}
