import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex, type Log } from 'viem';
import { describe, expect, it } from 'vitest';

import { CELL_ABI } from '../../contracts/cell.abi.js';
import { revealDepositsOf, revealRequestedOf } from '../reveal.utils.js';

const CELL = getAddress('0xcccccccccccccccccccccccccccccccccccccccc');
const OTHER_CONTRACT = getAddress('0xdddddddddddddddddddddddddddddddddddddddd');
const SOURCE = getAddress('0x00000000000000000000000000000000000000a1');
const RESOURCES = { 5: 'Iron', 6: 'Copper' };
const REQUEST_ID = 7n;
const OTHER_REQUEST_ID = 99n;
const TOKEN_ID = 42n;
const OTHER_TOKEN_ID = 43n;

function log(address: Address, topics: unknown, data: Hex): Log {
    return {
        address,
        topics,
        data,
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 0,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

function requestedLog(address: Address, tokenId: bigint, requestId: bigint): Log {
    return log(
        address,
        encodeEventTopics({ abi: CELL_ABI, eventName: 'RevealRequested', args: { tokenId, source: SOURCE } }),
        encodeAbiParameters(
            [{ type: 'uint64' }, { type: 'bool' }, { type: 'uint32' }, { type: 'uint64' }],
            [requestId, true, 1, 1_700_000_000n],
        ),
    );
}

function fulfilledLog(address: Address, tokenId: bigint, requestId: bigint): Log {
    return log(
        address,
        encodeEventTopics({ abi: CELL_ABI, eventName: 'RevealFulfilled', args: { tokenId, source: SOURCE } }),
        encodeAbiParameters(
            [
                { type: 'uint64' },
                { type: 'uint32' },
                { type: 'uint16[3]' },
                { type: 'uint64[3]' },
                { type: 'uint8[3]' },
            ],
            [requestId, 1, [5, 6, 0], [100n, 200n, 0n], [3, 4, 0]],
        ),
    );
}

describe('reveal receipt readers', () => {
    it('reads nothing out of reveal events another contract wrote into the same receipt', () => {
        const logs = [
            requestedLog(OTHER_CONTRACT, TOKEN_ID, REQUEST_ID),
            fulfilledLog(OTHER_CONTRACT, TOKEN_ID, REQUEST_ID),
        ];

        expect(revealRequestedOf(logs, CELL, TOKEN_ID.toString())).toBeNull();
        expect(revealDepositsOf(logs, CELL, REQUEST_ID, RESOURCES)).toBeNull();
    });

    it('reads the request of the cell asked for, never one another cell opened in the same receipt', () => {
        const foreign = requestedLog(CELL, OTHER_TOKEN_ID, OTHER_REQUEST_ID);

        expect(revealRequestedOf([foreign], CELL, TOKEN_ID.toString())).toBeNull();
        expect(
            revealRequestedOf([foreign, requestedLog(CELL, TOKEN_ID, REQUEST_ID)], CELL, TOKEN_ID.toString()),
        ).toEqual({ requestId: REQUEST_ID, source: SOURCE });
    });

    it('reports no deposits when the receipt only fulfils another request', () => {
        const logs = [fulfilledLog(CELL, TOKEN_ID, OTHER_REQUEST_ID)];

        expect(revealDepositsOf(logs, CELL, REQUEST_ID, RESOURCES)).toBeNull();
    });
});
