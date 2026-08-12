export const LIST_FILLS_DESCRIPTION = [
    'The feed of executed buys (fills) — what buyers actually PAID, not what sellers ask. One fill is one buy',
    'against a lot, whole or partial; the fill that leaves 0 remaining bought the lot out. Filter by resourceId',
    'and/or hubTokenId, or read the whole world. Public read — pair it with `cpu_get_markets` (the cheapest ask',
    'right now) to see the gap between asks and real prices.',
    'PAGING GOES ONE WAY: rows come newest first, and `before` (the "<blockNumber>:<logIndex>" cursor of the last',
    'row you got) pages DOWN to older fills. There is no "since" parameter. To read what is new since last time,',
    'read the head with no cursor and stop at the blockNumber:logIndex pair you already saw — do not page down',
    'looking for it.',
    'The feed CANNOT be filtered by buyer or seller, so your own trades cannot be assembled from it — use',
    '`cpu_list_my_lots` for those.',
].join(' ');
