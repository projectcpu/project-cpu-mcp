import { describe, expect, it } from 'vitest';

import type { ServerHealthView } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import type { EnrichedCell, MapChanges } from '../../../map/types.js';
import type { AppContext } from '../../../types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';
import {
    PANEL_CONTINUATION_INDENT,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_MAX_WIDTH,
    PANEL_STRUCTURAL_SEQUENCES,
} from '../../../utils/panel.constants.js';
import type { ToolRegistrar } from '../../types.js';
import { CHANGE_FEED_LABELS, CHANGE_FEED_TITLE } from '../get-changes/constants.js';
import { registerGetChangesTool } from '../get-changes/get-changes.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

const CHANGED: EnrichedCell = {
    tokenId: '9',
    pos: { face: 0, i: 0, j: 9 },
    owner: '0xMe',
    revealCount: 1,
    revealPending: false,
    resources: [{ resourceId: 4, deposit: '50', balance: '0', strength: null, storage: null }],
    building: null,
    demolishFinishAt: null,
    demolishStartAt: null,
    demolishingType: null,
    transitFeeOverrides: null,
    saleFeeOverrides: null,
    process: null,
    updated: 5,
    ready: null,
    activeHub: false,
    neighbors: [],
};

const UP: ServerHealthView = { reachable: true, reason: null };
const DOWN: ServerHealthView = { reachable: false, reason: 'connect ECONNREFUSED 127.0.0.1:3000' };

