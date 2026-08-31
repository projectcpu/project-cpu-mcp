import { zeroAddress } from 'viem';
import type { ZodError } from 'zod';

import { STALE_STAND_CONFIG_HINT } from './app-config.constants.js';
import { type AppConfig, type CatalogBuildingView, ModeSwitchKind } from './types.js';
import {
    appConfigResponseSchema,
    type ParsedBuildingConfig,
    type RandomnessDescriptor,
    randomnessDescriptorSchema,
    RandomnessKind,
    type RevealPaymentView,
    type TradeParameters,
    tradeParametersSchema,
} from '../api/types.js';
import { bpToPercent } from '../utils/format.utils.js';

function normalizeBuilding({ modeSwitchCost, ...building }: ParsedBuildingConfig): CatalogBuildingView {
    const normalized = {
        ...building,
        demolishCost: building.demolishCost ?? { cpu: '0', inputs: [] },
    };
    if (!modeSwitchCost.known) {
        return { ...normalized, modeSwitch: { kind: ModeSwitchKind.Unknown } };
    }
    if (modeSwitchCost.value === null) {
        return {
            ...normalized,
            modeSwitchCost: null,
            modeSwitch: { kind: ModeSwitchKind.Impossible },
        };
    }
    return {
        ...normalized,
        modeSwitchCost: modeSwitchCost.value,
        modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: modeSwitchCost.value },
    };
}

function normalizeOptionalAddress(address: string | null | undefined): string | null {
    if (address === undefined || address === null || address === '') {
        return null;
    }
    return address.toLowerCase() === zeroAddress ? null : address;
}

function isDecimalAmount(value: unknown): value is string {
    return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value);
}

/**
 * Reads the reveal payment the game API serves, and answers `null` for anything else. Guessing a zero here
 * would read as a free reveal; the Cell's own quote remains the transaction authority. Both values are
 * whole-unit decimals as served, never wei: they are displayed, never used in arithmetic.
 */
function parseRevealPayment(raw: unknown): RevealPaymentView | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { ethBudget, cpuBurn } = raw as Record<string, unknown>;
    if (!isDecimalAmount(ethBudget) || !isDecimalAmount(cpuBurn)) {
        return null;
    }
    return { ethBudget, cpuBurn };
}

function formatIssues(error: ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
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

function parseRandomnessDescriptor(raw: unknown): RandomnessDescriptor {
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

    throw new Error(
        `GET /api/v1/config serves an incomplete "${kind}" randomness descriptor — ` +
            `${STALE_STAND_CONFIG_HINT}. Rejected fields: ${formatIssues(parsed.error)}.`,
    );
}

function parseTradeParameters(raw: unknown): TradeParameters {
    const parsed = tradeParametersSchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    throw new Error(
        `GET /api/v1/config serves no usable trade block — ${STALE_STAND_CONFIG_HINT}. The sale burn and ` +
            `the sale-fee ceiling are live rules and are never assumed. Rejected fields: ` +
            `${formatIssues(parsed.error)}.`,
    );
}

export function parseAppConfig(raw: unknown): AppConfig {
    const data = appConfigResponseSchema.parse(raw);
    const trade = parseTradeParameters(data.trade);
    return {
        network: data.network,
        chainId: data.chainId,
        contracts: {
            land: data.contracts.land,
            usdg: data.contracts.usdg,
            cpuToken: data.contracts.cpuToken,
            cpuHook: data.contracts.cpuHook,
            cell: data.contracts.cell,
            cellLens: data.contracts.cellLens,
            transport: data.contracts.transport,
            trade: data.contracts.trade,
            syndicate: normalizeOptionalAddress(data.contracts.syndicate),
        },
        randomness: parseRandomnessDescriptor(data.randomness),
        resources: data.resources,
        recipes: data.recipes,
        buildings: data.buildings.map(normalizeBuilding),
        reveal: parseRevealPayment(data.reveal),
        transport: data.transport,
        trade: {
            saleBurnPercent: trade.saleBurnPercent,
            maxSaleFeePercent: bpToPercent(trade.maxSaleFeeBp),
        },
        storage: { caps: data.storage.caps.map((row) => ({ ...row })) },
    };
}
