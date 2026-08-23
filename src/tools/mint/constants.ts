export const MINT_CELL_DESCRIPTION = [
    'Mint new land cells on the primary market, straight from the collection’s OpenSea SeaDrop public drop.',
    '`quantity` cells are minted to your connected wallet on the drop terms live at call time: the per-cell',
    'amount in native ETH comes from the drop itself and may be anything the drop sets, including zero — no',
    '$CPU is involved. Read the current terms and the exact total with `cpu_quote_mint` first, and make sure',
    '`cpu_get_balance` covers that total plus gas. The mint is submitted on-chain and this waits for',
    'confirmation. For existing cells on the secondary market, use OpenSea listings instead (see the `land`',
    'contract link in the server instructions).',
].join(' ');

export const QUOTE_MINT_DESCRIPTION = [
    'Preview a primary-market land mint without committing: reads the live OpenSea SeaDrop public drop and',
    'returns the current per-cell amount in native ETH — which may be zero — the total for `quantity` cells,',
    'the drop window and the per-wallet limit. It has no side effects — no transaction. Use it before',
    '`cpu_mint_cell` to size the mint and confirm the drop is active.',
].join(' ');