function harness(
    health: ServerHealthView = UP,
    changes: Partial<MapChanges> = {},
): {
    handler: Handler;
    sinceArgs: Array<number>;
} {
    const sinceArgs: Array<number> = [];
    const map = {
        getChanges(since: number): MapChanges {
            sinceArgs.push(since);
            return { version: 200, serverTime: 1_700_000_000, changed: [CHANGED], changedCount: 1, ...changes };
        },
    };
    const wallet = { isReady: () => true, get: () => ({ getAddress: () => '0xMe' }) };
    const appConfig = {
        load: async (): Promise<{ resources: Record<number, string> }> => ({ resources: { 4: 'Iron Ore' } }),
    };
    const api = { getServerHealth: () => health };
    const context = { mapReader: map, wallet, appConfig, api, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerGetChangesTool(server, context);
    if (captured === null) {
        throw new Error('get_changes was not registered');
    }
    return { handler: captured, sinceArgs };
}

describe('get_changes tool', () => {
    it('passes the provided version through', async () => {
        const { handler, sinceArgs } = harness();
        await handler({ sinceVersion: 120 });
        expect(sinceArgs[0]).toBe(120);
    });

    it('defaults a null version to 0 (return everything)', async () => {
        const { handler, sinceArgs } = harness();
        await handler({ sinceVersion: null });
        expect(sinceArgs[0]).toBe(0);
    });

    it('serializes the changes payload, with resource ids labeled from config', async () => {
        const { handler } = harness();
        const result = await handler({ sinceVersion: 0 });
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as {
            version: number;
            changed: Array<{ resources: Array<{ resourceName: string }> }>;
        };
        expect(parsed.version).toBe(200);
        expect(parsed.changed[0]?.resources[0]?.resourceName).toBe('Iron Ore');
    });

    it('surfaces server reachability in the panel and payload', async () => {
        const { handler } = harness();
        const result = await handler({ sinceVersion: 0 });
        expect(result.content[0]?.text).toMatch(/State: live/);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { server: { reachable: boolean } };
        expect(parsed.server.reachable).toBe(true);
    });
});

const PANEL_LABELS = Object.values(CHANGE_FEED_LABELS);

function panelOf(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}

function labelSeparators(panel: string): number {
    return panel.split(PANEL_LABEL_SEPARATOR).length - 1;
}

function unwrapped(panel: string): string {
    return panel
        .split('\n')
        .reduce((text, line) =>
            line.startsWith(PANEL_CONTINUATION_INDENT) ? `${text} ${line.trim()}` : `${text}\n${line}`,
        );
}

function flattened(panel: string): string {
    return panel
        .split('\n')
        .map((line) => line.trim())
        .join('');
}

function panelLabels(panel: string): Array<string> {
    return panel
        .split('\n')
        .slice(1)
        .flatMap((line) => line.trim().split(' | '))
        .map((field) => field.split(': ')[0] ?? '')
        .filter((label) => PANEL_LABELS.includes(label));
}

describe('get_changes panel', () => {
    it('opens with the same title and the same fields in the same order on every input', async () => {
        const panels = [
            panelOf(await harness().handler({ sinceVersion: 120 })),
            panelOf(await harness(DOWN).handler({ sinceVersion: 120 })),
            panelOf(await harness(UP, { changed: [], changedCount: 0 }).handler({ sinceVersion: null })),
            panelOf(await harness(DOWN, { changed: [], changedCount: 0 }).handler({ sinceVersion: null })),
        ];

        for (const panel of panels) {
            expect(panel.split('\n')[0]).toBe(CHANGE_FEED_TITLE);
            expect(panelLabels(panel)).toEqual(PANEL_LABELS);
            expect(labelSeparators(panel)).toBe(PANEL_LABELS.length);
        }
    });

    it('keeps every line inside the panel width, whatever the values are', async () => {
        const noisy: ServerHealthView = { reachable: false, reason: `getaddrinfo ENOTFOUND ${'h'.repeat(120)}` };
        const panels = [
            panelOf(await harness().handler({ sinceVersion: 120 })),
            panelOf(await harness(DOWN).handler({ sinceVersion: 120 })),
            panelOf(await harness(noisy).handler({ sinceVersion: 120 })),
        ];

        for (const panel of panels) {
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('reports the cursor it was given, what it found and how far the map got', async () => {
        const panel = panelOf(await harness().handler({ sinceVersion: 120 }));

        expect(panel).toMatch(/Since: v120/);
        expect(panel).toMatch(/Changed: 1/);
        expect(panel).toMatch(/Last recorded: v200/);
        expect(panel).toContain(formatUnixSeconds(1_700_000_000));
        expect(panel).toMatch(/Source: game API/);
    });

    it('prints a missing value instead of dropping its field when the source is healthy', async () => {
        const panel = panelOf(await harness().handler({ sinceVersion: 0 }));

        expect(panel).toMatch(/Reason: n\/a/);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('names the unreachable source and what it costs, instead of a soft maybe', async () => {
        const panel = panelOf(await harness(DOWN).handler({ sinceVersion: 120 }));

        expect(panel).toMatch(/State: UNREACHABLE/);
        expect(panel).toMatch(/Reason: connect ECONNREFUSED/);
        expect(panel).toMatch(/Effect: [^\n]*game API/);
        expect(flattened(panel)).toMatch(/stale/i);
        expect(flattened(panel)).not.toMatch(/may be|might be|possibly/i);
    });

    it('does not let an empty list read as a quiet world while the source is down', async () => {
        const quiet = panelOf(await harness(DOWN, { changed: [], changedCount: 0 }).handler({ sinceVersion: 120 }));

        expect(quiet).toMatch(/Changed: 0/);
        expect(flattened(quiet)).toMatch(/not quiet/i);
        expect(flattened(quiet)).toMatch(/stopped/i);
    });

    it('calls the feed live only while the source answers', async () => {
        const live = flattened(panelOf(await harness().handler({ sinceVersion: 120 })));
        const down = flattened(panelOf(await harness(DOWN).handler({ sinceVersion: 120 })));

        expect(live).toMatch(/live/i);
        expect(live).not.toMatch(/stale/i);
        expect(down).not.toMatch(/State: live/);
    });

    it('lets the outage reason forge no line, no column and no field', async () => {
        const clean = panelOf(
            await harness({ reachable: false, reason: 'socket hang up forged' }).handler({ sinceVersion: 1 }),
        );

        for (const probe of PANEL_STRUCTURAL_SEQUENCES) {
            const panel = panelOf(
                await harness({ reachable: false, reason: `socket hang up${probe}forged` }).handler({
                    sinceVersion: 1,
                }),
            );

            expect(panel.split('\n')).toHaveLength(clean.split('\n').length);
            expect(labelSeparators(panel)).toBe(labelSeparators(clean));
            expect(panel.split('|')).toHaveLength(clean.split('|').length);
        }
    });

    it('lets the outage reason forge no field even when the panel is read unwrapped', async () => {
        for (let offset = 40; offset < 72; offset += 1) {
            const reason = `${'b'.repeat(offset)}:${'c'.repeat(30)}`;
            const panel = panelOf(await harness({ reachable: false, reason }).handler({ sinceVersion: 1 }));

            expect(labelSeparators(unwrapped(panel))).toBe(PANEL_LABELS.length);
            expect(flattened(panel)).toContain(`Reason: ${reason}`);
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('keeps its own labels inside the label ceiling the builder documents', () => {
        for (const label of PANEL_LABELS) {
            expect(label.length).toBeLessThanOrEqual(PANEL_MAX_LABEL_LENGTH);
        }
    });

    it('leaves the machine block untouched next to the panel', async () => {
        const result = await harness(DOWN).handler({ sinceVersion: 120 });

        expect(result.content).toHaveLength(2);
        expect(result.content[1]?.type).toBe('text');
        const payload = JSON.parse(result.content[1]?.text ?? '{}') as {
            version: number;
            changedCount: number;
            server: { reachable: boolean; reason: string | null };
        };
        expect(Object.keys(payload).sort()).toEqual(['changed', 'changedCount', 'server', 'serverTime', 'version']);
        expect(payload.version).toBe(200);
        expect(payload.changedCount).toBe(1);
        expect(payload.server).toEqual(DOWN);
    });
});
