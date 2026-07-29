export const WITHDRAW_MAX_UNITS = 2n ** 64n - 1n;

export const WITHDRAW_DESCRIPTION = [
    'Cash out a cell’s wCPU (resource id 1, the CPU Forge output) to the on-chain $CPU token in your wallet, 1:1',
    '(needs a session — `cpu_authenticate` first; you must own the cell). Pass the amount in whole wCPU units up',
    'to the cell’s wCPU balance; it debits the cell and mints $CPU to your wallet (no approve needed). If the',
    'on-chain $CPU emission budget cannot cover the full amount, only a partial tranche executes — up to what',
    'remains — and the rest stays in the cell; the result reports the requested and executed amounts separately.',
    'Waits for confirmation and returns the tx hash — check the result with `cpu_get_balance`. wCPU lives on the',
    'cell, so selling or transferring the cell takes it along: withdraw before you sell.',
].join(' ');
