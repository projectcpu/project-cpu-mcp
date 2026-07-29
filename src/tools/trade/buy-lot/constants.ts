export const BUY_LOT_DESCRIPTION = [
    'Buy units from an OPEN lot, delivered to your own cell, on-chain (needs a session). `chain` = [hub holding the',
    'lot, ...waypoints, your destination cell]. One atomic $CPU tx: seller price (value × pricePerUnit) + any',
    'foreign-hub transit fee, plus gas; the first buy auto-approves the sale exactly and the transit fee with ~10%',
    'headroom (a ceiling for on-chain fee drift, not a double charge). Preview the exact cost with `cpu_quote_buy`.',
    'Goods ship to your cell and credit only after arrival, when you `cpu_finalize_delivery` the returned',
    'deliveryId. If the lot is frozen — the hub raised its live sale fee above the seller tolerance — the buy',
    'reverts on-chain until the hub lowers the rate (or you pick another lot); `cpu_get_lot` flags it up front.',
    'Buying your own lot is allowed. The result reports the sale-leg clan economics: `paid` is what you were actually',
    'debited for the sale (= `sale` − `discount`, the syndicate discount when buyer and seller share a syndicate),',
    "while `tax` is the clan tax carved from the hub fee to the owner's syndicate manager and `ownerNet` is the hub",
    "owner's net proceeds.",
].join(' ');
