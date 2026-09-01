import { currentMarketWaitBudget } from './budget.scope.js';
import { sleep } from '../../utils/async.utils.js';

export async function waitOnInvocationBudget(delayMs: number): Promise<number> {
    const budget = currentMarketWaitBudget();
    if (budget === null) {
        await sleep(delayMs);
        return delayMs;
    }

    return budget.waitAtMost(delayMs);
}

export function narrowInvocationDeadline(deadlineAtSeconds: number): void {
    currentMarketWaitBudget()?.narrowDeadlineSeconds(deadlineAtSeconds);
}

export async function waitWithinInvocationBudget(delayMs: number, fallbackRemainingMs: number): Promise<boolean> {
    const budget = currentMarketWaitBudget();

    if (budget === null) {
        if (delayMs > fallbackRemainingMs) {
            return false;
        }
        await sleep(delayMs);
        return true;
    }

    if (budget.refuse(delayMs) !== null) {
        return false;
    }

    await budget.wait(delayMs);
    return true;
}
