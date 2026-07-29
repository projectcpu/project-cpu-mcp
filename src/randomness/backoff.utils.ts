import { FULFILMENT_BACKOFF_CEILING_MS, FULFILMENT_BACKOFF_FACTOR, FULFILMENT_BACKOFF_MS } from './constants.js';

export function backoffDelayMs(failures: number): number {
    if (failures <= 1) {
        return FULFILMENT_BACKOFF_MS;
    }
    const grown = FULFILMENT_BACKOFF_MS * FULFILMENT_BACKOFF_FACTOR ** (failures - 1);
    return Math.min(grown, FULFILMENT_BACKOFF_CEILING_MS);
}
