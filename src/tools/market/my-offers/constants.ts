import { MARKET_PAGE_SIZE_HINT } from '../../../services/market/constants.js';

export const GET_MY_OFFERS_DESCRIPTION = [
    'The active offers YOU made on the public NFT marketplace — bids you published on land owned by others,',
    'page at a time. The wallet is the authenticated one; there is no wallet input. For bids other players made on',
    'your Cells, call `cpu_get_my_offers_received` instead.',
    'Each offer carries its `kind`: `item` (bound to one exact Cell), `trait`, or `collection`. A trait or',
    'collection offer is not made for one Cell, so its `tokenId` may be null while the offer is still fillable.',
    'PAGINATION: omit `cursor` for the first page, then pass back the exact `nextCursor` you received. Stop only',
    `when \`nextCursor\` is null — a page with fewer than ${MARKET_PAGE_SIZE_HINT} rows may still have another page,`,
    'so never decide you are done by counting rows.',
    'Every amount is a base-unit decimal integer STRING (never a number), paired with a `currency` carrying the',
    'symbol and decimals you need to read it. Every row carries the exact `orderHash` needed to cancel it.',
    'Ordinary map and Cell reads carry no marketplace data — ask here.',
].join(' ');
