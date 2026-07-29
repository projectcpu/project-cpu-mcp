export const LIST_LOTS_DESCRIPTION = [
    'Browse marketplace lots with filters (hub, resourceId, seller, minPrice/maxPrice), sort',
    '(price_asc | recent | nearest — nearest needs a zone), pagination (limit ≤ 200, offset), and an optional',
    'zone (aroundTokenId + radius in grid steps). `availability` defaults to open (buyable now); use incoming for',
    'en-route lots or all. Public read — start with `cpu_get_markets` for a compact overview, then drill in here.',
].join(' ');
