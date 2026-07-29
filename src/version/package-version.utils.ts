import {
    BLOCKED_ERROR_TEMPLATE,
    CURRENT_PLACEHOLDER,
    LATEST_PLACEHOLDER,
    UPDATE_NOTICE_TEMPLATE,
} from './constants.js';
import { PackageVersionSignal, type SemanticVersion } from './types.js';

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value: string): SemanticVersion | null {
    const match = VERSION_PATTERN.exec(value.trim());
    if (match === null) {
        return null;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ?? '',
    };
}

export function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
    if (left.major !== right.major) {
        return left.major > right.major ? 1 : -1;
    }
    if (left.minor !== right.minor) {
        return left.minor > right.minor ? 1 : -1;
    }
    if (left.patch !== right.patch) {
        return left.patch > right.patch ? 1 : -1;
    }
    if (left.prerelease === right.prerelease) {
        return 0;
    }
    if (left.prerelease === '') {
        return 1;
    }
    if (right.prerelease === '') {
        return -1;
    }
    return left.prerelease > right.prerelease ? 1 : -1;
}

export function isSameRange(left: SemanticVersion, right: SemanticVersion): boolean {
    if (left.major !== right.major) {
        return false;
    }
    return left.major !== 0 || left.minor === right.minor;
}

export function resolveVersionSignal(latest: string, current: string): PackageVersionSignal {
    const published = parseVersion(latest);
    const running = parseVersion(current);
    if (published === null || running === null) {
        return PackageVersionSignal.Silent;
    }
    if (published.prerelease !== '' || compareVersions(published, running) <= 0) {
        return PackageVersionSignal.Silent;
    }
    return isSameRange(published, running) ? PackageVersionSignal.UpdateAvailable : PackageVersionSignal.Blocked;
}

export function formatBlockedError(latest: string, current: string): string {
    return BLOCKED_ERROR_TEMPLATE.replace(LATEST_PLACEHOLDER, latest).replace(CURRENT_PLACEHOLDER, current);
}

export function formatUpdateNotice(latest: string, current: string): string {
    return UPDATE_NOTICE_TEMPLATE.replace(LATEST_PLACEHOLDER, latest).replace(CURRENT_PLACEHOLDER, current);
}
