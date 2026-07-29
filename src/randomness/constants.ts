import { REVEAL_POLL_TIMEOUT_MS } from '../services/reveal.constants.js';

export const BEACON_ROUND_PATH = '/public/';

export const BEACON_SIGNATURE_BYTES = 64;

export const BEACON_SIGNATURE_HEX = new RegExp(`^(?:0x)?[0-9a-fA-F]{${BEACON_SIGNATURE_BYTES * 2}}$`);

export const BEACON_RETRY_INTERVAL_MS = 3_000;

export const BEACON_WAIT_CEILING_MS = REVEAL_POLL_TIMEOUT_MS;

export const BEACON_WAIT_BUDGET_FACTOR = 2;

export const MS_PER_SECOND = 1_000;

export const FULFILMENT_SWEEP_INTERVAL_MS = 60_000;

export const FULFILMENT_BACKOFF_MS = 60_000;

export const FULFILMENT_BACKOFF_FACTOR = 2;

export const FULFILMENT_BACKOFF_CEILING_MS = 900_000;

export const FULFILMENT_REVERT_LABEL = 'Reveal fulfilment';
