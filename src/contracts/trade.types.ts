/**
 * The lot lifecycle as the Trade contract stores it — an ordinal, not a name. The game API projects the
 * same lifecycle under named strings (`LotState` in `src/api/types.js`); the two are separate
 * representations and are converted only through the explicit mapping in `trade.helpers.js`.
 */
export enum OnChainLotState {
    /** No lot in storage: never created, or closed and deleted (sold out, cancelled, reclaimed). */
    None = 0,
    Delivering = 1,
    Open = 2,
    /** Removed from its hub by the hub owner: still the seller's goods, unbuyable, holding no hub space. */
    Evicted = 3,
}
