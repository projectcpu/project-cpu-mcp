import { LIST_RECIPES_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeRecipes } from '../format.utils.js';

export function registerListRecipesTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool('cpu_list_recipes', { description: LIST_RECIPES_DESCRIPTION, inputSchema: {} }, async () => {
        const { recipes, resources } = await context.appConfig.load();

        return {
            content: [
                { type: 'text', text: summarizeRecipes(recipes, resources) },
                { type: 'text', text: JSON.stringify(recipes) },
            ],
        };
    });
}
