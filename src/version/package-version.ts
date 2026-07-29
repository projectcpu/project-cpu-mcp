import { REGISTRY_DIST_TAGS_URL, REGISTRY_FETCH_TIMEOUT_MS } from './constants.js';
import { formatBlockedError, formatUpdateNotice, resolveVersionSignal } from './package-version.utils.js';
import {
    distTagsSchema,
    type FetchLatestVersion,
    type IPackageVersionSignal,
    type NowMs,
    type PackageVersionOptions,
    PackageVersionSignal,
    type PackageVersionStatus,
    type ToolGate,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';

const SILENT: PackageVersionStatus = { signal: PackageVersionSignal.Silent, latest: null };

export class PackageVersion implements IPackageVersionSignal {
    readonly currentVersion: string;
    private readonly fetchLatest: FetchLatestVersion;
    private readonly nowMs: NowMs;
    private readonly ttlMs: number;
    private readonly logger: ILogger;
    private lastAttemptMs: number | null = null;
    private reportedVersion: string | null = null;
    private blockedBy: string | null = null;

    constructor(options: PackageVersionOptions) {
        this.currentVersion = options.currentVersion;
        this.fetchLatest = options.fetchLatest;
        this.nowMs = options.nowMs;
        this.ttlMs = options.ttlMs;
        this.logger = options.logger;
    }

    async check(): Promise<PackageVersionStatus> {
        if (this.blockedBy !== null) {
            return { signal: PackageVersionSignal.Blocked, latest: this.blockedBy };
        }

        const now = this.nowMs();
        if (this.lastAttemptMs !== null && now - this.lastAttemptMs < this.ttlMs) {
            return SILENT;
        }
        this.lastAttemptMs = now;

        const latest = await this.readLatest();
        if (latest === null) {
            return SILENT;
        }

        const signal = resolveVersionSignal(latest, this.currentVersion);
        if (signal === PackageVersionSignal.Blocked) {
            this.blockedBy = latest;
            this.logger.warn('published version is not compatible with this build', {
                latest,
                current: this.currentVersion,
            });
            return { signal, latest };
        }

        if (signal === PackageVersionSignal.UpdateAvailable && this.reportedVersion !== latest) {
            this.reportedVersion = latest;
            this.logger.info('compatible update available', { latest, current: this.currentVersion });
            return { signal, latest };
        }

        return SILENT;
    }

    private async readLatest(): Promise<string | null> {
        try {
            return await this.fetchLatest();
        } catch (error) {
            this.logger.debug('registry lookup failed', { error: errorMessage(error) });
            return null;
        }
    }
}

export function createPackageVersionGate(version: IPackageVersionSignal): ToolGate {
    return {
        check: async (): Promise<Array<string>> => {
            const status = await version.check();
            const latest = status.latest ?? '';

            if (status.signal === PackageVersionSignal.Blocked) {
                throw new Error(formatBlockedError(latest, version.currentVersion));
            }
            if (status.signal === PackageVersionSignal.UpdateAvailable) {
                return [formatUpdateNotice(latest, version.currentVersion)];
            }
            return [];
        },
    };
}

export async function fetchLatestFromRegistry(): Promise<string | null> {
    const response = await fetch(REGISTRY_DIST_TAGS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
        return null;
    }

    const parsed = distTagsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.latest : null;
}
