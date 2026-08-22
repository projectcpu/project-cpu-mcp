import { describe, expect, it } from 'vitest';

import type {
    CreateSyndicateResult,
    JoinSyndicateResult,
    LeaveSyndicateResult,
    SetSyndicateParamsResult,
    SyndicateRatesView,
    TransferSyndicateManagerResult,
} from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType } from '../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerCreateSyndicateTool } from '../create/create-syndicate.js';
import { registerJoinSyndicateTool } from '../join/join-syndicate.js';
import { registerLeaveSyndicateTool } from '../leave/leave-syndicate.js';
import { registerSetSyndicateParamsTool } from '../set-params/set-syndicate-params.js';
import { registerTransferSyndicateManagerTool } from '../transfer-manager/transfer-syndicate-manager.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Register = (server: ToolRegistrar, context: AppContext) => void;

function capture(register: Register, contextPartial: Record<string, unknown>): (args: never) => Promise<ToolResult> {
    const context = { ...contextPartial } as unknown as AppContext;
    let captured: ((args: never) => Promise<ToolResult>) | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: (args: never) => Promise<ToolResult>): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    register(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

const RATES: SyndicateRatesView = {
    tradeDiscountPercent: 1,
    transportDiscountPercent: 2,
    tradeTaxPercent: 3,
    transportTaxPercent: 4,
};

function eventTypeOf(result: ToolResult): string | null {
    const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { eventType: string | null };
    return parsed.eventType ?? null;
}

describe('syndicate mutating tools report their event', () => {
    it('cpu_join_syndicate names SyndicateJoined', async () => {
        const joined: JoinSyndicateResult = {
            syndicateId: '7',
            joinedAt: 1_700_000_001,
            leaveAvailableAt: 1_700_000_601,
            rates: RATES,
        };
        const handler = capture(registerJoinSyndicateTool, { syndicate: { join: async () => joined } });
        const result = await handler({ id: '7' } as never);
        expect(eventTypeOf(result)).toBe(ToolEventType.SyndicateJoined);
    });

    it('cpu_leave_syndicate names SyndicateLeft', async () => {
        const left: LeaveSyndicateResult = { syndicateId: '7', rejoinAvailableImmediately: true };
        const handler = capture(registerLeaveSyndicateTool, { syndicate: { leave: async () => left } });
        const result = await handler({} as never);
        expect(eventTypeOf(result)).toBe(ToolEventType.SyndicateLeft);
    });

    it('cpu_create_syndicate names SyndicateCreated', async () => {
        const created: CreateSyndicateResult = {
            syndicateId: '7',
            manager: '0x00000000000000000000000000000000000000a1',
            rates: RATES,
            joinedAt: 1_700_000_001,
            leaveAvailableAt: 1_700_000_601,
        };
        const handler = capture(registerCreateSyndicateTool, { syndicate: { create: async () => created } });
        const result = await handler({ name: 'n', link: '', manager: null, rates: RATES } as never);
        expect(eventTypeOf(result)).toBe(ToolEventType.SyndicateCreated);
    });

    it('cpu_set_syndicate_params names SyndicateParamsChanged', async () => {
        const params: SetSyndicateParamsResult = { syndicateId: '7', rates: RATES };
        const handler = capture(registerSetSyndicateParamsTool, { syndicate: { setParams: async () => params } });
        const result = await handler({ id: '7', name: 'n', link: '', rates: RATES } as never);
        expect(eventTypeOf(result)).toBe(ToolEventType.SyndicateParamsChanged);
    });

    it('cpu_transfer_syndicate_manager names SyndicateManagerChanged', async () => {
        const transferred: TransferSyndicateManagerResult = {
            syndicateId: '7',
            previousManager: '0x00000000000000000000000000000000000000a1',
            newManager: '0x00000000000000000000000000000000000000a2',
        };
        const handler = capture(registerTransferSyndicateManagerTool, {
            syndicate: { transferManager: async () => transferred },
        });
        const result = await handler({ id: '7', next: '0x00000000000000000000000000000000000000a2' } as never);
        expect(eventTypeOf(result)).toBe(ToolEventType.SyndicateManagerChanged);
    });
});
