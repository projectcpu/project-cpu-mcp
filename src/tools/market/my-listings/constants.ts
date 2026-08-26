import { MARKET_PAGE_SIZE_HINT } from '../../../services/market/constants.js';

export const GET_MY_LISTINGS_DESCRIPTION = [
    'Your own active Cell listings on the public NFT marketplace — the land you have put up for sale, one page at',
    'a time. The wallet is the authenticated one; there is no wallet input and no way to read another player.',
    'This is the land market, entirely separate from `cpu_list_my_lots`, which lists your RESOURCE lots for $CPU',
    'inside the game.',
    'PAGINATION: omit `cursor` for the first page, then pass back the exact `nextCursor` you received. Stop only',
    `when \`nextCursor\` is null — a page with fewer than ${MARKET_PAGE_SIZE_HINT} rows may still have another page,`,
    'so never decide you are done by counting rows.',
    'Every price is a base-unit decimal integer STRING (never a number), paired with a `currency` carrying the',
    'address, symbol and decimals you need to read it. Times are Unix seconds. Ordinary map and Cell reads carry',
    'no marketplace data — ask here.',
].join(' ');
