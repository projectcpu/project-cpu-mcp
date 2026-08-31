import { spawn } from 'node:child_process';

import { browserLaunchCommand } from './browser-opener.utils.js';
import type { IPayboxBrowserOpener, PayboxBrowserSpawn } from '../types.js';

export class SystemBrowserOpener implements IPayboxBrowserOpener {
    public constructor(
        private readonly platform: NodeJS.Platform = process.platform,
        private readonly spawnProcess: PayboxBrowserSpawn = spawn,
    ) {}

    public open(url: string): void {
        const [command, args] = browserLaunchCommand(url, this.platform);
        try {
            const child = this.spawnProcess(command, args, { stdio: 'ignore', detached: true });
            child.once('error', () => undefined);
            child.unref();
        } catch {
            // The authorization URL returned to the caller remains the headless fallback.
        }
    }
}
