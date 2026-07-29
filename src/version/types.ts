import { z } from 'zod';

import type { ILogger } from '../logger/types.js';
import type { MapSnapshotResponse } from '../map/types.js';
import type { AppConfig, IAppConfig } from '../services/types.js';

export interface ToolGate {
    check(): Promise<Array<string>>;
}

export interface NoticeBuffer {
    take(): Array<string>;
    keep(notices: ReadonlyArray<string>): void;
}

export enum PackageVersionSignal {
    Silent = 'silent',
    UpdateAvailable = 'update-available',
    Blocked = 'blocked',
}

export interface PackageVersionStatus {
    signal: PackageVersionSignal;
    latest: string | null;
}

export interface SemanticVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: string;
}

export type FetchLatestVersion = () => Promise<string | null>;

export type NowMs = () => number;

export interface PackageVersionOptions {
    currentVersion: string;
    fetchLatest: FetchLatestVersion;
    nowMs: NowMs;
    ttlMs: number;
    logger: ILogger;
}

export interface IPackageVersionSignal {
    readonly currentVersion: string;
    check(): Promise<PackageVersionStatus>;
}

export const distTagsSchema = z.object({ latest: z.string().min(1) }).passthrough();

export interface VersionProbeApi {
    requestWithTimeout<T>(path: string, timeoutMs: number): Promise<{ status: number; data: T }>;
}

export type ProbeBackendVersion = () => Promise<string | null>;

export type OnBackendVersionChange = () => Promise<void>;

export interface BackendVersionOptions {
    probe: ProbeBackendVersion;
    nowMs: NowMs;
    ttlMs: number;
    onChange: OnBackendVersionChange;
    logger: ILogger;
}

export interface IBackendVersion {
    ensureFresh(): Promise<void>;
}

export interface IBackendVersionSignal extends IBackendVersion {
    takeResetNotice(): boolean;
}

export interface IReplaceableAppConfig extends IAppConfig {
    fetch(): Promise<AppConfig>;
    replace(config: AppConfig): void;
}

export interface IFullMapLoader {
    fetchFullSnapshot(): Promise<MapSnapshotResponse>;
    applyFullSnapshot(snapshot: MapSnapshotResponse): void;
    pauseResync(run: () => Promise<void>): Promise<void>;
}

export interface ICachedFromConfig {
    invalidateCache(): void;
}

export interface ResetCoordinatorOptions {
    appConfig: IReplaceableAppConfig;
    mapSync: IFullMapLoader;
    swap: ICachedFromConfig;
    syndicate: ICachedFromConfig;
    logger: ILogger;
}
