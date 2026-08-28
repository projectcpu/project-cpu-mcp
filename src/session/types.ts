import { z } from 'zod';

import type { ILogger } from '../logger/types.js';
import { WalletMode } from '../types.js';

export const sessionDataSchema = z.object({
    walletMode: z.nativeEnum(WalletMode),
    address: z.string(),
    jwt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type SessionData = z.infer<typeof sessionDataSchema>;

export interface ISessionStorage {
    load(): SessionData | null;
    save(data: SessionData): void;
    delete(): void;
    exists(): boolean;
}

/** The game-session capability API clients need to revoke a rejected bearer token. */
export interface IJwtSession {
    clearJwt(): void;
}

export enum SessionStatus {
    Active = 'active',
    Expired = 'expired',
    Missing = 'missing',
}

export interface SessionManagerOptions {
    storage: ISessionStorage;
    walletMode: WalletMode;
    logger: ILogger;
}
