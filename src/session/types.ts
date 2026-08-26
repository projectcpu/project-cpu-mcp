import { z } from 'zod';

import type { ILogger } from '../logger/types.js';

export const sessionDataSchema = z.object({
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

export enum SessionStatus {
    Active = 'active',
    Expired = 'expired',
    Missing = 'missing',
}

export interface SessionManagerOptions {
    storage: ISessionStorage;
    logger: ILogger;
}
