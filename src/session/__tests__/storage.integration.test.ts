import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_DIR, SESSION_FILE } from '../../config/constants.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { WalletMode } from '../../types.js';
import { SessionStorage } from '../storage.js';
import type { SessionData } from '../types.js';

function createSessionData(overrides: Partial<SessionData> = {}): SessionData {
    const now = new Date().toISOString();
    return {
        walletMode: WalletMode.EVM,
        address: '0x1234567890123456789012345678901234567890',
        jwt: 'header.payload.signature',
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

        it('persists only the wallet mode, address, JWT and timestamps', () => {
            storage.save(createSessionData());
            const written = JSON.parse(
                fs.readFileSync(path.join(tempDir, SESSION_DIR, SESSION_FILE), 'utf-8'),
            ) as Record<string, unknown>;
            expect(Object.keys(written).sort()).toEqual(['address', 'createdAt', 'jwt', 'updatedAt', 'walletMode']);
        });

        it('writes nothing beside session.json', () => {
            storage.save(createSessionData());
            expect(fs.readdirSync(path.join(tempDir, SESSION_DIR))).toEqual([SESSION_FILE]);
        });

        it('reads a session file written by an older runtime and drops its discarded fields', () => {
            const now = new Date().toISOString();
            const sessionFile = path.join(tempDir, SESSION_DIR, SESSION_FILE);
            fs.mkdirSync(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
            fs.writeFileSync(
                sessionFile,
                JSON.stringify({
                    walletMode: 'evm',
                    address: '0x1234567890123456789012345678901234567890',
                    jwt: 'header.payload.signature',
                    sessionConfig: null,
                    createdAt: now,
                    updatedAt: now,
                }),
                { mode: 0o600 },
            );

            expect(storage.load()).toEqual({
                walletMode: WalletMode.EVM,
                address: '0x1234567890123456789012345678901234567890',
                jwt: 'header.payload.signature',
                createdAt: now,
                updatedAt: now,
            });
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
        it('leaves the session directory empty', () => {
            storage.save(createSessionData());
            storage.delete();
            expect(fs.readdirSync(path.join(tempDir, SESSION_DIR))).toEqual([]);
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
