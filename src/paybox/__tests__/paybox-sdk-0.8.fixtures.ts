export const PAYBOX_SDK_COMPATIBILITY_VERSION = '0.8.0';

const autonomousWalletGrant = {
    credential: {
        id: 'wallet-a',
        name: 'Acceptance Wallet',
        provider: 'Paybox',
        credential_type: 'wallet',
        disabled_at: null,
        metadata: {
            chains: ['evm'],
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        },
    },
    grant: { credential_id: 'wallet-a', approval_mode: 'autonomous' },
};

export const payboxSdkEnvelopeGrantList: unknown = {
    credentials: [autonomousWalletGrant],
    ungranted: [],
};
export const payboxLegacyDirectGrantList: unknown = [autonomousWalletGrant];

export const payboxSdkSuccessfulSignature: unknown = {
    status: 'success',
    output: {
        output_type: 'signature',
        credential_id: 'wallet-a',
        value: `0x${'11'.repeat(65)}`,
    },
};

export const payboxSdkDeniedOperation: unknown = { status: 'denied' };

export const payboxSdkRefreshResponse: unknown = {
    clientId: 'client-b',
    accessToken: 'access-b',
    refreshToken: 'refresh-b',
    expiresAt: 120_000,
    resource: null,
};
