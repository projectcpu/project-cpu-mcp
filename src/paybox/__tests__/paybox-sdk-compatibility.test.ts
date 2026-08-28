import { describe, expect, it } from 'vitest';

import {
    PAYBOX_SDK_COMPATIBILITY_VERSION,
    payboxSdkDeniedOperation,
    payboxSdkDirectGrantList,
    payboxSdkEnvelopeGrantList,
    payboxSdkSuccessfulSignature,
} from './paybox-sdk-0.7.fixtures.js';
import pkg from '../../../package.json' with { type: 'json' };
import { PayboxOperationDeniedError } from '../errors.js';
import { autonomousEvmGrants, signatureFromResponse } from '../sdk.utils.js';

describe('Paybox SDK compatibility fixtures', () => {
    it('keeps the installed SDK pinned to the fixture version', () => {
        expect(pkg.dependencies['@paybox-sh/sdk']).toBe(PAYBOX_SDK_COMPATIBILITY_VERSION);
    });

    it.each([
        ['observed envelope', payboxSdkEnvelopeGrantList],
        ['declared direct array', payboxSdkDirectGrantList],
    ])('normalizes the SDK 0.7 %s response shape', (_shape, fixture) => {
        expect(autonomousEvmGrants(fixture, 'https://api.paybox.sh')).toEqual({
            grants: [
                {
                    credentialId: 'wallet-a',
                    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                    label: 'Acceptance Wallet',
                    provider: 'Paybox',
                },
            ],
            managementUrl: 'https://app.paybox.sh',
        });
    });

    it('records the success and denial operation response shapes', () => {
        expect(signatureFromResponse(payboxSdkSuccessfulSignature, 'wallet-a')).toBe(`0x${'11'.repeat(65)}`);
        expect(() => signatureFromResponse(payboxSdkDeniedOperation, 'wallet-a')).toThrow(PayboxOperationDeniedError);
    });
});
