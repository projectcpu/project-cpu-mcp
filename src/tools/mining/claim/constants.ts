export const CLAIM_MINING_DESCRIPTION = [
    'Bank every matured mining cycle an extractor has produced on a cell you own into its resource balance.',
    'Requires a session — call `cpu_authenticate` first. With an active job, claiming when nothing new',
    'has matured is a harmless no-op; claiming on a cell that has no extractor is an error. A cycle in progress',
    'matures nothing until it completes, and only whole cycles settle — if a full cycle of output does not fit,',
    'nothing banks and the wait resets. Claiming does not stop a running job. Claiming one that has run its',
    'schedule (or drained its deposit) retires it and frees the process slot, so the cell can take another job',
    'or a craft. Check what is available first with `cpu_get_mining_status`.',
].join(' ');
