import { encodeErrorResult, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';

import { decodeRevert, describeRevert, extractRevertData } from '../revert.utils.js';

const ABI = parseAbi(['error RoundMismatch(uint64 requestId, uint64 expected, uint64 provided)', 'error Nope()']);

const MISMATCH = encodeErrorResult({ abi: ABI, errorName: 'RoundMismatch', args: [7n, 91n, 90n] });

describe('decodeRevert', () => {
    it('returns the error name and its decoded arguments', () => {
        expect(decodeRevert({ data: MISMATCH }, ABI)).toEqual({ name: 'RoundMismatch', args: [7n, 91n, 90n] });
    });

    it('returns an empty argument list for an error without parameters', () => {
        const data = encodeErrorResult({ abi: ABI, errorName: 'Nope' });

        expect(decodeRevert({ data }, ABI)).toEqual({ name: 'Nope', args: [] });
    });

    it('finds the payload down a chain of wrapping errors', () => {
        const wrapped = new Error('Execution reverted', { cause: { cause: { data: { data: MISMATCH } } } });

        expect(decodeRevert(wrapped, ABI)?.name).toBe('RoundMismatch');
    });

    it('returns null when the error carries no revert payload', () => {
        expect(decodeRevert(new Error('connection refused'), ABI)).toBeNull();
        expect(extractRevertData(new Error('connection refused'))).toBeNull();
    });

    it('returns null when the payload does not match the abi', () => {
        expect(decodeRevert({ data: '0xdeadbeef' }, ABI)).toBeNull();
    });
});

describe('describeRevert', () => {
    it('formats the decoded error as name and arguments', () => {
        expect(describeRevert({ data: MISMATCH }, ABI)).toBe('RoundMismatch(7, 91, 90)');
    });

    it('formats a parameterless error with empty parentheses', () => {
        const data = encodeErrorResult({ abi: ABI, errorName: 'Nope' });

        expect(describeRevert({ data }, ABI)).toBe('Nope()');
    });

    it('returns null when nothing decodes', () => {
        expect(describeRevert({ data: '0xdeadbeef' }, ABI)).toBeNull();
    });
});
