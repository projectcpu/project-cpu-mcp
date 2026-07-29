export const SET_SYNDICATE_PARAMS_DESCRIPTION = [
    'Update a syndicate you manage. This REPLACES the entire card at once — name, link, and all four rates — it is',
    'NOT a partial patch: every field you pass overwrites the stored one, and any field you leave out reverts to its',
    'default. Read the current card with cpu_get_syndicate FIRST and resubmit the full state with your edits applied,',
    'otherwise you will silently wipe the fields you omit. Rates are percentages 0–100 on whole basis-point steps.',
    'Manager and creation time are untouched. Writes on-chain (a wallet transaction). Fails clearly if you are not the',
    'manager, on an empty/over-long name or over-long link, on a rate above 100%, or if the registry is not deployed',
    'on this network.',
].join(' ');
