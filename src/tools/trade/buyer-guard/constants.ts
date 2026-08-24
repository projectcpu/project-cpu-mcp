import { LotState } from '../../../api/types.js';

export const NO_SIDE_EFFECTS_NOTE = 'No tokens were approved and no transaction was sent.';

export const LOT_STATE_ADVICE: Readonly<Record<LotState, string>> = {
    [LotState.Open]: '',
    [LotState.Delivering]: 'Its goods are still en route to the hub; it opens once the delivery is finalized.',
    [LotState.Evicted]:
        "The hub owner threw it out: the units are still the seller's and owe a lot return home, and nobody " +
        'can buy them. Browse cpu_list_lots or cpu_get_markets for a lot that is actually on sale.',
    [LotState.Sold]: 'It sold out — nothing remains on it.',
    [LotState.Cancelled]: 'The seller took it off the market and sent the remainder home.',
};
