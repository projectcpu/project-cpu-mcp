export const GET_MARKET_INDEX_DESCRIPTION = [
    'World price index — one call, no inputs, one row per resource: the 24h volume-weighted average price',
    '($CPU per unit), the 24h percent change, and 24h volume in resource UNITS (not $CPU). A weekly spark series',
    'rides along in the JSON block only, never in the text summary — read the trend off changePct instead.',
    'This is a SERVER-CACHED AGGREGATE that can run up to an hour behind — do not use it where you need',
    'second-fresh data. A `null` price means NO TRADES settled for that resource in the 24h window — read it as',
    '"no trades", never as free or as zero.',
    'This answers a different question than `cpu_get_markets` (the cheapest ask available right now, per hub):',
    'that is what you could buy at this instant; this is what the world actually paid, on average, over the last',
    'day. The two are never combined into one call — mixing them would read as one price when it is really two.',
].join(' ');
