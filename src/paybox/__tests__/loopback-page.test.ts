import { describe, expect, it } from 'vitest';

import { FRONTEND_URL } from '../../config/constants.js';
import { connectionCompletePage } from '../auth/loopback-page.utils.js';

describe('key receipt page', () => {
    it('links to the live grid without credentials and without claiming login has finished', () => {
        const html = connectionCompletePage();

        expect(FRONTEND_URL).toBe('https://dev.projectcpu.cc');
        expect(html).toContain(`href="${FRONTEND_URL}" target="_blank" rel="noopener noreferrer"`);
        expect(html).toContain('OPERATOR VIEW // LIVE GRID');
        expect(html).toContain('The UI observes. The agent acts.');
        expect(html).toContain('Open the grid');
        expect(html).toContain('finishing your login automatically');
        expect(html).not.toContain('stored locally');
        expect(html).not.toContain('Connection established');
        expect(html).not.toContain('pbxk1.');
    });
});
