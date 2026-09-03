import { describe, expect, it } from 'vitest';

import { MarketActionTool } from '../action.types.js';
import { marketActionKey, normalizeActionAddress } from '../idempotency.utils.js';

const WALLET = `0x${'A'.repeat(40)}`;

function key(over: Partial<Parameters<typeof marketActionKey>[0]> = {}): string {
    return marketActionKey({
        wallet: WALLET,
        network: 'arbitrum',
        tool: MarketActionTool.ListCell,
        inputs: ['1234', '1000', '1800086400', null],
        ...over,
    });
}

describe('the action key an intent computes for itself', () => {
    it('ignores the letter case a wallet address happens to arrive in', () => {
        expect(key({ wallet: WALLET.toLowerCase() })).toBe(key());
        expect(normalizeActionAddress(` ${WALLET} `)).toBe(WALLET.toLowerCase());
    });

    it('separates two wallets, networks and tools that share the same business inputs', () => {
        expect(key({ wallet: `0x${'b'.repeat(40)}` })).not.toBe(key());
        expect(key({ network: 'other' })).not.toBe(key());
        expect(key({ tool: MarketActionTool.MakeCellOffer })).not.toBe(key());
    });

    it('separates a reserved-buyer intent from the public intent with the same price and expiry', () => {
        const reserved = key({ inputs: ['1234', '1000', '1800086400', `0x${'c'.repeat(40)}`] });

        expect(reserved).not.toBe(key());
    });

    it('separates intents whose inputs differ only in where one field ends and the next begins', () => {
        const left = key({ inputs: ['12', '341000', '1800086400', null] });
        const right = key({ inputs: ['1234', '1000', '1800086400', null] });

        expect(left).not.toBe(right);
    });

    it('separates a null reserved buyer from an empty string, so absence keeps its own identity', () => {
        expect(key({ inputs: ['1234', '1000', '1800086400', ''] })).not.toBe(key());
    });
});
