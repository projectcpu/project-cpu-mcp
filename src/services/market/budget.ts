import { MARKET_RETRY_BUDGET_MS, MS_PER_SECOND } from './constants.js';
import { MarketWaitRefusal, type IMarketWaitBudget, type MarketWaitBudgetOptions } from './types.js';
import { sleep } from '../../utils/async.utils.js';

export class MarketWaitBudget implements IMarketWaitBudget {
    private readonly totalMs: number;
    private deadline: number | null;
    private spentMs = 0;

    constructor(options: MarketWaitBudgetOptions) {
        this.totalMs = options.totalMs;
        this.deadline = options.deadlineAtSeconds;
    }

    static openInvocation(): MarketWaitBudget {
        return new MarketWaitBudget({ totalMs: MARKET_RETRY_BUDGET_MS, deadlineAtSeconds: null });
    }

    get remainingMs(): number {
        return Math.max(0, this.totalMs - this.spentMs);
    }

    get deadlineAtSeconds(): number | null {
        return this.deadline;
    }

    narrowDeadlineSeconds(deadlineAtSeconds: number): void {
        this.deadline = this.deadline === null ? deadlineAtSeconds : Math.min(this.deadline, deadlineAtSeconds);
    }

    refuse(delayMs: number): MarketWaitRefusal | null {
        if (delayMs > this.remainingMs) {
            return MarketWaitRefusal.BudgetSpent;
        }
        if (delayMs >= this.deadlineRoomMs()) {
            return MarketWaitRefusal.DeadlineWouldPass;
        }
        return null;
    }

    async wait(delayMs: number): Promise<void> {
        await this.spend(delayMs);
    }

    async waitAtMost(delayMs: number): Promise<number> {
        const affordable = Math.min(delayMs, this.remainingMs, this.deadlineRoomMs());
        if (affordable <= 0) {
            return 0;
        }

        await this.spend(affordable);
        return affordable;
    }

    private async spend(delayMs: number): Promise<void> {
        this.spentMs += delayMs;
        await sleep(delayMs);
    }

    private deadlineRoomMs(): number {
        return this.deadline === null ? Number.POSITIVE_INFINITY : this.deadline * MS_PER_SECOND - Date.now();
    }
}
