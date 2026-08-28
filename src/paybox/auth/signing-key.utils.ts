import { credsFromToken } from '@paybox-sh/sdk';

import { PAYBOX_KEY_PREFIX } from '../constants.js';

export function isPbxk1(value: string): boolean {
    if (value !== value.trim() || !value.startsWith(PAYBOX_KEY_PREFIX)) return false;
    try {
        credsFromToken(value);
        return true;
    } catch {
        return false;
    }
}
