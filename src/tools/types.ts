import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ToolRegistrar = Pick<McpServer, 'registerTool'>;

export type ToolHandler<TArgs extends Array<unknown> = Array<unknown>> = (
    ...args: TArgs
) => CallToolResult | Promise<CallToolResult>;

export enum ToolEventType {
    CellRevealed = 'cell_revealed',
    BuildStarted = 'build_started',
    UpgradeStarted = 'upgrade_started',
    BuildingDemolished = 'building_demolished',
    MiningStarted = 'mining_started',
    MiningClaimed = 'mining_claimed',
    CraftStarted = 'craft_started',
    CraftClaimed = 'craft_claimed',
}
