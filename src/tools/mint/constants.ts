export const MINT_CELL_DESCRIPTION = [
    'Mint new land cells on the primary market, straight from the collection’s OpenSea SeaDrop public drop —',
    'paid in native ETH, no $CPU involved. `quantity` cells are minted to your connected wallet at the',
    'on-chain drop price; preview the exact ETH cost first with `cpu_quote_mint`. The mint is submitted on-chain',
    'and this waits for confirmation. Check `cpu_get_balance` for enough ETH (mint price × quantity, plus gas)',
    'before calling. For existing cells on the secondary market, use OpenSea listings instead (see the',
    '`land` contract link in the server instructions).',
].join(' ');

export const QUOTE_MINT_DESCRIPTION = [
    'Preview a primary-market land mint without committing: reads the live OpenSea SeaDrop public drop and',
    'returns the per-cell ETH price and the total for `quantity` cells, plus the drop window and per-wallet',
    'limit. It has no side effects — no transaction. Use it before `cpu_mint_cell` to size the buy and confirm',
    'the drop is active.',
].join(' ');
