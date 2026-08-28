import { expect, it, vi } from 'vitest';

import type { ILogger } from '../../logger/types.js';
import { createPayboxCoordinator } from '../coordinator.factory.js';
import type { PayboxCoordinatorOptions } from '../types.js';

it('composes the production coordinator with its named child logger', () => {
    const coordinatorLogger = { warn: vi.fn() } as unknown as ILogger;
    const child = vi.fn(() => coordinatorLogger);
    const rootLogger = { child } as unknown as ILogger;
    const options = {
        storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
        flow: { start: vi.fn(), finish: vi.fn(), cancel: vi.fn() },
        sdk: {},
        authenticator: { authenticate: vi.fn(), clearSession: vi.fn() },
    } as unknown as PayboxCoordinatorOptions;

    createPayboxCoordinator(options, rootLogger);

    expect(child).toHaveBeenCalledOnce();
    expect(child).toHaveBeenCalledWith('paybox:coordinator');
});
