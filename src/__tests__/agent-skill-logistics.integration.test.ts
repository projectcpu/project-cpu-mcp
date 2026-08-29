import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CREATE_LOT_DESCRIPTION } from '../tools/trade/create-lot/constants.js';
import { NEXT_HOPS_DESCRIPTION, ROUTE_NETWORK_DESCRIPTION } from '../tools/transport/constants.js';
import { LIST_MY_TRANSPORTS_DESCRIPTION } from '../tools/transport/list-mine/constants.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOGISTICS = path.join(REPO_ROOT, 'plugins', 'project-cpu', 'skills', 'operator-cpu', 'references', 'logistics.md');

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

    it('uses the foreign-Hub route discovery contract before buying a resource lot', () => {
        const buying = section(readLogistics(), 'Buy resources');

        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(/foreign Hub is passage, never an end/iu);
        expect(NEXT_HOPS_DESCRIPTION).toMatch(/Survey the legal next waypoints/iu);
        expect(orderedTools(buying)).toContain('cpu_next_hops');
        expect(orderedTools(buying)).not.toContain('cpu_route_network');
        expectToolsInOrder(orderedTools(buying), [
            'cpu_list_lots',
            'cpu_get_lot',
            'cpu_next_hops',
            'cpu_quote_buy',
            'cpu_buy_lot',
            'cpu_list_my_transports',
            'cpu_finalize_delivery',
            'cpu_get_map',
        ]);
    });

    it('finalizes the listing delivery before using its open-lot lifecycle', () => {
        const selling = section(readLogistics(), 'Sell resources and recover escrow');

        expect(CREATE_LOT_DESCRIPTION).toMatch(/lot is DELIVERING/iu);
        expect(CREATE_LOT_DESCRIPTION).toMatch(/becomes buyable \(OPEN\).*cpu_finalize_delivery/iu);
        expect(LIST_MY_TRANSPORTS_DESCRIPTION).toMatch(/ready_to_finalize/iu);
        expectToolsInOrder(orderedTools(selling), [
            'cpu_get_lot_terms',
            'cpu_next_hops',
            'cpu_create_lot',
            'cpu_list_my_transports',
            'cpu_finalize_delivery',
            'cpu_get_lot',
            'cpu_list_my_lots',
            'cpu_list_fills',
            'cpu_get_lot',
            'cpu_next_hops',
            'cpu_quote_lot_return',
            'cpu_return_lot',
            'cpu_list_my_transports',
            'cpu_finalize_delivery',
            'cpu_get_map',
            'cpu_list_my_lots',
            'cpu_get_lot',
        ]);
    });
});
