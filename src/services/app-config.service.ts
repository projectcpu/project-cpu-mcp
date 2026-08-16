import { parseAppConfig } from './app-config.utils.js';
import type { AppConfig, AppConfigServiceOptions, IAppConfig } from './types.js';
import type { ApiClient } from '../api/client.js';
import { HttpStatus } from '../api/types.js';
import type { Network } from '../config/types.js';
import type { ILogger } from '../logger/types.js';

export class AppConfigService implements IAppConfig {
    private readonly api: ApiClient;
    private readonly network: Network;
    private readonly logger: ILogger;
    private cached: AppConfig | null = null;

    constructor(options: AppConfigServiceOptions) {
        this.api = options.api;
        this.network = options.network;
        this.logger = options.logger;
    }

    async load(): Promise<AppConfig> {
        if (this.cached !== null) {
            return this.cached;
        }

        const config = await this.fetch();
        if (this.cached !== null) {
            return this.cached;
        }

        this.replace(config);
        return config;
    }

    replace(config: AppConfig): void {
        this.cached = config;
    }

    async fetch(): Promise<AppConfig> {
        this.logger.info('loading chain config', { network: this.network });
        const { status, data } = await this.api.request<unknown>(`/api/v1/config?network=${this.network}`);

        if (status !== HttpStatus.Ok) {
            throw new Error(`Failed to load chain config (HTTP ${status}) for network ${this.network}.`);
        }

        const config = parseAppConfig(data);
        this.logger.info('chain config loaded', { chainId: config.chainId });
        return config;
    }
}
