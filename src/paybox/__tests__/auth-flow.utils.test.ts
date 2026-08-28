import { describe, expect, it } from 'vitest';

import { oauthTokenError } from '../auth-flow.utils.js';
import { PayboxAuthInvalidError, PayboxTemporarilyUnavailableError } from '../errors.js';

describe('OAuth failure classification', () => {
    it.each([400, 401, 403])('marks token exchange HTTP %i as confirmed invalid authority', (status) => {
        expect(oauthTokenError(status)).toBeInstanceOf(PayboxAuthInvalidError);
    });

    it.each([429, 503])('publishes temporary recovery for token exchange HTTP %i', (status) => {
        const error = oauthTokenError(status);

        expect(error).toBeInstanceOf(PayboxTemporarilyUnavailableError);
        expect(error).not.toBeInstanceOf(PayboxAuthInvalidError);
        expect(error).toMatchObject({
            data: { code: 'PAYBOX_TEMPORARILY_UNAVAILABLE', stateCleared: false, retryable: true },
        });
    });
});
