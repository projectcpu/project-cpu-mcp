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
    TransportSent = 'transport_sent',
    DeliveryFinalized = 'delivery_finalized',
    LotCreated = 'lot_created',
    LotBought = 'lot_bought',
    LotCancelled = 'lot_cancelled',
    LotEvicted = 'lot_evicted',
    HubFeeSet = 'hub_fee_set',
    Swapped = 'swapped',
    Withdrawn = 'withdrawn',
    CellMinted = 'cell_minted',
    SyndicateJoined = 'syndicate_joined',
    SyndicateLeft = 'syndicate_left',
    SyndicateCreated = 'syndicate_created',
    SyndicateManagerChanged = 'syndicate_manager_changed',
    SyndicateParamsChanged = 'syndicate_params_changed',
    RevealFulfilled = 'reveal_fulfilled',
}
