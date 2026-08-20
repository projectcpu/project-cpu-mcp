import { describe, expect, it } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../server.js';

const INSTRUCTIONS_CHAR_BUDGET = 2000;

describe('server instructions', () => {
    it('stay under the character budget clients deliver in full', () => {
        expect(SERVER_INSTRUCTIONS.length).toBeLessThan(INSTRUCTIONS_CHAR_BUDGET);
    });

    it('name authentication and the entry point', () => {
        expect(SERVER_INSTRUCTIONS).toContain('cpu_authenticate');
        expect(SERVER_INSTRUCTIONS).toContain('cpu_get_game_config');
    });

    it('keep the route planning loop', () => {
        expect(SERVER_INSTRUCTIONS).toContain('cpu_route_network');
        expect(SERVER_INSTRUCTIONS).toContain('cpu_next_hops');
        expect(SERVER_INSTRUCTIONS).toContain('cpu_quote_transport');
    });
});
