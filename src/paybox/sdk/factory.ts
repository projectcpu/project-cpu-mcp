import { mcpResource, PayboxClient, refreshTokens } from '@paybox-sh/sdk';

import type { PayboxSdkClientFactory, PayboxSdkOAuthTokens, PayboxTokenRefresher } from '../types.js';

export const defaultPayboxSdkClientFactory: PayboxSdkClientFactory = {
    create: (options) => new PayboxClient(options),
};

export const defaultPayboxTokenRefresher: PayboxTokenRefresher = {
    refresh: async (baseUrl, current) => {
        const refreshed = await refreshTokens(baseUrl, {
            clientId: current.clientId,
            accessToken: current.accessToken,
            ...(current.refreshToken === null ? {} : { refreshToken: current.refreshToken }),
            ...(current.expiresAt === null ? {} : { expiresAt: current.expiresAt }),
            resource: current.resource ?? mcpResource(baseUrl),
        });
        const normalized: PayboxSdkOAuthTokens = {
            clientId: refreshed.clientId,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? current.refreshToken,
            expiresAt: refreshed.expiresAt ?? null,
            resource: refreshed.resource ?? current.resource,
        };
        return normalized;
    },
};
