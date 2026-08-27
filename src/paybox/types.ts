import { z } from 'zod';

import type { WalletManager } from '../wallet/types.js';

export enum PayboxAuthStatus {
    Authenticated = 'authenticated',
    AuthRequired = 'paybox_auth_required',
}

export const payboxTokensSchema = z.object({
    clientId: z.string().min(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().nullable(),
    expiresAt: z.number().finite().nullable(),
    resource: z.string().nullable(),
    baseUrl: z.string().url(),
});

export const payboxAuthRecordSchema = z.object({
    version: z.literal(1),
    tokens: payboxTokensSchema.nullable(),
    signingKey: z.string().nullable(),
    credentialId: z.string().nullable(),
    address: z.string().nullable(),
});

export type PayboxTokens = z.infer<typeof payboxTokensSchema>;
export type PayboxAuthRecord = z.infer<typeof payboxAuthRecordSchema>;

export interface IPayboxAuthStorage {
    load(): PayboxAuthRecord | null;
    save(record: PayboxAuthRecord): void;
    clear(): void;
}

export interface PayboxAuthStart {
    authorizationUrl: string;
}

export interface PayboxAuthMaterial {
    tokens: PayboxTokens;
    signingKey: string;
}

export interface PayboxAuthFlow {
    start(): Promise<PayboxAuthStart>;
    finish(): Promise<PayboxAuthMaterial>;
    cancel(): void;
}

export interface PayboxHttpResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

export interface PayboxHttpClient {
    fetch(url: string, init: RequestInit): Promise<PayboxHttpResponse>;
}

export interface PayboxClock {
    setTimeout(callback: () => void, delayMs: number): NodeJS.Timeout;
    clearTimeout(timeout: NodeJS.Timeout): void;
}

export interface LoopbackAuthFlowOptions {
    issuerUrl: string;
    httpClient: PayboxHttpClient;
    clock: PayboxClock;
    timeoutMs: number | null;
}

export interface PayboxAuthenticateInput {
    force: boolean;
}

export type PayboxAuthenticateResult =
    | { status: PayboxAuthStatus.AuthRequired; instructions: string; authorizationUrl: string }
    | { status: PayboxAuthStatus.Authenticated; address: string };

export interface IPayboxSdkAdapter {
    selectOneAutonomousEvmGrant(
        tokens: PayboxTokens,
        signingKey: string,
    ): Promise<{ credentialId: string; address: string }>;
    createWallet(tokens: PayboxTokens, signingKey: string, credentialId: string, address: string): WalletManager;
    signMessage(tokens: PayboxTokens, signingKey: string, credentialId: string, message: string): Promise<string>;
}

export interface PayboxCoordinatorOptions {
    storage: IPayboxAuthStorage;
    flow: PayboxAuthFlow;
    sdk: IPayboxSdkAdapter;
}

export interface PayboxSdkClient {
    listCredentials(): Promise<unknown>;
    requestWalletSign(args: unknown, options: unknown): Promise<unknown>;
}

export interface PayboxSdkClientFactory {
    create(options: { baseUrl: string; token: string; signingKey: string }): PayboxSdkClient;
}
