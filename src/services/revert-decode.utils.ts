import type { Abi } from 'viem';

import { decodeRevert } from '../wallet/revert.utils.js';

export interface KnownRevert<T extends string> {
    name: T;
    args: ReadonlyArray<unknown>;
}

export function decodeKnownRevert<T extends string>(
    error: unknown,
    abi: Abi,
    names: ReadonlyArray<T>,
): KnownRevert<T> | null {
    const decoded = decodeRevert(error, abi);
    if (decoded === null) {
        return null;
    }
    const name = names.find((known) => known === decoded.name) ?? null;
    if (name === null) {
        return null;
    }
    return { name, args: decoded.args };
}
