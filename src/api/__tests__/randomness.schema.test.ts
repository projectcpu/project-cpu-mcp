import { describe, expect, it } from 'vitest';

import { randomnessDescriptorSchema, RandomnessKind } from '../types.js';

function drandDescriptor(overrides: Record<string, unknown> = {}): unknown {
    return {
        kind: 'drand',
        adapter: '',
        genesis: 1_700_000_000,
        period: 30,
        beaconApi: 'http://127.0.0.1:3139',
        ...overrides,
    };
}

describe('randomnessDescriptorSchema', () => {
    it('discriminates the push source by its kind and carries only the adapter address', () => {
        const parsed = randomnessDescriptorSchema.parse({
            kind: 'entropy',
            adapter: '0x00000000000000000000000000000000000000a1',
        });

        expect(parsed.kind).toBe(RandomnessKind.ENTROPY);
        expect(parsed).toEqual({ kind: 'entropy', adapter: '0x00000000000000000000000000000000000000a1' });
    });

    it('discriminates the self-service source by its kind and carries the beacon params', () => {
        const parsed = randomnessDescriptorSchema.parse({
            kind: 'drand',
            adapter: '0x00000000000000000000000000000000000000a2',
            genesis: 1_700_000_000,
            period: 3,
            beaconApi: 'https://beacon.example/v2/chains/abc',
        });

        expect(parsed.kind).toBe(RandomnessKind.DRAND);
        expect(parsed).toEqual({
            kind: 'drand',
            adapter: '0x00000000000000000000000000000000000000a2',
            genesis: 1_700_000_000,
            period: 3,
            beaconApi: 'https://beacon.example/v2/chains/abc',
        });
    });

    it('accepts an adapter address the stand fills in only after deployment', () => {
        expect(randomnessDescriptorSchema.parse({ kind: 'entropy', adapter: '' })).toEqual({
            kind: 'entropy',
            adapter: '',
        });
        expect(
            randomnessDescriptorSchema.parse({
                kind: 'drand',
                adapter: '',
                genesis: 1,
                period: 30,
                beaconApi: 'http://127.0.0.1:3139',
            }).adapter,
        ).toBe('');
    });

    it('rejects a kind outside the union', () => {
        expect(() => randomnessDescriptorSchema.parse({ kind: 'oracle', adapter: '' })).toThrow();
    });

    it('rejects a self-service descriptor without beacon params', () => {
        expect(() => randomnessDescriptorSchema.parse({ kind: 'drand', adapter: '' })).toThrow();
    });

    it('rejects beacon params that are not whole numbers', () => {
        expect(() =>
            randomnessDescriptorSchema.parse({
                kind: 'drand',
                adapter: '',
                genesis: 1_700_000_000.5,
                period: 30,
                beaconApi: 'http://127.0.0.1:3139',
            }),
        ).toThrow();
    });

    it('rejects a zero beacon period rather than passing a division by zero downstream', () => {
        expect(() => randomnessDescriptorSchema.parse(drandDescriptor({ period: 0 }))).toThrow();
    });

    it('rejects a negative beacon period', () => {
        expect(() => randomnessDescriptorSchema.parse(drandDescriptor({ period: -30 }))).toThrow();
    });

    it('rejects a non-positive genesis timestamp', () => {
        expect(() => randomnessDescriptorSchema.parse(drandDescriptor({ genesis: 0 }))).toThrow();
        expect(() => randomnessDescriptorSchema.parse(drandDescriptor({ genesis: -1 }))).toThrow();
    });

    it('rejects a beacon base that is not a url', () => {
        expect(() => randomnessDescriptorSchema.parse(drandDescriptor({ beaconApi: '' }))).toThrow();
        expect(() => randomnessDescriptorSchema.parse(drandDescriptor({ beaconApi: 'not-a-url' }))).toThrow();
    });
});
