import { isAddress } from 'viem';

import type {
    IRandomnessStrategyFactory,
    ISelfServiceRandomnessResolver,
    SelfServiceRandomness,
    SelfServiceRandomnessResolverOptions,
} from './types.js';
import { RandomnessKind } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import type { IAppConfig } from '../services/types.js';

export class SelfServiceRandomnessResolver implements ISelfServiceRandomnessResolver {
    private readonly appConfig: IAppConfig;
    private readonly randomness: IRandomnessStrategyFactory;
    private readonly logger: ILogger;

    constructor(options: SelfServiceRandomnessResolverOptions) {
        this.appConfig = options.appConfig;
        this.randomness = options.randomness;
        this.logger = options.logger;
    }

    async resolve(): Promise<SelfServiceRandomness | null> {
        const config = await this.appConfig.load();
        const cell = config.contracts.cell;
        if (!isAddress(cell, { strict: false })) {
            throw new Error(
                `Cell contract is not configured for network ${config.network}; background reveal fulfilment cannot run.`,
            );
        }

        const strategy = await this.randomness.create(config.randomness, cell);
        if (strategy.kind !== RandomnessKind.DRAND) {
            this.logger.info('reveals on this chain are settled by the randomness source itself, so nothing is swept', {
                kind: strategy.kind,
                source: strategy.source,
            });
            return null;
        }
        return strategy;
    }
}
