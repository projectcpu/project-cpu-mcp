import { isAddress } from 'viem';
import { z } from 'zod';

import { isPbxk1 } from './auth-flow.utils.js';
import type { WalletManager } from '../wallet/types.js';

export enum PayboxAuthStatus {
    Authenticated = 'authenticated',
    AuthRequired = 'paybox_auth_required',
    WalletSelectionRequired = 'wallet_selection_required',
}

export enum PayboxApprovalMode {
    Autonomous = 'autonomous',
}

export enum PayboxErrorCode {
    FullAccessWalletRequired = 'PAYBOX_FULL_ACCESS_WALLET_REQUIRED',
    WalletSelectionInvalid = 'PAYBOX_WALLET_SELECTION_INVALID',
    WalletSelectionNotPending = 'PAYBOX_WALLET_SELECTION_NOT_PENDING',
}

export const payboxTokensSchema = z.object({
    clientId: z.string().min(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).nullable(),
    expiresAt: z.number().finite().nullable(),
    resource: z.string().min(1).nullable(),
    baseUrl: z.string().url(),
});

export const payboxAuthRecordSchema = z
    .object({
        version: z.literal(1),
        tokens: payboxTokensSchema.nullable(),
        signingKey: z.string().refine(isPbxk1, 'invalid signing key').nullable(),
        credentialId: z.string().min(1).nullable(),
        address: z
            .string()
            .refine((value) => isAddress(value, { strict: true }), 'invalid checksummed EVM address')
            .nullable(),
    })
    .superRefine((record, context) => {
        if ((record.tokens === null) !== (record.signingKey === null)) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'incomplete Paybox auth record' });
        }
        if ((record.credentialId === null) !== (record.address === null)) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'incomplete Paybox Wallet selection' });
        }
        if (record.tokens === null && record.credentialId !== null) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'Paybox Wallet selection has no auth material' });
        }
    });

export type PayboxTokens = z.infer<typeof payboxTokensSchema>;
export type PayboxAuthRecord = z.infer<typeof payboxAuthRecordSchema>;

export interface IPayboxAuthStorage {
    load(): PayboxAuthRecord | null;
    save(record: PayboxAuthRecord): void;
    clear(): void;
}

export interface PayboxAuthRecordRemover {
    remove(filePath: string): void;
}

export interface PayboxAuthStart {
    authorizationUrl: string;
}

export interface PayboxAuthMaterial {
    tokens: PayboxTokens;
    signingKey: string;
}

export interface OAuthMetadata {
    authorizationEndpoint: string;
    registrationEndpoint: string;
    tokenEndpoint: string;
}

export interface OAuthTokenResponse {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    resource: string | null;
}

export interface EligiblePayboxGrant {
    credentialId: string;
    address: string;
    label: string | null;
    provider: string | null;
}

export interface EligiblePayboxGrantList {
    grants: Array<EligiblePayboxGrant>;
    managementUrl: string | null;
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
    payboxCredentialId: string | null;
}

export type PayboxAuthenticateResult =
    | { status: PayboxAuthStatus.AuthRequired; instructions: string; authorizationUrl: string }
    | { status: PayboxAuthStatus.Authenticated; address: string }
    | { status: PayboxAuthStatus.WalletSelectionRequired; choices: Array<EligiblePayboxGrant> };

export enum PayboxSelectionPhase {
    AwaitingChoice = 'awaiting_choice',
    Activating = 'activating',
}

export type PayboxSelectionState =
    | {
          phase: PayboxSelectionPhase.AwaitingChoice;
          choices: Array<EligiblePayboxGrant>;
      }
    | {
          phase: PayboxSelectionPhase.Activating;
          choices: Array<EligiblePayboxGrant>;
          credentialId: string;
          promise: Promise<PayboxAuthenticateResult>;
      };

export interface PayboxAuthenticationFlight {
    credentialId: string;
    address: string;
    generation: number;
    promise: Promise<string>;
}

export interface PayboxContinuationFlight {
    material: PayboxAuthMaterial;
    requestedCredentialId: string | null;
    generation: number;
    promise: Promise<PayboxAuthenticateResult>;
}

export interface PayboxFullAccessWalletRequiredErrorData {
    code: PayboxErrorCode.FullAccessWalletRequired;
    instructions: string;
    requiredMode: PayboxApprovalMode.Autonomous;
    managementUrl: string | null;
}

export interface PayboxWalletSelectionErrorData {
    code: PayboxErrorCode.WalletSelectionInvalid | PayboxErrorCode.WalletSelectionNotPending;
}

export interface IPayboxSdkAdapter {
    listEligibleAutonomousEvmGrants(tokens: PayboxTokens, signingKey: string): Promise<EligiblePayboxGrantList>;
    createWallet(tokens: PayboxTokens, signingKey: string, credentialId: string, address: string): WalletManager;
    signMessage(tokens: PayboxTokens, signingKey: string, credentialId: string, message: string): Promise<string>;
}

export interface PayboxCoordinatorOptions {
    storage: IPayboxAuthStorage;
    flow: PayboxAuthFlow;
    sdk: IPayboxSdkAdapter;
    authenticator: PayboxSiweAuthenticator;
}

export interface PayboxSiweAuthenticator {
    authenticate(wallet: WalletManager, isCurrent: () => boolean): Promise<string>;
}

export interface PayboxSdkClient {
    listCredentials(): Promise<unknown>;
    requestWalletSign(args: unknown, options: unknown): Promise<unknown>;
}

export interface PayboxSdkClientFactory {
    create(options: { baseUrl: string; token: string; signingKey: string }): PayboxSdkClient;
}
