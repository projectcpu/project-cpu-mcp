import { describe, expect, it } from 'vitest';

import { ToolEventType } from '../types.js';

const WIRE: ReadonlyArray<[string, ToolEventType, string]> = [
    ['CellRevealed', ToolEventType.CellRevealed, 'cell_revealed'],
    ['BuildStarted', ToolEventType.BuildStarted, 'build_started'],
    ['UpgradeStarted', ToolEventType.UpgradeStarted, 'upgrade_started'],
    ['BuildingDemolished', ToolEventType.BuildingDemolished, 'building_demolished'],
    ['MiningStarted', ToolEventType.MiningStarted, 'mining_started'],
    ['MiningClaimed', ToolEventType.MiningClaimed, 'mining_claimed'],
    ['CraftStarted', ToolEventType.CraftStarted, 'craft_started'],
    ['CraftClaimed', ToolEventType.CraftClaimed, 'craft_claimed'],
    ['TransportSent', ToolEventType.TransportSent, 'transport_sent'],
    ['DeliveryFinalized', ToolEventType.DeliveryFinalized, 'delivery_finalized'],
    ['LotCreated', ToolEventType.LotCreated, 'lot_created'],
    ['LotBought', ToolEventType.LotBought, 'lot_bought'],
    ['LotReturned', ToolEventType.LotReturned, 'lot_returned'],
    ['LotEvicted', ToolEventType.LotEvicted, 'lot_evicted'],
    ['HubFeeSet', ToolEventType.HubFeeSet, 'hub_fee_set'],
    ['Swapped', ToolEventType.Swapped, 'swapped'],
    ['Withdrawn', ToolEventType.Withdrawn, 'withdrawn'],
    ['CellMinted', ToolEventType.CellMinted, 'cell_minted'],
    ['SyndicateJoined', ToolEventType.SyndicateJoined, 'syndicate_joined'],
    ['SyndicateLeft', ToolEventType.SyndicateLeft, 'syndicate_left'],
    ['SyndicateCreated', ToolEventType.SyndicateCreated, 'syndicate_created'],
    ['SyndicateManagerChanged', ToolEventType.SyndicateManagerChanged, 'syndicate_manager_changed'],
    ['SyndicateParamsChanged', ToolEventType.SyndicateParamsChanged, 'syndicate_params_changed'],
    ['RevealFulfilled', ToolEventType.RevealFulfilled, 'reveal_fulfilled'],
];

describe('tool event type', () => {
    it.each(WIRE)('sends %s over the wire as its own literal', (_name, member, wire) => {
        expect(member).toBe(wire);
    });

    it('keeps every value distinct, so no two events collapse into one branch', () => {
        const values = Object.values(ToolEventType);

        expect(new Set(values).size).toBe(values.length);
        expect(new Set(WIRE.map(([, member]) => member)).size).toBe(WIRE.length);
    });

    it('pins every enum member with a wire literal, so a new value cannot go unpinned', () => {
        const members = Object.values(ToolEventType);
        const pinned = WIRE.map(([, member]) => member);

        expect(pinned.sort()).toEqual([...members].sort());
    });

    it('names no failure: a failed action has no response body to carry it', () => {
        for (const [name, value] of Object.entries(ToolEventType)) {
            expect(name).not.toMatch(/fail|error|reject/iu);
            expect(value).not.toMatch(/fail|error|reject/iu);
        }
    });

    it('names no next action: the agent builds the strategy, the server does not dictate it', () => {
        for (const [name, value] of Object.entries(ToolEventType)) {
            expect(name).not.toMatch(/next|recommend|suggest/iu);
            expect(value).not.toMatch(/next|recommend|suggest/iu);
        }
    });
});
