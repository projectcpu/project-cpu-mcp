import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import pkg from '../package.json' with { type: 'json' };
import { registerGetBalanceTool } from './tools/account/get-balance/get-balance.js';
import { registerAuthenticateTool } from './tools/authenticate.js';
import { registerBuildTool } from './tools/build/build.js';
import { registerDemolishTool } from './tools/build/demolish.js';
import { registerUpgradeTool } from './tools/build/upgrade.js';
import { registerGetBuildingTool } from './tools/config/building-card/building-card.js';
import { registerFindBuildingsTool } from './tools/config/find-buildings/find-buildings.js';
import { registerGetGameConfigTool } from './tools/config/get-game-config/get-game-config.js';
import { registerGetResourceTool } from './tools/config/resource-lens/resource-lens.js';
import { registerClaimCraftTool } from './tools/craft/claim/claim-craft.js';
import { registerCraftTool } from './tools/craft/craft.js';
import { registerGetCraftStatusTool } from './tools/craft/get-status/get-craft-status.js';
import { registerListRecipesTool } from './tools/craft/list-recipes/list-recipes.js';
import { registerGetAttentionTool } from './tools/map/attention/attention.js';
import { registerGetCellTool } from './tools/map/get-cell/get-cell.js';
import { registerGetChangesTool } from './tools/map/get-changes/get-changes.js';
import { registerGetMapTool } from './tools/map/get-map/get-map.js';
import { registerClaimMiningTool } from './tools/mining/claim/claim-mining.js';
import { registerGetMiningStatusTool } from './tools/mining/get-status/get-mining-status.js';
import { registerStartMiningTool } from './tools/mining/start/start-mining.js';
import { registerMintCellTool } from './tools/mint/mint-cell.js';
import { registerQuoteMintTool } from './tools/mint/quote/quote-mint.js';
import { PERSONA_TOOL_NAME } from './tools/persona/constants.js';
import { registerPersonaTool } from './tools/persona/persona.js';
import { registerFulfillRevealTool } from './tools/reveal/fulfill-reveal.js';
import { registerRevealTool } from './tools/reveal/reveal.js';
import { registerQuoteSwapTool } from './tools/swap/quote/quote-swap.js';
import { registerSwapTool } from './tools/swap/swap.js';
import { registerCreateSyndicateTool } from './tools/syndicate/create/create-syndicate.js';
import { registerGetSyndicateTool } from './tools/syndicate/get/get-syndicate.js';
import { registerJoinSyndicateTool } from './tools/syndicate/join/join-syndicate.js';
import { registerLeaveSyndicateTool } from './tools/syndicate/leave/leave-syndicate.js';
import { registerListSyndicatesTool } from './tools/syndicate/list/list-syndicates.js';
import { registerGetSyndicateMembershipTool } from './tools/syndicate/membership/get-membership.js';
import { registerGetSyndicatePlayerContentTool } from './tools/syndicate/player-content/get-syndicate-player-content.js';
import { registerSetSyndicateParamsTool } from './tools/syndicate/set-params/set-syndicate-params.js';
import { registerTransferSyndicateManagerTool } from './tools/syndicate/transfer-manager/transfer-syndicate-manager.js';
import { registerBuyLotTool } from './tools/trade/buy-lot/buy-lot.js';
import { registerCancelLotTool } from './tools/trade/cancel-lot/cancel-lot.js';
import { registerCreateLotTool } from './tools/trade/create-lot/create-lot.js';
import { registerGetLotTool } from './tools/trade/get-lot/get-lot.js';
import { registerListFillsTool } from './tools/trade/list-fills/list-fills.js';
import { registerListLotsTool } from './tools/trade/list-lots/list-lots.js';
import { registerListMyLotsTool } from './tools/trade/list-mine/list-my-lots.js';
import { registerGetMarketIndexTool } from './tools/trade/market-index/market-index.js';
import { registerGetMarketsTool } from './tools/trade/markets/get-markets.js';
import { registerQuoteBuyTool } from './tools/trade/quote-buy/quote-buy.js';
import { registerSetSaleFeeTool } from './tools/trade/set-sale-fee/set-sale-fee.js';
import { registerFinalizeDeliveryTool } from './tools/transport/finalize/finalize-delivery.js';
import { registerGetTransportStatusTool } from './tools/transport/get-status/get-transport-status.js';
import { registerListMyTransportsTool } from './tools/transport/list-mine/list-my-transports.js';
import { registerRouteNetworkTool } from './tools/transport/network/route-network.js';
import { registerNextHopsTool } from './tools/transport/next-hops/next-hops.js';
import { registerQuoteTransportTool } from './tools/transport/quote/quote-transport.js';
import { registerTransportTool } from './tools/transport/transport.js';
import type { ToolRegistrar } from './tools/types.js';
import { registerWithdrawTool } from './tools/withdraw/withdraw.js';
import type { AppContext } from './types.js';
import { createBackendVersionGate } from './version/backend-version.js';
import { createPackageVersionGate } from './version/package-version.js';
import { createGuardedRegistrar } from './version/tool-guard.js';
import type { ToolGate } from './version/types.js';

