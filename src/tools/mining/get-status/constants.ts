export const GET_MINING_STATUS_DESCRIPTION = [
    "Read a cell's mining job: whether an extractor is active, which resource it mines, its yield per cycle and",
    'cycle length, how far through its schedule it is (`completedBatches` of `batches`), the units and whole',
    'cycles claimable right now, when the next cycle matures and when the job ends, the remaining deposit, and',
    'whether it is stalled. Mining matures in whole cycles — a cycle in progress banks nothing until it',
    'completes — and settles in whole cycles too: if one full cycle of output does not fit, nothing settles.',
    'That is a stall, and it begins before the box reads full. A stall burns time (the schedule survives, the',
    'wait does not), so offload to resume — transport it out, sell via create_lot, craft with it, or withdraw',
    'wCPU; a null cap means the warehouse is uncapped. `isFinished` means the job has run its schedule and will',
    'produce nothing more: claim it to bank the rest and free the cell for another job or a craft. Timestamps',
    'are unix seconds on the same clock as `serverTime`. Public — works for any cell, no session required. The',
    'owner banks matured cycles with `cpu_claim_mining`.',
].join(' ');
