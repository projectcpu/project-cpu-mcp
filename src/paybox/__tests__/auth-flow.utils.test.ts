import { describe, expect, it } from 'vitest';

import { oauthTokenError } from '../auth-flow.utils.js';
import { PayboxAuthInvalidError } from '../errors.js';

describe('OAuth failure classification', () => {
    it.each([400, 401, 403])('marks token exchange HTTP %i as confirmed invalid authority', (status) => {
        expect(oauthTokenError(status)).toBeInstanceOf(PayboxAuthInvalidError);
    });

    it('preserves a token exchange service failure without marking authority dead', () => {
        expect(oauthTokenError(503)).not.toBeInstanceOf(PayboxAuthInvalidError);
    });
});
