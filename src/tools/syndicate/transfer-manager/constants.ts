export const TRANSFER_SYNDICATE_MANAGER_DESCRIPTION = [
    'Hand the manager role of a syndicate you manage to a successor wallet. IRREVERSIBLE: once transferred you can no',
    'longer change the syndicate’s params, and the entire member-tax stream (the tax members pay on trades and',
    'shipments) immediately starts paying the new manager instead of you — you cannot take it back unless the new',
    'manager transfers it back. Double-check the successor address. Writes on-chain (a wallet transaction). Fails',
    'clearly if you are not the current manager, if the successor is the zero address, or if the registry is not',
    'deployed on this network.',
].join(' ');
