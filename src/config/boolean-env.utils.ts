import { BOOLEAN_ENV_FALSE, BOOLEAN_ENV_TRUE } from './constants.js';

export function parseBooleanEnv(value: string | null, defaultValue: boolean): boolean {
    if (value === null) {
        return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === BOOLEAN_ENV_TRUE) {
        return true;
    }
    if (normalized === BOOLEAN_ENV_FALSE) {
        return false;
    }

    return defaultValue;
}
