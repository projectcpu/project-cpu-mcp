import type { IMarketRecoveryStore, MarketRecoveryRecord } from './action.types.js';
import { MarketError } from './error.js';
import { MARKET_UNRESOLVED_ACTION_LIMIT } from './recovery.constants.js';
import { MarketErrorCode } from './types.js';

export class MarketRecoveryStore implements IMarketRecoveryStore {
    private readonly records = new Map<string, MarketRecoveryRecord>();

    read<TPayload>(key: string): MarketRecoveryRecord<TPayload> | null {
        return (this.records.get(key) as MarketRecoveryRecord<TPayload> | undefined) ?? null;
    }

    write(key: string, record: MarketRecoveryRecord): void {
        if (!this.records.has(key) && this.records.size >= MARKET_UNRESOLVED_ACTION_LIMIT) {
            throw new MarketError({
                code: MarketErrorCode.UnresolvedCapacityFull,
                message:
                    `This process is already holding ${MARKET_UNRESOLVED_ACTION_LIMIT} unresolved marketplace ` +
                    'actions, and none of them may be dropped to make room — dropping one could publish a ' +
                    `duplicate order. The outstanding work belongs to: ${this.outstandingTools()}. Resolve or ` +
                    'retry those actions, then call this tool again.',
                retryable: true,
                retryAfterSeconds: null,
                stage: record.stage,
                txHash: null,
            });
        }

        this.records.set(key, record);
    }

    forget(key: string): void {
        this.records.delete(key);
    }

    size(): number {
        return this.records.size;
    }

    // Names the tools that hold the bound, so a refused write tells the agent what to go and resolve
    // rather than only that it is full.
    private outstandingTools(): string {
        const counts = new Map<string, number>();
        for (const held of this.records.values()) {
            counts.set(held.tool, (counts.get(held.tool) ?? 0) + 1);
        }

        return [...counts.entries()]
            .sort(([first], [second]) => first.localeCompare(second))
            .map(([tool, count]) => `${tool} (${count})`)
            .join(', ');
    }
}
