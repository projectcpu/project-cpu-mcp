export const REVEAL_DESCRIPTION = [
    'Reveal the deposits of a cell you own (call `cpu_authenticate` first). Sends an on-chain Cell tx requesting',
    'randomness, paying the source fee in ETH — keep some ETH. First reveal is free; a re-reveal needs',
    'all deposits depleted and costs $CPU (auto-approved once). How the draw arrives depends on the network’s',
    'randomness mode — see `cpu_get_game_config`. On a self-service network this call also settles the draw and',
    'returns the deposits it rolled; call it again on a cell whose reveal is still pending to finish that one,',
    'which costs no new fee.',
].join(' ');

export const FULFILL_REVEAL_DESCRIPTION = [
    'Finish reveal requests you already opened that have not delivered their draw yet (call `cpu_authenticate`',
    'first). Where the network’s randomness mode leaves delivery to the player — see `cpu_get_game_config` — this',
    'sends the missing draw on-chain: it costs gas but no new reveal fee. With no arguments it works through every',
    'open request you own; pass `tokenIds` to settle only those cells. If a request you know exists is not listed,',
    'name it directly with `requestId` plus `source` and it is settled without that list. Requests already settled',
    'are reported as such, not as errors. On a network where the randomness source delivers draws itself this call',
    'refuses — there is nothing to settle by hand there.',
].join(' ');
