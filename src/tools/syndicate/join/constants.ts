export const JOIN_SYNDICATE_DESCRIPTION = [
    'Join a syndicate by id (get ids from cpu_list_syndicates). Membership is effective immediately and the',
    "syndicate's four fee rates (trade/transport discount and tax, as percentages) apply to your activity from",
    'that moment — the returned card shows exactly what you are signing up for.',
    'COMMITMENT: leaving is gated by an exit cooldown that starts at your join time, so you cannot leave again',
    'right away; the result reports the earliest time you may leave. Writes on-chain (a wallet transaction).',
    'Fails clearly if you are already in a syndicate (leave first), if the id does not exist, or if the registry',
    'is not deployed on this network.',
].join(' ');
