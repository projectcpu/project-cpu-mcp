import { GET_GAME_CONFIG_DESCRIPTION, SALE_FEE_STRUCTURAL_BOUND_PERCENT } from './constants.js';
import {
    describeRandomnessMode,
    describeRevealPayment,
    summarizeRecipeLines,
    summarizeUpgradeGraph,
} from './get-game-config.utils.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';

export function registerGetGameConfigTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_game_config',
        { description: GET_GAME_CONFIG_DESCRIPTION, inputSchema: {} },
        async () => {
            const config = await context.appConfig.load();

            const resourceList =
                Object.entries(config.resources)
                    .map(([id, name]) => `${id}:${name}`)
                    .join(', ') || 'none';
            const buildings =
                config.buildings
                    .map((b) => {
                        const opex =
                            b.recipeOpexCpu !== null
                                ? `, opex ${Object.entries(b.recipeOpexCpu)
                                      .map(([recipeId, costCpu]) => `${recipeId}:${costCpu}`)
                                      .join('/')} $CPU/batch`
                                : '';
                        return `${b.name} (${b.kind}, build ${b.buildCost} $CPU, demolish ${b.demolishCost.cpu} $CPU${opex})`;
                    })
                    .join(', ') || 'none';
            const reveal = describeRevealPayment(config.reveal);
            const trade =
                `${config.trade.saleBurnPercent}% sale burn, sale fee up to ${SALE_FEE_STRUCTURAL_BOUND_PERCENT}% ` +
                `(the structural bound — a hub owner can set any rate up to this maximum)`;
            const transitFeeFloors =
                Object.entries(config.transport.moveFeeFloors)
                    .map(([id, fee]) => `${id}:${fee}`)
                    .join(', ') || 'none';
            const transit =
                `every resource carries a transit-fee floor ($CPU/u; a hub's non-zero override wins over it) — ` +
                `${transitFeeFloors}`;
            const storage =
                'storage caps are explicit per-resource cell/hub shelf pairs (`0` means unlimited); map reads ' +
                'label the shelf currently in force as each resource storage `cap`';
            const randomness = describeRandomnessMode(config.randomness);
            const header =
                `Network ${config.network} (chainId ${config.chainId}). ${config.recipes.length} recipe(s) ` +
                `(see list_recipes). Buildings: ${buildings}. Reveal: ${reveal}. Randomness: ${randomness}. ` +
                `Trade: ${trade}. ` +
                `Transit: ${transit}. ` +
                `Storage: ${storage}. ` +
                `Resources: ${resourceList}. ` +
                `Contracts — land ${config.contracts.land}, $CPU ${config.contracts.cpuToken}, ` +
                `cpuHook ${config.contracts.cpuHook}, cell ${config.contracts.cell}, ` +
                `transport ${config.contracts.transport}.`;
            const recipeLines = summarizeRecipeLines(config.recipes, config.resources);
            const upgradeGraph = summarizeUpgradeGraph(config.buildings, config.resources);
            const text =
                `${header}\n\n` +
                `Recipes (one line each — id | cycle duration | in resource stacks | out resource stacks | ` +
                `$CPU/cycle):\n${recipeLines}\n\n` +
                'Upgrade graph (one line per building with a predecessor or a successor — type | level | branch ' +
                `| predecessor | successors | cost | inputs | build time | effects):\n${upgradeGraph}`;

            return {
                content: [
                    { type: 'text', text },
                    { type: 'text', text: JSON.stringify(config) },
                ],
            };
        },
    );
}
