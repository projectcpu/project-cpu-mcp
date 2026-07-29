export const GET_CRAFT_STATUS_DESCRIPTION = [
    'Get the craft job on a cell: its recipe, status (active / pending payment / stalled), how far through its',
    'schedule it is (`completedBatches` of `batches`), what is claimable right now, when the next batch matures',
    'and when the run ends. A craft stalls once any output box has room for less than one whole batch — batches',
    'settle whole or not at all, so nothing banks until you offload a blocked output (`blockedResourceIds`), and',
    'the wait resets while the schedule survives. `isFinished` means the run is done and now only holds the',
    "cell's process slot: claim it to bank the rest and free the cell. Timestamps are unix seconds on the same",
    'clock as `serverTime`. Public — works for any tokenId. This is the source of craft progress; bank matured',
    'batches with `cpu_claim_craft`.',
].join(' ');
