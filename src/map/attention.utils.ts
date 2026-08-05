import {
    REVEAL_RETRY_CEILING_SECONDS,
    REVEAL_RETRY_FLOOR_SECONDS,
    REVEAL_STUCK_AFTER_MISSED_SWEEPS,
    REVEAL_STUCK_AFTER_SECONDS,
} from './constants.js';
import { activeDemolition, isDepleted } from './map.utils.js';
import { processOutputs } from './process.utils.js';
import { cellProcessProgress, type SettleConfig } from './settle.utils.js';
import { blockedResourceIds, needByResource } from './storage.utils.js';
import {
    type AttentionItem,
    AttentionReason,
    type AttentionReport,
    AttentionSeverity,
    type CellResource,
    type Cell,
    CellProcessKind,
    type RevealAttentionInput,
} from './types.js';
import type { OpenRevealRequestView } from '../api/types.js';
import { sameAddress } from '../randomness/request.utils.js';

const { Critical, Warning, Info } = AttentionSeverity;

// Each reason has a fixed urgency (how time-sensitive the fact is), used only for ordering — the report
// stays descriptive and suggests no action, leaving what to do to the caller.
const REASON_SEVERITY: Record<AttentionReason, AttentionSeverity> = {
    [AttentionReason.StalledMining]: Critical,
    [AttentionReason.StalledCraft]: Critical,
    [AttentionReason.WarehouseNearFull]: Warning,
    [AttentionReason.DepositDepleted]: Warning,
    [AttentionReason.ProcessFinished]: Warning,
    [AttentionReason.DeliveryReady]: Warning,
    [AttentionReason.Unbuilt]: Info,
    [AttentionReason.DemolishCooldown]: Info,
    [AttentionReason.LotFrozen]: Warning,
    [AttentionReason.LotAtRisk]: Info,
    [AttentionReason.RevealStuck]: Critical,
    [AttentionReason.RevealSourceRetired]: Critical,
};

const SEVERITY_RANK: Record<AttentionSeverity, number> = { [Critical]: 0, [Warning]: 1, [Info]: 2 };

export interface BuildAttentionInput extends SettleConfig {
    ownedCells: Array<Cell> | null;
    version: number;
    serverTime: number;
    nearFullPct: number;
    // Building types whose kind is `extractor`; injected so the map layer stays config-agnostic.
    extractorBuildingTypes: Set<string>;
}

// Every item shares this shape; a reason + a few `extra` fields is all that varies.
export function attentionItem(
    loc: { tokenId: string },
    reason: AttentionReason,
    extra: Partial<AttentionItem> = {},
): AttentionItem {
    return {
        tokenId: loc.tokenId,
        severity: REASON_SEVERITY[reason],
        reason,
        resourceId: null,
        used: null,
        cap: null,
        fillPct: null,
        breakdown: null,
        depositRemaining: null,
        deliveryId: null,
        arrivalAt: null,
        demolishingType: null,
        lotId: null,
        requestId: null,
        requestedAt: null,
        message: null,
        ...extra,
    };
}

function storageFields(resource: CellResource): Partial<AttentionItem> {
    const s = resource.storage;
    const used = s?.used ?? '0';
    const cap = s?.cap ?? null;
    return {
        resourceId: resource.resourceId,
        used,
        cap,
        fillPct: cap === null || cap === '0' ? null : Number((BigInt(used) * 100n) / BigInt(cap)),
        breakdown: {
            liquid: resource.balance,
            incomingTransport: s?.reserved.incomingTransport ?? '0',
            lots: s?.reserved.lots ?? '0',
        },
    };
}

function isOperationalExtractor(cell: Cell, extractorTypes: Set<string>): boolean {
    const building = cell.building;
    return building !== null && extractorTypes.has(building.type) && cell.ready === true;
}

function finishedProcess(cell: Cell, input: BuildAttentionInput): boolean {
    const process = cell.process;
    if (process === null) {
        return false;
    }
    return cellProcessProgress(cell, process, input.serverTime, input).progress.isFinished;
}

function cellItems(cell: Cell, input: BuildAttentionInput): Array<AttentionItem> {
    const items: Array<AttentionItem> = [];
    const outputs = cell.process === null ? [] : processOutputs(cell.process, input.craftOutputsByRecipe);
    const need = needByResource(outputs);
    const blocked = new Set(blockedResourceIds(outputs, cell.resources));
    const isCraft = cell.process?.kind === CellProcessKind.Craft;

    // One pass over the boxes this process feeds: one that can't take a whole cycle stalls it, an
    // almost-full one warns.
    for (const resource of cell.resources) {
        const s = resource.storage;
        if (!s || s.cap === null || (need.get(resource.resourceId) ?? 0n) === 0n) {
            continue;
        }
        if (blocked.has(resource.resourceId)) {
            items.push(
                attentionItem(
                    cell,
                    isCraft ? AttentionReason.StalledCraft : AttentionReason.StalledMining,
                    storageFields(resource),
                ),
            );
        } else if (BigInt(s.used) * 100n >= BigInt(s.cap) * BigInt(input.nearFullPct)) {
            items.push(attentionItem(cell, AttentionReason.WarehouseNearFull, storageFields(resource)));
        }
    }

    const minedResourceId = cell.process?.kind === CellProcessKind.Mining ? cell.process.resource : null;
    if (finishedProcess(cell, input)) {
        items.push(attentionItem(cell, AttentionReason.ProcessFinished, { resourceId: minedResourceId }));
    }
    if (isOperationalExtractor(cell, input.extractorBuildingTypes) && isDepleted(cell)) {
        items.push(
            attentionItem(cell, AttentionReason.DepositDepleted, {
                resourceId: minedResourceId,
                depositRemaining: '0',
            }),
        );
    }
    if (cell.revealCount > 0 && cell.building === null && !cell.revealPending) {
        // A just-demolished cell is empty but can't be rebuilt until its cooldown ends — flag the wait, not a
        // missing building, so the caller isn't told to build somewhere it can't yet.
        const demolish = activeDemolition(cell, input.serverTime);
        if (demolish !== null) {
            items.push(
                attentionItem(cell, AttentionReason.DemolishCooldown, {
                    arrivalAt: demolish.finishAt,
                    demolishingType: demolish.buildingType,
                }),
            );
        } else {
            items.push(attentionItem(cell, AttentionReason.Unbuilt));
        }
    }
    return items;
}

