import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';

import { LAUNCH_CHAIN_ID } from '../../config/constants.js';
import {
    SEAPORT_ADDRESS,
    SEAPORT_COUNTER_ABI,
    SEAPORT_DOMAIN_NAME,
    SEAPORT_DOMAIN_VERSION,
    SEAPORT_ORDER_COMPONENTS_TYPES,
    SEAPORT_ORDER_PRIMARY_TYPE,
} from '../seaport.constants.js';

describe('the pinned Seaport protocol contract', () => {
    it('is the canonical 1.6 deployment, checksummed exactly as the chain reports it', () => {
        expect(SEAPORT_ADDRESS).toBe('0x0000000000000068F116a894984e2DB1123eB395');
        expect(getAddress(SEAPORT_ADDRESS)).toBe(SEAPORT_ADDRESS);
    });

    it('carries the domain the launch chain verifies signatures against', () => {
        expect(SEAPORT_DOMAIN_NAME).toBe('Seaport');
        expect(SEAPORT_DOMAIN_VERSION).toBe('1.6');
        expect(LAUNCH_CHAIN_ID).toBe(4663);
    });

    it('exposes the maker counter read the protocol contract defines', () => {
        expect(SEAPORT_COUNTER_ABI).toEqual([
            expect.objectContaining({
                type: 'function',
                name: 'getCounter',
                stateMutability: 'view',
                inputs: [{ name: 'offerer', type: 'address' }],
                outputs: [{ name: 'counter', type: 'uint256' }],
            }),
        ]);
    });
});

describe('the signed order struct', () => {
    it('lists the order fields in the exact order the protocol hashes them', () => {
        expect(SEAPORT_ORDER_PRIMARY_TYPE).toBe('OrderComponents');
        expect(SEAPORT_ORDER_COMPONENTS_TYPES.OrderComponents.map((field) => field.name)).toEqual([
            'offerer',
            'zone',
            'offer',
            'consideration',
            'orderType',
            'startTime',
            'endTime',
            'zoneHash',
            'salt',
            'conduitKey',
            'counter',
        ]);
    });

    it('omits the transport-only totalOriginalConsiderationItems field from every signed struct', () => {
        const everyField = Object.values(SEAPORT_ORDER_COMPONENTS_TYPES).flatMap((fields) =>
            fields.map((field) => field.name),
        );

        expect(everyField).not.toContain('totalOriginalConsiderationItems');
    });

    it('declares the item structs the order struct refers to', () => {
        expect(SEAPORT_ORDER_COMPONENTS_TYPES.OfferItem.map((field) => field.type)).toEqual([
            'uint8',
            'address',
            'uint256',
            'uint256',
            'uint256',
        ]);
        expect(SEAPORT_ORDER_COMPONENTS_TYPES.ConsiderationItem.map((field) => field.name)).toContain('recipient');
    });
});
