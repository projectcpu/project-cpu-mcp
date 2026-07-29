export const QUOTE_BUY_DESCRIPTION = [
    'Preview a buy priced by the Trade contract itself — read-only, reserves nothing, sends no tx (needs a',
    'session). Pass `chain` = [hub, ...waypoints, your destination cell] for the full preflight (sale leg +',
    'transit) — the exact total `cpu_buy_lot` would charge; omit it for the sale leg alone via `quoteSale`.',
    "Returns decimal $CPU: `sale` (nominal value × pricePerUnit), the hub's live `saleFeePercent`, your clan",
    '`discount`, `salePaid` (what you actually pay for the goods), the split (`tax`, `ownerNet`), plus',
    '`transitFee`/`transitDiscount` and `arrivalAt` when routed, with `total` = the actual full debit. The hub',
    'sale fee and burn come out of the seller proceeds, not on top. Because the quote runs the same checks as the',
    'buy, a failed quote explains why the purchase would revert (lot closed, amount exceeds remaining, a',
    'sale-fee-tolerance freeze, a foreign frozen hub on the route). It does NOT check pause, $CPU balance, or',
    'allowance — a fill can still revert on those. `cpu_buy_lot` re-quotes transit on-chain and authorizes ~10%',
    'over as headroom (a ceiling, not an extra charge). Use before `cpu_buy_lot`.',
].join(' ');
