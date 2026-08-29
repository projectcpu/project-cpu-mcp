import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REFERENCE = path.join(
    REPO_ROOT,
    'plugins',
    'project-cpu',
    'skills',
    'operator-cpu',
    'references',
    'production.md',
);

function reference(): string {
    return fs.readFileSync(REFERENCE, 'utf8');
}

function expectOrdered(document: string, steps: ReadonlyArray<string>): void {
    let offset = -1;

    for (const step of steps) {
        const next = document.indexOf(step, offset + 1);

        expect(next, `Expected ${step} after the prior decision.`).toBeGreaterThan(offset);
        offset = next;
    }
}

describe('the production and crafting reference', () => {
    it('forms a ready production chain before it commits a bounded mining process', () => {
        const document = reference();

        expectOrdered(document, [
            'cpu_get_cell',
            'cpu_find_buildings',
            'cpu_build',
            'cpu_get_cell',
            'cpu_start_mining',
            'cpu_get_mining_status',
            'cpu_claim_mining',
        ]);
        expect(document).toMatch(/ready/iu);
        expect(document).toMatch(/upgrade/iu);
        expect(document).toMatch(/mode/iu);
        expect(document).toMatch(/bounded/iu);
    });

    it('keeps Warehouse Full separate from a Process Stall and restores a whole cycle of room', () => {
        const document = reference();

        expect(document).toMatch(/Warehouse Full/iu);
        expect(document).toMatch(/Process Stall/iu);
        expect(document).toMatch(/whole (?:mining )?cycle/iu);
        expectOrdered(document, ['cpu_get_mining_status', 'cpu_quote_transport', 'cpu_transport', 'cpu_get_cell']);
    });

    it('forms a multi-stage recipe chain from recipe inputs through delivery and claim', () => {
        const document = reference();

        expectOrdered(document, [
            'cpu_list_recipes',
            'cpu_get_cell',
            'cpu_quote_transport',
            'cpu_transport',
            'cpu_finalize_delivery',
            'cpu_craft',
            'cpu_get_craft_status',
            'cpu_claim_craft',
        ]);
        expect(document).toMatch(/build inputs/iu);
        expect(document).toMatch(/recipe inputs/iu);
    });

    it('connects forge and withdrawal to a verified spendable CPU balance', () => {
        const document = reference();

        expectOrdered(document, ['forge_wcpu', 'cpu_craft', 'cpu_claim_craft', 'cpu_withdraw', 'cpu_get_balance']);
        expect(document).toMatch(/quote|preflight/iu);
    });
});
