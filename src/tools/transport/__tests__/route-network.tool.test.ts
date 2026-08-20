import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { NetworkNodeView, RouteNetworkResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import {
    PANEL_CONTINUATION_INDENT,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_MAX_WIDTH,
    PANEL_STRUCTURAL_SEQUENCES,
} from '../../../utils/panel.constants.js';
import type { ToolRegistrar } from '../../types.js';
import { ROUTE_NETWORK_LABELS, ROUTE_NETWORK_TITLE } from '../network/constants.js';
import { registerRouteNetworkTool } from '../network/route-network.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

const NOTE = 'This is the road map, not a route. Verify with cpu_quote_transport.';

function node(over: Partial<NetworkNodeView> = {}): NetworkNodeView {
    return {
        tokenId: '10',
        pos: { face: 0, i: 0, j: 10 },
        isOwn: true,
        isHub: false,
        ready: true,
        owner: '0xMe',
        transitFeePerUnit: null,
        distFromSource: 0,
        distToTarget: 6,
        component: 0,
        ...over,
    };
}

function network(over: Partial<RouteNetworkResult> = {}): RouteNetworkResult {
    return {
        from: '10',
        towards: '30',
        fromToTarget: 6,
        reach: { moveRadius: 2, hubRadius: 4 },
        components: 1,
        nodes: [
            node(),
            node({ tokenId: '20', isOwn: true }),
            node({ tokenId: '25', isOwn: false, isHub: true, owner: '0xrival', transitFeePerUnit: '0.5' }),
            node({ tokenId: '30', isOwn: false, owner: '0xrival' }),
        ],
        edges: [
            { a: '10', b: '20', distance: 2 },
            { a: '20', b: '25', distance: 3 },
            { a: '25', b: '30', distance: 4 },
        ],
        note: NOTE,
        ...over,
    };
}

function harness(result: RouteNetworkResult): Handler {
    const route = { network: async (): Promise<RouteNetworkResult> => result };
    const context = { route, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerRouteNetworkTool(server, context);
    if (captured === null) {
        throw new Error('route_network was not registered');
    }
    return captured;
}

const ARGS = { from: 10, towards: 30, resourceId: 3 };

const PANEL_LABELS = Object.values(ROUTE_NETWORK_LABELS);

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

describe('route_network panel', () => {
    it('opens with the same title and the same fields in the same order on every input', async () => {
        const panels = [
            panelOf(await harness(network())(ARGS)),
            panelOf(await harness(network({ from: null, towards: null, fromToTarget: null }))({ resourceId: 3 })),
            panelOf(await harness(network({ nodes: [], edges: [], components: 0 }))(ARGS)),
            panelOf(await harness(network({ components: 2 }))(ARGS)),
        ];

        for (const panel of panels) {
            expect(panel.split('\n')[0]).toBe(ROUTE_NETWORK_TITLE);
            expect(panelLabels(panel)).toEqual(PANEL_LABELS);
            expect(labelSeparators(panel)).toBe(PANEL_LABELS.length);
        }
    });

    it('keeps every line inside the panel width, whatever the values are', async () => {
        const panels = [
            panelOf(await harness(network())(ARGS)),
            panelOf(await harness(network({ note: 'q'.repeat(400) }))(ARGS)),
            panelOf(await harness(network({ from: '9'.repeat(60), towards: '8'.repeat(60) }))(ARGS)),
        ];

        for (const panel of panels) {
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('counts the waypoints, whose they are, the legal hops and the reach that produced them', async () => {
        const panel = panelOf(await harness(network())(ARGS));

        expect(panel).toMatch(/Waypoints: 4/);
        expect(panel).toMatch(/Yours: 2/);
        expect(panel).toMatch(/Hubs: 1/);
        expect(panel).toMatch(/Legal hops: 3/);
        expect(panel).toMatch(/Reach: move 2, hub 4/);
    });

    it('says how many waypoints charge for passage', async () => {
        const panel = panelOf(await harness(network())(ARGS));

        expect(panel).toMatch(/Paid waypoints: 1 of 4/);
    });

    it('reports a reachable target as a chain that exists', async () => {
        const panel = panelOf(await harness(network())(ARGS));

        expect(panel).toMatch(/From: 10/);
        expect(panel).toMatch(/Towards: 30/);
        expect(panel).toMatch(/Grid steps: 6/);
        expect(flattened(panel)).toMatch(/chain exists/);
    });

    it('calls out the gap when the two ends sit in different components', async () => {
        const split = network({
            components: 2,
            nodes: [node(), node({ tokenId: '30', isOwn: false, owner: '0xrival', component: 1 })],
        });
        const panel = panelOf(await harness(split)(ARGS));

        expect(flattened(panel)).toMatch(/NOT connected/);
        expect(flattened(panel)).toMatch(/gap/);
        expect(panel).toMatch(/Components: 2/);
    });

    it('prints a missing value instead of dropping its field when no route was asked for', async () => {
        const panel = panelOf(
            await harness(network({ from: null, towards: null, fromToTarget: null }))({ resourceId: 3 }),
        );

        expect(panel).toMatch(/From: n\/a/);
        expect(panel).toMatch(/Towards: n\/a/);
        expect(panel).toMatch(/Grid steps: n\/a/);
        expect(panel).toMatch(/Link: n\/a/);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('carries the survey note the tool already returns', async () => {
        const panel = panelOf(await harness(network())(ARGS));

        expect(flattened(panel).replace(/ /gu, '')).toContain(NOTE.replace(/ /gu, ''));
    });

    it('lets the note forge no line, no column and no field', async () => {
        const clean = panelOf(await harness(network({ note: 'road map forged' }))(ARGS));

        for (const probe of PANEL_STRUCTURAL_SEQUENCES) {
            const panel = panelOf(await harness(network({ note: `road map${probe}forged` }))(ARGS));

            expect(panel.split('\n')).toHaveLength(clean.split('\n').length);
            expect(labelSeparators(panel)).toBe(labelSeparators(clean));
            expect(panel.split('|')).toHaveLength(clean.split('|').length);
        }
    });

    it('lets the note forge no field even when the panel is read unwrapped', async () => {
        for (let offset = 40; offset < 72; offset += 1) {
            const note = `${'b'.repeat(offset)}:${'c'.repeat(30)}`;
            const panel = panelOf(await harness(network({ note }))(ARGS));

            expect(labelSeparators(unwrapped(panel))).toBe(PANEL_LABELS.length);
            expect(flattened(panel)).toContain(`Note: ${note}`);
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
        const result = await harness(network())(ARGS);

        expect(result.content).toHaveLength(2);
        expect(result.content[1]?.type).toBe('text');
        expect(result.content[1]?.text).toBe(JSON.stringify(network()));
    });
});
