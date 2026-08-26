import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import { currentMarketWaitBudget } from '../../../services/market/budget.scope.js';
import type { AppContext } from '../../../types.js';
import type { ToolHandler, ToolRegistrar } from '../../types.js';
import * as marketRegistrations from '../register.js';

type MarketRegistration = (server: ToolRegistrar, context: AppContext) => void;

interface ObservedRegistration {
    name: string;
    ranInsideBudget: boolean;
}

const MARKETPLACE_TOOL_NAMES = [
    'cpu_accept_cell_offer',
    'cpu_buy_cell',
    'cpu_cancel_order',
    'cpu_get_cell_market',
    'cpu_get_my_listings',
    'cpu_get_my_offers',
    'cpu_get_my_offers_received',
    'cpu_list_cell',
    'cpu_make_cell_offer',
];

async function observeRegistration(register: MarketRegistration): Promise<ObservedRegistration> {
    let ranInsideBudget = false;
    const note = (): void => {
        ranInsideBudget = ranInsideBudget || currentMarketWaitBudget() !== null;
    };

    const service = new Proxy(
        {},
        {
            get: () => async (): Promise<never> => {
                note();
                throw new Error('reaching the marketplace is not part of this check');
            },
        },
    );
    const context = new Proxy({ logger: new NoopLogger() } as Record<string, unknown>, {
        get: (target, property) => (property === 'logger' ? target.logger : service),
    }) as unknown as AppContext;

    let name: string | null = null;
    let handler: ToolHandler | null = null;
    const server = {
        registerTool(registeredName: string, _definition: unknown, registeredHandler: ToolHandler): void {
            name = registeredName;
            handler = registeredHandler;
        },
    } as unknown as ToolRegistrar;

    register(server, context);

    const registeredName = name as string | null;
    const registeredHandler = handler as ToolHandler | null;
    if (registeredName === null || registeredHandler === null) {
        throw new Error('the tool was not registered');
    }

    const args = new Proxy({} as Record<string, unknown>, {
        get: () => {
            note();
            return undefined;
        },
    });
    await Promise.resolve(registeredHandler(args)).catch(() => null);

    return { name: registeredName, ranInsideBudget };
}

async function observeEveryRegistration(): Promise<Array<ObservedRegistration>> {
    const registrations = Object.values(marketRegistrations) as Array<MarketRegistration>;
    const observed: Array<ObservedRegistration> = [];

    for (const register of registrations) {
        observed.push(await observeRegistration(register));
    }

    return observed;
}

describe('the marketplace tool registration seam', () => {
    it('runs every marketplace tool it registers inside one invocation wait budget', async () => {
        const observed = await observeEveryRegistration();

        expect(observed.filter((entry) => !entry.ranInsideBudget).map((entry) => entry.name)).toEqual([]);
    });

    it('registers the whole marketplace surface through that seam and nothing beside it', async () => {
        const observed = await observeEveryRegistration();

        expect(observed.map((entry) => entry.name).sort()).toEqual([...MARKETPLACE_TOOL_NAMES].sort());
    });
});
