import { encodeErrorResult, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';

import { describeAdapterFailure } from '../adapter-revert.utils.js';
import { AdapterErrorName } from '../types.js';

const DEPLOYED_ERRORS = parseAbi([
    'error UnknownRequest(uint64 requestId)',
    'error RoundMismatch(uint64 requestId, uint64 expected, uint64 provided)',
    'error MalformedSignature()',
    'error SignatureDoesNotVerify(uint64 round)',
    'error InsufficientCallbackGas(uint256 budget, uint256 available)',
    'error InsufficientFee(uint256 quoted, uint256 attached)',
    'error RefundFailed()',
]);

function revert(errorName: string, args: ReadonlyArray<unknown>): { data: string } {
    return {
        data: encodeErrorResult({
            abi: DEPLOYED_ERRORS,
            errorName,
            ...(args.length > 0 ? { args } : {}),
        } as Parameters<typeof encodeErrorResult>[0]),
    };
}

describe('describeAdapterFailure', () => {
    it('reads an already fulfilled request as done rather than as a failure', () => {
        const failure = describeAdapterFailure(revert('UnknownRequest', [7n]));

        expect(failure?.name).toBe(AdapterErrorName.UNKNOWN_REQUEST);
        expect(failure?.alreadyFulfilled).toBe(true);
        expect(failure?.message).toMatch(/request 7 is no longer open/i);
        expect(failure?.message).toMatch(/already been fulfilled/i);
        expect(failure?.message).toMatch(/re-read the cell/i);
    });

    it('names the round the beacon answered for and the round the request needs', () => {
        const failure = describeAdapterFailure(revert('RoundMismatch', [7n, 91n, 90n]));

        expect(failure?.name).toBe(AdapterErrorName.ROUND_MISMATCH);
        expect(failure?.alreadyFulfilled).toBe(false);
        expect(failure?.message).toMatch(/beacon handed back round 90/i);
        expect(failure?.message).toMatch(/settled only by round 91/i);
    });

    it('reads a signature of the wrong shape as the wrong beacon', () => {
        const failure = describeAdapterFailure(revert('MalformedSignature', []));

        expect(failure?.name).toBe(AdapterErrorName.MALFORMED_SIGNATURE);
        expect(failure?.alreadyFulfilled).toBe(false);
        expect(failure?.message).toMatch(/64-byte signatures/i);
        expect(failure?.message).toMatch(/not the one the source was deployed against/i);
    });

    it('reads a signature that does not verify as the wrong beacon', () => {
        const failure = describeAdapterFailure(revert('SignatureDoesNotVerify', [91n]));

        expect(failure?.name).toBe(AdapterErrorName.SIGNATURE_DOES_NOT_VERIFY);
        expect(failure?.alreadyFulfilled).toBe(false);
        expect(failure?.message).toMatch(/signature of round 91/i);
        expect(failure?.message).toMatch(/not the one the source was deployed against/i);
    });

    it('asks for a higher gas limit when the callback budget was not covered', () => {
        const failure = describeAdapterFailure(revert('InsufficientCallbackGas', [550_000n, 356_850n]));

        expect(failure?.name).toBe(AdapterErrorName.INSUFFICIENT_CALLBACK_GAS);
        expect(failure?.alreadyFulfilled).toBe(false);
        expect(failure?.message).toMatch(/needs 550000 gas/i);
        expect(failure?.message).toMatch(/only 356850 was left/i);
        expect(failure?.message).toMatch(/higher gas limit/i);
    });

    it('asks for a fresh quote when gas got more expensive than the fee paid', () => {
        const failure = describeAdapterFailure(revert('InsufficientFee', [1_500n, 1_000n]));

        expect(failure?.name).toBe(AdapterErrorName.INSUFFICIENT_FEE);
        expect(failure?.alreadyFulfilled).toBe(false);
        expect(failure?.message).toMatch(/now asks 1500 wei/i);
        expect(failure?.message).toMatch(/carried 1000/i);
        expect(failure?.message).toMatch(/quote again and retry/i);
    });

    it('translates every adapter error this client can hit and treats only one as done', () => {
        const failures = [
            describeAdapterFailure(revert('UnknownRequest', [7n])),
            describeAdapterFailure(revert('RoundMismatch', [7n, 91n, 90n])),
            describeAdapterFailure(revert('MalformedSignature', [])),
            describeAdapterFailure(revert('SignatureDoesNotVerify', [91n])),
            describeAdapterFailure(revert('InsufficientCallbackGas', [550_000n, 356_850n])),
            describeAdapterFailure(revert('InsufficientFee', [1_500n, 1_000n])),
        ];

        expect(failures.map((failure) => failure?.name)).toEqual(Object.values(AdapterErrorName));
        expect(failures.filter((failure) => failure?.alreadyFulfilled === true)).toHaveLength(1);
        for (const failure of failures) {
            expect(failure?.message).not.toMatch(/[A-Za-z]+\(/);
        }
    });

    it('leaves a revert it has no phrase for to the caller', () => {
        expect(describeAdapterFailure(revert('RefundFailed', []))).toBeNull();
    });

    it('leaves an error carrying no revert payload to the caller', () => {
        expect(describeAdapterFailure(new Error('connection refused'))).toBeNull();
    });

    it('reads the payload through the wrapper the contract client throws', () => {
        const raw = revert('UnknownRequest', [7n]);
        const wrapped = new Error('Execution reverted: UnknownRequest(7)', { cause: raw });

        expect(describeAdapterFailure(wrapped)?.alreadyFulfilled).toBe(true);
    });
});
