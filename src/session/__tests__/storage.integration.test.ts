import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_DIR, SESSION_FILE, SESSION_KEY_FILE } from '../../config/constants.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { WalletMode } from '../../types.js';
import { SessionStorage } from '../storage.js';
import type { SessionData } from '../types.js';

function createSessionData(overrides: Partial<SessionData> = {}): SessionData {
    const now = new Date().toISOString();
    return {
        walletMode: WalletMode.EVM,
        address: '0x1234567890123456789012345678901234567890',
        sessionPrivateKey: null,
        jwt: 'header.payload.signature',
        sessionConfig: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('SessionStorage', () => {
    let tempDir: string;
    let storage: SessionStorage;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
        storage = new SessionStorage(tempDir, new NoopLogger());
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('save + load', () => {
        it('saves and loads session data correctly', () => {
            const data = createSessionData();
            storage.save(data);
            const loaded = storage.load();
            expect(loaded).toEqual(data);
        });

        it('creates directory with 0o700 permissions', () => {
            storage.save(createSessionData());
            const dirStat = fs.statSync(path.join(tempDir, SESSION_DIR));
            // On macOS/Linux mode has file-type bits; mask to permission bits
            expect(dirStat.mode & 0o777).toBe(0o700);
        });

        it('creates file with 0o600 permissions', () => {
            storage.save(createSessionData());
            const fileStat = fs.statSync(path.join(tempDir, SESSION_DIR, SESSION_FILE));
            expect(fileStat.mode & 0o777).toBe(0o600);
        });

        it('returns null when no session file exists', () => {
            expect(storage.load()).toBeNull();
        });

        it('overwrites existing session on save', () => {
            storage.save(createSessionData({ jwt: 'old-jwt' }));
            storage.save(createSessionData({ jwt: 'new-jwt' }));
            const loaded = storage.load();
            expect(loaded?.jwt).toBe('new-jwt');
        });

        it('preserves AGW session config when saved', () => {
            const data = createSessionData({
                walletMode: WalletMode.AGW,
                sessionConfig: {
                    accountAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
                    sessionHash: '0xdeadbeef',
                    policies: { target: '0x1111', selector: '0x2222' },
                    expiresAt: 1234567890,
                },
            });
            storage.save(data);
            const loaded = storage.load();
            expect(loaded).toEqual(data);
        });

        it('deletes session files and returns null when session.json is corrupted', () => {
            const sessionFile = path.join(tempDir, SESSION_DIR, SESSION_FILE);
            fs.mkdirSync(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
            fs.writeFileSync(sessionFile, '{"not": "valid session"}', { mode: 0o600 });

            expect(storage.load()).toBeNull();
            expect(fs.existsSync(sessionFile)).toBe(false);
        });
    });

    describe('delete', () => {
        it('removes session file', () => {
            storage.save(createSessionData());
            expect(storage.exists()).toBe(true);
            storage.delete();
            expect(storage.exists()).toBe(false);
        });

        it('does not throw when file does not exist', () => {
            expect(() => storage.delete()).not.toThrow();
        });

        it('removes both session.json and session-key files', () => {
            const validKey = '0x' + 'a'.repeat(64);
            storage.save(createSessionData({ sessionPrivateKey: validKey }));
            const keyPath = path.join(tempDir, SESSION_DIR, SESSION_KEY_FILE);
            expect(fs.existsSync(keyPath)).toBe(true);
            storage.delete();
            expect(fs.existsSync(keyPath)).toBe(false);
        });
    });

    describe('key file persistence', () => {
        const validKey = '0x' + 'b'.repeat(64);

        it('stores sessionPrivateKey in a separate session-key file, not session.json', () => {
            storage.save(createSessionData({ sessionPrivateKey: validKey }));
            const jsonContent = fs.readFileSync(path.join(tempDir, SESSION_DIR, SESSION_FILE), 'utf-8');
            expect(jsonContent).not.toContain(validKey);
            const keyContent = fs.readFileSync(path.join(tempDir, SESSION_DIR, SESSION_KEY_FILE), 'utf-8');
            expect(keyContent.trim()).toBe(validKey);
        });

        it('creates key file with 0o600 permissions', () => {
            storage.save(createSessionData({ sessionPrivateKey: validKey }));
            const stat = fs.statSync(path.join(tempDir, SESSION_DIR, SESSION_KEY_FILE));
            expect(stat.mode & 0o777).toBe(0o600);
        });

        it('load returns null sessionPrivateKey when key file is absent', () => {
            storage.save(createSessionData({ sessionPrivateKey: null }));
            const loaded = storage.load();
            expect(loaded?.sessionPrivateKey).toBeNull();
        });

        it('save with null key removes a previously-persisted key file', () => {
            storage.save(createSessionData({ sessionPrivateKey: validKey }));
            const keyPath = path.join(tempDir, SESSION_DIR, SESSION_KEY_FILE);
            expect(fs.existsSync(keyPath)).toBe(true);
            storage.save(createSessionData({ sessionPrivateKey: null }));
            expect(fs.existsSync(keyPath)).toBe(false);
        });

        it('deletes both files and returns null when the key file is corrupted', () => {
            storage.save(createSessionData({ sessionPrivateKey: validKey }));
            const sessionFile = path.join(tempDir, SESSION_DIR, SESSION_FILE);
            const keyFile = path.join(tempDir, SESSION_DIR, SESSION_KEY_FILE);
            fs.writeFileSync(keyFile, 'not-a-valid-hex-key', { mode: 0o600 });

            expect(storage.load()).toBeNull();
            expect(fs.existsSync(sessionFile)).toBe(false);
            expect(fs.existsSync(keyFile)).toBe(false);
        });
    });

    describe('exists', () => {
        it('returns true when session file exists', () => {
            storage.save(createSessionData());
            expect(storage.exists()).toBe(true);
        });

        it('returns false when session file does not exist', () => {
            expect(storage.exists()).toBe(false);
        });
    });
});
