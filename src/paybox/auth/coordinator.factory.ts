import { PayboxCoordinator } from './coordinator.js';
import type { ILogger } from '../../logger/types.js';
import type { PayboxCoordinatorOptions } from '../types.js';

export function createPayboxCoordinator(options: PayboxCoordinatorOptions, logger: ILogger): PayboxCoordinator {
    return new PayboxCoordinator(options, logger.child('paybox:coordinator'));
}
