import { AUTHENTICATION_REQUIRED_RECOVERY } from './constants.js';
import type { AuthenticationRequiredErrorData } from './types.js';

export class AuthenticationRequiredError extends Error {
    readonly data: AuthenticationRequiredErrorData = { ...AUTHENTICATION_REQUIRED_RECOVERY };

    constructor() {
        super(JSON.stringify(AUTHENTICATION_REQUIRED_RECOVERY));
        this.name = 'AuthenticationRequiredError';
    }
}
