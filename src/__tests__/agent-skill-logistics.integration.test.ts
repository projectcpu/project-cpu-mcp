import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOGISTICS = path.join(REPO_ROOT, 'plugins', 'project-cpu', 'skills', 'project-cpu', 'references', 'logistics.md');

function readLogistics(): string {
    return fs.readFileSync(LOGISTICS, 'utf8');
}

function orderedTools(section: string): Array<string> {
    return Array.from(section.matchAll(/`(cpu_[a-z0-9_]+)`/g), (match) => match[1] ?? '');
}

function expectToolsInOrder(actual: Array<string>, expected: Array<string>): void {
    let from = 0;

    for (const tool of expected) {
        const index = actual.indexOf(tool, from);
        expect(index, `expected ${tool} after ${actual.slice(0, from).join(', ')}`).toBeGreaterThanOrEqual(0);
        from = index + 1;
    }
}

function section(document: string, heading: string): string {
    const start = document.indexOf(`## ${heading}`);
    const next = document.indexOf('\n## ', start + 1);

    return document.slice(start, next === -1 ? undefined : next);
}

describe('the logistics orchestration reference', () => {
    it('moves cargo through a fresh route, quote, delivery, and final warehouse check', () => {
        const transport = section(readLogistics(), 'Transport cargo');

        expectToolsInOrder(orderedTools(transport), [
            'cpu_get_map',
            'cpu_route_network',
            'cpu_quote_transport',
            'cpu_transport',
            'cpu_list_my_transports',
            'cpu_finalize_delivery',
            'cpu_get_map',
        ]);
        expect(transport).toMatch(/fresh.*route|route.*fresh/iu);
        expect(transport).toMatch(/capacity/iu);
        expect(transport).toMatch(/waypoint.*change|change.*waypoint/iu);
    });

    it('turns a resource buy into a usable warehouse balance', () => {
        const buying = section(readLogistics(), 'Buy resources');

        expectToolsInOrder(orderedTools(buying), [
            'cpu_list_lots',
            'cpu_get_lot',
            'cpu_route_network',
            'cpu_quote_buy',
            'cpu_buy_lot',
            'cpu_list_my_transports',
            'cpu_finalize_delivery',
            'cpu_get_map',
        ]);
        expect(buying).toMatch(/destination.*capacity|capacity.*destination/iu);
        expect(buying).toMatch(/Lot|Fill/);
    });

    it('keeps seller inventory recoverable after a live terms change or eviction', () => {
        const selling = section(readLogistics(), 'Sell resources and recover escrow');

        expectToolsInOrder(orderedTools(selling), [
            'cpu_get_lot_terms',
            'cpu_route_network',
            'cpu_create_lot',
            'cpu_list_my_lots',
            'cpu_list_fills',
            'cpu_get_lot',
            'cpu_quote_lot_return',
            'cpu_return_lot',
            'cpu_list_my_transports',
            'cpu_finalize_delivery',
            'cpu_get_map',
            'cpu_list_my_lots',
            'cpu_get_lot',
        ]);
        expect(selling).toMatch(/live rate/iu);
        expect(selling).toMatch(/seller tolerance/iu);
        expect(selling).toMatch(/sale fee/iu);
        expect(selling).toMatch(/Frozen/);
        expect(selling).toMatch(/Evict|evict/);
        expect(selling).toMatch(/syndicate/iu);
        expect(selling).toMatch(/Cell Market/);
    });
});
