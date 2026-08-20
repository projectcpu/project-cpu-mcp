import { GET_CELL_DESCRIPTION } from './constants.js';
import { cellOverviewPanel } from './panel.utils.js';
import { getCellInputSchema } from './types.js';
import { activeDemolition } from '../../../map/map.utils.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { labelCell, priceOutputs } from '../label.utils.js';
import { getWalletAddress } from '../wallet.utils.js';

export function registerGetCellTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_cell',
        { description: GET_CELL_DESCRIPTION, inputSchema: getCellInputSchema },
        async (args) => {
            const walletAddress = getWalletAddress(context);
            const inspection = await context.mapReader.inspectCell(args.tokenId, walletAddress);
            if (inspection === null) {
                throw new Error(`Cell ${args.tokenId} is not in the current map.`);
            }

            const { cell, neighbors } = inspection;
            const { resources, buildings } = await context.appConfig.load();
            const serverTime = context.mapReader.getServerTime();
            const panel = cellOverviewPanel({
                inspection,
                demolish: activeDemolition(cell, serverTime),
                serverTime,
                walletAddress,
                resources,
            });

            const labeled = {
                ...inspection,
                cell: { ...labelCell(cell, resources), outputs: priceOutputs(cell, buildings, resources) },
                neighbors: neighbors.map((neighbor) => labelCell(neighbor, resources)),
            };

            return {
                content: [
                    { type: 'text', text: panel },
                    { type: 'text', text: JSON.stringify(labeled) },
                ],
            };
        },
    );
}
