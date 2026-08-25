export const GET_LOT_TERMS_DESCRIPTION = [
    'Read the live terms for listing one resource on one Hub, before you spend anything (needs a session —',
    '`cpu_authenticate` first). Returns the effective minimum and maximum units one new lot may hold there,',
    'how many live lots you already hold for that Hub and resource against your limit (delivering, open and',
    'evicted ones all count), how many evicted remainders you still owe a return on at that Hub, and a plain',
    '`canList` verdict with the blockers behind it. Every number is read from the Trade contract itself for',
    'this exact Hub and resource. `cpu_create_lot` checks the same terms again before it spends, so a listing',
    'these terms refuse never costs you an approval or gas.',
].join(' ');

export const CAN_LIST_LINE = 'You can list here now.';

export const CANNOT_LIST_LINE = 'You cannot list here right now:';

export const NO_EVICTED_LINE = 'No evicted remainders owed on this hub.';
