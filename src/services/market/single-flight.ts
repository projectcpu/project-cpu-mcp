import type { IMarketSingleFlight } from './action.types.js';

export class MarketSingleFlight implements IMarketSingleFlight {
    private readonly inFlight = new Map<string, Promise<unknown>>();

    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const running = this.inFlight.get(key);
        if (running !== undefined) {
            return running as Promise<T>;
        }

        const started = (async () => operation())();
        this.inFlight.set(key, started);
        void started.catch(() => undefined);

        try {
            return await started;
        } finally {
            this.inFlight.delete(key);
        }
    }
}
