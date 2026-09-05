import { mcpResource } from '@paybox-sh/sdk';

import {
    DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
    DEVICE_SLOW_DOWN_INCREMENT_SECONDS,
    OAUTH_DEVICE_GRANT_TYPE,
    OAUTH_DEVICE_PENDING_ERROR,
    OAUTH_DEVICE_REDIRECT_URI,
    OAUTH_DEVICE_SLOW_DOWN_ERROR,
    OAUTH_DISCOVERY_PATH,
    OAUTH_SCOPE,
    PAYBOX_OAUTH_CLIENT_NAME,
} from './constants.js';
import {
    deviceAuthorizationResponse,
    isObject,
    nonEmptyString,
    oauthResponseError,
    tokenResponse,
    urlField,
} from './oauth-response.utils.js';
import type { DeviceAuthorizationGrant, OAuthDeviceAuthorization, OAuthMetadata, OAuthTokenResponse } from './types.js';
import { authAbortError, oauthError, oauthTokenError, waitForPoll } from './utils.js';
import { classifiedPayboxError, classifiedPayboxHttpStatus } from '../sdk/utils.js';
import { type PayboxHttpClient, type PayboxHttpResponse, PayboxRequestContext } from '../types.js';

export class DeviceAuthorizationClient {
    public constructor(
        private readonly issuerUrl: string,
        private readonly httpClient: PayboxHttpClient,
    ) {}

    public async start(signal: AbortSignal): Promise<DeviceAuthorizationGrant> {
        const metadata = await this.discover(signal);
        const clientId = await this.register(metadata, signal);
        const authorization = await this.authorize(metadata, clientId, signal);
        return { metadata, clientId, authorization };
    }

    public async poll(grant: DeviceAuthorizationGrant, signal: AbortSignal): Promise<OAuthTokenResponse> {
        let interval = grant.authorization.interval ?? DEFAULT_DEVICE_POLL_INTERVAL_SECONDS;
        while (true) {
            await waitForPoll(interval * 1000, signal);
            const response = await this.request(
                grant.metadata.tokenEndpoint,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: OAUTH_DEVICE_GRANT_TYPE,
                        device_code: grant.authorization.deviceCode,
                        client_id: grant.clientId,
                    }).toString(),
                },
                signal,
            );
            if (response.ok) return tokenResponse(await this.responseJson(response, signal));
            if (response.status !== 400) throw oauthTokenError(response.status);
            const error = oauthResponseError(await this.responseJson(response, signal));
            if (error === OAUTH_DEVICE_PENDING_ERROR) continue;
            if (error === OAUTH_DEVICE_SLOW_DOWN_ERROR) {
                interval += DEVICE_SLOW_DOWN_INCREMENT_SECONDS;
                continue;
            }
            throw oauthTokenError(response.status);
        }
    }

    private async discover(signal: AbortSignal): Promise<OAuthMetadata> {
        const response = await this.request(
            new URL(OAUTH_DISCOVERY_PATH, this.issuerUrl).toString(),
            { method: 'GET' },
            signal,
        );
        this.requireSuccess(response);
        const value = await this.responseJson(response, signal);
        if (!isObject(value)) throw oauthError('malformed discovery response');
        return {
            deviceAuthorizationEndpoint: urlField(value, 'device_authorization_endpoint'),
            registrationEndpoint: urlField(value, 'registration_endpoint'),
            tokenEndpoint: urlField(value, 'token_endpoint'),
        };
    }

    private async register(metadata: OAuthMetadata, signal: AbortSignal): Promise<string> {
        const response = await this.request(
            metadata.registrationEndpoint,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    client_name: PAYBOX_OAUTH_CLIENT_NAME,
                    redirect_uris: [OAUTH_DEVICE_REDIRECT_URI],
                    token_endpoint_auth_method: 'none',
                    grant_types: [OAUTH_DEVICE_GRANT_TYPE, 'refresh_token'],
                    response_types: ['code'],
                    scope: OAUTH_SCOPE,
                }),
            },
            signal,
        );
        this.requireSuccess(response);
        const value = await this.responseJson(response, signal);
        if (!isObject(value)) throw oauthError('malformed registration response');
        return nonEmptyString(value, 'client_id');
    }

    private async authorize(
        metadata: OAuthMetadata,
        clientId: string,
        signal: AbortSignal,
    ): Promise<OAuthDeviceAuthorization> {
        const response = await this.request(
            metadata.deviceAuthorizationEndpoint,
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    scope: OAUTH_SCOPE,
                    resource: mcpResource(this.issuerUrl),
                }).toString(),
            },
            signal,
        );
        this.requireSuccess(response);
        return deviceAuthorizationResponse(await this.responseJson(response, signal));
    }

    private async request(url: string, init: RequestInit, signal: AbortSignal): Promise<PayboxHttpResponse> {
        signal.throwIfAborted();
        try {
            const response = await this.httpClient.fetch(url, { ...init, signal });
            signal.throwIfAborted();
            return response;
        } catch (error) {
            if (signal.aborted) throw authAbortError(signal.reason);
            throw classifiedPayboxError(error, PayboxRequestContext.Unauthenticated);
        }
    }

    private async responseJson(response: PayboxHttpResponse, signal: AbortSignal): Promise<unknown> {
        try {
            const value = await response.json();
            signal.throwIfAborted();
            return value;
        } catch {
            if (signal.aborted) throw authAbortError(signal.reason);
            throw oauthError('malformed response');
        }
    }

    private requireSuccess(response: PayboxHttpResponse): void {
        if (!response.ok) {
            throw classifiedPayboxHttpStatus(response.status, PayboxRequestContext.Unauthenticated);
        }
    }
}
