import { FULFILMENT_SWEEP_INTERVAL_MS } from './constants.js';
import { RevealFulfiller } from './fulfiller.js';
import { SelfServiceRandomnessResolver } from './self-service.resolver.js';
import type { RevealFulfilmentHandle, RevealFulfillerFactoryOptions } from './types.js';
import { errorMessage } from '../utils/error.utils.js';

export async function createRevealFulfiller(options: RevealFulfillerFactoryOptions): Promise<RevealFulfiller | null> {
    const randomness = new SelfServiceRandomnessResolver({
        appConfig: options.appConfig,
        randomness: options.randomness,
        logger: options.logger,
    });
    if ((await randomness.resolve()) === null) {
        return null;
    }

    return new RevealFulfiller({
        randomness,
        revealRequests: options.revealRequests,
        contracts: options.contracts,
        wallet: options.wallet,
        claims: options.claims,
        logger: options.logger,
    });
}

export function startRevealFulfilment(options: RevealFulfillerFactoryOptions): RevealFulfilmentHandle {
    let fulfiller: RevealFulfiller | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const attempt = (): void => {
        void createRevealFulfiller(options)
            .then((built) => {
                if (stopped) {
                    return;
                }
                fulfiller = built;
                built?.start();
            })
            .catch((error: unknown) => {
                options.logger.warn('background reveal fulfilment has nothing to run on yet, retrying', {
                    error: errorMessage(error),
                    retryInMs: FULFILMENT_SWEEP_INTERVAL_MS,
                });
                if (!stopped) {
                    retry = setTimeout(attempt, FULFILMENT_SWEEP_INTERVAL_MS);
                }
            });
    };
    attempt();

    return {
        stop(): void {
            stopped = true;
            if (retry !== null) {
                clearTimeout(retry);
                retry = null;
            }
            fulfiller?.stop();
        },
    };
}
