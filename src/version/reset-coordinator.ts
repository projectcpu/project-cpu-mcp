import type { ICachedFromConfig, IFullMapLoader, IReplaceableAppConfig, ResetCoordinatorOptions } from './types.js';
import type { ILogger } from '../logger/types.js';

export class ResetCoordinator {
    private readonly appConfig: IReplaceableAppConfig;
    private readonly mapSync: IFullMapLoader;
    private readonly swap: ICachedFromConfig;
    private readonly syndicate: ICachedFromConfig;
    private readonly logger: ILogger;

    constructor(options: ResetCoordinatorOptions) {
        this.appConfig = options.appConfig;
        this.mapSync = options.mapSync;
        this.swap = options.swap;
        this.syndicate = options.syndicate;
        this.logger = options.logger;
    }

    async reset(): Promise<void> {
        await this.mapSync.pauseResync(async () => {
            const config = await this.appConfig.fetch();
            const snapshot = await this.mapSync.fetchFullSnapshot();

            this.appConfig.replace(config);
            this.mapSync.applyFullSnapshot(snapshot);
            this.swap.invalidateCache();
            this.syndicate.invalidateCache();
        });
        this.logger.info('config, map and config-derived caches replaced');
    }
}
