import { zeroAddress } from 'viem';

import { STALE_STAND_CONFIG_HINT } from './app-config.constants.js';
import { type ModeSwitchView, ModeSwitchKind } from './types.js';
import {
    type RandomnessDescriptor,
    randomnessDescriptorSchema,
    RandomnessKind,
    type RevealPaymentView,
} from '../api/types.js';

export function toModeSwitchView(cost: string | null | undefined): ModeSwitchView {
    if (cost === undefined) {
        return { kind: ModeSwitchKind.Unknown };
    }
    if (cost === null) {
        return { kind: ModeSwitchKind.Impossible };
    }
    return { kind: ModeSwitchKind.Possible, costCpu: cost };
}

export function normalizeOptionalAddress(address: string | null | undefined): string | null {
    if (address === undefined || address === null || address === '') {
        return null;
    }
    return address.toLowerCase() === zeroAddress ? null : address;
}

function isDecimalAmount(value: unknown): value is string {
    return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value);
}

/**
 * Reads the reveal payment a stand serves, and answers `null` for anything else — an absent field, or a
 * stand still serving a shape this client has never priced a reveal from. Guessing a zero here would read
 * as a free reveal, which no stand offers; the Cell's own quote is the price either way. Both legs are
 * whole-unit decimals as served, never wei: they are displayed, never used in arithmetic.
 */
export function parseRevealPayment(raw: unknown): RevealPaymentView | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { ethContribution, cpuBurn } = raw as Record<string, unknown>;
    if (!isDecimalAmount(ethContribution) || !isDecimalAmount(cpuBurn)) {
        return null;
    }
    return { ethContribution, cpuBurn };
}

function knownRandomnessKinds(): string {
    return Object.values(RandomnessKind).join(', ');
}

function readKind(raw: unknown): unknown {
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).kind : undefined;
}

function isKnownRandomnessKind(kind: unknown): kind is RandomnessKind {
    return typeof kind === 'string' && (Object.values(RandomnessKind) as Array<string>).includes(kind);
}

function formatKind(kind: unknown): string {
    return typeof kind === 'string' ? `"${kind}"` : String(kind);
}

export function parseRandomnessDescriptor(raw: unknown): RandomnessDescriptor {
    if (raw === undefined || raw === null) {
        throw new Error(
            `GET /api/v1/config serves no randomness descriptor — ${STALE_STAND_CONFIG_HINT}. Reveal cannot ` +
                `pick a randomness source until the stand serves one (known kinds: ${knownRandomnessKinds()}).`,
        );
    }

    const parsed = randomnessDescriptorSchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    const kind = readKind(raw);
    if (!isKnownRandomnessKind(kind)) {
        throw new Error(
            `GET /api/v1/config serves randomness kind ${formatKind(kind)}, which this client ` +
                `cannot drive — ${STALE_STAND_CONFIG_HINT}, or this client is older than the stand ` +
                `(known kinds: ${knownRandomnessKinds()}).`,
        );
    }

    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(
        `GET /api/v1/config serves an incomplete "${kind}" randomness descriptor — ` +
            `${STALE_STAND_CONFIG_HINT}. Rejected fields: ${issues}.`,
    );
}
