import { PayboxCoordinator } from './coordinator.js';
import type { PayboxCoordinatorOptions } from './types.js';
import type { ILogger } from '../logger/types.js';

export function createPayboxCoordinator(options: PayboxCoordinatorOptions, logger: ILogger): PayboxCoordinator {
    return new PayboxCoordinator(options, logger.child('paybox:coordinator'));
}
