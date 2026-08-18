import { describe, expect, it } from 'vitest';

import { preparePaidAction } from '../paid-action.js';
import { AppContract } from '../paid-action.types.js';
import { CELL, FakeAppConfig, FakeWallet, makeConfig } from './service-fakes.js';

describe('preparePaidAction', () => {
    it('returns a chain-checked context that resolves configured contracts', async () => {
        const config = makeConfig();
        const wallet = new FakeWallet(config.chainId);

        const action = await preparePaidAction({ appConfig: new FakeAppConfig(config), wallet });

        expect(action.config).toBe(config);
        expect(action.wallet).toBe(wallet);
        expect(action.requireContract(AppContract.Cell, 'cannot act')).toBe(CELL);
    });

    it('owns the canonical chain mismatch error', async () => {
        const config = makeConfig();
        const wallet = new FakeWallet(config.chainId + 1);

        await expect(preparePaidAction({ appConfig: new FakeAppConfig(config), wallet })).rejects.toThrow(
            `Wallet chain ${config.chainId + 1} does not match the configured network chain ${config.chainId}`,
        );
    });

    it('rejects missing and malformed contract addresses at the context boundary', async () => {
        const config = makeConfig();
        config.contracts.cell = '';
        config.contracts.syndicate = null;
        const action = await preparePaidAction({
            appConfig: new FakeAppConfig(config),
            wallet: new FakeWallet(config.chainId),
        });

        expect(() => action.requireContract(AppContract.Cell, 'cannot build')).toThrow(
            'Cell contract is not configured for network ethereum; cannot build.',
        );
        expect(() => action.requireContract(AppContract.Syndicate, 'cannot join')).toThrow(
            'Syndicate registry is not configured for network ethereum; cannot join.',
        );
    });
});
