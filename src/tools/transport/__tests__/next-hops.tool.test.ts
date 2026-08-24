import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import { NEXT_HOPS_NOTE } from '../../../services/route.constants.js';
import { hopReachLimit, type RouteNode } from '../../../services/route.utils.js';
import type { NextHopsResult, NextHopView } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { NEXT_HOPS_DESCRIPTION } from '../constants.js';
import { NEXT_HOPS_SUMMARY_LIMIT } from '../next-hops/constants.js';
import { registerNextHopsTool } from '../next-hops/next-hops.js';
import { nextHopsInputSchema, transportInputSchema } from '../types.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

const NOTE = 'Chain hops yourself.';

function capture(result: NextHopsResult): (args: never) => Promise<ToolResult> {
    const route = { nextHops: async () => result };
    const context = { route, logger: new NoopLogger() } as unknown as AppContext;
    let captured: ((args: never) => Promise<ToolResult>) | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: (args: never) => Promise<ToolResult>): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    registerNextHopsTool(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

function hop(overrides: Partial<NextHopView> = {}): NextHopView {
    return {
        tokenId: '80',
        pos: { face: 0, i: 0, j: 0 },
        hopDistance: 1,
        isOwn: true,
        isHub: false,
        isVirgin: false,
        ready: null,
        owner: '0xowner',
        radius: 1,
        transitFeePerUnit: null,
        distanceToTarget: null,
        ...overrides,
    };
}

function nextHopsResult(overrides: Partial<NextHopsResult> = {}): NextHopsResult {
    return {
        from: '72',
        fromIsHub: false,
        fromIsVirgin: false,
        fromReady: null,
        fromRadius: 1,
        towards: null,
        targetDistance: null,
        hops: [hop()],
        note: NOTE,
        ...overrides,
    };
}

async function summaryOf(result: NextHopsResult): Promise<string> {
    const handler = capture(result);
    const out = await handler({ from: 72, resourceId: 3, towards: null } as never);
    return out.content[0]?.text ?? '';
}

describe('next_hops origin note', () => {
    it.each([
        ['a finished building says nothing about the origin', true],
        ['no building at all says nothing about the origin', null],
    ])('%s', async (_name, fromReady) => {
        expect(await summaryOf(nextHopsResult({ fromReady }))).not.toContain('under construction');
    });

    it('states the reach an origin still under construction actually has', async () => {
        const text = await summaryOf(nextHopsResult({ fromReady: false }));
        expect(text).toContain('72 has a building still under construction');
        expect(text).toContain('your reach from here is normal cell reach');
    });

    it('scopes the hub-reach rule to a Hub instead of promising a crafter will grant it once built', async () => {
        const text = await summaryOf(nextHopsResult({ fromReady: false }));
        expect(text).toContain('a Hub grants hub reach only once its construction finishes');
        expect(text).not.toContain('it is not an active Hub');
    });

    it('explains the shrunken reach even when nothing is in range', async () => {
        const text = await summaryOf(nextHopsResult({ fromReady: false, hops: [] }));
        expect(text).toContain('No eligible waypoints within reach of 72');
        expect(text).toContain('your reach from here is normal cell reach');
    });
});

describe('next_hops reach reporting', () => {
    it('names the origin reach instead of one universal hub radius', async () => {
        const text = await summaryOf(nextHopsResult({ fromIsHub: true, fromRadius: 8, fromReady: true }));

        expect(text).toContain('radius 8');
        expect(text).not.toMatch(/hubRadius/);
    });

    it('reports each candidate with the radius that candidate itself carries', async () => {
        const text = await summaryOf(
            nextHopsResult({
                hops: [
                    hop({ tokenId: '81', isOwn: false, isHub: true, radius: 5, hopDistance: 5 }),
                    hop({ tokenId: '82', isOwn: false, isHub: true, radius: 13, hopDistance: 13 }),
                ],
            }),
        );

        expect(text).toContain('81 (hub, radius 5, 5 step hop');
        expect(text).toContain('82 (hub, radius 13, 13 step hop');
    });

    it('reports the resource-specific fee only where one is charged', async () => {
        const text = await summaryOf(
            nextHopsResult({
                hops: [
                    hop({ tokenId: '81', isOwn: false, isHub: true, radius: 5, transitFeePerUnit: '0.5' }),
                    hop({ tokenId: '82', isOwn: false, isVirgin: true, owner: null }),
                    hop({ tokenId: '83' }),
                ],
            }),
        );

        expect(text).toContain('81 (hub, radius 5, 1 step hop, fee 0.5 $CPU/u)');
        expect(text).toContain('82 (virgin, radius 1, 1 step hop)');
        expect(text).toContain('83 (own, radius 1, 1 step hop)');
    });
});

describe('next_hops candidate listing', () => {
    function manyHops(count: number): Array<NextHopView> {
        return Array.from({ length: count }, (_, index) =>
            hop({ tokenId: String(100 + index), isOwn: false, isVirgin: true, owner: null }),
        );
    }

    it('keeps every legal candidate in the payload while the summary stays short', async () => {
        const hops = manyHops(NEXT_HOPS_SUMMARY_LIMIT + 5);
        const handler = capture(nextHopsResult({ hops }));

        const out = await handler({ from: 72, resourceId: 3, towards: null } as never);
        const summary = out.content[0]?.text ?? '';
        const payload = JSON.parse(out.content[1]?.text ?? '{}') as NextHopsResult;

        expect(payload.hops).toHaveLength(hops.length);
        expect(summary).toContain(`${hops.length} legal next hop(s)`);
        expect(summary).toContain('5 more in the JSON payload');
        expect(summary).not.toContain(String(100 + NEXT_HOPS_SUMMARY_LIMIT));
    });

    it('lists every candidate when they fit under the limit', async () => {
        const hops = manyHops(NEXT_HOPS_SUMMARY_LIMIT);

        const summary = await summaryOf(nextHopsResult({ hops }));

        expect(summary).not.toContain('more in the JSON payload');
        expect(summary).toContain(String(100 + NEXT_HOPS_SUMMARY_LIMIT - 1));
    });
});

describe('next_hops fee documentation', () => {
    it('does not promise open ground is free when a Hub can stand on it', async () => {
        const text = await summaryOf(
            nextHopsResult({ hops: [hop({ isVirgin: true, isHub: true, owner: '0xrival', transitFeePerUnit: '17' })] }),
        );

        expect(text).toContain('fee 17 $CPU/u');
        expect(NEXT_HOPS_DESCRIPTION).toMatch(/finished Hub charges its fee even on a cell with no completed reveal/);
        expect(NEXT_HOPS_DESCRIPTION).not.toContain('Virgin ground and your own cells charge none');
    });

    it('does not promise a fee for a Hub of your own standing on open ground', async () => {
        const text = await summaryOf(
            nextHopsResult({
                hops: [hop({ isOwn: true, isVirgin: true, isHub: true, transitFeePerUnit: null })],
            }),
        );

        expect(text).not.toContain('fee');
        expect(NEXT_HOPS_DESCRIPTION).toMatch(/your own cells charge none, a Hub of your own on them included/);
    });
});

describe('next_hops strings name the fields the payload really carries', () => {
    function backtickedNames(text: string): Array<string> {
        return [...text.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((match) => match[1] ?? '');
    }

    function servedNames(): Set<string> {
        const result = nextHopsResult();
        const candidate = result.hops[0];
        if (candidate === undefined) {
            throw new Error('the fixture carries no candidate to read field names off');
        }
        return new Set([
            ...Object.keys(result),
            ...Object.keys(candidate),
            ...Object.keys(nextHopsInputSchema),
            ...Object.keys(transportInputSchema),
        ]);
    }

    function plainNode(radius: number): RouteNode {
        return { tokenId: '1', isOwn: true, isHub: false, isVirgin: false, radius };
    }

    it.each([
        ['the note returned in the payload', NEXT_HOPS_NOTE],
        ['the tool description', NEXT_HOPS_DESCRIPTION],
    ])('%s points at no field the answer does not carry', (_name, text) => {
        const served = servedNames();
        const named = backtickedNames(text);

        expect(named.length).toBeGreaterThan(0);
        expect(named.filter((name) => !served.has(name))).toEqual([]);
    });

    it.each([
        ['the note returned in the payload', NEXT_HOPS_NOTE],
        ['the tool description', NEXT_HOPS_DESCRIPTION],
    ])('%s names the origin reach and the candidate reach by their own field names', (_name, text) => {
        const result = nextHopsResult();
        const candidate = result.hops[0];
        const named = backtickedNames(text);
        const originFields = Object.keys(result).filter((key) => key.toLowerCase().endsWith('radius'));
        const candidateFields = Object.keys(candidate ?? {}).filter((key) => key.toLowerCase().endsWith('radius'));

        expect(originFields.every((field) => named.includes(field))).toBe(true);
        expect(candidateFields.every((field) => named.includes(field))).toBe(true);
    });

    it('states the hop rule with the offset the reach helper actually applies', () => {
        const [from, to] = [5, 8];
        const offset = hopReachLimit(plainNode(from), plainNode(to)) - (from + to);

        expect(offset).toBeLessThan(0);
        expect(NEXT_HOPS_DESCRIPTION).toContain(`radius(from)+radius(to)\u2212${String(-offset)} grid steps`);
    });
});
