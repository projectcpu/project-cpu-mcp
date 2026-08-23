import { describe, expect, it } from 'vitest';

import { BuildingKind } from '../../api/types.js';
import {
    effectiveNodeRadius,
    effectiveTransitFee,
    hopReachLimit,
    isHopLegal,
    radiusPolicy,
    waypointTransitFee,
    type RouteNode,
} from '../route.utils.js';

const FLOORS: Record<number, string> = { 3: '0.1', 9: '0.5' };

const foreignHub: RouteNode = { tokenId: '75', isOwn: false, isHub: true, radius: 5 };
const ownCell: RouteNode = { tokenId: '72', isOwn: true, isHub: false, radius: 1 };
const ownHub: RouteNode = { tokenId: '80', isOwn: true, isHub: true, radius: 5 };
const foreignPlain: RouteNode = { tokenId: '90', isOwn: false, isHub: false, radius: 1 };

const BASE_HUB = 'hub';
const MID_HUB = 'hub_l2a';
const TOP_HUB = 'hub_l3a';

const LADDER = [
    { type: BASE_HUB, kind: BuildingKind.Hub, radius: 5 },
    { type: MID_HUB, kind: BuildingKind.Hub, radius: 8 },
    { type: TOP_HUB, kind: BuildingKind.Hub, radius: 13 },
    { type: 'mine', kind: BuildingKind.Extractor, radius: 0 },
];

function policy(moveRadius = 1, hubRadius = 5) {
    return radiusPolicy({ moveRadius, hubRadius }, LADDER);
}

function node(radius: number, tokenId = '1'): RouteNode {
    return { tokenId, isOwn: true, isHub: radius > 1, radius };
}

function cell(type: string | null, activeHub: boolean) {
    return { activeHub, building: type === null ? null : { type } };
}

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

describe('effectiveNodeRadius', () => {
    it('gives a cell with no building the runtime move radius', () => {
        expect(effectiveNodeRadius(cell(null, false), policy())).toBe(1);
        expect(effectiveNodeRadius(cell(null, false), policy(2))).toBe(2);
    });

    it('gives a ready hub the radius its own catalog row carries, tier by tier', () => {
        expect(effectiveNodeRadius(cell(BASE_HUB, true), policy())).toBe(5);
        expect(effectiveNodeRadius(cell(MID_HUB, true), policy())).toBe(8);
        expect(effectiveNodeRadius(cell(TOP_HUB, true), policy())).toBe(13);
    });

    it('leaves a hub upgrade still under construction on plain move reach', () => {
        expect(effectiveNodeRadius(cell(MID_HUB, false), policy())).toBe(1);
        expect(effectiveNodeRadius(cell(MID_HUB, false), policy(2))).toBe(2);
    });

    it('gives a ready hub the catalog does not name the served default hub radius', () => {
        expect(effectiveNodeRadius(cell('hub_l4z', true), policy(1, 5))).toBe(5);
    });

    it('never lends hub reach to a ready building of another kind', () => {
        expect(effectiveNodeRadius(cell('mine', false), policy())).toBe(1);
    });
});

describe('hop reach', () => {
    it('lets two plain cells reach exactly the move radius pair sum, one short of it and no further', () => {
        const plain = node(1, '1');
        const other = node(1, '2');

        expect(hopReachLimit(plain, other)).toBe(1);
        expect(isHopLegal(plain, other, 1)).toBe(true);
        expect(isHopLegal(plain, other, 2)).toBe(false);
    });

    it('scales the plain-to-hub limit with the concrete hub radius', () => {
        const plain = node(1, '1');

        expect(hopReachLimit(plain, node(5, '2'))).toBe(5);
        expect(hopReachLimit(plain, node(8, '3'))).toBe(8);
        expect(hopReachLimit(plain, node(13, '4'))).toBe(13);
    });

    it('sums both endpoints on a hub-to-hub hop instead of assuming one shared hub reach', () => {
        expect(hopReachLimit(node(8, '1'), node(13, '2'))).toBe(20);
        expect(isHopLegal(node(8, '1'), node(13, '2'), 20)).toBe(true);
        expect(isHopLegal(node(8, '1'), node(13, '2'), 21)).toBe(false);
    });

    it('holds exactly at the limit and one step beyond it for a mixed pair', () => {
        const plain = node(1, '1');
        const upgraded = node(8, '2');

        expect(isHopLegal(plain, upgraded, 8)).toBe(true);
        expect(isHopLegal(plain, upgraded, 9)).toBe(false);
    });

    it('saturates at zero when both configured radii are zero, so no hop is legal', () => {
        const dead = node(0, '1');
        const other = node(0, '2');

        expect(hopReachLimit(dead, other)).toBe(0);
        expect(isHopLegal(dead, other, 1)).toBe(false);
    });

    it('follows a move radius that is not one', () => {
        const plain = { ...node(1, '1'), radius: effectiveNodeRadius(cell(null, false), policy(2)) };
        const other = { ...node(1, '2'), radius: effectiveNodeRadius(cell(null, false), policy(2)) };

        expect(hopReachLimit(plain, other)).toBe(3);
        expect(isHopLegal(plain, other, 3)).toBe(true);
        expect(isHopLegal(plain, other, 4)).toBe(false);
    });
});