function countBySeverity(items: Array<AttentionItem>): Record<AttentionSeverity, number> {
    const counts: Record<AttentionSeverity, number> = { [Critical]: 0, [Warning]: 0, [Info]: 0 };
    for (const item of items) {
        counts[item.severity] += 1;
    }
    return counts;
}

// Most-urgent first, then a stable tokenId tiebreak so callers get a deterministic ordering.
export function sortAttentionItems(items: Array<AttentionItem>): Array<AttentionItem> {
    return [...items].sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.tokenId.localeCompare(b.tokenId),
    );
}

export function meetsSeverity(severity: AttentionSeverity, min: AttentionSeverity | null): boolean {
    return min === null || SEVERITY_RANK[severity] <= SEVERITY_RANK[min];
}

export function buildAttentionReport(input: BuildAttentionInput): AttentionReport {
    const cells = input.ownedCells;
    const items = cells === null ? [] : sortAttentionItems(cells.flatMap((cell) => cellItems(cell, input)));
    return {
        ownerKnown: cells !== null,
        version: input.version,
        serverTime: input.serverTime,
        counts: countBySeverity(items),
        items,
        note: null,
    };
}

function stuckRevealMessage(requestId: string, waited: number | null): string {
    const tail =
        `Until it settles the cell has no new draw and no further reveal can be requested for it. Background ` +
        `settlement comes back to it no sooner than every ${REVEAL_RETRY_FLOOR_SECONDS} seconds and waits longer ` +
        `after each attempt that fails, up to ${REVEAL_RETRY_CEILING_SECONDS} seconds between tries. Settling it ` +
        `by hand with fulfill_reveal reports what is blocking the draw.`;
    return waited === null
        ? `Reveal request ${requestId} is open and carries no open time, so its wait cannot be measured against ` +
              `the ${REVEAL_STUCK_AFTER_SECONDS}-second mark. ${tail}`
        : `Reveal request ${requestId} has been open for ${waited} seconds, past the ` +
              `${REVEAL_STUCK_AFTER_SECONDS}-second mark that spans ${REVEAL_STUCK_AFTER_MISSED_SWEEPS} background ` +
              `settlement passes. ${tail}`;
}

function retiredSourceMessage(request: OpenRevealRequestView, currentSource: string): string {
    return (
        `Reveal request ${request.requestId} was opened at randomness source ${request.source}, while the chain ` +
        `config now reveals through ${currentSource}. A cell takes its draw only from the source its own request ` +
        `names, so nothing you can send closes this one: fulfill_reveal refuses a request of a retired source, and ` +
        `retrying it will never clear the cell. The cell stays locked on this open request until an admin of the ` +
        `contracts clears it on-chain — that admin cleanup is the only way out.`
    );
}

export function revealAttentionItems(input: RevealAttentionInput): Array<AttentionItem> {
    const items: Array<AttentionItem> = [];
    for (const request of input.requests) {
        if (!sameAddress(request.source, input.currentSource)) {
            items.push(
                attentionItem(request, AttentionReason.RevealSourceRetired, {
                    requestId: request.requestId,
                    requestedAt: request.requestedAt,
                    message: retiredSourceMessage(request, input.currentSource),
                }),
            );
            continue;
        }

        const waited = request.requestedAt === null ? null : input.serverTime - request.requestedAt;
        if (waited !== null && waited < REVEAL_STUCK_AFTER_SECONDS) {
            continue;
        }
        items.push(
            attentionItem(request, AttentionReason.RevealStuck, {
                requestId: request.requestId,
                requestedAt: request.requestedAt,
                message: stuckRevealMessage(request.requestId, waited),
            }),
        );
    }
    return items;
}

// Fold tool-layer items (delivery-ready, sourced from the deliveries endpoint) into a map-derived report,
// re-sorting and re-counting so the merged result stays ordered and consistent.
export function withExtraItems(
    report: AttentionReport,
    extraItems: Array<AttentionItem>,
    note: string | null,
): AttentionReport {
    const items = sortAttentionItems([...report.items, ...extraItems]);
    return { ...report, items, counts: countBySeverity(items), note };
}
