import { SwapDirection, type SwapQuote, type SwapResult } from '../../services/types.js';

function symbols(direction: SwapDirection): { inSym: string; outSym: string } {
    return direction === SwapDirection.EthToCpu ? { inSym: 'ETH', outSym: '$CPU' } : { inSym: '$CPU', outSym: 'ETH' };
}

export function summarizeSwapQuote(q: SwapQuote): string {
    const { inSym, outSym } = symbols(q.direction);
    return (
        `Quote: ${q.amountIn} ${inSym} → ~${q.amountOut} ${outSym} (min ${q.amountOutMinimum} after ` +
        `${q.slippage}% slippage, net of the pool fee). Commit with swap.`
    );
}

export function summarizeSwap(r: SwapResult): string {
    const { inSym, outSym } = symbols(r.direction);
    const approve = r.approveTxHash !== null ? `approve tx ${r.approveTxHash}, ` : '';
    const permit = r.permit2TxHash !== null ? `permit2 tx ${r.permit2TxHash}, ` : '';
    return (
        `Swapped ${r.amountIn} ${inSym} → ${outSym} (expected ~${r.amountOutQuoted}, min ${r.amountOutMinimum}). ` +
        `${approve}${permit}swap tx ${r.txHash} confirmed in block ${r.blockNumber}.`
    );
}
