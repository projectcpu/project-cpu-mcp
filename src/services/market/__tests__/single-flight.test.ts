import { describe, expect, it } from 'vitest';

import { MarketSingleFlight } from '../single-flight.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('concurrent calls that share one action key', () => {
    it('run the operation once and hand every caller the same result', async () => {
        const flight = new MarketSingleFlight();
        const gate = deferred<string>();
        let runs = 0;

        const first = flight.run('key', async () => {
            runs += 1;
            return gate.promise;
        });
        const second = flight.run('key', async () => {
            runs += 1;
            return gate.promise;
        });
        gate.resolve('published');

        await expect(Promise.all([first, second])).resolves.toEqual(['published', 'published']);
        expect(runs).toBe(1);
    });

    it('gives every waiting caller the same failure rather than repeating the operation', async () => {
        const flight = new MarketSingleFlight();
        const gate = deferred<string>();
        let runs = 0;
        const start = (): Promise<string> =>
            flight.run('key', async () => {
                runs += 1;
                return gate.promise;
            });

        const first = start();
        const second = start();
        gate.reject(new Error('submit lost'));

        await expect(first).rejects.toThrow('submit lost');
        await expect(second).rejects.toThrow('submit lost');
        expect(runs).toBe(1);
    });

    it('keeps different action keys independent', async () => {
        const flight = new MarketSingleFlight();
        let runs = 0;
        const run = (key: string): Promise<number> =>
            flight.run(key, async () => {
                runs += 1;
                return runs;
            });

        await expect(Promise.all([run('a'), run('b')])).resolves.toEqual([1, 2]);
        expect(runs).toBe(2);
    });

    it('releases the key once the operation settles, so a later retry really runs again', async () => {
        const flight = new MarketSingleFlight();
        let runs = 0;
        const run = (): Promise<number> =>
            flight.run('key', async () => {
                runs += 1;
                return runs;
            });

        await run();
        await run();

        expect(runs).toBe(2);
    });

    it('releases the key after a failure too', async () => {
        const flight = new MarketSingleFlight();
        let runs = 0;
        const run = (): Promise<never> =>
            flight.run('key', async () => {
                runs += 1;
                throw new Error('boom');
            });

        await expect(run()).rejects.toThrow('boom');
        await expect(run()).rejects.toThrow('boom');
        expect(runs).toBe(2);
    });
});
