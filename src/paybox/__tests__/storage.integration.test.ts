import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_DIR } from '../../config/constants.js';
import type { ILogger } from '../../logger/types.js';
import { PAYBOX_AUTH_FILE } from '../constants.js';
import { PayboxAuthStorage } from '../storage.js';
import { PayboxRefreshState, type PayboxAuthRecord } from '../types.js';

const directories: Array<string> = [];
const logger = { warn: vi.fn() } as unknown as ILogger;
const VALID_SIGNING_KEY =
    'pbxk1.eyJwIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInMiOiIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIn0';
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
    signingKey: VALID_SIGNING_KEY,
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
        const { storage, home, file } = fixture();
        storage.save(record);
        expect(storage.load()).toEqual(record);
        expect(fs.statSync(path.join(home, SESSION_DIR)).mode & 0o777).toBe(0o700);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(path.dirname(file)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
    });

    it('persists complete OAuth material while Wallet selection remains pending', () => {
        const { storage } = fixture();
        const pendingSelection: PayboxAuthRecord = { ...record, credentialId: null, address: null };

        storage.save(pendingSelection);

        expect(storage.load()).toEqual(pendingSelection);
    });

    it('round-trips an unresolved refresh guard without discarding authority', () => {
        const { storage } = fixture();
        const guarded: PayboxAuthRecord = { ...record, refreshState: PayboxRefreshState.ExchangePending };

        storage.save(guarded);

        expect(storage.load()).toEqual(guarded);
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
        fs.writeFileSync(file, JSON.stringify({ ...record, signingKey: 'pbxk1.abcdefghijklmnop' }));
        expect(storage.load()).toBeNull();
        expect(fs.existsSync(file)).toBe(false);
        fs.writeFileSync(file, JSON.stringify({ ...record, signingKey: 'pbxk1.eyJwIjoiYWEifQ' }));
        expect(storage.load()).toBeNull();
        expect(fs.existsSync(file)).toBe(false);
        fs.writeFileSync(file, JSON.stringify({ ...record, signingKey: 'pbxk1.eyJwIjoiemoiLCJzIjoiMTEifQ' }));
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

    it('fails closed and makes stale authority unrestorable when deletion fails', () => {
        const { storage, home } = fixture();
        storage.save(record);
        const removeFile = vi.fn(() => {
            const error = new Error('permission denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
        });
        const failingStorage = new PayboxAuthStorage(home, logger, removeFile);

        expect(() => failingStorage.clear()).toThrow();
        expect(() => new PayboxAuthStorage(home, logger, removeFile).load()).toThrow();

        expect(new PayboxAuthStorage(home, logger).load()).toBeNull();
    });
});
