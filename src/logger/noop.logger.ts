/* eslint-disable @typescript-eslint/no-empty-function */

import type { ILogger } from './types.js';

export class NoopLogger implements ILogger {
    info(): void {}
    warn(): void {}
    error(): void {}
    debug(): void {}
    child(): ILogger {
        return this;
    }
}
