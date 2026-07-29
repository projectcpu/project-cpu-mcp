import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStorage } from '../../__mocks__/in-memory-storage.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { WalletMode } from '../../types.js';
import { SessionManager } from '../manager.js';
import { type SessionData, SessionStatus } from '../types.js';

const testLogger = new NoopLogger();

/**
 * Builds a valid-looking JWT with a given `exp` (unix seconds).
 * Format: `header.payload.signature` — only payload is parsed by SessionManager.
 */
function buildJwt(expSeconds: number | undefined): string {
    const payload: Record<string, unknown> = { sub: 'test' };
    if (expSeconds !== undefined) {
        payload.exp = expSeconds;
    }
    const base64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `header.${base64}.signature`;
}

function createSession(overrides: Partial<SessionData> = {}): SessionData {
    const now = new Date().toISOString();
    const inOneHour = Math.floor(Date.now() / 1000) + 3600;
    return {
        walletMode: WalletMode.EVM,
        address: '0x1234567890123456789012345678901234567890',
        sessionPrivateKey: null,
        jwt: buildJwt(inOneHour),
        sessionConfig: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('SessionManager', () => {
    let storage: InMemoryStorage;
    let manager: SessionManager;

    beforeEach(() => {
        storage = new InMemoryStorage();
        manager = new SessionManager({ storage, walletMode: WalletMode.EVM, logger: testLogger });
    });

    it('initialize loads existing session from storage', () => {
        const session = createSession();
        storage._seed(session);

        manager.initialize();

        expect(manager.getSession()).toEqual(session);
    });

    it('getStatus returns Missing when no session exists', () => {
        manager.initialize();
        expect(manager.getStatus()).toBe(SessionStatus.Missing);
    });

    it.skip('getStatus returns Missing when session has no JWT', () => {
        storage._seed(createSession({ jwt: null }));
        manager.initialize();
        expect(manager.getStatus()).toBe(SessionStatus.Missing);
    });

    it('getStatus returns Active when JWT is valid and not expired', () => {
        storage._seed(createSession());
        manager.initialize();
        expect(manager.getStatus()).toBe(SessionStatus.Active);
    });

    it.skip('getStatus returns Expired when JWT exp is in the past', () => {
        const pastSeconds = Math.floor(Date.now() / 1000) - 60;
        storage._seed(createSession({ jwt: buildJwt(pastSeconds) }));
        manager.initialize();
        expect(manager.getStatus()).toBe(SessionStatus.Expired);
    });

    it('getSession throws when session is missing', () => {
        manager.initialize();
        expect(() => manager.getSession()).toThrow(/missing/i);
    });

    it('getJwt throws when JWT is null', () => {
        storage._seed(createSession({ jwt: null }));
        manager.initialize();
        expect(() => manager.getJwt()).toThrow(/JWT/);
    });

    it('setJwt persists the token and updates updatedAt', async () => {
        const session = createSession({ updatedAt: '2020-01-01T00:00:00.000Z' });
        storage._seed(session);
        manager.initialize();

        manager.setJwt('new-jwt');

        const persisted = storage.load();
        expect(persisted?.jwt).toBe('new-jwt');
        expect(persisted?.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
        // In-memory state matches persisted state
        expect(manager.getJwt()).toBe('new-jwt');
    });

    it('setJwt throws when no session exists', () => {
        manager.initialize();
        expect(() => manager.setJwt('new-jwt')).toThrow(/no session/i);
    });

    it('setSession replaces entire session in memory and storage', () => {
        manager.initialize();
        const session = createSession({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

        manager.setSession(session);

        expect(manager.getSession()).toEqual(session);
        expect(storage.load()).toEqual(session);
    });

    it('clear removes session from memory and storage', () => {
        storage._seed(createSession());
        manager.initialize();

        manager.clear();

        expect(manager.getStatus()).toBe(SessionStatus.Missing);
        expect(storage.load()).toBeNull();
    });

    it.skip('isAuthenticated reflects JWT validity', () => {
        manager.initialize();
        expect(manager.isAuthenticated()).toBe(false);

        manager.setSession(createSession());
        expect(manager.isAuthenticated()).toBe(true);

        const pastSeconds = Math.floor(Date.now() / 1000) - 60;
        manager.setSession(createSession({ jwt: buildJwt(pastSeconds) }));
        expect(manager.isAuthenticated()).toBe(false);
    });

    it('throws when methods are called before initialize()', () => {
        expect(() => manager.getStatus()).toThrow(/not initialized/i);
        expect(() => manager.getSession()).toThrow(/not initialized/i);
        expect(() => manager.clear()).toThrow(/not initialized/i);
    });
});
