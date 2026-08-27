import { describe, expect, it, vi } from 'vitest';

import type { WalletManager } from '../../wallet/types.js';
import { PayboxCoordinator } from '../coordinator.js';
import { PayboxAuthStatus, type IPayboxAuthStorage, type PayboxAuthFlow, type PayboxSdkAdapter } from '../types.js';

const wallet = { getAddress: () => '0x0000000000000000000000000000000000000001' } as unknown as WalletManager;

describe('PayboxCoordinator', () => {
    it('returns one safe pending state then persists the sole eligible grant', async () => {
        const storage: IPayboxAuthStorage = { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
        const flow: PayboxAuthFlow = {
            start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
            finish: vi.fn(async () => ({
                tokens: {
                    clientId: 'client',
                    accessToken: 'access',
                    refreshToken: null,
                    expiresAt: null,
                    resource: null,
                    baseUrl: 'https://paybox.test',
                },
                signingKey: 'pbxk1.test',
            })),
            cancel: vi.fn(),
        };
        const sdk: PayboxSdkAdapter = {
            selectOneAutonomousEvmGrant: vi.fn(async () => ({
                credentialId: 'credential',
                address: '0x0000000000000000000000000000000000000001',
            })),
            createWallet: vi.fn(() => wallet),
        };
        const coordinator = new PayboxCoordinator({ storage, flow, sdk });
        await expect(coordinator.authenticate({ force: false })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        await expect(coordinator.completePending()).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(storage.save).toHaveBeenCalledWith(
            expect.objectContaining({ credentialId: 'credential', signingKey: 'pbxk1.test' }),
        );
        expect(coordinator.get()).toBe(wallet);
    });
});
