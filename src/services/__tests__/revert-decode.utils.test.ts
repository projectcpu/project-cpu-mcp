import { encodeErrorResult, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';

import { decodeKnownRevert } from '../revert-decode.utils.js';

const ABI = parseAbi(['error KnownOne(uint16 res)', 'error KnownTwo()', 'error OtherError()']);

enum SomeRevertName {
    KNOWN_ONE = 'KnownOne',
    KNOWN_TWO = 'KnownTwo',
}

const KNOWN_NAMES: ReadonlyArray<SomeRevertName> = Object.values(SomeRevertName);

describe('decodeKnownRevert', () => {
    it('returns the name and args when the decoded error is in the known set', () => {
        const data = encodeErrorResult({ abi: ABI, errorName: 'KnownOne', args: [7] });
        expect(decodeKnownRevert({ data }, ABI, KNOWN_NAMES)).toEqual({ name: SomeRevertName.KNOWN_ONE, args: [7] });
    });

    it('passes multiple decoded args through unchanged and in order', () => {
        const wideAbi = parseAbi(['error Wide(uint16 a, address b, bool c)']);
        const data = encodeErrorResult({
            abi: wideAbi,
            errorName: 'Wide',
            args: [3, '0x1111111111111111111111111111111111111111', true],
        });
        const result = decodeKnownRevert({ data }, wideAbi, ['Wide'] as ReadonlyArray<'Wide'>);
        expect(result?.args).toEqual([3, '0x1111111111111111111111111111111111111111', true]);
    });

    it('returns null when the error decodes against the abi but its name is outside the known set', () => {
        const data = encodeErrorResult({ abi: ABI, errorName: 'OtherError' });
        expect(decodeKnownRevert({ data }, ABI, KNOWN_NAMES)).toBeNull();
    });

    it('returns null when the error carries no revert payload the abi can decode at all', () => {
        expect(decodeKnownRevert(new Error('connection refused'), ABI, KNOWN_NAMES)).toBeNull();
    });

    it('returns null when the payload does not match the abi', () => {
        expect(decodeKnownRevert({ data: '0xdeadbeef' }, ABI, KNOWN_NAMES)).toBeNull();
    });
});
