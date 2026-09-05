import type {
    IPayboxAuthStorage,
    IPayboxCoordinatorSdkAdapter,
    PayboxAuthenticateResult,
    PayboxHttpClient,
    PayboxSiweAuthenticator,
} from '../types.js';

export interface DeviceAuthFlowOptions {
    issuerUrl: string;
    httpClient: PayboxHttpClient;
    timeoutMs: number | null;
}

export interface OAuthMetadata {
    deviceAuthorizationEndpoint: string;
    registrationEndpoint: string;
    tokenEndpoint: string;
}

export interface OAuthDeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number | null;
}

export interface OAuthTokenResponse {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    resource: string | null;
}

export interface DeviceAuthorizationGrant {
    clientId: string;
    metadata: OAuthMetadata;
    authorization: OAuthDeviceAuthorization;
}

export interface PayboxAuthorityOptions {
    storage: IPayboxAuthStorage;
    sdk: IPayboxCoordinatorSdkAdapter;
    authenticator: PayboxSiweAuthenticator;
}

export enum PayboxAuthFlowPollStatus {
    Completed = 'completed',
    Finalizing = 'finalizing',
    Pending = 'pending',
}

export type PayboxAuthFlowPollResult =
    | { status: PayboxAuthFlowPollStatus.Finalizing }
    | {
          status: PayboxAuthFlowPollStatus.Completed;
          result: PayboxAuthenticateResult;
      }
    | {
          status: PayboxAuthFlowPollStatus.Pending;
          authorizationUrl: string;
      };
