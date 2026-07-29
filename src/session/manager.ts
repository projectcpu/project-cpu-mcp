import type { ILogger } from '../logger/types.js';
import { WalletMode } from '../types.js';
import { type ISessionStorage, type SessionData, type SessionManagerOptions, SessionStatus } from './types.js';

export class SessionManager {
    private session: SessionData | null = null;
    private readonly storage: ISessionStorage;
    private readonly walletMode: WalletMode;
    private readonly logger: ILogger;
    private initialized = false;

    constructor(options: SessionManagerOptions) {
        this.storage = options.storage;
        this.walletMode = options.walletMode;
        this.logger = options.logger;
    }

    /**
     * Load session from storage into memory. Must be called before using other methods.
     */
    initialize(): void {
        this.session = this.storage.load();
        this.initialized = true;
    }

    getStatus(): SessionStatus {
        this.assertInitialized();

        if (!this.session) {
            return SessionStatus.Missing;
        }

        return SessionStatus.Active;
    }

    getSession(): SessionData {
        this.assertInitialized();

        if (!this.session) {
            throw new Error('Session is missing. Call authenticate first.');
        }

        return this.session;
    }

    getJwt(): string {
        const session = this.getSession();

        if (!session.jwt) {
            throw new Error('Session has no JWT. Call authenticate first.');
        }

        return session.jwt;
    }

    isAuthenticated(): boolean {
        return this.getStatus() === SessionStatus.Active;
    }

    setJwt(jwt: string): void {
        this.assertInitialized();

        if (!this.session) {
            throw new Error('Cannot set JWT: no session exists. Use setSession first.');
        }

        const updated: SessionData = {
            ...this.session,
            jwt,
            updatedAt: new Date().toISOString(),
        };

        this.session = updated;
        this.storage.save(updated);
    }

    setSession(data: SessionData): void {
        this.assertInitialized();

        this.session = data;
        this.storage.save(data);
    }

    clear(): void {
        this.assertInitialized();

        this.session = null;
        this.storage.delete();
    }

    getWalletMode(): WalletMode {
        return this.walletMode;
    }

    private assertInitialized(): void {
        if (!this.initialized) {
            throw new Error('SessionManager not initialized. Call initialize() first.');
        }
    }
}
