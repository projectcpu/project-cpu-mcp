import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';

import type { OpenRevealRequestView } from '../../api/types.js';
import {
    parseRequestId,
    pickOpenRequest,
    pickRetiredSourceRequest,
    sameAddress,
    sameTokenId,
} from '../request.utils.js';

const CHECKSUMMED_SOURCE = '0xAbC1230000000000000000000000000000000001';
const LOWERCASE_SOURCE = '0xabc1230000000000000000000000000000000001';
const OTHER_SOURCE = '0x00000000000000000000000000000000000000b2';

function row(over: Partial<OpenRevealRequestView> = {}): OpenRevealRequestView {
    return { requestId: '1', source: CHECKSUMMED_SOURCE, tokenId: '42', requestedAt: 1_700_000_000, ...over };
}

describe('sameAddress', () => {
    it('ignores the case the two sides were written in', () => {
        expect(sameAddress(CHECKSUMMED_SOURCE, LOWERCASE_SOURCE)).toBe(true);
        expect(sameAddress(LOWERCASE_SOURCE, CHECKSUMMED_SOURCE.toUpperCase())).toBe(true);
    });

    it('still tells two different addresses apart', () => {
        expect(sameAddress(CHECKSUMMED_SOURCE, OTHER_SOURCE)).toBe(false);
    });
});

describe('sameTokenId', () => {
    it('matches the same number written differently', () => {
        expect(sameTokenId('42', ' 42 ')).toBe(true);
        expect(sameTokenId('042', '42')).toBe(true);
    });

    it('does not match a different cell', () => {
        expect(sameTokenId('42', '43')).toBe(false);
    });
});

describe('parseRequestId', () => {
    it('reads a decimal id', () => {
        expect(parseRequestId('18446744073709551615')).toBe(18_446_744_073_709_551_615n);
    });

    it('refuses anything that is not a plain decimal', () => {
        expect(parseRequestId('0x0c')).toBeNull();
        expect(parseRequestId('')).toBeNull();
        expect(parseRequestId('-1')).toBeNull();
        expect(parseRequestId('nope')).toBeNull();
    });
});

describe('pickOpenRequest', () => {
    it('matches a lowercase wire address against a checksummed adapter', () => {
        const picked = pickOpenRequest([row({ source: LOWERCASE_SOURCE })], CHECKSUMMED_SOURCE, '42');

        expect(picked?.requestId).toBe(1n);
        expect(picked?.source).toBe(CHECKSUMMED_SOURCE);
    });

    it('matches a checksummed wire address against a lowercase adapter', () => {
        const picked = pickOpenRequest([row({ source: CHECKSUMMED_SOURCE })], LOWERCASE_SOURCE, '42');

        expect(picked?.requestId).toBe(1n);
    });

    it('skips requests opened at a retired source', () => {
        expect(pickOpenRequest([row({ source: OTHER_SOURCE })], CHECKSUMMED_SOURCE, '42')).toBeNull();
    });

    it('skips requests for another cell', () => {
        expect(pickOpenRequest([row({ tokenId: '43' })], CHECKSUMMED_SOURCE, '42')).toBeNull();
    });

    it('takes the newest id when the cell has more than one open request', () => {
        const picked = pickOpenRequest(
            [row({ requestId: '9' }), row({ requestId: '11' }), row({ requestId: '10' })],
            CHECKSUMMED_SOURCE,
            '42',
        );

        expect(picked?.requestId).toBe(11n);
    });

    it('carries the request time through, including when the server has none', () => {
        expect(pickOpenRequest([row({ requestedAt: null })], CHECKSUMMED_SOURCE, '42')?.requestedAt).toBeNull();
        expect(pickOpenRequest([row()], CHECKSUMMED_SOURCE, '42')?.requestedAt).toBe(1_700_000_000);
    });

    it('drops rows whose id or source cannot be read instead of failing the lookup', () => {
        const picked = pickOpenRequest(
            [row({ requestId: 'nope' }), row({ source: 'not-an-address' }), row({ requestId: '5' })],
            CHECKSUMMED_SOURCE,
            '42',
        );

        expect(picked?.requestId).toBe(5n);
    });

    it('answers null on an empty list', () => {
        expect(pickOpenRequest([], CHECKSUMMED_SOURCE, '42')).toBeNull();
    });
});

describe('pickRetiredSourceRequest', () => {
    it('picks the request the cell opened at a source other than the current one', () => {
        const picked = pickRetiredSourceRequest([row({ source: OTHER_SOURCE })], CHECKSUMMED_SOURCE, '42');

        expect(picked?.requestId).toBe(1n);
        expect(picked?.source).toBe(getAddress(OTHER_SOURCE));
    });

    it('skips the request opened at the current source, whatever case each side is written in', () => {
        expect(pickRetiredSourceRequest([row({ source: LOWERCASE_SOURCE })], CHECKSUMMED_SOURCE, '42')).toBeNull();
        expect(pickRetiredSourceRequest([row({ source: CHECKSUMMED_SOURCE })], LOWERCASE_SOURCE, '42')).toBeNull();
    });

    it('skips a retired-source request for another cell', () => {
        expect(
            pickRetiredSourceRequest([row({ source: OTHER_SOURCE, tokenId: '43' })], CHECKSUMMED_SOURCE, '42'),
        ).toBeNull();
    });

    it('takes the newest id when the cell has more than one retired-source request', () => {
        const picked = pickRetiredSourceRequest(
            [row({ requestId: '9', source: OTHER_SOURCE }), row({ requestId: '11', source: OTHER_SOURCE })],
            CHECKSUMMED_SOURCE,
            '42',
        );

        expect(picked?.requestId).toBe(11n);
    });

    it('answers null on an empty list', () => {
        expect(pickRetiredSourceRequest([], CHECKSUMMED_SOURCE, '42')).toBeNull();
    });
});
