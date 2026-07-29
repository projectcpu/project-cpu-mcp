import type { Hex } from 'viem';

import { BEACON_SIGNATURE_HEX } from './constants.js';
import { BeaconRoundOutcome, type BeaconRoundResult } from './types.js';

export function toContractSignature(raw: string): Hex | null {
    if (!BEACON_SIGNATURE_HEX.test(raw)) {
        return null;
    }
    const body = raw.startsWith('0x') ? raw.slice(2) : raw;
    return `0x${body}`;
}

export function isBeaconRetryable(result: BeaconRoundResult): boolean {
    return result.outcome === BeaconRoundOutcome.NOT_RELEASED;
}