export const SERVER_INSTRUCTIONS = [
    'MCP server for Project CPU (blockchain game on EVM).',
    'Before you answer the operator, load your operating brief once with `cpu_get_persona` and work to it.',
    'Authenticate first: `cpu_authenticate` opens a session — the default EVM mode signs in via SIWE',
    'locally, AGW mode starts a Device Authorization flow.',
    'Then read the entry point once: `cpu_get_game_config` carries the static rulebook — resources,',
    'buildings, costs, storage and transport parameters, contract addresses.',
    'It is a router, not the whole catalog: static facts plus a building index, and it names the tool to ask',
    'next — `cpu_get_building`, `cpu_find_buildings`, `cpu_get_resource`, `cpu_list_recipes`.',
    'The world is a finite sphere of land cells identified only by tokenId; there are no coordinates,',
    'adjacency comes from the `neighbors` list on each cell, and you plan routes yourself.',
    'Route planning loop: PLAN once over `cpu_route_network` (waypoints, legal hops, fees, gaps),',
    'EXECUTE leg by leg re-checking your position with the cheap `cpu_next_hops` because the world moves',
    'while goods travel, VERIFY every chain with `cpu_quote_transport` before spending. Foreign land with',
    'no active hub is a wall, not a waypoint.',
    'You see the world only when you call a tool — there is no push.',
    'Every other mechanic — reveal, building, mining, crafting, transport, trade, syndicates, payouts —',
    'is carried by the tools themselves: read the description of the tool and call it rather than',
    'assuming the rules.',
].join(' ');

const SENTENCE_BOUNDARY = /(?<=\.)\s+/u;

function instructionsFor(personaEnabled: boolean): string {
    if (personaEnabled) {
        return SERVER_INSTRUCTIONS;
    }
    return SERVER_INSTRUCTIONS.split(SENTENCE_BOUNDARY)
        .filter((sentence) => !sentence.includes(PERSONA_TOOL_NAME))
        .join(' ');
}

// Takes the registrar rather than the server so a tool registered the plain way is a compile error
// here, not a tool that silently answers past the version gates.
function registerTools(registrar: ToolRegistrar, context: AppContext): void {
    registerAuthenticateTool(registrar, context);
    if (context.config.OPERATOR_PERSONA) {
        registerPersonaTool(registrar);
    }
    registerGetGameConfigTool(registrar, context);
    registerGetBuildingTool(registrar, context);
    registerFindBuildingsTool(registrar, context);
    registerGetResourceTool(registrar, context);
    registerGetMapTool(registrar, context);
    registerGetCellTool(registrar, context);
    registerGetChangesTool(registrar, context);
    registerGetAttentionTool(registrar, context);
    registerRevealTool(registrar, context);
    registerFulfillRevealTool(registrar, context);
    registerBuildTool(registrar, context);
    registerDemolishTool(registrar, context);
    registerUpgradeTool(registrar, context);
    registerListRecipesTool(registrar, context);
    registerCraftTool(registrar, context);
    registerGetCraftStatusTool(registrar, context);
    registerClaimCraftTool(registrar, context);
    registerStartMiningTool(registrar, context);
    registerGetMiningStatusTool(registrar, context);
    registerClaimMiningTool(registrar, context);
    registerRouteNetworkTool(registrar, context);
    registerNextHopsTool(registrar, context);
    registerQuoteTransportTool(registrar, context);
    registerTransportTool(registrar, context);
    registerListMyTransportsTool(registrar, context);
    registerGetTransportStatusTool(registrar, context);
    registerFinalizeDeliveryTool(registrar, context);
    registerGetMarketsTool(registrar, context);
    registerListLotsTool(registrar, context);
    registerGetLotTool(registrar, context);
    registerListMyLotsTool(registrar, context);
    registerListFillsTool(registrar, context);
    registerGetMarketIndexTool(registrar, context);
    registerQuoteBuyTool(registrar, context);
    registerCreateLotTool(registrar, context);
    registerBuyLotTool(registrar, context);
    registerCancelLotTool(registrar, context);
    registerSetSaleFeeTool(registrar, context);
    registerListSyndicatesTool(registrar, context);
    registerGetSyndicateTool(registrar, context);
    registerGetSyndicateMembershipTool(registrar, context);
    registerGetSyndicatePlayerContentTool(registrar, context);
    registerJoinSyndicateTool(registrar, context);
    registerLeaveSyndicateTool(registrar, context);
    registerCreateSyndicateTool(registrar, context);
    registerSetSyndicateParamsTool(registrar, context);
    registerTransferSyndicateManagerTool(registrar, context);
    registerQuoteSwapTool(registrar, context);
    registerSwapTool(registrar, context);
    registerQuoteMintTool(registrar, context);
    registerMintCellTool(registrar, context);
    registerGetBalanceTool(registrar, context);
    registerWithdrawTool(registrar, context);
}

export async function createServer(context: AppContext): Promise<void> {
    const server = new McpServer(
        { name: pkg.name, version: pkg.version },
        { instructions: instructionsFor(context.config.OPERATOR_PERSONA) },
    );

    const gates: Array<ToolGate> = [
        createPackageVersionGate(context.packageVersion),
        createBackendVersionGate(context.backendVersion),
    ];
    registerTools(createGuardedRegistrar(server, gates), context);

    const stdio = new StdioServerTransport();
    await server.connect(stdio);
}
