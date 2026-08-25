import { describe, expect, it } from 'vitest';

import { Network } from '../../../config/types.js';
import type { BalanceResult } from '../../../services/types.js';
import { capture } from '../../trade/__tests__/fixtures.js';
import { registerGetBalanceTool } from '../get-balance/get-balance.js';

describe('get_balance tool', () => {
    it('reports $CPU and gas', async () => {
        const balance: BalanceResult = {
            address: '0xdead',
            network: Network.ETHEREUM,
            chainId: 1,
            cpu: '12.5',
            native: '0.3',
        };
        const handler = capture(registerGetBalanceTool, { balance: { getBalances: async () => balance } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/Wallet 0xdead/);
        expect(result.content[0]?.text).toMatch(/12.5 \$CPU/);
        expect(result.content[0]?.text).toMatch(/0.3 gas/);
    });
});
