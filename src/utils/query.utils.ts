export function buildQuery(params: Record<string, string | number | null>): string {
    const pairs: Array<string> = [];
    for (const [key, value] of Object.entries(params)) {
        if (value !== null) {
            pairs.push(`${key}=${encodeURIComponent(String(value))}`);
        }
    }
    return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}
