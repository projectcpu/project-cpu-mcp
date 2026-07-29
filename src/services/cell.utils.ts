import { keccak256, toBytes } from 'viem';

import { CraftRecipeId } from '../api/types.js';

const UINT64_MASK = (1n << 64n) - 1n;

export function recipeNameToUint64(name: CraftRecipeId): bigint {
    return BigInt(keccak256(toBytes(name))) & UINT64_MASK;
}

export function recipeNameFromUint64(id: bigint): CraftRecipeId | null {
    for (const name of Object.values(CraftRecipeId)) {
        if (recipeNameToUint64(name) === id) {
            return name;
        }
    }
    return null;
}
