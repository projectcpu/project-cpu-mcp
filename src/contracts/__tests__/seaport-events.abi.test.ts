import { toEventSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import { SEAPORT_EVENTS_ABI } from '../seaport-events.abi.js';

function eventNamed(name: string) {
    const found = SEAPORT_EVENTS_ABI.find((entry) => entry.type === 'event' && entry.name === name);
    if (found === undefined) {
        throw new Error(`the ABI declares no ${name} event`);
    }
    return found;
}

function componentNames(event: { inputs: ReadonlyArray<{ name: string }> }, field: string): Array<string> {
    const input = event.inputs.find((entry) => entry.name === field) as unknown as {
        components: ReadonlyArray<{ name: string }> | undefined;
    };
    return (input.components ?? []).map((component) => component.name);
}

describe('the Seaport order event ABI', () => {
    it('declares OrderFulfilled with the field order the deployed contract emits', () => {
        const event = eventNamed('OrderFulfilled');

        expect(event.inputs.map((input) => input.name)).toEqual([
            'orderHash',
            'offerer',
            'zone',
            'recipient',
            'offer',
            'consideration',
        ]);
        expect(event.inputs.map((input) => input.indexed)).toEqual([false, true, true, false, false, false]);
    });

    it('describes the offered and received item structs the event carries', () => {
        const event = eventNamed('OrderFulfilled');
        expect(componentNames(event, 'offer')).toEqual(['itemType', 'token', 'identifier', 'amount']);
        expect(componentNames(event, 'consideration')).toEqual([
            'itemType',
            'token',
            'identifier',
            'amount',
            'recipient',
        ]);
    });

    it('declares OrderCancelled with the maker and zone the deployed contract indexes', () => {
        const event = eventNamed('OrderCancelled');

        expect(event.inputs.map((input) => input.name)).toEqual(['orderHash', 'offerer', 'zone']);
        expect(event.inputs.map((input) => input.indexed)).toEqual([false, true, true]);
    });

    it('hashes to the topics the deployed contract emits', () => {
        expect(toEventSelector(eventNamed('OrderFulfilled'))).toBe(
            '0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31',
        );
        expect(toEventSelector(eventNamed('OrderCancelled'))).toBe(
            '0x6bacc01dbe442496068f7d234edd811f1a5f833243e0aec824f86ab861f3c90d',
        );
    });
});
