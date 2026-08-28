import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { SystemBrowserOpener } from '../auth/browser-opener.js';
import type { PayboxBrowserSpawn } from '../types.js';

const AUTHORIZATION_URL = 'https://issuer.example/authorize?state=one&code_challenge=two';

describe('SystemBrowserOpener', () => {
    it.each([
        ['darwin', 'open', [AUTHORIZATION_URL]],
        ['win32', 'rundll32', ['url.dll,FileProtocolHandler', AUTHORIZATION_URL]],
        ['linux', 'xdg-open', [AUTHORIZATION_URL]],
    ] as const)('launches through the platform command on %s without a shell', (platform, command, args) => {
        const unref = vi.fn();
        const once = vi.fn();
        const spawnProcess = vi.fn(() => ({ once, unref }) as unknown as ChildProcess) as PayboxBrowserSpawn;
        const opener = new SystemBrowserOpener(platform, spawnProcess);

        opener.open(AUTHORIZATION_URL);

        expect(spawnProcess).toHaveBeenCalledOnce();
        expect(spawnProcess).toHaveBeenCalledWith(command, args, { stdio: 'ignore', detached: true });
        expect(once).toHaveBeenCalledWith('error', expect.any(Function));
        expect(unref).toHaveBeenCalledOnce();
    });

    it('leaves URL fallback to the caller when process creation throws', () => {
        const spawnProcess = vi.fn(() => {
            throw new Error('spawn unavailable');
        }) as PayboxBrowserSpawn;
        const opener = new SystemBrowserOpener('linux', spawnProcess);

        expect(() => opener.open(AUTHORIZATION_URL)).not.toThrow();
    });
});
