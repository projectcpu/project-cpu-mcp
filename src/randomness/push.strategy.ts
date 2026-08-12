import type { Address } from 'viem';

import type { PushRandomness, PushRandomnessOptions } from './types.js';
import { RandomnessKind } from '../api/types.js';

/**
 * Names the source a push network draws from. It quotes nothing: the Cell prices the whole reveal — its own
 * legs and the source's fee together — so a second, client-side fee quote could only disagree with it.
 */
export class PushRandomnessStrategy implements PushRandomness {
    public readonly kind: RandomnessKind.ENTROPY = RandomnessKind.ENTROPY;
    public readonly source: Address;

    constructor(options: PushRandomnessOptions) {
        this.source = options.source;
    }
}
