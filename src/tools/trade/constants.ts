/** Vocabulary more than one trade tool renders; a tool's own wording stays in its own `constants.ts`. */

export const EVICTED_LOT_HEADLINE = 'EVICTED — not for sale';

export const EVICTED_LOT_EXPLANATION = [
    'Evicted: the hub owner threw this lot out of their hub. The units are still yours and still escrowed,',
    'but the lot is not selling and nobody can buy it, it earns nothing, and it no longer occupies hub',
    'storage. It stays that way until you schedule its lot return — the whole remainder shipped home over a',
    'route you choose. Until every evicted remainder on that hub has a return scheduled, you cannot create a',
    'new lot on that hub for any resource; other hubs are unaffected.',
].join(' ');

export const FROZEN_LOT_RETURN_NOTE = [
    'Returning it costs no sale fee, but the route home still owes transit fees for every foreign hub it',
    'passes through.',
].join(' ');
