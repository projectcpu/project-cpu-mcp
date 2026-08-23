import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { NextHopsResult, NextHopView } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerNextHopsTool } from '../next-hops/next-hops.js';

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
        fromReady: null,
        fromRadius: 1,
        towards: null,
        targetDistance: null,
        reach: { moveRadius: 1 },
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

        expect(text).toContain('reach 8');
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

        expect(text).toContain('81 (hub, reach 5, 5 step hop');
        expect(text).toContain('82 (hub, reach 13, 13 step hop');
    });
});
