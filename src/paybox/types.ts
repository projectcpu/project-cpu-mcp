import { isAddress, type Address, type Hash, type Hex } from 'viem';
import { z } from 'zod';

import { isPbxk1 } from './auth/signing-key.utils.js';
import type { ILogger } from '../logger/types.js';
import type { GasEstimateRequest, ReadContractParams, TxReceipt, WalletManager } from '../wallet/types.js';

export enum PayboxAuthStatus {
    Authenticated = 'authenticated',
    AuthRequired = 'paybox_auth_required',
    WalletSelectionRequired = 'wallet_selection_required',
}

export enum PayboxApprovalMode {
    Autonomous = 'autonomous',
}

export enum PayboxErrorCode {
    AuthorizationFailed = 'PAYBOX_AUTHORIZATION_FAILED',
    FullAccessWalletRequired = 'PAYBOX_FULL_ACCESS_WALLET_REQUIRED',
    InvalidOperationArtifact = 'PAYBOX_INVALID_OPERATION_ARTIFACT',
    OperationDenied = 'PAYBOX_OPERATION_DENIED',
    OperationIncomplete = 'PAYBOX_OPERATION_INCOMPLETE',
    TemporarilyUnavailable = 'PAYBOX_TEMPORARILY_UNAVAILABLE',
    WalletSelectionInvalid = 'PAYBOX_WALLET_SELECTION_INVALID',
    WalletSelectionNotPending = 'PAYBOX_WALLET_SELECTION_NOT_PENDING',
}

export enum PayboxFailureClass {
    AuthenticationFlow = 'authentication_flow',
    ConfirmedAuthentication = 'confirmed_authentication',
    InvalidOperationArtifact = 'invalid_operation_artifact',
    OperationDenied = 'operation_denied',
    OperationIncomplete = 'operation_incomplete',
    TemporarilyUnavailable = 'temporarily_unavailable',
}

export enum PayboxRecoveryTool {
    Authenticate = 'cpu_authenticate',
}

export enum PayboxResetCause {
    AuthenticatedRequestRejected = 'authenticated_request_rejected',
    InvalidRefresh = 'invalid_refresh',
    InvalidSigningAuthority = 'invalid_signing_authority',
    OAuthRejected = 'oauth_rejected',
    SelectedGrantMissing = 'selected_grant_missing',
}

export enum PayboxResetDepth {
    None = 'none',
    Full = 'full',
}

export enum PayboxRequestContext {
    Authenticated = 'authenticated',
    OAuthToken = 'oauth_token',
    Refresh = 'refresh',
    Unauthenticated = 'unauthenticated',
}

export enum PayboxRefreshFailureDisposition {
    Ambiguous = 'ambiguous',
    NotApplicable = 'not_applicable',
    SafeToRetry = 'safe_to_retry',
}

export enum PayboxRefreshState {
    ExchangePending = 'exchange_pending',
    Ready = 'ready',
}

export interface PayboxFailureDiagnostic {
    failureClass: PayboxFailureClass;
    resetCause: PayboxResetCause | null;
    resetDepth: PayboxResetDepth;
}

export interface PayboxOperationDeniedErrorData {
    code: PayboxErrorCode.OperationDenied;
}

export interface PayboxOperationResponseErrorData {
    code: PayboxErrorCode.InvalidOperationArtifact | PayboxErrorCode.OperationIncomplete;
    stateCleared: false;
    retryable: false;
}

export interface PayboxAuthFlowErrorData {
    code: PayboxErrorCode.AuthorizationFailed;
    stateCleared: false;
    retryable: false;
    nextTool: PayboxRecoveryTool.Authenticate;
}

export interface PayboxTemporarilyUnavailableErrorData {
    code: PayboxErrorCode.TemporarilyUnavailable;
    stateCleared: false;
    retryable: true;
}

export const payboxTokensSchema = z.object({
    clientId: z.string().min(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).nullable(),
    expiresAt: z.number().finite().nullable(),
    resource: z.string().min(1).nullable(),
    baseUrl: z.string().url(),
});

const payboxAuthRecordSchemaV1 = z
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
    .strict()
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

