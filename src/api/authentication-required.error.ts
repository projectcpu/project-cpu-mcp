import { ApiAuthenticationErrorCode, type AuthenticationRequiredErrorData } from './types.js';

export class AuthenticationRequiredError extends Error {
    readonly data: AuthenticationRequiredErrorData = {
        code: ApiAuthenticationErrorCode.AuthenticationRequired,
        stateCleared: true,
        nextTool: 'cpu_authenticate',
    };

    constructor() {
        super(ApiAuthenticationErrorCode.AuthenticationRequired);
        this.name = 'AuthenticationRequiredError';
    }
}
