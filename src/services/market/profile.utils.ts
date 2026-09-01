import { MARKET_CURSOR_PARAM } from './constants.js';

export function pagePath(basePath: string, cursor: string | null): string {
    if (cursor === null) {
        return basePath;
    }

    return `${basePath}?${new URLSearchParams({ [MARKET_CURSOR_PARAM]: cursor }).toString()}`;
}
