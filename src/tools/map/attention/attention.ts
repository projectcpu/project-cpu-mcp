import { EVICTED_COUNT_UNREACHABLE_NOTE, GET_ATTENTION_DESCRIPTION, LOT_RETURN_COST_NOTE } from './constants.js';
import { createEvictedLotCountService } from './evicted.service.js';
import { evictedAttentionItems, liveHubTokenIds } from './evicted.utils.js';
import { warehousePressurePanel } from './panel.utils.js';
import { getAttentionInputSchema, type IEvictedLotCounts } from './types.js';
import { LotState, type LotView } from '../../../api/types.js';
import { attentionItem, meetsSeverity, revealAttentionItems, withExtraItems } from '../../../map/attention.utils.js';
import { type AttentionItem, AttentionReason } from '../../../map/types.js';
import type { DeliveryView } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { errorMessage } from '../../../utils/error.utils.js';
import { resourceName } from '../../../utils/format.utils.js';
import type { ToolRegistrar } from '../../types.js';
import { getWalletAddress } from '../wallet.utils.js';

const DELIVERIES_UNREACHABLE = 'Deliveries could not be loaded (server unreachable); showing map-based items only.';
const LOTS_UNREACHABLE = 'Your lots could not be loaded (server unreachable); showing map-based items only.';
const REVEAL_REQUESTS_UNREACHABLE =
    'Your open reveal requests could not be read (server or chain unreachable); showing the other items only.';

function deliveryItem(d: DeliveryView) {
    return attentionItem({ tokenId: d.targetTokenId }, AttentionReason.DeliveryReady, {
        resourceId: d.resourceId,
        deliveryId: d.deliveryId,
        arrivalAt: d.arrivalAt,
    });
}

function lotItem(lot: LotView): AttentionItem | null {
    if (lot.state !== LotState.Open) {
        return null;
    }
    if (lot.frozen) {
        return attentionItem({ tokenId: lot.hubTokenId }, AttentionReason.LotFrozen, {
            resourceId: lot.resourceId,
            lotId: lot.id,
            message:
                `Frozen: the hub's live sale fee (${lot.saleFeePercent}%) exceeds your tolerance ` +
                `(${lot.maxSaleFeePercent}%); buys revert until the hub lowers the rate to your tolerance or below. ` +
                LOT_RETURN_COST_NOTE,
        });
    }
    if (lot.saleFeePercent === lot.maxSaleFeePercent) {
        return attentionItem({ tokenId: lot.hubTokenId }, AttentionReason.LotAtRisk, {
            resourceId: lot.resourceId,
            lotId: lot.id,
            message:
                `At risk: the hub's live sale fee (${lot.saleFeePercent}%) sits at your tolerance ` +
                `(${lot.maxSaleFeePercent}%); the next hike freezes this lot and buys would revert. ` +
                LOT_RETURN_COST_NOTE,
        });
    }
    return null;
}

export function registerGetAttentionTool(server: ToolRegistrar, context: AppContext): void {
    // Built on first use, not at registration: registration runs before the process has a wallet or a
    // chain client, and nothing here may depend on either being live that early.
    let evictedCounts: IEvictedLotCounts | null = null;
    server.registerTool(
        'cpu_get_attention',
        { description: GET_ATTENTION_DESCRIPTION, inputSchema: getAttentionInputSchema },
        async (args) => {
            const self = getWalletAddress(context);
            const target = args.owner ?? self;
            const scouting = target !== null && (self === null || target.toLowerCase() !== self.toLowerCase());
            const { resources } = await context.appConfig.load();
            const mapReport = await context.mapReader.attention(target);

            // Deliveries are public too, so we surface arrived-and-ready ones for whoever we're inspecting.
            let report = mapReport;
            if (target !== null) {
                const extraItems: Array<AttentionItem> = [];
                const notes: Array<string> = [];

                try {
                    const ready = await context.transport.listReadyToFinalizeForOwner(target);
                    extraItems.push(...ready.map((d) => deliveryItem(d)));
                } catch (error) {
                    context.logger.warn('attention: deliveries fetch failed', { error: errorMessage(error) });
                    notes.push(DELIVERIES_UNREACHABLE);
                }

                if (!scouting) {
                    try {
                        const lots = await context.trade.listMyLots(null);
                        for (const lot of lots) {
                            const item = lotItem(lot);
                            if (item !== null) {
                                extraItems.push(item);
                            }
                        }
                        evictedCounts ??= createEvictedLotCountService(context);
                        const counts = await evictedCounts.forHubs(liveHubTokenIds(lots));
                        extraItems.push(...evictedAttentionItems(lots, counts));
                        if (counts.some((entry) => entry.count === null)) {
                            notes.push(EVICTED_COUNT_UNREACHABLE_NOTE);
                        }
                    } catch (error) {
                        context.logger.warn('attention: lots fetch failed', { error: errorMessage(error) });
                        notes.push(LOTS_UNREACHABLE);
                    }

                    try {
                        const open = await context.revealFulfilment.openRequests(target);
                        if (open !== null) {
                            extraItems.push(...revealAttentionItems(open));
                        }
                    } catch (error) {
                        context.logger.warn('attention: open reveal requests fetch failed', {
                            error: errorMessage(error),
                        });
                        notes.push(REVEAL_REQUESTS_UNREACHABLE);
                    }
                }

                report = withExtraItems(mapReport, extraItems, notes.length === 0 ? null : notes.join(' '));
            }

            const items = report.items
                .filter((item) => meetsSeverity(item.severity, args.minSeverity))
                .map((item) => ({
                    ...item,
                    resourceName: item.resourceId === null ? null : resourceName(resources, item.resourceId),
                }));

            const panel = warehousePressurePanel({
                scouting,
                owner: target,
                ownerKnown: report.ownerKnown,
                version: report.version,
                counts: report.counts,
                items,
                note: report.note,
                resources,
            });

            return {
                content: [
                    { type: 'text', text: panel },
                    {
                        type: 'text',
                        text: JSON.stringify({ ...report, owner: target, scouting, items, resourceNames: resources }),
                    },
                ],
            };
        },
    );
}
