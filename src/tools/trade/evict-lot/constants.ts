export const EVICT_LOT_DESCRIPTION = [
    'Throw one foreign OPEN lot off a Hub you own, on-chain. Requires a session. It moves no goods and seizes',
    'nothing: the units stay the seller’s and stay escrowed, the lot simply stops selling and stops occupying',
    'your Hub storage, which is what makes the Hub demolishable again once no physical lot is left. It never',
    'finalizes a delivery, never touches more than the one lot you name, and never brings anything home —',
    'only the seller can do that, with `cpu_return_lot`. Your own lot cannot be evicted: return it instead.',
].join(' ');

export const EVICT_LOT_NO_GOODS_NOTE =
    'No goods moved and nothing was seized: every unit is still the seller’s, still escrowed, and only they ' +
    'can ship it home.';

export const EVICT_LOT_SELLER_BLOCK_NOTE =
    'It has not vanished: it stays on the books as an evicted lot, still holding one of that seller’s lot ' +
    'slots, and they cannot list any resource on this Hub until they schedule its return.';
