import { getAddress, isAddress } from 'viem';

import type { OpenRequestRow } from './types.js';
import type { OpenRevealRequestView } from '../api/types.js';

const DECIMAL = /^\d+$/;

export function sameAddress(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function sameTokenId(left: string, right: string): boolean {
    const a = left.trim();
    const b = right.trim();
    if (a === b) {
        return true;
    }
    return DECIMAL.test(a) && DECIMAL.test(b) && BigInt(a) === BigInt(b);
}

export function fulfilmentKey(source: string, requestId: bigint): string {
    return `${source.trim().toLowerCase()}:${requestId.toString()}`;
}

export function parseRequestId(value: string): bigint | null {
    const trimmed = value.trim();
    return DECIMAL.test(trimmed) ? BigInt(trimmed) : null;
}

export function toOpenRequestRow(request: OpenRevealRequestView): OpenRequestRow | null {
    const requestId = parseRequestId(request.requestId);
    if (requestId === null || !isAddress(request.source, { strict: false })) {
        return null;
    }
    return {
        requestId,
        source: getAddress(request.source),
        tokenId: request.tokenId,
        requestedAt: request.requestedAt,
    };
}

function pickNewestRequest(
    requests: ReadonlyArray<OpenRevealRequestView>,
    tokenId: string,
    accepts: (source: string) => boolean,
): OpenRequestRow | null {
    let picked: OpenRequestRow | null = null;
    for (const request of requests) {
        if (!sameTokenId(request.tokenId, tokenId) || !accepts(request.source)) {
            continue;
        }
        const row = toOpenRequestRow(request);
        if (row !== null && (picked === null || row.requestId > picked.requestId)) {
            picked = row;
        }
    }
    return picked;
}

export function pickOpenRequest(
    requests: ReadonlyArray<OpenRevealRequestView>,
    source: string,
    tokenId: string,
): OpenRequestRow | null {
    return pickNewestRequest(requests, tokenId, (candidate) => sameAddress(candidate, source));
}

export function pickRetiredSourceRequest(
    requests: ReadonlyArray<OpenRevealRequestView>,
    source: string,
    tokenId: string,
): OpenRequestRow | null {
    return pickNewestRequest(requests, tokenId, (candidate) => !sameAddress(candidate, source));
}
