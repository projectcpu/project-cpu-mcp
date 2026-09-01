import { createHash } from 'node:crypto';

import type { MarketActionIdentity } from './action.types.js';
import { ACTION_KEY_FIELD_SEPARATOR, ACTION_KEY_NULL_INPUT } from './recovery.constants.js';

export function normalizeActionAddress(address: string): string {
    return address.trim().toLowerCase();
}

export function marketActionKey(identity: MarketActionIdentity): string {
    const fields = [
        normalizeActionAddress(identity.wallet),
        identity.network,
        identity.tool,
        ...identity.inputs.map((input) => (input === null ? ACTION_KEY_NULL_INPUT : input)),
    ];

    return createHash('sha256').update(fields.join(ACTION_KEY_FIELD_SEPARATOR)).digest('hex');
}
