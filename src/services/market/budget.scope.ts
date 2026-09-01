import { AsyncLocalStorage } from 'node:async_hooks';

import { MarketWaitBudget } from './budget.js';
import type { IMarketWaitBudget } from './types.js';

const invocationScope = new AsyncLocalStorage<IMarketWaitBudget>();

export function runWithMarketWaitBudget<T>(run: () => Promise<T>): Promise<T> {
    return invocationScope.run(MarketWaitBudget.openInvocation(), run);
}

export function currentMarketWaitBudget(): IMarketWaitBudget | null {
    return invocationScope.getStore() ?? null;
}
