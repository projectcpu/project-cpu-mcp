const TRUE_LITERAL = 'true';
const FALSE_LITERAL = 'false';

export function parseBooleanEnv(value: string | null, defaultValue: boolean): boolean {
    if (value === null) {
        return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === TRUE_LITERAL) {
        return true;
    }
    if (normalized === FALSE_LITERAL) {
        return false;
    }

    return defaultValue;
}
