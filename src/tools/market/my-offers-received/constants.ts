import { MARKET_PAGE_SIZE_HINT } from '../../../services/market/constants.js';

export const GET_MY_OFFERS_RECEIVED_DESCRIPTION = [
    'The active offers standing on YOUR Cells on the public NFT marketplace — what other players are bidding to',
    'buy your land, one page at a time. The wallet is the authenticated one; there is no wallet input. For the',
    'bids you published yourself, call `cpu_get_my_offers` instead.',
    'THE MAKER IS SOMEONE ELSE. Every `maker` here is another wallet — that is the point of the feed, not a',
    'mismatch to filter out. An offer carries its `kind`: `item` (bound to one exact Cell), `trait`, or',
    '`collection`; a trait or collection offer has no single bound Cell, so its `tokenId` may be null while it is',
    'still fillable with one of your Cells.',
    'PAGINATION: omit `cursor` for the first page, then pass back the exact `nextCursor` you received. Stop only',
    `when \`nextCursor\` is null — a page with fewer than ${MARKET_PAGE_SIZE_HINT} rows may still have another page,`,
    'so never decide you are done by counting rows.',
    'Every amount is a base-unit decimal integer STRING (never a number), paired with a `currency` carrying the',
    'address, symbol and decimals you need to read it. Times are Unix seconds. Ordinary map and Cell reads carry',
    'no marketplace data — ask here.',
].join(' ');
