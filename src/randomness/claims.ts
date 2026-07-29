import type { Address } from 'viem';

import { fulfilmentKey } from './request.utils.js';
import type { IFulfilmentClaims } from './types.js';

export class FulfilmentClaims implements IFulfilmentClaims {
    private readonly held = new Set<string>();

    claim(source: Address, requestId: bigint): boolean {
        const key = fulfilmentKey(source, requestId);
        if (this.held.has(key)) {
            return false;
        }
        this.held.add(key);
        return true;
    }

    release(source: Address, requestId: bigint): void {
        this.held.delete(fulfilmentKey(source, requestId));
    }

    has(source: Address, requestId: bigint): boolean {
        return this.held.has(fulfilmentKey(source, requestId));
    }
}
