import { AttentionReason } from '../../../map/types.js';

export const GET_ATTENTION_DESCRIPTION = [
    'Owner-scoped roll-up of cells worth attention, most time-sensitive first — so you skip scanning the whole',
    'map. Flags, each with a severity: stalled mining/craft (the output box has room for less than one whole',
    'cycle, so nothing settles and the wait burns); a reveal request of yours still open long after the client',
    'should have settled it in the background, and a cell locked by a reveal request opened at a randomness',
    'source the chain config has since replaced — that one no call of yours can clear, only an admin cleanup of',
    'the contracts; and every lot of yours a hub has evicted — it sells to nobody, it still holds one of your',
    'per-seller lot slots, and it blocks you from listing any resource on that hub until the outstanding count',
    'reaches zero, so it is reconciled against the count the Trade contract itself reports (critical);',
    'a near-full warehouse on an actively-produced',
    'resource, a job that has run its scheduled cycles and now idles the cell until claimed, an arrived delivery',
    'ready to finalize, an extractor on a depleted deposit, or one of your open lots frozen because the hub',
    'raised its live sale fee above your tolerance (buys revert; getting the goods back is a lot return and pays',
    'the Transit fee for that move) (warning);',
    'revealed-but-unbuilt cells, cells in a post-demolish rebuild cooldown, and an open lot whose live sale fee',
    'now sits exactly at your tolerance so the next hike freezes it (info — on a `demolish_cooldown` item',
    '`arrivalAt` marks when rebuild reopens and `demolishingType` names what is coming down, `null` when that',
    'detail was never recorded, which is normal and does not put the cooldown itself in doubt).',
    'A finished job loses nothing by waiting, unlike a stall — it only',
    'holds the cell idle. Items are purely descriptive (cell, resource, used/cap breakdown, deposit, delivery,',
    'and for a lot its `lotId`, hub cell and a `message`, for a reveal request its `requestId` and `requestedAt`)',
    'and suggest no action — you decide. Lot and reveal-request flags cover your own wallet only. Your own cells',
    'need an authenticated wallet; pass `owner` to scout another player read-only (all data is public).',
    '`minSeverity` filters by urgency. If the deliveries, lots or open-reveal-request lookup is down, the',
    'remaining items still return and a `note` says so.',
].join(' ');

export const WAREHOUSE_PRESSURE_TITLE = 'WAREHOUSE PRESSURE';

export const WAREHOUSE_PRESSURE_LABELS = {
    scope: 'Scope',
    owner: 'Owner',
    map: 'Map',
    shown: 'Shown',
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
    nearFull: 'Near full',
    peakFill: 'Peak fill',
    stalled: 'Stalled',
    evicted: 'Evicted',
    note: 'Note',
};

export const LOT_RETURN_COST_NOTE =
    'Getting the goods back is a lot return: it moves the remainder over the network to a cell of yours and ' +
    'pays the Transit fee for that move, so it is not free.';

export const EVICTED_LOT_NOT_SELLING =
    'It is out of the hub and sells to nobody; the remainder stays yours, stranded, until you return it to a ' +
    'cell of your own.';

export const EVICTED_LISTING_BLOCK =
    'No lot of any resource can be listed on this hub until that outstanding count reaches zero.';

export const EVICTED_COUNT_UNREADABLE =
    'The hub could not be asked how many evicted lots of yours are still outstanding, so treat the listing ' +
    'block as in force.';

export const EVICTED_COUNT_UNREACHABLE_NOTE =
    'The outstanding evicted-lot count of at least one hub could not be read from the chain; the evicted lots ' +
    'below are still listed and no hub is reported clear.';

export const WAREHOUSE_PRESSURE_SCOPE_SELF = 'self';
export const WAREHOUSE_PRESSURE_SCOPE_SCOUTING = 'scouting';

export const WAREHOUSE_PRESSURE_NO_OWNER_NOTE =
    'Attention needs a wallet or an `owner` address — call authenticate or pass owner. Nothing to scope to.';

export const STALLED_REASONS: ReadonlyArray<AttentionReason> = [
    AttentionReason.StalledMining,
    AttentionReason.StalledCraft,
];
