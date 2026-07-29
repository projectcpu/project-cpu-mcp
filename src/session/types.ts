import { z } from 'zod';

import type { ILogger } from '../logger/types.js';
import { WalletMode } from '../types.js';

export const agwSessionConfigSchema = z.object({
    accountAddress: z.string(),
    sessionHash: z.string(),
    policies: z.unknown(),
    expiresAt: z.number(),
});

export const sessionDataSchema = z.object({
    walletMode: z.nativeEnum(WalletMode),
    address: z.string(),
    sessionPrivateKey: z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/, 'sessionPrivateKey must be a 32-byte hex string')
        .nullable(),
    jwt: z.string().nullable(),
    sessionConfig: agwSessionConfigSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const sessionJsonSchema = sessionDataSchema.omit({ sessionPrivateKey: true });
export type SessionJsonData = z.infer<typeof sessionJsonSchema>;

export const sessionPrivateKeySchema = z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'sessionPrivateKey must be a 32-byte hex string');

export type AgwSessionConfig = z.infer<typeof agwSessionConfigSchema>;
export type SessionData = z.infer<typeof sessionDataSchema>;

export interface ISessionStorage {
    load(): SessionData | null;
    save(data: SessionData): void;
    delete(): void;
    exists(): boolean;
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
