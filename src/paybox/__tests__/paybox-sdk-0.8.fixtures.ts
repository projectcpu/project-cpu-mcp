import type { ClientCredentialList, ClientGrantSummary } from '@paybox-sh/sdk';

const autonomousWalletGrant = {
    credential: {
        id: 'wallet-a',
        user_id: 'user-a',
        name: 'Acceptance Wallet',
        provider: 'Paybox',
        credential_type: 'wallet',
        created_at: '2026-08-28T00:00:00.000Z',
        disabled_at: null,
        metadata: {
            chains: ['evm'],
            address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        },
    },
    grant: { credential_id: 'wallet-a', approval_mode: 'autonomous' },
} satisfies ClientGrantSummary;

export const payboxSdkEnvelopeGrantList: ClientCredentialList = {
    credentials: [autonomousWalletGrant],
    ungranted: [],
};
