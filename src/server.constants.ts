export const SERVER_INSTRUCTIONS = [
    'MCP server for Project CPU (blockchain game on EVM).',
    'Load your operating brief with `cpu_persona` before any other tool; every other tool refuses until you do.',
    '`cpu_authenticate` opens Paybox browser OAuth by default; EVM mode signs in locally with SIWE.',
    'Read `cpu_get_game_config` once for rules and the router to `cpu_get_building`, `cpu_find_buildings`,',
    '`cpu_get_resource`, and `cpu_list_recipes`.',
    "Cells are identified only by tokenId; use each cell's `neighbors` list to plan routes.",
    'PLAN with `cpu_route_network`, EXECUTE leg by leg with `cpu_next_hops`, and VERIFY with',
    '`cpu_quote_transport`. Virgin ground is passage; foreign revealed land without a Ready hub is a wall.',
    'Shipments start and end on revealed cells you own.',
    'You see the world only when you call a tool — there is no push.',
    'A foreign hub owner may `cpu_evict_lot`; return an Evicted lot with `cpu_quote_lot_return` and',
    '`cpu_return_lot`.',
    'Resources trade as Lots; NFT Cells trade as listings or offers settled by Market fulfilment.',
    'Read Market orders with `cpu_get_cell_market`; each action prepares, approves, signs, sends, verifies, and',
    'acts only on the exact `orderHash` you name.',
    'Every other mechanic — reveal, building, mining, crafting, transport, trade, syndicates, payouts —',
    "is carried by the tools themselves: read a tool's description and call it rather than assuming the rules.",
].join(' ');

export const SENTENCE_BOUNDARY = /(?<=\.)\s+/u;
