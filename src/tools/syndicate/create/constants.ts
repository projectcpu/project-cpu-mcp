export const CREATE_SYNDICATE_DESCRIPTION = [
    'Found your own syndicate: pick a name, an optional link, and the four fee rates as percentages (same-syndicate',
    'trade/transport discounts and the trade/transport tax the manager collects). You are auto-joined as the first',
    'member the instant it is created — the result reports the assigned id, your join time, and the earliest time',
    'you may leave (an exit cooldown starts at that join time, so you cannot leave right away). The manager defaults',
    'to you; pass a different address to hand the tax stream to another wallet. Rates are percentages 0–100 on whole',
    'basis-point steps (finer than 0.01% is rejected). Writes on-chain (a wallet transaction). Fails clearly if you',
    'are already in a syndicate (leave first), on an empty/over-long name or over-long link, on a rate above 100%, or',
    'if the registry is not deployed on this network.',
].join(' ');
