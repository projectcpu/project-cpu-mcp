export const SET_SALE_FEE_DESCRIPTION = [
    'Set the sale-fee rate for one resource on a Hub you own, on-chain (needs a session — `cpu_authenticate`',
    'first). The rate is a percent of every sale of that resource settled on your hub (0–100, 0.01 granularity),',
    'carved out of the seller proceeds; set 0 to list that resource for free. One resource per call (loop for',
    'several). The rate settles live on every open lot of the resource, but never above each lot’s seller tolerance;',
    'a lot whose tolerance you exceed freezes (its buys revert) until you lower the rate back to its tolerance.',
    'Settable on a hub still under construction, so it is already in place when the hub becomes Ready. Reverts if you',
    'do not own the hub or the rate exceeds the 100% structural bound. Returns the confirmed rate and tx hash.',
].join(' ');
