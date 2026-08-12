import { formatEther } from 'viem';

import {
    PUSH_RANDOMNESS_SUMMARY,
    REVEAL_PAYMENT_UNKNOWN_SUMMARY,
    SELF_SERVICE_RANDOMNESS_SUMMARY,
} from './constants.js';
import { type RandomnessDescriptor, RandomnessKind, type RevealPaymentView } from '../../../api/types.js';

export function describeRandomnessMode(randomness: RandomnessDescriptor): string {
    return randomness.kind === RandomnessKind.DRAND ? SELF_SERVICE_RANDOMNESS_SUMMARY : PUSH_RANDOMNESS_SUMMARY;
}

export function describeRevealPayment(payment: RevealPaymentView | null): string {
    if (payment === null) {
        return REVEAL_PAYMENT_UNKNOWN_SUMMARY;
    }
    return (
        `every reveal contributes ${formatEther(BigInt(payment.ethContribution))} ETH to the $CPU liquidity ` +
        `pool and burns ${formatEther(BigInt(payment.cpuBurn))} $CPU, the first reveal of a cell included; ` +
        `cpu_reveal reads the exact total off the chain and pays that`
    );
}
