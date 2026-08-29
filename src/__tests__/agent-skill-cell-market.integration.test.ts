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
    'project-cpu',
    'references',
    'cell-market.md',
);

function readReference(): string {
    return fs.readFileSync(REFERENCE, 'utf8');
}

function section(document: string, heading: string): string {
    const start = document.indexOf(`## ${heading}`);
    const next = document.indexOf('\n## ', start + 1);

    return document.slice(start, next === -1 ? undefined : next);
}

function orderedTools(document: string): Array<string> {
    return Array.from(document.matchAll(/`(cpu_[a-z0-9_]+)`/g), (match) => match[1] ?? '');
}

function expectToolsInOrder(actual: Array<string>, expected: Array<string>): void {
    let from = 0;

    for (const tool of expected) {
        const index = actual.indexOf(tool, from);

        expect(index, `expected ${tool} after ${actual.slice(0, from).join(', ')}`).toBeGreaterThanOrEqual(0);
        from = index + 1;
    }
}

describe('the Cell Market orchestration reference', () => {
    it('keeps its nine target capabilities available to the installed skill', () => {
        const tools = orderedTools(readReference());

        expect(tools).toEqual(
            expect.arrayContaining([
                'cpu_get_cell_market',
                'cpu_get_my_listings',
                'cpu_get_my_offers',
                'cpu_get_my_offers_received',
                'cpu_list_cell',
                'cpu_make_cell_offer',
                'cpu_buy_cell',
                'cpu_accept_cell_offer',
                'cpu_cancel_order',
            ]),
        );
    });

    it('forms separate verified listing and offer pipelines', () => {
        const document = readReference();

        expectToolsInOrder(orderedTools(section(document, 'List a Cell')), [
            'cpu_get_my_listings',
            'cpu_list_cell',
            'cpu_get_my_listings',
        ]);
        expectToolsInOrder(orderedTools(section(document, 'Make a Cell offer')), [
            'cpu_get_cell_market',
            'cpu_make_cell_offer',
            'cpu_get_my_offers',
        ]);
    });

    it('re-reads an exact listing or offer before purchase or acceptance', () => {
        const document = readReference();

        expectToolsInOrder(orderedTools(section(document, 'Buy an exact listing')), [
            'cpu_get_cell_market',
            'cpu_get_cell_market',
            'cpu_buy_cell',
            'cpu_get_map',
        ]);
        expectToolsInOrder(orderedTools(section(document, 'Accept an exact offer')), [
            'cpu_get_my_offers_received',
            'cpu_get_my_offers_received',
            'cpu_accept_cell_offer',
            'cpu_get_my_offers_received',
        ]);
    });

    it('cancels only a re-read exact listing or offer and keeps resource Lots separate', () => {
        const cancellation = section(readReference(), 'Cancel an exact Market order');

        expectToolsInOrder(orderedTools(cancellation), [
            'cpu_get_my_listings',
            'cpu_get_my_offers',
            'cpu_cancel_order',
        ]);
        expect(cancellation).toMatch(/re-read[\s\S]*exact[\s\S]*order/iu);
        expect(readReference()).toMatch(/resource Lots[\s\S]*Cell Market|Cell Market[\s\S]*resource Lots/iu);
    });
});