const guardedPayboxAuthRecordSchemaV1 = z
    .object({
        version: z.literal(1),
        tokens: payboxTokensSchema.nullable(),
        signingKey: z.string().refine(isPbxk1, 'invalid signing key').nullable(),
        credentialId: z.string().min(1).nullable(),
        address: z
            .string()
            .refine((value) => isAddress(value, { strict: true }), 'invalid checksummed EVM address')
            .nullable(),
        refreshState: z.nativeEnum(PayboxRefreshState),
    })
    .strict()
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

export const payboxAuthRecordSchema = z.union([guardedPayboxAuthRecordSchemaV1, payboxAuthRecordSchemaV1]);

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

export interface PayboxWalletAuthority {
    current(): Promise<PayboxAuthMaterial>;
    invalidate(): void;
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
    start(signal: AbortSignal): Promise<PayboxAuthStart>;
    finish(): Promise<PayboxAuthMaterial>;
}

export interface PayboxHttpResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

export interface PayboxHttpClient {
    fetch(url: string, init: RequestInit): Promise<PayboxHttpResponse>;
}

export interface LoopbackAuthFlowOptions {
    issuerUrl: string;
    httpClient: PayboxHttpClient;
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
    controller: AbortController;
    promise: Promise<string>;
}

export interface PayboxRestoredAuthenticationFlight {
    credentialId: string;
    address: string;
    generation: number;
    promise: Promise<PayboxAuthenticateResult>;
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
    refreshTokens(tokens: PayboxTokens): Promise<PayboxTokens>;
    listEligibleAutonomousEvmGrants(tokens: PayboxTokens, signingKey: string): Promise<EligiblePayboxGrantList>;
    createWallet(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        address: string,
        authority: PayboxWalletAuthority,
    ): WalletManager;
    signMessage(tokens: PayboxTokens, signingKey: string, credentialId: string, message: string): Promise<string>;
    signTransaction(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        intent: PayboxTransactionIntent,
    ): Promise<Hex>;
}

export interface PayboxCoordinatorOptions {
    storage: IPayboxAuthStorage;
    flow: PayboxAuthFlow;
    sdk: IPayboxSdkAdapter;
    authenticator: PayboxSiweAuthenticator;
}

export interface PayboxSiweAuthenticator {
    authenticate(wallet: WalletManager, signal: AbortSignal): Promise<string>;
    clearSession(): void;
}

export interface PayboxSdkClient {
    listCredentials(): Promise<unknown>;
    requestWalletSign(args: unknown, options: unknown): Promise<unknown>;
}

export interface PayboxSdkClientFactory {
    create(options: { baseUrl: string; token: string; signingKey: string }): PayboxSdkClient;
}

export interface PayboxTransactionIntent {
    to: Address;
    value: bigint;
    data: Hex;
    chainId: number;
    gas: bigint;
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    nonce: number;
}

export interface PayboxEip1559Fees {
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
}

export interface IPayboxRpcClient {
    getPendingNonce(address: Address): Promise<number>;
    estimateEip1559Fees(): Promise<PayboxEip1559Fees>;
    estimateGas(address: Address, tx: GasEstimateRequest): Promise<bigint>;
    sendRawTransaction(serializedTransaction: Hex): Promise<Hash>;
    getGasPrice(): Promise<bigint>;
    waitForReceipt(hash: Hash): Promise<TxReceipt>;
    readContract(params: ReadContractParams): Promise<unknown>;
    getBalance(address: Address): Promise<bigint>;
}

export interface PayboxWalletManagerOptions {
    sdk: IPayboxSdkAdapter;
    credentialId: string;
    address: string;
    authority: PayboxWalletAuthority;
    rpc: IPayboxRpcClient;
    logger: ILogger;
}

export interface PayboxSdkWalletOptions {
    rpcUrl: string | null;
    logger: ILogger;
}

export interface PayboxRpcClientOptions {
    rpcUrl: string | null;
}

export interface PayboxSdkOAuthTokens {
    clientId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    resource: string | null;
}

export interface PayboxTokenRefresher {
    refresh(baseUrl: string, current: PayboxSdkOAuthTokens): Promise<PayboxSdkOAuthTokens>;
}

export interface PayboxRefreshFlight {
    generation: number;
    promise: Promise<void>;
}
