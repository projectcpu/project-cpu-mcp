import { describe, expect, it } from 'vitest';

import { MarketActionTool, type MarketRecoveryRecord } from '../action.types.js';
import { MarketError } from '../error.js';
import { MARKET_UNRESOLVED_ACTION_LIMIT } from '../recovery.constants.js';
import { MarketRecoveryStore } from '../recovery.store.js';
import { MarketActionStage, MarketErrorCode } from '../types.js';

function record(payload: unknown): MarketRecoveryRecord {
    return { tool: MarketActionTool.ListCell, stage: MarketActionStage.Submit, payload };
}

function fill(store: MarketRecoveryStore, count: number): void {
    for (let index = 0; index < count; index += 1) {
        store.write(`key-${index}`, record({ index }));
    }
}

describe('the bounded store of unresolved actions', () => {
    it('hands a written record back under its own action key', () => {
        const store = new MarketRecoveryStore();
        store.write('key', record({ prepareId: 'p' }));

        expect(store.read<{ prepareId: string }>('key')?.payload).toEqual({ prepareId: 'p' });
        expect(store.read('missing')).toBeNull();
        expect(store.size()).toBe(1);
    });

    it('forgets a record once its action is resolved', () => {
        const store = new MarketRecoveryStore();
        store.write('key', record(null));

        store.forget('key');

        expect(store.read('key')).toBeNull();
        expect(store.size()).toBe(0);
    });

    it('lets an unresolved action advance its own stage without consuming more capacity', () => {
        const store = new MarketRecoveryStore();
        fill(store, MARKET_UNRESOLVED_ACTION_LIMIT);

        store.write('key-0', { tool: MarketActionTool.ListCell, stage: MarketActionStage.Sign, payload: { index: 0 } });

        expect(store.size()).toBe(MARKET_UNRESOLVED_ACTION_LIMIT);
        expect(store.read('key-0')?.stage).toBe(MarketActionStage.Sign);
    });

    it('refuses the next new action instead of evicting an unresolved one', () => {
        const store = new MarketRecoveryStore();
        fill(store, MARKET_UNRESOLVED_ACTION_LIMIT);

        const error = (() => {
            try {
                store.write('one-too-many', record(null));
                return null;
            } catch (thrown: unknown) {
                return thrown as MarketError;
            }
        })();

        expect(error).toBeInstanceOf(MarketError);
        expect(error?.code).toBe(MarketErrorCode.UnresolvedCapacityFull);
        expect(error?.retryable).toBe(true);
        expect(store.size()).toBe(MARKET_UNRESOLVED_ACTION_LIMIT);
        expect(store.read('key-0')).not.toBeNull();
        expect(store.read('one-too-many')).toBeNull();
    });

    it('admits a new action again once a resolved one frees its slot', () => {
        const store = new MarketRecoveryStore();
        fill(store, MARKET_UNRESOLVED_ACTION_LIMIT);

        store.forget('key-7');
        store.write('one-more', record(null));

        expect(store.size()).toBe(MARKET_UNRESOLVED_ACTION_LIMIT);
        expect(store.read('one-more')).not.toBeNull();
    });

    it('bounds unresolved memory at one hundred actions', () => {
        expect(MARKET_UNRESOLVED_ACTION_LIMIT).toBe(100);
    });
});
