import type { MintQuote, MintResult } from '../../services/types.js';

export function summarizeMintQuote(q: MintQuote): string {
    return (
        `Quote: mint ${q.quantity} land cell(s) at ${q.mintPrice} ETH each → ${q.total} ETH total ` +
        `(plus gas). Per-wallet limit ${q.maxTotalMintableByWallet}. Commit with mint_cell.`
    );
}

export function summarizeMint(r: MintResult): string {
    return (
        `Minted ${r.quantity} land cell(s) for ${r.total} ETH: mint tx ${r.txHash} confirmed in block ` +
        `${r.blockNumber}. New cells appear shortly — use get_map to find them.`
    );
}
