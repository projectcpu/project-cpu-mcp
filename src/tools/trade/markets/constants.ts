export const GET_MARKETS_DESCRIPTION = [
    'Scout the marketplace: one compact row per (Hub, resource) with open-vs-incoming lot counts, lowest',
    "price, distance, and the hub's live sale-fee percent for that resource (`liveSaleFeePercent`, enriched from",
    'the local world map — advisory, may trail the chain; `null` when the rate is unknown, i.e. the map has no',
    "read on the hub or it isn't serving sale fees yet). The",
    'recommended first look at what is for sale and where — compare hubs by fee in one call, then drill into',
    'specific lots with `cpu_list_lots`. Public read; supports hub / resourceId filters and an optional zone',
    '(aroundTokenId + radius in grid steps).',
].join(' ');
