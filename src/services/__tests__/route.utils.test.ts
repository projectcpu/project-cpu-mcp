import { describe, expect, it } from 'vitest';

import { effectiveTransitFee, waypointTransitFee, type RouteNode } from '../route.utils.js';

const FLOORS: Record<number, string> = { 3: '0.1', 9: '0.5' };

const foreignHub: RouteNode = { tokenId: '75', isOwn: false, isHub: true };
const ownCell: RouteNode = { tokenId: '72', isOwn: true, isHub: false };
const ownHub: RouteNode = { tokenId: '80', isOwn: true, isHub: true };
const foreignPlain: RouteNode = { tokenId: '90', isOwn: false, isHub: false };

describe('effectiveTransitFee', () => {
    it('returns the resource floor when there is no override', () => {
        expect(effectiveTransitFee(null, 3, FLOORS)).toBe('0.1');
        expect(effectiveTransitFee({}, 3, FLOORS)).toBe('0.1');
    });

    it('returns a present non-zero override over the floor', () => {
        expect(effectiveTransitFee({ 3: '0.7' }, 3, FLOORS)).toBe('0.7');
    });

    it('grandfathers an override that sits below a later-raised floor', () => {
        expect(effectiveTransitFee({ 3: '0.05' }, 3, { 3: '0.2' })).toBe('0.05');
    });

    it("treats a '0' override as cleared and falls back to the floor", () => {
        expect(effectiveTransitFee({ 3: '0' }, 3, FLOORS)).toBe('0.1');
    });

    it('resolves against the requested resource id, not another override on the cell', () => {
        expect(effectiveTransitFee({ 3: '0.7' }, 9, FLOORS)).toBe('0.5');
    });
});

describe('waypointTransitFee', () => {
    it('charges the effective fee only at a foreign hub', () => {
        expect(waypointTransitFee(foreignHub, { 3: '0.5' }, 3, FLOORS)).toBe('0.5');
        expect(waypointTransitFee(foreignHub, null, 3, FLOORS)).toBe('0.1');
    });

    it('is null on your own cell even when it carries a hub', () => {
        expect(waypointTransitFee(ownCell, null, 3, FLOORS)).toBeNull();
        expect(waypointTransitFee(ownHub, { 3: '0.5' }, 3, FLOORS)).toBeNull();
    });

    it('is null on a foreign non-hub node', () => {
        expect(waypointTransitFee(foreignPlain, null, 3, FLOORS)).toBeNull();
    });
});
