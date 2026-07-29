import { parseEther, type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { settleTransitFees, sumTransitFees } from '../delivery.helpers.js';
import { TRANSPORT, cpuBurnLog, transitSettledLog, WALLET_ADDRESS } from './service-fakes.js';

const OWNER_A = '0x00000000000000000000000000000000000000a1' as Address;
const OWNER_B = '0x00000000000000000000000000000000000000b2' as Address;

describe('sumTransitFees', () => {
    it('sums gross minus discount across several legs', () => {
        const totals = sumTransitFees([
            { gross: parseEther('0.6'), discount: parseEther('0.1') },
            { gross: parseEther('0.5'), discount: parseEther('0.05') },
        ]);

        expect(totals.transitPaid).toBe(parseEther('0.95'));
        expect(totals.transitDiscount).toBe(parseEther('0.15'));
    });

    it('handles a single leg', () => {
        const totals = sumTransitFees([{ gross: parseEther('0.6'), discount: parseEther('0.1') }]);

        expect(totals.transitPaid).toBe(parseEther('0.5'));
        expect(totals.transitDiscount).toBe(parseEther('0.1'));
    });

    it('is zero for an empty list', () => {
        const totals = sumTransitFees([]);

        expect(totals.transitPaid).toBe(0n);
        expect(totals.transitDiscount).toBe(0n);
    });
});

describe('settleTransitFees', () => {
    it('aggregates the TransitFeeSettled legs from a receipt', () => {
        const logs = [
            transitSettledLog({
                deliveryId: 1n,
                owner: OWNER_A,
                gross: parseEther('0.6'),
                discount: parseEther('0.1'),
            }),
            transitSettledLog({
                deliveryId: 1n,
                owner: OWNER_B,
                gross: parseEther('0.5'),
                discount: parseEther('0.05'),
            }),
        ];

        const totals = settleTransitFees(logs, TRANSPORT as Address, parseEther('999'));

        expect(totals.transitPaid).toBe(parseEther('0.95'));
        expect(totals.transitDiscount).toBe(parseEther('0.15'));
    });

    it('ignores logs from other contracts', () => {
        const logs = [
            cpuBurnLog(WALLET_ADDRESS, parseEther('7')),
            transitSettledLog({
                deliveryId: 1n,
                owner: OWNER_A,
                gross: parseEther('0.6'),
                discount: parseEther('0.1'),
            }),
        ];

        const totals = settleTransitFees(logs, TRANSPORT as Address, parseEther('999'));

        expect(totals.transitPaid).toBe(parseEther('0.5'));
        expect(totals.transitDiscount).toBe(parseEther('0.1'));
    });

    it('falls back to the quoted fee with no discount on a dark registry (no events)', () => {
        const totals = settleTransitFees([], TRANSPORT as Address, parseEther('0.42'));

        expect(totals.transitPaid).toBe(parseEther('0.42'));
        expect(totals.transitDiscount).toBe(0n);
    });
});
