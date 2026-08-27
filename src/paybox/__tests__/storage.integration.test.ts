import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_DIR } from '../../config/constants.js';
import type { ILogger } from '../../logger/types.js';
import { PAYBOX_AUTH_FILE, PAYBOX_FILE_MODE } from '../constants.js';
import { PayboxAuthStorage } from '../storage.js';
import type { PayboxAuthRecord } from '../types.js';

const directories: Array<string> = [];
const logger = { warn: vi.fn() } as unknown as ILogger;
const record: PayboxAuthRecord = {
    version: 1,
    tokens: {
        clientId: 'client',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 1,
        resource: null,
        baseUrl: 'https://paybox.test',
    },
    signingKey: 'pbxk1.abcdefghijklmnop',
    credentialId: 'credential',
    address: '0x0000000000000000000000000000000000000001',
};

afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
    vi.clearAllMocks();
});

function fixture(): { storage: PayboxAuthStorage; home: string; file: string } {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
    directories.push(home);
    return { storage: new PayboxAuthStorage(home, logger), home, file: path.join(home, SESSION_DIR, PAYBOX_AUTH_FILE) };
}

describe('PayboxAuthStorage', () => {
    it('treats an absent record as missing', () => {
        expect(fixture().storage.load()).toBeNull();
    });

    it('atomically saves a versioned record with restrictive permissions', () => {
        const { storage, file } = fixture();
        storage.save(record);
        expect(storage.load()).toEqual(record);
        expect(fs.statSync(file).mode & 0o777).toBe(PAYBOX_FILE_MODE);
        expect(fs.readdirSync(path.dirname(file)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
    });

    it('rejects corrupt, partial, and incompatible records without touching a real home', () => {
        const { storage, file } = fixture();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{');
        expect(storage.load()).toBeNull();
        expect(fs.existsSync(file)).toBe(false);
        fs.writeFileSync(file, JSON.stringify({ ...record, signingKey: 'not-a-pbxk1', address: 'not-an-evm-address' }));
        expect(storage.load()).toBeNull();
        expect(fs.existsSync(file)).toBe(false);
        fs.writeFileSync(file, JSON.stringify({ version: 2 }));
        expect(storage.load()).toBeNull();
        expect(fs.existsSync(file)).toBe(false);
    });

    it('clears the owned record', () => {
        const { storage, file } = fixture();
        storage.save(record);
        storage.clear();
        expect(fs.existsSync(file)).toBe(false);
    });
});
