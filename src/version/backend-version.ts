import { BACKEND_RESET_NOTICE, BACKEND_VERSION_PATH, BACKEND_VERSION_TIMEOUT_MS } from './constants.js';
import {
    type BackendVersionOptions,
    type IBackendVersionSignal,
    type NowMs,
    type OnBackendVersionChange,
    type ProbeBackendVersion,
    type ToolGate,
    type VersionProbeApi,
} from './types.js';
import { backendVersionResponseSchema, HttpStatus } from '../api/types.js';
import type { ILogger } from '../logger/types.js';

export class BackendVersion implements IBackendVersionSignal {
    private readonly probe: ProbeBackendVersion;
    private readonly nowMs: NowMs;
    private readonly ttlMs: number;
    private readonly onChange: OnBackendVersionChange;
    private readonly logger: ILogger;
    private sha: string | null = null;
    private lastAttemptMs: number | null = null;
    private inFlight: Promise<void> | null = null;
    private resetPending = false;

    constructor(options: BackendVersionOptions) {
        this.probe = options.probe;
        this.nowMs = options.nowMs;
        this.ttlMs = options.ttlMs;
        this.onChange = options.onChange;
        this.logger = options.logger;
    }

    async ensureFresh(): Promise<void> {
        await this.attempt();
    }

    takeResetNotice(): boolean {
        const pending = this.resetPending;
        this.resetPending = false;
        return pending;
    }

    private async attempt(): Promise<void> {
        if (this.inFlight !== null) {
            await this.inFlight;
            return;
        }

        const now = this.nowMs();
        if (this.lastAttemptMs !== null && now - this.lastAttemptMs < this.ttlMs) {
            return;
        }
        this.lastAttemptMs = now;

        const flight = this.revalidate();
        this.inFlight = flight;
        try {
            await flight;
        } finally {
            this.inFlight = null;
        }
    }

    private async revalidate(): Promise<void> {
        const observed = await this.probe();
        if (observed === null || observed === this.sha) {
            return;
        }

        if (this.sha === null) {
            this.sha = observed;
            return;
        }

        this.logger.info('game API build changed — reloading config and map');
        try {
            await this.onChange();
        } catch (error) {
            this.lastAttemptMs = null;
            throw error;
        }

        this.sha = observed;
        this.resetPending = true;
        this.logger.info('local state reloaded for the new game API build');
    }
}

export function createBackendVersionGate(version: IBackendVersionSignal): ToolGate {
    return {
        check: async (): Promise<Array<string>> => {
            await version.ensureFresh();
            return version.takeResetNotice() ? [BACKEND_RESET_NOTICE] : [];
        },
    };
}

export function createBackendVersionProbe(api: VersionProbeApi): ProbeBackendVersion {
    return async (): Promise<string | null> => {
        try {
            const { status, data } = await api.requestWithTimeout<unknown>(
                BACKEND_VERSION_PATH,
                BACKEND_VERSION_TIMEOUT_MS,
            );
            if (status !== HttpStatus.Ok) {
                return null;
            }
            const parsed = backendVersionResponseSchema.safeParse(data);
            return parsed.success ? parsed.data.versionSha : null;
        } catch {
            return null;
        }
    };
}
