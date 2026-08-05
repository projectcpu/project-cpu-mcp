import { GET_CELL_DESCRIPTION } from './constants.js';
import { demolishNote } from './demolish.utils.js';
import { getCellInputSchema } from './types.js';
import { demolishState } from '../../../map/map.utils.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { labelCell, priceOutputs } from '../label.utils.js';
import { getWalletAddress } from '../wallet.utils.js';

export function registerGetCellTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_cell',
        { description: GET_CELL_DESCRIPTION, inputSchema: getCellInputSchema },
        async (args) => {
            const inspection = await context.mapReader.inspectCell(args.tokenId, getWalletAddress(context));
            if (inspection === null) {
                throw new Error(`Cell ${args.tokenId} is not in the current map.`);
            }

            const { cell, neighbors } = inspection;
            const { resources, buildings } = await context.appConfig.load();
            const demolish = demolishState(cell, context.mapReader.getServerTime());
            const header = `Cell ${cell.tokenId} · ${neighbors.length} neighbours${demolishNote(demolish)}`;

            const labeled = {
                ...inspection,
                cell: { ...labelCell(cell, resources), outputs: priceOutputs(cell, buildings, resources) },
                neighbors: neighbors.map((neighbor) => labelCell(neighbor, resources)),
            };

            return {
                content: [
                    { type: 'text', text: header },
                    { type: 'text', text: JSON.stringify(labeled) },
                ],
            };
        },
    );
}
