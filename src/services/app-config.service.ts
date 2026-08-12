import {
    normalizeOptionalAddress,
    parseRandomnessDescriptor,
    parseRevealPayment,
    toModeSwitchView,
} from './app-config.utils.js';
import type { AppConfig, AppConfigServiceOptions, IAppConfig } from './types.js';
import type { ApiClient } from '../api/client.js';
import { type AppConfigResponse, appConfigResponseSchema, HttpStatus } from '../api/types.js';
import type { Network } from '../config/types.js';
import type { ILogger } from '../logger/types.js';
import { bpToPercent } from '../utils/format.utils.js';

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
        const { status, data } = await this.api.request<AppConfigResponse>(`/api/v1/config?network=${this.network}`);

        if (status !== HttpStatus.Ok) {
            throw new Error(`Failed to load chain config (HTTP ${status}) for network ${this.network}.`);
        }

        appConfigResponseSchema.parse(data);

        // Addresses ship empty until their contracts are deployed; each paid action validates the address it
        // needs (`isAddress`) before sending, so read-only tools keep working before a deployment lands.
        const config: AppConfig = {
            network: this.network,
            chainId: data.chainId,
            contracts: {
                land: data.contracts.land,
                cpuToken: data.contracts.cpuToken,
                cpuHook: data.contracts.cpuHook,
                cell: data.contracts.cell,
                cellLens: data.contracts.cellLens,
                transport: data.contracts.transport,
                trade: data.contracts.trade,
                syndicate: normalizeOptionalAddress(data.contracts.syndicate),
            },
            randomness: parseRandomnessDescriptor(data.randomness),
            resources: data.resources ?? {},
            recipes: data.recipes ?? [],
            // Default demolishCost so a client running against an older API (no demolish field) degrades to a
            // free/no-op demolish pre-check rather than crashing on `undefined.cpu`; the chain stays the arbiter.
            buildings: (data.buildings ?? []).map((b) => ({
                ...b,
                demolishCost: b.demolishCost ?? { cpu: '0', inputs: [] },
                modeSwitch: toModeSwitchView(b.modeSwitchCost),
                recipeOpexCpu: b.recipeOpexCpu ?? null,
                upgradeFrom: b.upgradeFrom ?? null,
                upgradeTo: b.upgradeTo ?? [],
                family: b.family ?? null,
                level: b.level ?? null,
                branch: b.branch ?? null,
            })),
            reveal: parseRevealPayment(data.reveal),
            transport: {
                moveRadius: data.transport.moveRadius,
                hubRadius: data.transport.hubRadius,
                moveTimePerCellSec: data.transport.moveTimePerCellSec,
                moveFeeFloors: data.transport.moveFeeFloors,
            },
            trade: {
                saleBurnPercent: data.trade?.saleBurnPercent ?? 0,
                maxSaleFeePercent: bpToPercent(data.trade?.maxSaleFeeBp ?? 0),
            },
            storage: { hubStorageMultiplier: data.storage.hubStorageMultiplier },
        };
        this.logger.info('chain config loaded', { chainId: config.chainId });
        return config;
    }
}
