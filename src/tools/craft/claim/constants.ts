export const CLAIM_CRAFT_DESCRIPTION = [
    'Bank every matured craft batch on a cell you own into its resource balance. Requires a session — call',
    '`cpu_authenticate` first. With at least one craft process on the cell, claiming nothing matured is a no-op',
    'success; claiming on a cell that has no craft processes is an error. A fully-claimed process frees its',
    'slot. Check what is claimable first with `cpu_get_craft_status`.',
].join(' ');
