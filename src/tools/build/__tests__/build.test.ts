import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { BuildResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerBuildTool } from '../build.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type BuildArgs = { tokenId: string; buildingType: BuildingType };
type Handler = (args: BuildArgs) => Promise<ToolResult>;

function harness(outcome: BuildResult | Error): Handler {
    const build = {
        build: async (): Promise<BuildResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const appConfig = { load: async () => makeConfig() };
    const context = { build, appConfig, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerBuildTool(server, context);
    if (captured === null) {
        throw new Error('build was not registered');
    }
    return captured;
}

const mineResult: BuildResult = {
    tokenId: '42',
    buildingType: BuildingType.Mine,
    buildCost: '5',
    approveTxHash: '0xapprove',
    buildTxHash: '0xbuild',
    alreadyBuilt: false,
};

describe('build tool', () => {
    it('reports $CPU paid and a start-mining follow-up (with mine targets) for an extractor', async () => {
        const result = await harness(mineResult)({ tokenId: '42', buildingType: BuildingType.Mine });

        const panel = result.content[0]?.text ?? '';
        expect(panel).toMatch(/^BUILDING PLACEMENT\n/);
        expect(panel).toMatch(/Cell: 42 \| Building: Mine/);
        expect(panel).toMatch(/Approve tx: 0xapprove/);
        expect(panel).toMatch(/5 \$CPU/);
        expect(panel).toMatch(/cpu_start_mining 42/);
        // Mine mines Iron/Copper in the fixture.
        expect(panel).toMatch(/Iron \(#5\)/);
        expect(panel).not.toMatch(/mining started/);
    });

    it('leaves the machine-readable block as the plain service result', async () => {
        const result = await harness(mineResult)({ tokenId: '42', buildingType: BuildingType.Mine });

        expect(result.content[1]?.text).toBe(JSON.stringify(mineResult));
        expect(result.content).toHaveLength(2);
    });

    it('says construction started rather than that the building is usable', async () => {
        const result = await harness(mineResult)({ tokenId: '42', buildingType: BuildingType.Mine });

        const panel = result.content[0]?.text ?? '';
        expect(panel).toMatch(/construction started/);
        expect(panel).toMatch(/does not work yet/);
        expect(panel).not.toMatch(/\b(ready|complete|completed|completes|finished)\b/i);
    });

    it('reports a crafter with a cpu_craft follow-up listing its recipe', async () => {
        const result = await harness({
            ...mineResult,
            buildingType: BuildingType.SteelMill,
            buildCost: '20',
        })({ tokenId: '42', buildingType: BuildingType.SteelMill });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/Steel Mill/);
        expect(header).toMatch(/cpu_craft 42/);
        expect(header).toMatch(/Smelt Steel \(smelt_steel\)/);
    });

    it('reports a hub with an absent approve transaction and a get_cell follow-up', async () => {
        const result = await harness({
            ...mineResult,
            buildingType: BuildingType.Hub,
            approveTxHash: null,
            buildCost: '40',
        })({ tokenId: '42', buildingType: BuildingType.Hub });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/routes transport and trade/);
        expect(header).toMatch(/40 \$CPU/);
        expect(header).toMatch(/cpu_get_cell 42/);
        expect(header).toMatch(/Approve tx: n\/a/);
        expect(header).not.toMatch(/0xapprove/);
    });

    it('prints the panel, not an empty line, when the building was already in place', async () => {
        const result = await harness({
            ...mineResult,
            approveTxHash: null,
            buildTxHash: null,
            buildCost: '0',
            alreadyBuilt: true,
        })({ tokenId: '42', buildingType: BuildingType.Mine });

        const panel = result.content[0]?.text ?? '';
        expect(panel).toMatch(/^BUILDING PLACEMENT\n/);
        expect(panel).toMatch(/no transaction sent/);
        expect(panel).toMatch(/already stands on the cell/);
        expect(panel).toMatch(/Build tx: n\/a/);
        expect(panel).toMatch(/cpu_start_mining 42/);
    });

    it('propagates service errors', async () => {
        await expect(
            harness(new Error('CellNotRevealed'))({ tokenId: '42', buildingType: BuildingType.Mine }),
        ).rejects.toThrow(/CellNotRevealed/);
    });
});
